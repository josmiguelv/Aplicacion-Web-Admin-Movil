import {createServer} from 'node:http'
import {readFile,stat} from 'node:fs/promises'
import {join,normalize,extname} from 'node:path'
import {randomBytes,scryptSync,timingSafeEqual,createHash,randomUUID} from 'node:crypto'
import pg from 'pg'

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL, max:10})
const port=Number(process.env.PORT||4000)
const prod=process.env.NODE_ENV==='production'
const secure=process.env.COOKIE_SECURE!== 'false' && prod
const allowedOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)
const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type','Cache-Control':'no-store'}
const json=(res,status,body,publicRead=false)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...(publicRead?corsHeaders:{'Cache-Control':'no-store'})});res.end(JSON.stringify(body))}
const bad=(code,message)=>Object.assign(new Error(message),{code})
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x)
const word=(x,max=150)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max
const bool=x=>typeof x==='boolean'
const mode=x=>['delivery','pickup','dine_in'].includes(x)
const method=x=>['yape','plin','card','cash'].includes(x)
const digest=s=>createHash('sha256').update(s).digest('hex')
const sql=(q,args)=>pool.query(q,args)
const safeNumber=x=>typeof x==='number'&&Number.isFinite(x)
const radians=x=>x*Math.PI/180
function kmDistance(a,b,c,d){const p=radians(c-a),q=radians(d-b);const h=Math.sin(p/2)**2+Math.cos(radians(a))*Math.cos(radians(c))*Math.sin(q/2)**2;return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)))}
async function imageBody(req){const chunks=[];let size=0;for await (const chunk of req){size+=chunk.length;if(size>4*1024*1024)throw bad(413,'Imagen de máximo 4 MB');chunks.push(chunk)}return Buffer.concat(chunks)}
function imageMime(data){if(data.length<12)return null;if(data[0]===0xff&&data[1]===0xd8&&data[2]===0xff)return'image/jpeg';if(data.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex')))return'image/png';if(data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP')return'image/webp';return null}
async function body(req){let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>65536)throw bad(413,'Solicitud demasiado grande')}try{return JSON.parse(raw||'{}')}catch{throw bad(400,'JSON inválido')}}
function cookie(req){const all=req.headers.cookie||'';return all.split(';').map(x=>x.trim()).find(x=>x.startsWith('b3sid='))?.slice(6)||''}
function sameOrigin(req){const origin=req.headers.origin;if(!origin)return !prod; const expected=process.env.ADMIN_ORIGIN;return !!expected&&origin===expected}
async function session(req){const token=cookie(req);if(!/^[a-f0-9]{64}$/.test(token))throw bad(401,'Inicia sesión');const q=await sql(`SELECT u.id,u.role,u.tenant_id FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() AND u.active=true`,[digest(token)]);if(!q.rowCount)throw bad(401,'Sesión expirada');return q.rows[0]}
async function tenantOf(auth,id){if(!uuid(id))throw bad(400,'Empresa inválida');if(auth.role!=='SUPER_ADMIN'&&auth.tenant_id!==id)throw bad(403,'No tienes acceso a esta empresa');const row=await sql('SELECT id FROM tenants WHERE id=$1 AND active=true',[id]);if(!row.rowCount)throw bad(404,'Empresa no disponible')}
function checkLatLng(lat,lng){return safeNumber(lat)&&safeNumber(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180}

const PERU_TZ='America/Lima';
const WEEKDAYS=['sun','mon','tue','wed','thu','fri','sat'];
function validateOpeningHours(value){
 if(value===null)return true;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!WEEKDAYS.includes(k)))return false;
 return Object.values(value).every(v=>v&&typeof v==='object'&&!Array.isArray(v)&&(
   v.closed===true||(typeof v.open==='string'&&typeof v.close==='string'&&
   /^([01]\d|2[0-3]):[0-5]\d$/.test(v.open)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v.close)&&v.open!==v.close)
 ));
}
function storeHours(store,date=new Date()){
 const hours=store.openingHours??store.opening_hours;
 if(!hours||typeof hours!=='object')return {hoursConfigured:false};
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:PERU_TZ,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
 const day=parts.weekday.toLowerCase(),cfg=hours[day],minutes=Number(parts.hour)*60+Number(parts.minute);
 const index=WEEKDAYS.indexOf(day);
 const prev=hours[WEEKDAYS[(index+6)%7]];
 const value=v=>Number(v.slice(0,2))*60+Number(v.slice(3));
 if(prev&&prev.closed!==true&&value(prev.close)<value(prev.open)&&minutes<value(prev.close))return {hoursConfigured:true,isOpen:true,closesAt:prev.close};
 if(!cfg)return {hoursConfigured:false};
 if(cfg.closed===true)return {hoursConfigured:true,isOpen:false,closesAt:null};
 const begin=value(cfg.open),end=value(cfg.close),isOpen=end>begin?(minutes>=begin&&minutes<end):(minutes>=begin);
 return {hoursConfigured:true,isOpen,closesAt:isOpen?cfg.close:null};
}
function withLiveHours(store){return {...store,...storeHours(store)}}

