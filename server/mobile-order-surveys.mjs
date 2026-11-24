import {createHash,timingSafeEqual} from 'node:crypto'
import {decryptCredential} from './integration-crypto.mjs'
import {readMobileInteraction} from './tuverso-mobile-connector.mjs'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const APP=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/
const TAGS=new Set(['Sabor','Temperatura','Tiempo','Presentación','Atención'])
const fail=(code,message)=>Object.assign(new Error(message),{code})
const equal=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b))
const ref=(tenant,app,store,key)=>'mobile:'+createHash('sha256').update([tenant,app,store,key].join(':')).digest('hex').slice(0,48)
const output=row=>({surveyId:row.id,interactionId:row.interaction_id,stored:true,createdAt:new Date(row.created_at).toISOString()})
export function validateSurvey(v){
 if(!v||typeof v!=='object'||Array.isArray(v)||
    Object.keys(v).some(k=>!['appId','storeId','rating','tags','comment'].includes(k))||
    !APP.test(v.appId)||!UUID.test(v.storeId)||
    !Number.isInteger(v.rating)||v.rating<1||v.rating>5||
    !Array.isArray(v.tags)||v.tags.length>5||
    v.tags.some(t=>typeof t!=='string'||!TAGS.has(t))||
    new Set(v.tags).size!==v.tags.length||
    (v.comment!==undefined&&(typeof v.comment!=='string'||v.comment.length>500||/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(v.comment))))
  throw fail(400,'Encuesta inválida')
 return {appId:v.appId,storeId:v.storeId,rating:v.rating,tags:v.tags,comment:v.comment??null}
}
const identical=(row,v)=>row.store_id===v.storeId&&Number(row.rating)===v.rating&&
 JSON.stringify(row.tags)===JSON.stringify(v.tags)&&(row.comment??null)===v.comment
