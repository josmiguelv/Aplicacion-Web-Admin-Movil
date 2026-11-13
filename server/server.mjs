import http from 'node:http'
import {URL} from 'node:url'
import pg from 'pg'
import {hashPassword,verifyPassword,newSessionToken,hashToken,readCookie,sessionCookie} from './auth.mjs'
import {selectDeliveryStore,allowedPayments,MODES,PAYMENT_CODES} from './delivery.mjs'

if(!process.env.DATABASE_URL)throw Error('DATABASE_URL is required')
const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:10})
const adminOrigin=process.env.ADMIN_ORIGIN??'http://localhost:5173'
const cookieSecure=process.env.COOKIE_SECURE==='true'||process.env.NODE_ENV==='production'
const port=Number(process.env.PORT??8080)
class HttpError extends Error{constructor(status,code){super(code);this.status=status;this.code=code}}
const fail=(status,code)=>{throw new HttpError(status,code)}
const validId=value=>typeof value==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
const text=(value,max=200)=>typeof value==='string'?value.trim().slice(0,max):''
const bool=value=>value===true
const money=value=>Number.isInteger(value)&&value>=0&&value<=100000000
const mapStore=r=>({id:r.id,name:r.name,address:r.address,active:r.active,deliveryEnabled:r.delivery_enabled,pickupEnabled:r.pickup_enabled,dineInEnabled:r.dine_in_enabled,latitude:r.latitude,longitude:r.longitude,deliveryRadiusM:r.delivery_radius_m,deliveryFeeCents:r.delivery_fee_cents,priority:r.priority})
const mapProduct=r=>({id:r.id,name:r.name,description:r.description,category:r.category,priceCents:r.price_cents,available:r.available,imageId:r.image_id})
const mapPayment=r=>({storeId:r.store_id,method:r.method,mode:r.mode,enabled:r.enabled})
const mapPromotion=r=>({id:r.id,name:r.name,description:r.description,active:r.active,startsAt:r.starts_at,endsAt:r.ends_at,discountPercent:r.discount_percent})
const send=(res,status,payload,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers});res.end(JSON.stringify(payload))}
async function body(req,limit=1048576){
 let size=0,parts=[]
 for await(const chunk of req){size+=chunk.length;if(size>limit)fail(413,'PAYLOAD_TOO_LARGE');parts.push(chunk)}
 return Buffer.concat(parts)
}
async function jsonBody(req){
 const type=(req.headers['content-type']??'').split(';')[0]
 if(type!=='application/json')fail(415,'JSON_REQUIRED')
 try{return JSON.parse((await body(req)).toString('utf8'))}catch{fail(400,'INVALID_JSON')}
}
function enforceOrigin(req){
 const origin=req.headers.origin
 if(origin!==adminOrigin)fail(403,'INVALID_ORIGIN')
}
async function actor(req){
 const token=readCookie(req,'b3_session')
 if(!/^[0-9a-f]{64}$/.test(token))fail(401,'UNAUTHORIZED')
 const q=await pool.query(`SELECT u.id,u.email,u.is_super FROM admin_sessions s
  JOIN admin_users u ON u.id=s.user_id AND u.status='ACTIVE'
  WHERE s.token_hash=$1 AND s.expires_at>now()`,[hashToken(token)])
 if(!q.rowCount)fail(401,'UNAUTHORIZED')
 return q.rows[0]
}
async function requireTenant(user,tenantId){
 if(!validId(tenantId))fail(404,'NOT_FOUND')
 const tenant=await pool.query("SELECT id FROM tenants WHERE id=$1 AND status='ACTIVE'",[tenantId])
 if(!tenant.rowCount)fail(404,'NOT_FOUND')
 if(user.is_super)return
 const member=await pool.query(`SELECT 1 FROM tenant_memberships
 WHERE tenant_id=$1 AND user_id=$2 AND role='TENANT_ADMIN' AND status='ACTIVE'`,[tenantId,user.id])
 if(!member.rowCount)fail(404,'NOT_FOUND')
}
async function audit(queryable,tenantId,userId,action,subjectId){
 await queryable.query("INSERT INTO admin_audit(tenant_id,actor_user_id,action,subject_id) VALUES($1,$2,$3,$4)",[tenantId,userId,action,String(subjectId)])
}
async function publicSnapshot(appId){
 if(!/^[a-zA-Z0-9._-]{3,140}$/.test(appId))fail(404,'APP_NOT_FOUND')
 const q=await pool.query(`SELECT a.tenant_id,p.snapshot
 FROM mobile_apps a JOIN tenants t ON t.id=a.tenant_id AND t.status='ACTIVE'
 JOIN catalog_publications p ON p.app_id=a.app_id AND p.version=a.published_version
 WHERE a.app_id=$1 AND a.active=true AND a.published_version>0`,[appId])
 if(!q.rowCount)fail(404,'CATALOG_NOT_PUBLISHED')
 return {tenantId:q.rows[0].tenant_id,snapshot:q.rows[0].snapshot}
}
async function activeStoreRows(tenantId,snapshot){
 const ids=(snapshot.stores??[]).map(s=>s.id).filter(validId)
 if(!ids.length)return []
 const rows=await pool.query(`SELECT * FROM stores WHERE tenant_id=$1
 AND id=ANY($2::uuid[]) AND active=true`,[tenantId,ids])
 const current=new Map(rows.rows.map(s=>[s.id,s]))
 return snapshot.stores.filter(s=>current.has(s.id)).map(s=>{
  const currentStore=current.get(s.id)
  // Emergency switches are immediately effective; new enablement requires publication.
  return {...s,active:true,
   deliveryEnabled:s.deliveryEnabled&&currentStore.delivery_enabled,
   pickupEnabled:s.pickupEnabled&&currentStore.pickup_enabled,
   dineInEnabled:s.dineInEnabled&&currentStore.dine_in_enabled}
 })
}
async function effectivePayments(tenantId,snapshot,storeId,mode){
 const publicCodes=allowedPayments(snapshot.payments??[],storeId,mode)
 if(!publicCodes.length)return []
 const rows=await pool.query(`SELECT method FROM payment_methods
 WHERE tenant_id=$1 AND store_id=$2 AND mode=$3 AND enabled=true AND method=ANY($4::text[])`,[tenantId,storeId,mode,publicCodes])
 return rows.rows.map(row=>row.method)
}
async function findDelivery(tenantId,snapshot,input){
 let lat=Number(input.latitude),lon=Number(input.longitude)
 const hasCoords=input.latitude!==undefined&&input.longitude!==undefined
 if(!hasCoords){
  const endpoint=process.env.GEOCODER_URL
  if(!endpoint||!text(input.address,400))fail(422,'LOCATION_OR_GEOCODER_REQUIRED')
  const u=new URL(endpoint)
  if(u.protocol!=='https:')fail(503,'GEOCODER_MUST_USE_HTTPS')
  u.searchParams.set('address',text(input.address,400))
  const response=await fetch(u,{signal:AbortSignal.timeout(5000),
    headers:process.env.GEOCODER_TOKEN?{'Authorization':'Bearer '+process.env.GEOCODER_TOKEN}:{}})
  if(!response.ok)fail(422,'ADDRESS_NOT_RESOLVED')
  const geo=await response.json()
  lat=Number(geo.latitude);lon=Number(geo.longitude)
 }
 const store=selectDeliveryStore(await activeStoreRows(tenantId,snapshot),lat,lon)
 if(!store)fail(422,'DELIVERY_OUT_OF_COVERAGE')
 const paymentMethodIds=await effectivePayments(tenantId,snapshot,store.id,'DELIVERY')
 if(!paymentMethodIds.length)fail(422,'NO_PAYMENT_METHODS')
 return {store,deliveryFeeCents:store.deliveryFeeCents,paymentMethodIds,
  coveragePolicy:'RADIUS_METERS',latitude:lat,longitude:lon}
}
async function publishedImage(res,imageId){
 if(!validId(imageId))fail(404,'NOT_FOUND')
 const q=await pool.query(`SELECT i.mime,i.data FROM product_images i
 JOIN catalog_publications p ON p.tenant_id=i.tenant_id
 JOIN mobile_apps a ON a.app_id=p.app_id AND a.published_version=p.version AND a.active
 JOIN tenants t ON t.id=a.tenant_id AND t.status='ACTIVE'
 WHERE i.id=$1 AND EXISTS(
 SELECT 1 FROM jsonb_array_elements(p.snapshot->'products') product
 WHERE product->>'imageId'=i.id::text
 ) LIMIT 1`,[imageId])
 if(!q.rowCount)fail(404,'NOT_FOUND')
 res.writeHead(200,{'Content-Type':q.rows[0].mime,'Cache-Control':'public, max-age=300','X-Content-Type-Options':'nosniff'})
 res.end(q.rows[0].data)
}
async function handlePublic(req,res,url){
 const path=url.pathname
 const img=path.match(/^\/api\/v1\/mobile\/images\/([^/]+)$/)
 if(img&&req.method==='GET'){await publishedImage(res,img[1]);return true}
 const match=path.match(/^\/api\/v1\/apps\/([^/]+)\/(stores|payments|catalog|delivery\/resolve)$/)
 if(!match)return false
 const {tenantId,snapshot}=await publicSnapshot(decodeURIComponent(match[1]))
 const endpoint=match[2],stores=await activeStoreRows(tenantId,snapshot)
 if(req.method==='GET'&&endpoint==='catalog'){
  const live=await pool.query("SELECT id FROM products WHERE tenant_id=$1 AND available=true",[tenantId])
  const enabled=new Set(live.rows.map(r=>r.id))
  send(res,200,{products:(snapshot.products??[]).filter(p=>p.available&&enabled.has(p.id)),
   promotions:(snapshot.promotions??[]).filter(p=>p.active),
   stores,paymentMethods:snapshot.payments??[]});return true
 }
 if(req.method==='GET'&&endpoint==='stores'){send(res,200,{stores});return true}
 if(req.method==='GET'&&endpoint==='payments'){
  const storeId=url.searchParams.get('storeId'),mode=url.searchParams.get('mode')
  if(!validId(storeId)||!MODES.has(mode))fail(400,'INVALID_FILTER')
  const store=stores.find(s=>s.id===storeId)
  const allowed=store&&(mode==='DELIVERY'?store.deliveryEnabled:mode==='PICKUP'?store.pickupEnabled:store.dineInEnabled)
  send(res,200,{paymentMethodIds:allowed?await effectivePayments(tenantId,snapshot,storeId,mode):[]});return true
 }
 if(req.method==='POST'&&endpoint==='delivery/resolve'){
  const input=await jsonBody(req)
  const decision=await findDelivery(tenantId,snapshot,input)
  send(res,200,decision);return true
 }
 fail(405,'METHOD_NOT_ALLOWED')
}
const uploads={jpeg:'image/jpeg',png:'image/png',webp:'image/webp'}
function validateImage(bytes,mime){
 if(bytes.length<12||bytes.length>4*1024*1024)fail(400,'INVALID_IMAGE_SIZE')
 const jpeg=mime===uploads.jpeg&&bytes[0]===0xff&&bytes[1]===0xd8&&bytes[2]===0xff
 const png=mime===uploads.png&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))
 const webp=mime===uploads.webp&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP'
 if(!jpeg&&!png&&!webp)fail(415,'INVALID_IMAGE_SIGNATURE')
}
async function handleAdmin(req,res,url){
 const path=url.pathname,method=req.method
 if(!path.startsWith('/api/admin/'))return false
 if(method==='POST'||method==='PATCH'||method==='DELETE')enforceOrigin(req)
 if(path==='/api/admin/login'&&method==='POST'){
  const b=await jsonBody(req),email=text(b.email,180).toLowerCase(),pass=b.password
  const q=await pool.query("SELECT id,password_hash FROM admin_users WHERE email=$1 AND status='ACTIVE'",[email])
  if(!q.rowCount||!await verifyPassword(pass,q.rows[0].password_hash))fail(401,'INVALID_CREDENTIALS')
  const token=newSessionToken()
  await pool.query("INSERT INTO admin_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '12 hours')",[hashToken(token),q.rows[0].id])
  send(res,200,{ok:true},{'Set-Cookie':sessionCookie(token,cookieSecure)});return true
 }
 const user=await actor(req)
 if(path==='/api/admin/me'&&method==='GET'){
  const q=await pool.query(`SELECT t.id,t.name FROM tenant_memberships m
  JOIN tenants t ON t.id=m.tenant_id WHERE m.user_id=$1 AND m.status='ACTIVE' AND t.status='ACTIVE'`,[user.id])
  send(res,200,{id:user.id,email:user.email,isSuper:user.is_super,tenants:q.rows});return true
 }
 if(path==='/api/admin/logout'&&method==='POST'){
  await pool.query("DELETE FROM admin_sessions WHERE token_hash=$1",[hashToken(readCookie(req,'b3_session'))])
  send(res,200,{ok:true},{'Set-Cookie':sessionCookie('',cookieSecure)+'; Max-Age=0'});return true
 }
 if(path==='/api/admin/tenants'){
  if(!user.is_super)fail(403,'SUPERADMIN_REQUIRED')
  if(method==='GET'){
   send(res,200,{tenants:(await pool.query("SELECT * FROM tenants ORDER BY created_at DESC LIMIT 200")).rows})
   return true
  }
  if(method==='POST'){
   const b=await jsonBody(req),name=text(b.name,160)
   if(name.length<2)fail(400,'INVALID_TENANT_NAME')
   const q=await pool.query("INSERT INTO tenants(name) VALUES($1) RETURNING id,name,status",[name])
   await audit(pool,q.rows[0].id,user.id,'TENANT_CREATED',q.rows[0].id)
   send(res,201,{tenant:q.rows[0]});return true
  }
 }
 const tenantMatch=path.match(/^\/api\/admin\/tenants\/([^/]+)\/(users|apps|stores|products|promotions|payments|images|publish)(?:\/([^/]+))?$/)
 if(!tenantMatch)fail(404,'NOT_FOUND')
 const [,tenantId,resource,resourceId]=tenantMatch
 await requireTenant(user,tenantId)
 if(resource==='users'&&method==='POST'&&user.is_super){
  const b=await jsonBody(req),email=text(b.email,180).toLowerCase()
  if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))fail(400,'INVALID_EMAIL')
  const passwordHash=await hashPassword(b.password)
  const client=await pool.connect()
  try{
   await client.query('BEGIN')
   const q=await client.query("INSERT INTO admin_users(email,password_hash) VALUES($1,$2) RETURNING id,email",[email,passwordHash])
   await client.query("INSERT INTO tenant_memberships(tenant_id,user_id,role) VALUES($1,$2,'TENANT_ADMIN')",[tenantId,q.rows[0].id])
   await audit(client,tenantId,user.id,'TENANT_ADMIN_CREATED',q.rows[0].id)
   await client.query('COMMIT')
   send(res,201,{user:q.rows[0]})
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  return true
 }
 if(resource==='apps'){
  if(method==='GET'){
   send(res,200,{apps:(await pool.query("SELECT app_id,display_name,active,published_version FROM mobile_apps WHERE tenant_id=$1",[tenantId])).rows});return true
  }
  if(method==='POST'&&user.is_super){
   const b=await jsonBody(req),appId=text(b.appId,140)
   if(!/^[a-zA-Z0-9._-]{3,140}$/.test(appId))fail(400,'INVALID_APP_ID')
   const q=await pool.query("INSERT INTO mobile_apps(app_id,tenant_id,display_name,active) VALUES($1,$2,$3,$4) RETURNING app_id",[appId,tenantId,text(b.name,140)||appId,bool(b.active)])
   await audit(pool,tenantId,user.id,'APP_CREATED',appId)
   send(res,201,{appId:q.rows[0].app_id});return true
  }
 }
 const sources={stores:{table:'stores',fields:['name','address','active','delivery_enabled','pickup_enabled','dine_in_enabled','latitude','longitude','delivery_radius_m','delivery_fee_cents','priority']},
 products:{table:'products',fields:['name','description','category','price_cents','available','image_id']},
 promotions:{table:'promotions',fields:['name','description','active','starts_at','ends_at','discount_percent']}}
 const spec=sources[resource]
 if(spec){
  if(method==='GET'&&!resourceId){
   const q=await pool.query('SELECT * FROM '+spec.table+' WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 500',[tenantId])
   send(res,200,{[resource]:q.rows});return true
  }
  if((method==='POST'&&!resourceId)||(method==='PATCH'&&validId(resourceId))){
   const b=await jsonBody(req),values={}
   for(const field of spec.fields){
    const camel=field.replace(/_([a-z])/g,(_,x)=>x.toUpperCase())
    if(Object.prototype.hasOwnProperty.call(b,camel))values[field]=b[camel]
   }
   if(resource==='stores'&&method==='POST'&&(!text(values.name)||!text(values.address)))fail(400,'STORE_NAME_ADDRESS_REQUIRED')
   if(resource==='products'&&method==='POST'&&(!text(values.name)||!money(values.price_cents)))fail(400,'INVALID_PRODUCT')
   if(resource==='products'&&values.price_cents!==undefined&&!money(values.price_cents))fail(400,'INVALID_PRICE')
   if(resource==='stores'&&values.delivery_fee_cents!==undefined&&!money(values.delivery_fee_cents))fail(400,'INVALID_DELIVERY_FEE')
   if(!Object.keys(values).length)fail(400,'NO_VALID_FIELDS')
   const cols=Object.keys(values),vals=Object.values(values)
   const sql=method==='POST'
    ?'INSERT INTO '+spec.table+' (tenant_id,'+cols.join(',')+') VALUES ($1,'+cols.map((_,i)=>'$'+(i+2)).join(',')+') RETURNING *'
    :'UPDATE '+spec.table+' SET '+cols.map((c,i)=>c+'=$'+(i+3)).join(',')+',updated_at=now() WHERE tenant_id=$1 AND id=$2 RETURNING *'
   const params=method==='POST'?[tenantId,...vals]:[tenantId,resourceId,...vals]
   const q=await pool.query(sql,params)
   if(!q.rowCount)fail(404,'NOT_FOUND')
   await audit(pool,tenantId,user.id,resource.toUpperCase()+(method==='POST'?'_CREATED':'_UPDATED'),q.rows[0].id)
   send(res,method==='POST'?201:200,{record:q.rows[0]});return true
  }
 }
 if(resource==='payments'){
  if(method==='GET'){
   const q=await pool.query("SELECT * FROM payment_methods WHERE tenant_id=$1",[tenantId]);send(res,200,{payments:q.rows});return true
  }
  if(method==='POST'){
   const b=await jsonBody(req)
   if(!validId(b.storeId)||!MODES.has(b.mode)||!PAYMENT_CODES.has(b.method))fail(400,'INVALID_PAYMENT_CONFIGURATION')
   const q=await pool.query(`INSERT INTO payment_methods(tenant_id,store_id,mode,method,enabled)
    VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,store_id,method,mode)
    DO UPDATE SET enabled=excluded.enabled,updated_at=now() RETURNING *`,
    [tenantId,b.storeId,b.mode,b.method,bool(b.enabled)])
   await audit(pool,tenantId,user.id,'PAYMENT_CONFIGURED',b.storeId)
   send(res,200,{payment:q.rows[0]});return true
  }
 }
 if(resource==='images'){
  if(method==='POST'&&!resourceId){
   const mime=(req.headers['content-type']??'').split(';')[0]
   const bytes=await body(req,4*1024*1024+1)
   validateImage(bytes,mime)
   const q=await pool.query("INSERT INTO product_images(tenant_id,mime,data) VALUES($1,$2,$3) RETURNING id",[tenantId,mime,bytes])
   await audit(pool,tenantId,user.id,'IMAGE_UPLOADED',q.rows[0].id)
   send(res,201,{imageId:q.rows[0].id});return true
  }
  if(method==='GET'&&validId(resourceId)){
   const q=await pool.query("SELECT mime,data FROM product_images WHERE tenant_id=$1 AND id=$2",[tenantId,resourceId])
   if(!q.rowCount)fail(404,'NOT_FOUND')
   res.writeHead(200,{'Content-Type':q.rows[0].mime,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'})
   res.end(q.rows[0].data);return true
  }
 }
 if(resource==='publish'&&method==='POST'){
  const b=await jsonBody(req),appId=text(b.appId,140)
  const client=await pool.connect()
  try{
   await client.query('BEGIN')
   const app=await client.query('SELECT * FROM mobile_apps WHERE app_id=$1 AND tenant_id=$2 FOR UPDATE',[appId,tenantId])
   if(!app.rowCount)fail(404,'APP_NOT_FOUND')
   const [stores,products,promotions,payments]=await Promise.all([
    client.query('SELECT * FROM stores WHERE tenant_id=$1',[tenantId]),
    client.query('SELECT * FROM products WHERE tenant_id=$1',[tenantId]),
    client.query('SELECT * FROM promotions WHERE tenant_id=$1',[tenantId]),
    client.query('SELECT * FROM payment_methods WHERE tenant_id=$1',[tenantId])
   ])
   const snapshot={stores:stores.rows.map(mapStore),products:products.rows.map(mapProduct),
    promotions:promotions.rows.map(mapPromotion),payments:payments.rows.map(mapPayment)}
   const version=app.rows[0].published_version+1
   await client.query(`INSERT INTO catalog_publications(app_id,tenant_id,version,snapshot,created_by)
    VALUES($1,$2,$3,$4,$5)`,[appId,tenantId,version,JSON.stringify(snapshot),user.id])
   await client.query('UPDATE mobile_apps SET published_version=$1 WHERE app_id=$2 AND tenant_id=$3',[version,appId,tenantId])
   await audit(client,tenantId,user.id,'CATALOG_PUBLISHED',appId+':'+version)
   await client.query('COMMIT')
   send(res,200,{appId,version,productCount:snapshot.products.length,storeCount:snapshot.stores.length})
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
  return true
 }
 fail(405,'METHOD_NOT_ALLOWED')
}
const server=http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost')
  res.setHeader('X-Content-Type-Options','nosniff')
  if(req.headers.origin===adminOrigin){
   res.setHeader('Access-Control-Allow-Origin',adminOrigin)
   res.setHeader('Access-Control-Allow-Credentials','true')
   res.setHeader('Access-Control-Allow-Headers','Content-Type')
   res.setHeader('Access-Control-Allow-Methods','GET,POST,PATCH,OPTIONS')
   res.setHeader('Vary','Origin')
  }
  if(req.method==='OPTIONS'){
   if(req.headers.origin!==adminOrigin)fail(403,'INVALID_ORIGIN')
   res.writeHead(204);res.end();return
  }
  if(url.pathname==='/health'&&req.method==='GET'){
   await pool.query('SELECT 1');send(res,200,{status:'ok'});return
  }
  if(await handlePublic(req,res,url))return
  if(await handleAdmin(req,res,url))return
  fail(404,'NOT_FOUND')
 }catch(e){
  if(e instanceof HttpError){send(res,e.status,{error:e.code});return}
  if(e.code==='23505'){send(res,409,{error:'CONFLICT'});return}
  if(e.code==='23503'||e.code==='22P02'||e.code==='23514'){send(res,400,{error:'INVALID_REFERENCE_OR_VALUE'});return}
  console.error('API request failed:',e.message)
  if(!res.headersSent)send(res,500,{error:'INTERNAL_ERROR'})
  else res.end()
 }
})
server.listen(port,()=>console.log('Pollos B3 admin API listening'))
process.on('SIGTERM',()=>server.close(()=>pool.end()))