async function publish(tx,tenantId,appId){const [stores,products,promos,payments]=await Promise.all([
 tx.query('SELECT id,name,address,latitude,longitude,radius_km,delivery_fee_pen,delivery_rate_per_km_pen,active,delivery_enabled,pickup_enabled,dine_in_enabled,opening_hours FROM stores WHERE tenant_id=$1 AND active=true ORDER BY name',[tenantId]),
 tx.query('SELECT id,name,description,category,price_pen,image_url FROM products WHERE tenant_id=$1 AND active=true ORDER BY name',[tenantId]),
 tx.query('SELECT id,title,starts_at,ends_at FROM promotions WHERE tenant_id=$1 AND active=true AND (starts_at IS NULL OR starts_at<=now()) AND (ends_at IS NULL OR ends_at>=now())',[tenantId]),
 tx.query('SELECT store_id,mode,method FROM payment_methods WHERE tenant_id=$1 AND enabled=true',[tenantId])
 ]);const payload={schemaVersion:1,appId,currency:'PEN',stores:stores.rows.map(s=>({...s,latitude:s.latitude===null?null:Number(s.latitude),longitude:s.longitude===null?null:Number(s.longitude),radiusKm:s.radius_km===null?null:Number(s.radius_km),deliveryRatePerKmPen:s.delivery_rate_per_km_pen===null?null:Number(s.delivery_rate_per_km_pen),openingHours:s.opening_hours??null,paymentMethods:payments.rows.filter(p=>p.store_id===s.id).reduce((a,p)=>(a[p.mode].push(p.method),a),{delivery:[],pickup:[],dine_in:[]})})),products:products.rows.map(p=>({...p,pricePen:Number(p.price_pen)})),promotions:promos.rows};
 const v=await tx.query('UPDATE mobile_apps SET published_revision=published_revision+1,enabled=true WHERE tenant_id=$1 AND app_id=$2 RETURNING published_revision',[tenantId,appId]);if(!v.rowCount)throw bad(404,'Aplicación no registrada');const revision=v.rows[0].published_revision;await tx.query(`INSERT INTO published_catalogs(app_id,tenant_id,revision,payload) VALUES($1,$2,$3,$4) ON CONFLICT(app_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,published_at=now()`,[appId,tenantId,revision,JSON.stringify(payload)]);return{revision,payload}}