const counters=new Map()
function throttle(req){
 const ip=req.socket?.remoteAddress||'unknown',now=Date.now()
 if(counters.size>3000)counters.clear()
 const v=counters.get(ip)
 if(!v||now-v.since>60000){counters.set(ip,{since:now,count:1});return}
 if(++v.count>10)throw fail(429,'Demasiadas encuestas')
}
export function createMobileSurveyRoute({pool,body,json,readInteraction=readMobileInteraction,decrypt=decryptCredential,rateLimit=throttle}){
 return async ({req,res,url})=>{
  const match=url.pathname.match(/^\/api\/v1\/mobile\/orders\/([0-9a-f-]{36})\/survey$/i)
  if(!match)return false
  try{
   if(req.method!=='POST')throw fail(405,'Método no permitido')
   rateLimit(req)
   const interactionId=match[1],access=req.headers['x-order-access-key'],key=req.headers['idempotency-key']
   if(!UUID.test(interactionId)||!UUID.test(access||'')||!UUID.test(key||''))throw fail(400,'Identificadores inválidos')
   const survey=validateSurvey(await body(req))
   const catalogs=await pool.query(`SELECT p.tenant_id,p.payload FROM published_catalogs p
    JOIN mobile_apps a ON a.app_id=p.app_id AND a.tenant_id=p.tenant_id
    JOIN tenants t ON t.id=p.tenant_id WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[survey.appId])
   if(catalogs.rowCount!==1)throw fail(404,'Aplicación inexistente')
   const tenantId=catalogs.rows[0].tenant_id
   if(!catalogs.rows[0].payload?.stores?.some(s=>s.id===survey.storeId))throw fail(403,'Sede no autorizada')
   const bindings=await pool.query(`SELECT i.id AS integration_id,i.encrypted_credential,i.expires_at,
    i.suspended,i.channel_type,b.external_location_id FROM integration_bindings b
    JOIN tenant_integrations i ON i.id=b.integration_id AND i.tenant_id=b.tenant_id
    WHERE b.tenant_id=$1 AND b.app_id=$2 AND b.store_id=$3 AND b.purpose='ORDER_REQUEST'
    AND b.authorization_confirmed_at IS NOT NULL`,[tenantId,survey.appId,survey.storeId])
   if(bindings.rowCount!==1)throw fail(403,'Integración no autorizada')
   const b=bindings.rows[0]
   if(b.suspended||!b.encrypted_credential||b.expires_at&&new Date(b.expires_at)<=new Date()||
      b.channel_type&&b.channel_type!=='MOBILE_APP')throw fail(403,'Credenciales inválidas')
   const token=decrypt(b.encrypted_credential,tenantId,b.integration_id)
   const remote=await readInteraction(token,interactionId)
   if(!remote.ok)throw fail(remote.httpStatus===404?404:[401,403].includes(remote.httpStatus)?403:503,'No se pudo verificar la interacción')
   if(remote.data?.interactionId!==interactionId||
      !equal(remote.data.externalReference,ref(tenantId,survey.appId,survey.storeId,access))||
      remote.data.externalLocationId!==b.external_location_id||remote.data.purpose!=='ORDER_REQUEST')
    throw fail(403,'Interacción no autorizada')
   // Android alone chooses when to display surveys; technical state may be closed.
   let row,status
   try{
    const saved=await pool.query(`INSERT INTO mobile_order_surveys
     (tenant_id,app_id,store_id,interaction_id,idempotency_key,rating,tags,comment)
     VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8) ON CONFLICT DO NOTHING
     RETURNING id,interaction_id,created_at,rating,tags,comment,store_id,idempotency_key`,
     [tenantId,survey.appId,survey.storeId,interactionId,key,survey.rating,JSON.stringify(survey.tags),survey.comment])
    if(saved.rowCount===1){row=saved.rows[0];status=201}
    else{
     const existing=await pool.query(`SELECT id,interaction_id,created_at,rating,tags,comment,store_id,idempotency_key
      FROM mobile_order_surveys WHERE tenant_id=$1 AND app_id=$2 AND (interaction_id=$3 OR idempotency_key=$4)`,
      [tenantId,survey.appId,interactionId,key])
     if(existing.rowCount!==1||existing.rows[0].interaction_id!==interactionId||
        existing.rows[0].idempotency_key!==key||!identical(existing.rows[0],survey))
      throw fail(409,'Ya existe una encuesta diferente')
     row=existing.rows[0];status=200
    }
   }catch(err){
    if(err.code===409)throw err
    throw fail(503,'Almacenamiento no disponible')
   }
   json(res,status,output(row))
  }catch(error){
   const status=Number.isInteger(error?.code)&&error.code>=400&&error.code<=599?error.code:503
   json(res,status,{error:status===503?'Servicio de encuestas temporalmente no disponible':error.message})
  }
  return true
 }
}
const ISO_DAY=/^\d{4}-\d{2}-\d{2}$/
const day=v=>typeof v==='string'&&ISO_DAY.test(v)&&!Number.isNaN(Date.parse(v+'T00:00:00Z'))&&new Date(v+'T00:00:00Z').toISOString().slice(0,10)===v
export function parseSurveyFilters(p){
 const permitted=new Set(['tenantId','storeId','from','to','rating','appId','limit','offset'])
 if([...p.keys()].some(k=>!permitted.has(k)||p.getAll(k).length!==1))throw fail(400,'Filtros inválidos')
 const storeId=p.get('storeId'),from=p.get('from'),to=p.get('to'),rating=p.get('rating'),appId=p.get('appId')
 const l=p.get('limit')??'20',o=p.get('offset')??'0'
 if(storeId!==null&&!UUID.test(storeId)||from!==null&&!day(from)||to!==null&&!day(to)||
    from!==null&&to!==null&&from>to||rating!==null&&!/^[1-5]$/.test(rating)||
    appId!==null&&!APP.test(appId)||!/^[1-9]\d*$/.test(l)||Number(l)>100||
    !/^(0|[1-9]\d*)$/.test(o)||Number(o)>1000000)throw fail(400,'Filtros inválidos')
 return {storeId,from,to,rating:rating===null?null:Number(rating),appId,limit:Number(l),offset:Number(o)}
}
export async function adminSurveyList({pool,user,params}){
 const f=parseSurveyFilters(params)
 const requested=params.get('tenantId')
 const tenantId=user.role==='SUPER_ADMIN'?requested:user.tenant_id
 if(!UUID.test(tenantId||'')||(user.role!=='SUPER_ADMIN'&&requested!==null&&requested!==tenantId))
  throw fail(403,'Empresa no autorizada')
 const where=['s.tenant_id=$1'],args=[tenantId]
 if(f.storeId){args.push(f.storeId);where.push('s.store_id=$'+args.length)}
 if(f.appId){args.push(f.appId);where.push('s.app_id=$'+args.length)}
 if(f.rating){args.push(f.rating);where.push('s.rating=$'+args.length)}
 if(f.from){args.push(f.from);where.push('s.created_at >= $'+args.length+'::date')}
 if(f.to){args.push(f.to);where.push("s.created_at < ($"+args.length+"::date + interval '1 day')")}
 const predicate=where.join(' AND ')
 const count=await pool.query('SELECT count(*)::int AS total FROM mobile_order_surveys s JOIN tenants t ON t.id=s.tenant_id AND t.active=true WHERE '+predicate,args)
 const records=await pool.query('SELECT s.id,s.app_id,s.store_id,s.interaction_id,s.rating,s.tags,s.comment,s.created_at FROM mobile_order_surveys s JOIN tenants t ON t.id=s.tenant_id AND t.active=true WHERE '+predicate+' ORDER BY s.created_at DESC,s.id DESC LIMIT $'+(args.length+1)+' OFFSET $'+(args.length+2),[...args,f.limit,f.offset])
 return {items:records.rows.map(x=>({surveyId:x.id,appId:x.app_id,storeId:x.store_id,interactionId:x.interaction_id,
  rating:x.rating,tags:x.tags,comment:x.comment,createdAt:new Date(x.created_at).toISOString()})),
  total:count.rows[0].total,limit:f.limit,offset:f.offset}
}
