import {createHash} from 'node:crypto'
import {decryptCredential} from './integration-crypto.mjs'
import {checkAvailability,connectionMode} from './tuverso-client.mjs'
import {createMobileInteraction,mobileInteractionMode} from './tuverso-mobile-connector.mjs'
import {calculateOrderCart} from './mobile-order-availability.mjs'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const VALID_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const APP=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/
const fail=(code,message)=>Object.assign(new Error(message),{code})
const validText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value)
const plainObject=value=>value&&typeof value==='object'&&!Array.isArray(value)
const safeError=error=>Number.isInteger(error?.code)&&error.code>=400&&error.code<=599?error.code:503
const counter=new Map()
function throttled(req){
 const key=req.socket?.remoteAddress||'unknown',now=Date.now()
 if(counter.size>5000)counter.clear()
 const current=counter.get(key)
 const max=req.method==='GET'?60:10
 if(!current||now-current.since>=60000){counter.set(key,{since:now,count:1});return}
 if(++current.count>max)throw fail(429,'Demasiadas solicitudes; vuelve a intentarlo más tarde')
}
function publicStore(payload,storeId){
 const store=payload?.stores?.find(store=>store.id===storeId)
 if(!store||store.active===false||store.consultOrderAvailability!==true)throw fail(409,'La sede no está habilitada para consultar atención')
 return store
}
function authorizedHour(store,storeOpen){
 if(!storeOpen(store))throw fail(409,'La sede no está abierta o habilitada')
}
export function createMobileTuVersoRoutes({pool,body,json,storeOpen,
 availability=checkAvailability,createInteraction=createMobileInteraction,decrypt=decryptCredential,
 checkMode=connectionMode,interactionMode=mobileInteractionMode,rateLimit=throttled}){
 async function context(appId,storeId){
  const result=await pool.query(`SELECT p.tenant_id,p.revision,p.payload
   FROM published_catalogs p
   JOIN mobile_apps a ON a.app_id=p.app_id AND a.tenant_id=p.tenant_id
   JOIN tenants t ON t.id=p.tenant_id
   WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[appId])
  if(result.rowCount!==1)throw fail(409,'Aplicación sin catálogo publicado')
  const catalog=result.rows[0]
  const store=publicStore(catalog.payload,storeId)
  authorizedHour(store,storeOpen)
  const live=await pool.query(`SELECT s.active,s.delivery_enabled,s.opening_hours,t.time_zone
   FROM stores s JOIN tenants t ON t.id=s.tenant_id
   WHERE s.tenant_id=$1 AND s.id=$2 AND t.active=true`,[catalog.tenant_id,storeId])
  if(live.rowCount!==1||!live.rows[0].active||!live.rows[0].delivery_enabled||!storeOpen({
   ...store,openingHours:live.rows[0].opening_hours
  },live.rows[0].time_zone))throw fail(409,'La sede ya no está abierta o habilitada')
  return {tenantId:catalog.tenant_id,revision:catalog.revision,payload:catalog.payload,store}
 }
 async function binding(tenantId,appId,storeId,kind){
  const result=await pool.query(`SELECT i.id AS integration_id,i.encrypted_credential,i.expires_at,i.suspended,i.scopes,
    i.channel_type,b.id AS binding_id,b.external_location_id,b.purpose
    FROM integration_bindings b JOIN tenant_integrations i
    ON i.id=b.integration_id AND i.tenant_id=b.tenant_id
    WHERE b.tenant_id=$1 AND b.app_id=$2 AND b.store_id=$3
    AND b.purpose='ORDER_REQUEST' AND b.authorization_confirmed_at IS NOT NULL
    ORDER BY i.id`,[tenantId,appId,storeId])
  if(result.rowCount!==1)throw fail(409,'La sede no tiene una integración única y autorizada')
  const row=result.rows[0]
  if(row.suspended||!row.encrypted_credential||row.expires_at&&new Date(row.expires_at)<=new Date()||
     row.channel_type&&row.channel_type!=='MOBILE_APP'||
     !Array.isArray(row.scopes)||!row.scopes.includes('queue.availability.read')||
     kind==='create'&&!row.scopes.includes('interactions.create'))throw fail(409,'La integración no está habilitada para esta operación')
  return {...row,token:decrypt(row.encrypted_credential,tenantId,row.integration_id)}
 }
 return async function route({req,res,url}){
  const match=url.pathname.match(/^\/api\/v1\/mobile\/stores\/([0-9a-f-]{36})\/agent-availability$/i)
  const creating=url.pathname==='/api/v1/mobile/interactions'
  if(!match&&!creating)return false
  try{
   rateLimit(req)
   if(match){
    if(req.method!=='GET')throw fail(405,'Método no permitido')
    const storeId=match[1],appId=url.searchParams.get('appId')
    if(!VALID_UUID.test(storeId)||!APP.test(appId||''))throw fail(400,'Sede o aplicación inválida')
    const ctx=await context(appId,storeId)
    if(checkMode()==='DISABLED')throw fail(503,'Consulta de TU VERSO no habilitada')
    const integration=await binding(ctx.tenantId,appId,storeId,'read')
    const result=await availability(integration.token,{external_location_id:integration.external_location_id,purpose:'ORDER_REQUEST',id:integration.binding_id})
    if(result.result!=='AVAILABLE'&&result.result!=='UNAVAILABLE')throw fail(503,'No se pudo comprobar la disponibilidad')
    return json(res,200,{storeId,status:result.result,available:result.result==='AVAILABLE',checkedAt:result.providerCheckedAt??result.checkedAt,reservation:false})
   }
   if(req.method!=='POST')throw fail(405,'Método no permitido')
   if(interactionMode()!=='LIVE'||checkMode()==='DISABLED')throw fail(503,'Interacciones TU VERSO no habilitadas')
   const input=await body(req)
   if(!plainObject(input)||Object.keys(input).some(key=>!['appId','storeId','quoteRevision','customerExternalId','items'].includes(key))||
      !APP.test(input.appId)||!VALID_UUID.test(input.storeId)||!Number.isSafeInteger(input.quoteRevision)||input.quoteRevision<1||
      !validText(input.customerExternalId,180))throw fail(400,'Solicitud de interacción inválida')
   const idempotencyKey=req.headers['idempotency-key']
   if(!VALID_UUID.test(idempotencyKey||''))throw fail(400,'Idempotency-Key UUID obligatorio')
   const ctx=await context(input.appId,input.storeId)
   if(ctx.revision!==input.quoteRevision)throw fail(409,'El catálogo cambió: solicita una nueva cotización')
   const cart=calculateOrderCart(ctx.payload.products,input.items)
   const integration=await binding(ctx.tenantId,input.appId,input.storeId,'create')
   // This is a fresh capacity check, not a reservation. If capacity was lost, refuse before creating.
   const available=await availability(integration.token,{external_location_id:integration.external_location_id,purpose:'ORDER_REQUEST',id:integration.binding_id})
   if(available.result==='UNAVAILABLE')throw fail(409,'Ya no hay capacidad de atención en esta sede')
   if(available.result!=='AVAILABLE')throw fail(503,'No se pudo confirmar la capacidad')
   // Stable upstream reference for retries. The public caller cannot set location, queue, price or summary.
   const externalReference='mobile:'+createHash('sha256').update([ctx.tenantId,input.appId,input.storeId,idempotencyKey].join(':')).digest('hex').slice(0,48)
   const result=await createInteraction(integration.token,{external_location_id:integration.external_location_id,purpose:'ORDER_REQUEST'},{
    customerExternalId:input.customerExternalId,externalReference,summary:cart.summary,idempotencyKey
   })
   if(!result.ok)throw fail(result.httpStatus===409?409:result.httpStatus===429?429:503,'TU VERSO no pudo iniciar la solicitud')
   if(result.data?.externalReference!==externalReference||result.data?.externalLocationId!==integration.external_location_id||
      result.data?.purpose!=='ORDER_REQUEST')throw fail(503,'Respuesta de TU VERSO no corresponde a la sede autorizada')
   return json(res,result.httpStatus===201?201:200,{interactionId:result.data.interactionId,status:result.data.status,storeId:input.storeId,externalReference:result.data.externalReference})
  }catch(error){
   const status=safeError(error)
   return json(res,status,{error:status===503?'Operación temporalmente no disponible':error.message})
  }
 }
}