async function publicConfig(req,res,url){if(req.method!=='GET')throw bad(405,'Método no permitido');const appId=url.searchParams.get('appId');if(!word(appId,150))throw bad(400,'appId obligatorio');const q=await sql(`SELECT p.payload,p.revision FROM published_catalogs p JOIN mobile_apps a ON a.app_id=p.app_id JOIN tenants t ON t.id=p.tenant_id WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[appId]);if(!q.rowCount)return json(res,200,{ready:false,revision:0,stores:[],products:[],promotions:[]},true);return json(res,200,{ready:true,revision:q.rows[0].revision,...q.rows[0].payload,stores:(q.rows[0].payload.stores||[]).map(withLiveHours)},true)}

const routesApiKey=process.env.GOOGLE_ROUTES_API_KEY||'';
const routeCache=new Map();
const routePending=new Map();
const quoteRateLimit=new Map();
function limitPublicDeliveryQuotes(req){
 const ip=req.socket.remoteAddress||'unknown',now=Date.now();
 const item=quoteRateLimit.get(ip);
 if(quoteRateLimit.size>3000)quoteRateLimit.clear();
 if(!item||now-item.start>=60000){quoteRateLimit.set(ip,{start:now,count:1});return}
 if(++item.count>20)throw bad(429,'Demasiadas cotizaciones. Intenta de nuevo en un minuto');
}
const routeTimeoutMs=6000;
async function roadDistanceKm(store,destination,revision){
 // The key never reaches the mobile device. No fallback to straight-line billing.
 if(!routesApiKey)throw bad(503,'Cotización de Delivery no disponible: falta configurar Google Routes');
 const key=[revision,store.id,typeof destination==='string'?destination:destination.latitude.toFixed(4)+':'+destination.longitude.toFixed(4)].join(':');
 const cached=routeCache.get(key);
 if(cached&&Date.now()<cached.until)return cached.km;
 if(routePending.has(key))return routePending.get(key);
 const promise=(async()=>{
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),routeTimeoutMs);
 try{
  const response=await fetch('https://routes.googleapis.com/directions/v2:computeRoutes',{
   method:'POST',signal:controller.signal,
   headers:{'Content-Type':'application/json','X-Goog-Api-Key':routesApiKey,'X-Goog-FieldMask':'routes.distanceMeters'},
   body:JSON.stringify({
    origin:{location:{latLng:{latitude:store.latitude,longitude:store.longitude}}},
    destination:typeof destination==='string'?{address:destination}:{location:{latLng:destination}},
    travelMode:'DRIVE',routingPreference:'TRAFFIC_UNAWARE',computeAlternativeRoutes:false
   })
  });
  if(!response.ok)throw Error('Routes '+response.status);
  const data=await response.json();
  const meters=data.routes?.[0]?.distanceMeters;
  if(!Number.isFinite(meters)||meters<0) return null; // No drivable route.
  const km=meters/1000;
  if(routeCache.size>3000)routeCache.clear();
  routeCache.set(key,{km,until:Date.now()+5*60*1000});
  return km;
 }catch(err){if(err.name==='AbortError')throw bad(503,'Tiempo de espera agotado al calcular la ruta');throw bad(503,'No se pudo calcular la distancia por carretera')}
 finally{clearTimeout(timer)}
 })();
 routePending.set(key,promise);
 try{return await promise}finally{routePending.delete(key)}
}

async function quote(req,res){
 const b=await body(req);
 if(!word(b.appId,150)||!mode(b.mode))throw bad(400,'Modalidad y aplicación obligatorias');
 const q=await sql(`SELECT p.payload,p.revision FROM published_catalogs p JOIN mobile_apps a ON a.app_id=p.app_id JOIN tenants t ON t.id=p.tenant_id WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[b.appId]);
 if(!q.rowCount)throw bad(409,'Catálogo no publicado');
 const config=q.rows[0].payload;
 const eligible=config.stores.map(withLiveHours).filter(s=>s.active&&s[b.mode==='dine_in'?'dine_in_enabled':b.mode+'_enabled']===true&&s.hoursConfigured===true&&s.isOpen===true);
 if(!eligible.length)throw bad(409,'No hay sedes abiertas y habilitadas para esta modalidad');
 let selected,roadKm=null,deliveryFeePen=0;
 if(b.mode==='delivery'){
  limitPublicDeliveryQuotes(req);
  const hasCoordinates=checkLatLng(b.latitude,b.longitude)&&b.useGps===true;
  const hasAddress=word(b.address,250)&&word(b.district,90);
  if(!hasCoordinates&&!hasAddress)throw bad(422,'Confirma una dirección completa o elige usar tu ubicación GPS');
  // A typed address takes precedence: an earlier GPS fix from browsing stores must
  // never silently replace the delivery destination.
  const destination=hasAddress?
   [b.address.trim(),b.district.trim(),'Lima','Perú'].join(', '):
   {latitude:b.latitude,longitude:b.longitude};
  const candidates=eligible.filter(s=>checkLatLng(s.latitude,s.longitude)&&
   Number.isFinite(s.deliveryRatePerKmPen)&&s.deliveryRatePerKmPen>=0);
  if(!candidates.length)throw bad(409,'Ninguna sede tiene una tarifa por kilómetro y coordenadas configuradas');
  if(candidates.length>12)throw bad(503,'Demasiadas sedes para cotizar en una sola operación');
  if(hasCoordinates&&!hasAddress)candidates.sort((a,b2)=>
   kmDistance(b.latitude,b.longitude,a.latitude,a.longitude)-
   kmDistance(b.latitude,b.longitude,b2.latitude,b2.longitude)||a.id.localeCompare(b2.id));
  // Evaluate all reachable, enabled stores so the road-nearest eligible one wins.
  const available=[];
  for(const store of candidates){
   const km=await roadDistanceKm(store,destination,q.rows[0].revision);
   if(km===null)continue;
   if(store.radiusKm!==null&&store.radiusKm!==undefined&&km>store.radiusKm+1e-8)continue;
   available.push({store,km});
  }
  available.sort((a,b2)=>a.km-b2.km||a.store.id.localeCompare(b2.store.id));
  if(!available.length)throw bad(409,'Dirección fuera de la cobertura de las sedes disponibles');
  selected=available[0].store;roadKm=available[0].km;
  deliveryFeePen=Math.round((roadKm*selected.deliveryRatePerKmPen+Number.EPSILON)*100)/100;
 }else{
  selected=eligible.find(s=>s.id===b.storeId);
  if(!selected)throw bad(409,'Selecciona una sede abierta para esta modalidad');
 }
 return json(res,200,{
  revision:q.rows[0].revision,storeId:selected.id,storeName:selected.name,
  mode:b.mode,paymentMethods:selected.paymentMethods?.[b.mode]||[],
  deliveryFeePen,routeDistanceKm:roadKm,ratePerKmPen:b.mode==='delivery'?selected.deliveryRatePerKmPen:null,
  distanceSource:b.mode==='delivery'?'GOOGLE_ROUTES':null,
  provisional:true,notice:'Importes sujetos a confirmación al realizar el pedido.'
 },true)
}
async function admin(req,res,url){if(req.method==='POST'&&url.pathname==='/api/admin/login'){
 if(!sameOrigin(req))throw bad(403,'Origen no autorizado');const b=await body(req);if(!word(b.email,254)||!word(b.password,512))throw bad(400,'Credenciales inválidas');const q=await sql('SELECT * FROM admin_users WHERE email=lower($1) AND active=true',[b.email]);const user=q.rows[0];let ok=false;if(user&&typeof user.password_hash==='string'){const parts=user.password_hash.split(':');if(parts.length===3&&parts[0]==='scrypt'){const provided=scryptSync(b.password,parts[1],64),stored=Buffer.from(parts[2],'hex');ok=stored.length===provided.length&&timingSafeEqual(provided,stored)}}if(!ok)throw bad(401,'Credenciales inválidas');const token=randomBytes(32).toString('hex');await sql(`INSERT INTO admin_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '12 hours')`,[user.id,digest(token)]);res.setHeader('Set-Cookie',`b3sid=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=43200${secure?'; Secure':''}`);return json(res,200,{id:user.id,role:user.role,tenantId:user.tenant_id})}
 const user=await session(req);if(req.method!=='GET'&&!sameOrigin(req))throw bad(403,'Origen no autorizado');
 if(url.pathname==='/api/admin/me'&&req.method==='GET')return json(res,200,{role:user.role,tenantId:user.tenant_id});
 if(url.pathname==='/api/admin/logout'&&req.method==='POST'){await sql('DELETE FROM admin_sessions WHERE token_hash=$1',[digest(cookie(req))]);res.setHeader('Set-Cookie',`b3sid=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`);return json(res,200,{ok:true})}
 if(url.pathname==='/api/admin/tenants'&&req.method==='GET'){if(user.role!=='SUPER_ADMIN')throw bad(403,'Acceso restringido');const x=await sql('SELECT id,name,active FROM tenants ORDER BY created_at');return json(res,200,{tenants:x.rows})}
 if(url.pathname==='/api/admin/tenants'&&req.method==='POST'){if(user.role!=='SUPER_ADMIN')throw bad(403,'Acceso restringido');const b=await body(req);if(!word(b.name,180))throw bad(400,'Nombre de empresa inválido');const x=await sql('INSERT INTO tenants(name) VALUES($1) RETURNING id,name,active',[b.name.trim()]);await sql('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[x.rows[0].id,user.id,'TENANT_CREATED',x.rows[0].id]);return json(res,201,x.rows[0])}
 const userMatch=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/users$/);
 if(userMatch&&req.method==='POST'){if(user.role!=='SUPER_ADMIN')throw bad(403,'Acceso restringido');const id=userMatch[1];await tenantOf(user,id);const b=await body(req);if(!word(b.email,254)||!word(b.password,512)||b.password.length<14)throw bad(400,'Correo o clave inválida (mínimo 14 caracteres)');const salt=randomBytes(16).toString('hex'),hash=`scrypt:${salt}:${scryptSync(b.password,salt,64).toString('hex')}`;const x=await sql('INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES(lower($1),$2,$3,$4) RETURNING id,email',[b.email,hash,'TENANT_ADMIN',id]);return json(res,201,x.rows[0])}
 const asset=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/images$/);
 if(asset&&req.method==='POST'){
  const tenantId=asset[1];await tenantOf(user,tenantId);const bytes=await imageBody(req),mime=imageMime(bytes);
  if(!mime)throw bad(415,'Solo imágenes JPEG, PNG y WebP reales');const x=await sql('INSERT INTO product_images(tenant_id,mime,content) VALUES($1,$2,$3) RETURNING id',[tenantId,mime,bytes]);
  await sql('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[tenantId,user.id,'IMAGE_UPLOADED',x.rows[0].id]);
  return json(res,201,{url:'/api/v1/mobile/images/'+x.rows[0].id,id:x.rows[0].id,mime})
 }
 const m=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/(stores|products|promotions|payments|apps|publish)$/);
 if(!m)throw bad(404,'Ruta no encontrada');const tenantId=m[1],resource=m[2];await tenantOf(user,tenantId);
 if(req.method==='GET'){
  const table={stores:'stores',products:'products',promotions:'promotions',payments:'payment_methods',apps:'mobile_apps'}[resource];if(!table)throw bad(405,'Acción no permitida');const x=await sql(`SELECT * FROM ${table} WHERE tenant_id=$1 ORDER BY 1`,[tenantId]);return json(res,200,{items:x.rows})
 }
 if(req.method!=='POST'&&req.method!=='PUT')throw bad(405,'Acción no permitida');const b=await body(req);const client=await pool.connect();try{await client.query('BEGIN');let result;
 if(resource==='stores'){
  if(!validateOpeningHours(b.openingHours??null)||!word(b.name,180)||!word(b.address,300)||![b.active,b.delivery_enabled,b.pickup_enabled,b.dine_in_enabled].every(bool)||!(b.latitude==null&&b.longitude==null)&&!checkLatLng(b.latitude,b.longitude)||b.radiusKm!=null&&(!safeNumber(b.radiusKm)||b.radiusKm<=0||b.radiusKm>500)||b.deliveryRatePerKmPen!=null&&(!safeNumber(b.deliveryRatePerKmPen)||b.deliveryRatePerKmPen<0||b.deliveryRatePerKmPen>1000))throw bad(400,'Datos del local inválidos');
  const args=[tenantId,b.name.trim(),b.address.trim(),b.latitude??null,b.longitude??null,b.radiusKm??null,b.deliveryRatePerKmPen??null,b.active,b.delivery_enabled,b.pickup_enabled,b.dine_in_enabled,b.openingHours??null];
  result=b.id&&uuid(b.id)?await client.query(`UPDATE stores SET name=$2,address=$3,latitude=$4,longitude=$5,radius_km=$6,delivery_rate_per_km_pen=$7,active=$8,delivery_enabled=$9,pickup_enabled=$10,dine_in_enabled=$11,opening_hours=$12,updated_at=now() WHERE tenant_id=$1 AND id=$13 RETURNING *`,[...args,b.id]):await client.query(`INSERT INTO stores(tenant_id,name,address,latitude,longitude,radius_km,delivery_rate_per_km_pen,active,delivery_enabled,pickup_enabled,dine_in_enabled,opening_hours) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,args)
 }else if(resource==='products'){
  if(!word(b.name,180)||!safeNumber(b.pricePen)||b.pricePen<0||!bool(b.active)||b.imageUrl&&(!/^https:\/\//.test(b.imageUrl)&&!/^\/api\/v1\/mobile\/images\/[0-9a-f-]{36}$/.test(b.imageUrl)||b.imageUrl.length>1024))throw bad(400,'Producto inválido');const args=[tenantId,b.name,b.description||'',b.category||'',b.pricePen,b.imageUrl||null,b.active];
  result=b.id&&uuid(b.id)?await client.query(`UPDATE products SET name=$2,description=$3,category=$4,price_pen=$5,image_url=$6,active=$7,updated_at=now() WHERE tenant_id=$1 AND id=$8 RETURNING *`,[...args,b.id]):await client.query(`INSERT INTO products(tenant_id,name,description,category,price_pen,image_url,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,args)
 }else if(resource==='promotions'){
  if(!word(b.title,180)||!bool(b.active))throw bad(400,'Promoción inválida');const args=[tenantId,b.title,b.startsAt||null,b.endsAt||null,b.active];result=await client.query(`INSERT INTO promotions(tenant_id,title,starts_at,ends_at,active) VALUES($1,$2,$3,$4,$5) RETURNING *`,args)
 }else if(resource==='payments'){
  if(!uuid(b.storeId)||!mode(b.mode)||!method(b.method)||!bool(b.enabled))throw bad(400,'Pago inválido');const exists=await client.query('SELECT id FROM stores WHERE id=$1 AND tenant_id=$2',[b.storeId,tenantId]);if(!exists.rowCount)throw bad(404,'Local no encontrado');result=await client.query(`INSERT INTO payment_methods(tenant_id,store_id,mode,method,enabled) VALUES($1,$2,$3,$4,$5) ON CONFLICT(tenant_id,store_id,mode,method) DO UPDATE SET enabled=EXCLUDED.enabled RETURNING *`,[tenantId,b.storeId,b.mode,b.method,b.enabled]);
 }else if(resource==='apps'){
  if(!word(b.appId,150)||!/^com\.[a-zA-Z0-9_.]+$/.test(b.appId))throw bad(400,'Identificador Android inválido');result=await client.query(`INSERT INTO mobile_apps(tenant_id,app_id) VALUES($1,$2) RETURNING *`,[tenantId,b.appId]);
 }else if(resource==='publish'){
  if(!word(b.appId,150))throw bad(400,'Aplicación inválida');const published=await publish(client,tenantId,b.appId);result={rows:[{revision:published.revision}]};
 }else throw bad(404,'Ruta no encontrada');
 if(!result.rowCount&&resource!=='publish')throw bad(404,'Registro no encontrado');await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[tenantId,user.id,resource.toUpperCase()+'_WRITE',result.rows[0]?.id||b.appId||null]);await client.query('COMMIT');return json(res,200,result.rows[0]);
 }catch(err){await client.query('ROLLBACK');throw err}finally{client.release()}
}
async function serve(res,path){const base=join(process.cwd(),'dist');const target=normalize(join(base,path==='/'?'index.html':path));if(!target.startsWith(base+'/')&&target!==base)throw bad(403,'Ruta inválida');let content;try{content=await readFile(target)}catch{content=await readFile(join(base,'index.html'))}const type=({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(target)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff'});res.end(content)}
createServer(async(req,res)=>{const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);try{
 if(url.pathname.startsWith('/api/v1/mobile/')){
 if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders);res.end();return}
 if(url.pathname==='/api/v1/mobile/config')return await publicConfig(req,res,url)
 const img=url.pathname.match(/^\/api\/v1\/mobile\/images\/([0-9a-f-]{36})$/)
 if(img&&req.method==='GET'){
  const found=await sql(`SELECT i.mime,i.content FROM product_images i WHERE i.id=$1 AND EXISTS(SELECT 1 FROM published_catalogs c JOIN mobile_apps a ON a.app_id=c.app_id JOIN tenants t ON t.id=c.tenant_id WHERE c.tenant_id=i.tenant_id AND a.enabled=true AND t.active=true AND c.payload::text LIKE '%'||$2||'%') LIMIT 1`,[img[1],img[1]]);
  if(!found.rowCount)throw bad(404,'Imagen no publicada');res.writeHead(200,{'Content-Type':found.rows[0].mime,'Cache-Control':'public,max-age=300','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});return res.end(found.rows[0].content)
 }
 if(url.pathname==='/api/v1/mobile/fulfillment/resolve'&&req.method==='POST')return await quote(req,res)
 throw bad(404,'Ruta pública inexistente')}
 if(url.pathname.startsWith('/api/admin/'))return await admin(req,res,url)
 if(req.method==='GET')return await serve(res,url.pathname)
 throw bad(405,'Método no permitido')
 }catch(err){if(err.code==='23505')return json(res,409,{error:'Conflicto: registro duplicado'});if(err.code==='23503')return json(res,409,{error:'Referencia no válida'});const code=typeof err.code==='number'?err.code:500;if(code===500)console.error('API error',err.message);json(res,code,{error:code===500?'Error interno':err.message})}}).listen(port,()=>console.log('Pollos B3 admin listening',port))