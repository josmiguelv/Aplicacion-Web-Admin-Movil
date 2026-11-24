import {integrationRoutes} from './integrations.mjs'
import {validatePromotionSchedule,promotionVisible} from './promotion-schedule.mjs'
import {adminApiKeyRoutes,serviceCatalogRoute} from './service-api-keys.mjs'
import {createMobileOrderAvailabilityRoutes} from './mobile-order-availability.mjs'
import {createMobileTuVersoRoutes} from './mobile-tuverso-routes.mjs'
import {createMobileReservationSlotsRoute} from './mobile-reservation-slots.mjs'
import {createMobileReservationsRoutes} from './mobile-reservations.mjs'
import {createAdminReservationRoutes} from './admin-reservations.mjs'
import {readStoreReservationSettings,saveStoreReservationSettings,publishedReservationSettings} from './mobile-reservation-settings.mjs'
import {checkoutPolicy,updateCheckoutPolicy,runCheckoutNotifications} from './mobile-checkout-followups.mjs'
import {commercialNotificationsAdmin,publicCommercialNotifications,dispatchCommercialNotifications} from './company-mobile-notifications.mjs'
import {createServer} from 'node:http'
import {readFile,stat} from 'node:fs/promises'
import {join,normalize,extname} from 'node:path'
import {randomBytes,scryptSync,timingSafeEqual,createHash,randomUUID} from 'node:crypto'
import pg from 'pg'

const pool=new pg.Pool({connectionString:process.env.DATABASE_URL, max:10})
const port=Number(process.env.PORT||4000)
const prod=process.env.NODE_ENV==='production'
if(prod){
 if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL es obligatorio en producción');
 if(!process.env.ADMIN_ORIGIN || !/^https:\/\/[^/]+$/.test(process.env.ADMIN_ORIGIN))throw new Error('ADMIN_ORIGIN debe ser un origen HTTPS exacto en producción');
 if(process.env.COOKIE_SECURE==='false')throw new Error('COOKIE_SECURE no puede ser false en producción');
}
const secure=process.env.COOKIE_SECURE!== 'false' && prod
const allowedOrigins=(process.env.ALLOWED_ORIGINS||'').split(',').map(x=>x.trim()).filter(Boolean)
const corsHeaders={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET, POST, OPTIONS','Access-Control-Allow-Headers':'Content-Type, Authorization, Idempotency-Key','Cache-Control':'no-store'}
const json=(res,status,body,publicRead=false)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8',...(publicRead?corsHeaders:{'Cache-Control':'no-store'})});res.end(JSON.stringify(body))}
const bad=(code,message)=>Object.assign(new Error(message),{code})
const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x)
const word=(x,max=150)=>typeof x==='string'&&x.trim().length>0&&x.trim().length<=max
const bool=x=>typeof x==='boolean'
const mode=x=>['delivery','pickup','dine_in','reservation'].includes(x)
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

const DEFAULT_TENANT_TZ='America/Lima';
const WEEKDAYS=['sun','mon','tue','wed','thu','fri','sat'];
function validateOpeningHours(value){
 if(value===null)return true;
 if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!WEEKDAYS.includes(k)))return false;
 return Object.values(value).every(v=>v&&typeof v==='object'&&!Array.isArray(v)&&(
   v.closed===true||(typeof v.open==='string'&&typeof v.close==='string'&&
   /^([01]\d|2[0-3]):[0-5]\d$/.test(v.open)&&/^([01]\d|2[0-3]):[0-5]\d$/.test(v.close)&&v.open!==v.close)
 ));
}
function storeHours(store,date=new Date(),timeZone=DEFAULT_TENANT_TZ){
 const hours=store.openingHours??store.opening_hours;
 if(!hours||typeof hours!=='object')return {hoursConfigured:false};
 const zone=DEFAULT_TENANT_TZ;
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).map(p=>[p.type,p.value]));
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
function withLiveHours(store,timeZone,at=new Date()){return {...store,...storeHours(store,at,timeZone)}}

async function publish(tx,tenantId,appId){const [stores,products,promos,payments,vacancies,appSettings,sharedPaymentImages]=await Promise.all([
 tx.query('SELECT s.id,s.name,s.address,s.latitude,s.longitude,s.radius_km,s.delivery_fee_pen,s.delivery_rate_per_km_pen,s.delivery_pricing_mode,s.delivery_preparation_minutes,s.pickup_preparation_minutes,s.active,s.delivery_enabled,s.pickup_enabled,s.dine_in_enabled,s.opening_hours,s.consult_order_availability, r.enabled AS reservation_enabled, r.preparation_minutes AS reservation_preparation_minutes FROM stores s LEFT JOIN store_reservation_settings r ON r.tenant_id=s.tenant_id AND r.store_id=s.id WHERE s.tenant_id=$1 AND s.active=true ORDER BY s.name',[tenantId]),
 tx.query('SELECT id,name,description,category,price_pen,image_url FROM products WHERE tenant_id=$1 AND active=true ORDER BY name',[tenantId]),
 tx.query(`SELECT id,title,starts_at,ends_at,
  to_char(starts_on,'YYYY-MM-DD') AS "startDate",
  to_char(ends_on,'YYYY-MM-DD') AS "endDate",
  to_char(active_from,'HH24:MI') AS "startTime",
  to_char(active_until,'HH24:MI') AS "endTime",
  active_weekdays AS weekdays
 FROM promotions WHERE tenant_id=$1 AND active=true ORDER BY id`,[tenantId]),
 tx.query('SELECT store_id,mode,method,image_url FROM payment_methods WHERE tenant_id=$1 AND enabled=true',[tenantId]),
 tx.query(`SELECT j.id,j.title,j.summary,j.description,j.requirements,
   j.employment_type AS "employmentType",j.image_url AS "imageUrl",j.whatsapp_phone AS "whatsappPhone",
   COALESCE((SELECT array_agg(vs.store_id ORDER BY st.name)
     FROM job_vacancy_stores vs JOIN stores st ON st.id=vs.store_id AND st.tenant_id=vs.tenant_id
     WHERE vs.vacancy_id=j.id AND vs.tenant_id=j.tenant_id AND st.active=true),ARRAY[]::uuid[]) AS "storeIds",
   COALESCE((SELECT string_agg(st.name, ', ' ORDER BY st.name)
     FROM job_vacancy_stores vs JOIN stores st ON st.id=vs.store_id AND st.tenant_id=vs.tenant_id
     WHERE vs.vacancy_id=j.id AND vs.tenant_id=j.tenant_id AND st.active=true),'') AS "locationLabel"
  FROM job_vacancies j WHERE j.tenant_id=$1 AND j.active=true
   AND EXISTS (SELECT 1 FROM job_vacancy_stores vs JOIN stores st
    ON st.id=vs.store_id AND st.tenant_id=vs.tenant_id
    WHERE vs.tenant_id=j.tenant_id AND vs.vacancy_id=j.id AND st.active=true)
   ORDER BY j.updated_at DESC,j.id`,[tenantId]),
 tx.query('SELECT complaints_book_url FROM mobile_apps WHERE tenant_id=$1 AND app_id=$2',[tenantId,appId]),
 tx.query('SELECT method,image_url FROM company_payment_images WHERE tenant_id=$1',[tenantId])
 ]);const sharedPaymentImageMap=Object.fromEntries(sharedPaymentImages.rows.filter(p=>p.image_url).map(p=>[p.method,p.image_url]));
 const payload={schemaVersion:1,appId,currency:'PEN',timeZone:DEFAULT_TENANT_TZ,paymentImages:sharedPaymentImageMap,stores:stores.rows.map(s=>({...s,latitude:s.latitude===null?null:Number(s.latitude),longitude:s.longitude===null?null:Number(s.longitude),radiusKm:s.radius_km===null?null:Number(s.radius_km),deliveryRatePerKmPen:s.delivery_rate_per_km_pen===null?null:Number(s.delivery_rate_per_km_pen),deliveryPricingMode:s.delivery_pricing_mode,deliveryFeePen:s.delivery_fee_pen===null?null:Number(s.delivery_fee_pen),openingHours:s.opening_hours??null,deliveryPreparationMinutes:s.delivery_preparation_minutes??null,pickupPreparationMinutes:s.pickup_preparation_minutes??null,consultOrderAvailability:s.delivery_enabled===true||s.pickup_enabled===true,preparationMinutes:s.reservation_preparation_minutes??null,reservationSettings:publishedReservationSettings({enabled:s.reservation_enabled,preparation_minutes:s.reservation_preparation_minutes}),paymentMethods:payments.rows.filter(p=>p.store_id===s.id).reduce((a,p)=>(a[p.mode].push(p.method),a),{delivery:[],pickup:[],dine_in:[],reservation:[]}),
 paymentMethodImages:{
  delivery:Object.fromEntries(payments.rows.filter(p=>p.store_id===s.id&&p.mode==='delivery'&&p.method!=='cash'&&sharedPaymentImageMap[p.method]).map(p=>[p.method,sharedPaymentImageMap[p.method]])),
  pickup:Object.fromEntries(payments.rows.filter(p=>p.store_id===s.id&&p.mode==='pickup'&&p.method!=='cash'&&sharedPaymentImageMap[p.method]).map(p=>[p.method,sharedPaymentImageMap[p.method]])),
  reservation:Object.fromEntries(payments.rows.filter(p=>p.store_id===s.id&&p.mode==='reservation'&&p.method!=='cash'&&sharedPaymentImageMap[p.method]).map(p=>[p.method,sharedPaymentImageMap[p.method]]))
 }})),products:products.rows.map(p=>({...p,pricePen:Number(p.price_pen)})),promotions:promos.rows,vacancies:vacancies.rows,complaintsBookUrl:appSettings.rows[0]?.complaints_book_url||null};
 const v=await tx.query('UPDATE mobile_apps SET published_revision=published_revision+1,enabled=true WHERE tenant_id=$1 AND app_id=$2 RETURNING published_revision',[tenantId,appId]);if(!v.rowCount)throw bad(404,'Aplicación no registrada');const revision=v.rows[0].published_revision;await tx.query(`INSERT INTO published_catalogs(app_id,tenant_id,revision,payload) VALUES($1,$2,$3,$4) ON CONFLICT(app_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,published_at=now()`,[appId,tenantId,revision,JSON.stringify(payload)]);return{revision,payload}}
async function publicConfig(req,res,url){if(req.method!=='GET')throw bad(405,'Método no permitido');const appId=url.searchParams.get('appId');if(!word(appId,150))throw bad(400,'appId obligatorio');const q=await sql(`SELECT p.payload,p.revision FROM published_catalogs p JOIN mobile_apps a ON a.app_id=p.app_id AND a.tenant_id=p.tenant_id JOIN tenants t ON t.id=p.tenant_id WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[appId]);if(!q.rowCount)return json(res,200,{ready:false,revision:0,stores:[],products:[],promotions:[],vacancies:[],notifications:[]},true);const commercial=await publicCommercialNotifications(pool,appId).catch(error=>{if(error.code==='42P01')return {items:[]};throw error});return json(res,200,{ready:true,revision:q.rows[0].revision,notifications:commercial.items,...q.rows[0].payload,timeZone:DEFAULT_TENANT_TZ,promotions:(q.rows[0].payload.promotions||[]).filter(p=>promotionVisible(p,DEFAULT_TENANT_TZ)),stores:(q.rows[0].payload.stores||[]).map(s=>({
 ...withLiveHours(s,DEFAULT_TENANT_TZ),
 reservationSettings:{...(s.reservationSettings||{}),
  acceptingRequests:process.env.B3_RESERVATIONS_LIVE_ENABLED==='true'&&s.reservationSettings?.enabled===true}
}))},true)}

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

async function deliveryQuotes(config,b,revision,legacyLimaFallback=false,at=new Date()){
 const eligible=config.stores.filter(s=>s.active&&s.delivery_enabled===true);
 if(!eligible.length)throw bad(409,'No hay sedes habilitadas para Delivery');
 const hasCoordinates=checkLatLng(b.latitude,b.longitude)&&b.useGps===true;
 if(!hasCoordinates)throw bad(422,'Necesitamos coordenadas verificadas del destino para estimar el delivery sin Google Routes.');
 // MVP: approximate straight-line distance from device-geocoded/GPS coordinates.
 // Never describe this as drivable route distance or a Google Maps quotation.
 const destination={latitude:b.latitude,longitude:b.longitude};
 const candidates=eligible.filter(s=>(!b.storeId||s.id===b.storeId)&&checkLatLng(s.latitude,s.longitude)&&
  (s.deliveryPricingMode==='FIXED'?Number.isFinite(s.deliveryFeePen)&&s.deliveryFeePen>=0:Number.isFinite(s.deliveryRatePerKmPen)&&s.deliveryRatePerKmPen>=0));
 if(!candidates.length)throw bad(409,'Ninguna sede tiene una tarifa de Delivery y coordenadas configuradas');
 if(candidates.length>12)throw bad(503,'Demasiadas sedes para cotizar en una sola operación');
 // The supplied GPS/geocoded coordinates are the only distance input here.
 // Do not reference an address flag: the candidates are sorted by the measured
 // straight-line distance below (after coverage checks).
 const available=[];
 for(const store of candidates){
  const km=Math.round(kmDistance(store.latitude,store.longitude,destination.latitude,destination.longitude)*100)/100;
  if(km===null||store.radiusKm!==null&&store.radiusKm!==undefined&&km>store.radiusKm+1e-8)continue;
  const deliveryFee=store.deliveryPricingMode==='FIXED'?store.deliveryFeePen:Math.round((km*store.deliveryRatePerKmPen+Number.EPSILON)*100)/100;
  available.push({storeId:store.id,storeName:store.name,deliveryFee,routeDistanceKm:km,
   deliveryPricingMode:store.deliveryPricingMode,ratePerKmPen:store.deliveryPricingMode==='FIXED'?null:store.deliveryRatePerKmPen,
   paymentMethods:store.paymentMethods?.delivery||[],preparationMinutes:store.deliveryPreparationMinutes??null,consultOrderAvailability:store.consultOrderAvailability===true});
 }
 available.sort((a,b2)=>a.routeDistanceKm-b2.routeDistanceKm||a.storeId.localeCompare(b2.storeId));
 if(!available.length)throw bad(409,'Dirección fuera de la cobertura de las sedes disponibles');
 return available
}
async function loadOrderContext(appId,b){
 const q=await sql(`SELECT p.tenant_id,p.payload,p.revision FROM published_catalogs p
  JOIN mobile_apps a ON a.app_id=p.app_id AND a.tenant_id=p.tenant_id
  JOIN tenants t ON t.id=p.tenant_id
  WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[appId]);
 if(!q.rowCount)throw bad(409,'Catálogo no publicado');
 const {tenant_id:tenantId,payload,revision}=q.rows[0];
 const candidates=await deliveryQuotes(payload,b,revision);
 return {tenantId,revision,currency:payload.currency||'PEN',products:payload.products||[],candidates};
}
const orderRequestLimit=new Map();
function limitMobileOrderRequests(req){
 const ip=req.socket?.remoteAddress||'unknown',now=Date.now(),current=orderRequestLimit.get(ip);
 if(orderRequestLimit.size>5000)orderRequestLimit.clear();
 const max=req.method==='GET'?60:10;
 if(!current||now-current.start>=60000){orderRequestLimit.set(ip,{start:now,count:1});return}
 if(++current.count>max)throw bad(429,'Demasiadas solicitudes de pedido. Intenta de nuevo en un minuto');
}
async function isOrderCandidateLive(tenantId,candidate){
 const result=await sql(`SELECT s.active,s.delivery_enabled
  FROM stores s JOIN tenants t ON t.id=s.tenant_id
  WHERE s.tenant_id=$1 AND s.id=$2 AND t.active=true`,[tenantId,candidate.storeId]);
 const store=result.rows[0];if(!store||!store.active||!store.delivery_enabled)return false;
 return true
}
const mobileOrderAvailabilityRoutes=createMobileOrderAvailabilityRoutes({pool,body,json:(res,status,value)=>json(res,status,value,true),loadOrderContext,isCandidateLive:isOrderCandidateLive,rateLimit:limitMobileOrderRequests});
const mobileTuVersoRoutes=createMobileTuVersoRoutes({pool,body,json:(res,status,value)=>json(res,status,value,true),storeOpen:store=>store.active!==false&&(store.delivery_enabled===true||store.pickup_enabled===true)});
const reservationFulfillmentHours=()=>({hoursConfigured:true,isOpen:true});
const mobileReservationSlotsRoute=createMobileReservationSlotsRoute({pool,json,storeHours:reservationFulfillmentHours});
const mobileReservationsRoutes=createMobileReservationsRoutes({pool,body,json,storeHours:reservationFulfillmentHours,deliveryQuotes});
const adminReservationsRoutes=createAdminReservationRoutes({pool,body,json,tenantOf});
async function quote(req,res){
 const b=await body(req);
 if(!word(b.appId,150)||!mode(b.mode))throw bad(400,'Modalidad y aplicación obligatorias');
 const q=await sql(`SELECT p.payload,p.revision FROM published_catalogs p JOIN mobile_apps a ON a.app_id=p.app_id JOIN tenants t ON t.id=p.tenant_id WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[b.appId]);
 if(!q.rowCount)throw bad(409,'Catálogo no publicado');
 const config=q.rows[0].payload;
 const eligible=config.stores.filter(s=>s.active&&s[b.mode==='dine_in'?'dine_in_enabled':b.mode+'_enabled']===true);
 if(!eligible.length)throw bad(409,'No hay sedes habilitadas para esta modalidad');
 let selected,roadKm=null,deliveryFeePen=0;
 if(b.mode==='delivery'){
  limitPublicDeliveryQuotes(req);
  const candidates=await deliveryQuotes(config,b,q.rows[0].revision,true);
  if(b.storeId&&!uuid(b.storeId))throw bad(400,'Sede solicitada inválida');
  const first=candidates[0];selected=eligible.find(s=>s.id===first.storeId);roadKm=first.routeDistanceKm;deliveryFeePen=first.deliveryFee;
  if(b.storeId&&selected.id!==b.storeId)throw bad(409,'No se pudo cotizar la sede seleccionada');
 }else{
  selected=eligible.find(s=>s.id===b.storeId);
  if(!selected)throw bad(409,'Selecciona una sede habilitada para esta modalidad');
 }
 return json(res,200,{revision:q.rows[0].revision,storeId:selected.id,storeName:selected.name,
  mode:b.mode,paymentMethods:selected.paymentMethods?.[b.mode]||[],preparationMinutes:b.mode==='delivery'?selected.deliveryPreparationMinutes??null:b.mode==='pickup'?selected.pickupPreparationMinutes??null:null,deliveryFeePen,routeDistanceKm:roadKm,
  deliveryPricingMode:b.mode==='delivery'?selected.deliveryPricingMode:null,
  ratePerKmPen:b.mode==='delivery'&&selected.deliveryPricingMode!=='FIXED'?selected.deliveryRatePerKmPen:null,
  distanceSource:b.mode==='delivery'?'STRAIGHT_LINE':null,provisional:true,
  notice:'Tarifa provisional calculada en línea recta, no distancia por carretera. Importes sujetos a confirmación.'},true)
}
async function admin(req,res,url){if(req.method==='POST'&&url.pathname==='/api/admin/login'){
 if(!sameOrigin(req))throw bad(403,'Origen no autorizado');const b=await body(req);if(!word(b.email,254)||!word(b.password,512))throw bad(400,'Credenciales inválidas');const q=await sql('SELECT * FROM admin_users WHERE email=lower($1) AND active=true',[b.email]);const user=q.rows[0];let ok=false;if(user&&typeof user.password_hash==='string'){const parts=user.password_hash.split(':');if(parts.length===3&&parts[0]==='scrypt'){const provided=scryptSync(b.password,parts[1],64),stored=Buffer.from(parts[2],'hex');ok=stored.length===provided.length&&timingSafeEqual(provided,stored)}}if(!ok)throw bad(401,'Credenciales inválidas');const token=randomBytes(32).toString('hex');await sql(`INSERT INTO admin_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '12 hours')`,[user.id,digest(token)]);res.setHeader('Set-Cookie',`b3sid=${token}; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=43200${secure?'; Secure':''}`);return json(res,200,{id:user.id,role:user.role,tenantId:user.tenant_id})}
 const user=await session(req);if(req.method!=='GET'&&!sameOrigin(req))throw bad(403,'Origen no autorizado');
 const mobileNoticeMatch=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]{36})\/mobile-notifications$/i)
 if(mobileNoticeMatch){
  const tenantId=mobileNoticeMatch[1];
  await tenantOf(user,tenantId);
  if(req.method==='GET')return json(res,200,await commercialNotificationsAdmin(pool,tenantId,null,'GET'));
  if(req.method==='POST'){
   const submitted=await body(req);
   const saved=await commercialNotificationsAdmin(pool,tenantId,submitted,'POST');
   return json(res,200,saved);
  }
  throw bad(405,'Método de avisos no permitido');
 }
 const checkoutSettings=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]{36})\/checkout-settings$/i)
 if(checkoutSettings){
  const tenantId=checkoutSettings[1];await tenantOf(user,tenantId)
  if(req.method==='GET')return json(res,200,await checkoutPolicy(pool,tenantId))
  if(req.method!=='POST')throw bad(405,'Método no permitido')
  const input=await body(req)
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!['paymentWaitMinutes','reminderCount','remindersEnabled','reminderTitle','reminderMessage','reminder2Title','reminder2Message'].includes(k)))throw bad(400,'Configuración de seguimiento inválida')
  const saved=await updateCheckoutPolicy(pool,tenantId,input)
  await sql('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[tenantId,user.id,'CHECKOUT_POLICY_UPDATED',tenantId])
  return json(res,200,saved)
 }
 const reservationMatch=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]{36})\/stores\/([0-9a-f-]{36})\/reservation-settings$/i)
  if(reservationMatch){
   const tenantId=reservationMatch[1],storeId=reservationMatch[2];
   await tenantOf(user,tenantId);
   if(req.method==='GET')return json(res,200,await readStoreReservationSettings(pool,tenantId,storeId));
   if(req.method!=='POST')throw bad(405,'Método no permitido');
   return json(res,200,await saveStoreReservationSettings(pool,tenantId,storeId,user.id,await body(req)));
  }
  if(/^\/api\/admin\/tenants\/[0-9a-f-]{36}\/reservations(?:\/[0-9a-f-]{36}\/(?:verify-payment|cancel))?$/i.test(url.pathname))
   return await adminReservationsRoutes({req,res,url,user})
  if(await adminApiKeyRoutes({req,res,url,user,pool,body,json,tenantOf}))return
 if(await integrationRoutes({req,res,url,user,pool,body,json,tenantOf}))return
 if(url.pathname==='/api/admin/me'&&req.method==='GET')return json(res,200,{role:user.role,tenantId:user.tenant_id});
 if(url.pathname==='/api/admin/logout'&&req.method==='POST'){await sql('DELETE FROM admin_sessions WHERE token_hash=$1',[digest(cookie(req))]);res.setHeader('Set-Cookie',`b3sid=; Path=/api/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure?'; Secure':''}`);return json(res,200,{ok:true})}
 if(url.pathname==='/api/admin/tenants'&&req.method==='GET'){if(user.role!=='SUPER_ADMIN')throw bad(403,'Acceso restringido');const x=await sql('SELECT id,name,active FROM tenants ORDER BY created_at');return json(res,200,{tenants:x.rows})}
 if(url.pathname==='/api/admin/tenants'&&req.method==='POST'){if(user.role!=='SUPER_ADMIN')throw bad(403,'Acceso restringido');const b=await body(req);if(!word(b.name,180))throw bad(400,'Nombre de empresa inválido');const x=await sql('INSERT INTO tenants(name,time_zone) VALUES($1,$2) RETURNING id,name,active',[b.name.trim(),DEFAULT_TENANT_TZ]);await sql('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[x.rows[0].id,user.id,'TENANT_CREATED',x.rows[0].id]);return json(res,201,x.rows[0])}
 const tenantSettingsMatch=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/settings$/);
 if(tenantSettingsMatch){
  const tenantId=tenantSettingsMatch[1];await tenantOf(user,tenantId);
  if(req.method!=='GET')throw bad(405,'La zona horaria está fijada internamente en UTC−5');
  return json(res,200,{id:tenantId,timeZone:DEFAULT_TENANT_TZ});
 }
 const userMatch=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/users$/);
 if(userMatch&&req.method==='GET'){if(user.role!=='SUPER_ADMIN')throw bad(403,'Acceso restringido');const id=userMatch[1];await tenantOf(user,id);const result=await sql('SELECT id,email,role,active,created_at FROM admin_users WHERE tenant_id=$1 ORDER BY created_at DESC,id',[id]);return json(res,200,{items:result.rows})}
 if(userMatch&&req.method==='POST'){if(user.role!=='SUPER_ADMIN')throw bad(403,'Acceso restringido');const id=userMatch[1];await tenantOf(user,id);const b=await body(req);if(!word(b.email,254)||!word(b.password,512)||b.password.length<14)throw bad(400,'Correo o clave inválida (mínimo 14 caracteres)');const salt=randomBytes(16).toString('hex'),hash=`scrypt:${salt}:${scryptSync(b.password,salt,64).toString('hex')}`;const x=await sql('INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES(lower($1),$2,$3,$4) RETURNING id,email',[b.email,hash,'TENANT_ADMIN',id]);return json(res,201,x.rows[0])}
 const asset=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/images$/);
 if(asset&&req.method==='POST'){
  const tenantId=asset[1];await tenantOf(user,tenantId);const bytes=await imageBody(req),mime=imageMime(bytes);
  if(!mime)throw bad(415,'Solo imágenes JPEG, PNG y WebP reales');const x=await sql('INSERT INTO product_images(tenant_id,mime,content) VALUES($1,$2,$3) RETURNING id',[tenantId,mime,bytes]);
  await sql('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[tenantId,user.id,'IMAGE_UPLOADED',x.rows[0].id]);
  return json(res,201,{url:'/api/v1/mobile/images/'+x.rows[0].id,id:x.rows[0].id,mime})
 }
 const previewImage=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]{36})\/images\/([0-9a-f-]{36})$/i);
 if(previewImage&&req.method==='GET'){
  const tenantId=previewImage[1],imageId=previewImage[2];
  await tenantOf(user,tenantId);
  const found=await sql('SELECT mime,content FROM product_images WHERE tenant_id=$1 AND id=$2',
    [tenantId,imageId]);
  if(!found.rowCount)throw bad(404,'Imagen de la empresa no encontrada');
  res.writeHead(200,{'Content-Type':found.rows[0].mime,
   'Cache-Control':'private,no-store','X-Content-Type-Options':'nosniff'});
  return res.end(found.rows[0].content);
 }
 const sharedPaymentRoute=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]{36})\/payment-images$/i);
 if(sharedPaymentRoute){
  const tenantId=sharedPaymentRoute[1];await tenantOf(user,tenantId);
  if(req.method==='GET'){
   const images=await sql('SELECT method,image_url FROM company_payment_images WHERE tenant_id=$1',[tenantId]);
   return json(res,200,{images:Object.fromEntries(images.rows.map(x=>[x.method,x.image_url||'']))});
  }
  if(req.method!=='POST')throw bad(405,'Método no permitido');
  const input=await body(req),methods=['yape','plin','card'];
  if(!input||typeof input!=='object'||Array.isArray(input)||
   Object.keys(input).length!==3||Object.keys(input).some(key=>!methods.includes(key))||
   methods.some(key=>!Object.prototype.hasOwnProperty.call(input,key)||
    typeof input[key]!=='string'||input[key]!==''&&!/^\/api\/v1\/mobile\/images\/[0-9a-f-]{36}$/i.test(input[key])))
   throw bad(400,'Selecciona solo imágenes válidas para Yape, Plin e Izipay');
  const imageIds=methods.map(key=>input[key]).filter(Boolean).map(value=>value.split('/').pop());
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   if(imageIds.length){
    const ownership=await client.query('SELECT id::text FROM product_images WHERE tenant_id=$1 AND id::text=ANY($2::text[])',[tenantId,imageIds]);
    if(new Set(ownership.rows.map(x=>x.id)).size!==new Set(imageIds).size)throw bad(400,'Hay imágenes que no pertenecen a esta empresa');
   }
   await client.query(`INSERT INTO company_payment_images(tenant_id,method,image_url)
    SELECT $1,a.method,a.url FROM unnest($2::text[],$3::text[]) AS a(method,url)
    ON CONFLICT(tenant_id,method) DO UPDATE SET image_url=EXCLUDED.image_url,updated_at=now()`,
    [tenantId,methods,methods.map(key=>input[key]||null)]);
   await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',
    [tenantId,user.id,'PAYMENT_IMAGES_UPDATED',tenantId]);
   await client.query('COMMIT');
   return json(res,200,{images:input});
  }catch(err){await client.query('ROLLBACK');throw err}finally{client.release()}
 }
 const m=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/(stores|products|promotions|payments|apps|publish|vacancies|complaints)$/);
 if(!m)throw bad(404,'Ruta no encontrada');const tenantId=m[1],resource=m[2];await tenantOf(user,tenantId);
 if(req.method==='GET'){
  if(resource==='vacancies'){
   const x=await sql(`SELECT j.*,
      COALESCE((SELECT array_agg(vs.store_id ORDER BY vs.store_id)
       FROM job_vacancy_stores vs WHERE vs.tenant_id=j.tenant_id AND vs.vacancy_id=j.id),
       ARRAY[]::uuid[]) AS store_ids
     FROM job_vacancies j WHERE j.tenant_id=$1 ORDER BY j.id`,[tenantId]);
   return json(res,200,{items:x.rows});
  }
  const table={stores:'stores',products:'products',promotions:'promotions',payments:'payment_methods',apps:'mobile_apps'}[resource];if(!table)throw bad(405,'Acción no permitida');const x=await sql(`SELECT * FROM ${table} WHERE tenant_id=$1 ORDER BY 1`,[tenantId]);return json(res,200,{items:x.rows})
 }
 if(req.method!=='POST'&&req.method!=='PUT')throw bad(405,'Acción no permitida');const b=await body(req);const client=await pool.connect();try{await client.query('BEGIN');let result;
 if(resource==='stores'){
  if(b.id && !uuid(b.id))throw bad(400,'ID técnico de sede inválido');
  if(b.code!==undefined&&(typeof b.code!=='string'||b.code.length<2||b.code.length>80||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(b.code)))throw bad(400,'ID de sede inválido: usa minúsculas, números y guiones (2 a 80 caracteres)');
  if(b.id){
   const existing=await client.query('SELECT code FROM stores WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,b.id]);
   if(!existing.rowCount)throw bad(404,'Sede no encontrada');
   if(b.code!==undefined&&b.code!==existing.rows[0].code)throw bad(400,'El ID de la sede no se puede modificar');
  }
  const storeCode=b.code??('sede-'+randomUUID());
  const consultOrderAvailability=b.delivery_enabled===true||b.pickup_enabled===true;
  const validPreparation=v=>v==null||Number.isInteger(v)&&v>=1&&v<=240;
  if(!validPreparation(b.deliveryPreparationMinutes)||!validPreparation(b.pickupPreparationMinutes)||!validateOpeningHours(b.openingHours??null)||!word(b.name,180)||!word(b.address,300)||![b.active,b.delivery_enabled,b.pickup_enabled,b.dine_in_enabled,consultOrderAvailability].every(bool)||!(b.latitude==null&&b.longitude==null)&&!checkLatLng(b.latitude,b.longitude)||b.radiusKm!=null&&(!safeNumber(b.radiusKm)||b.radiusKm<=0||b.radiusKm>500)||b.deliveryRatePerKmPen!=null&&(!safeNumber(b.deliveryRatePerKmPen)||b.deliveryRatePerKmPen<0||b.deliveryRatePerKmPen>1000)||b.deliveryFeePen!=null&&(!safeNumber(b.deliveryFeePen)||b.deliveryFeePen<0||b.deliveryFeePen>10000)||!['PER_KM','FIXED'].includes(b.deliveryPricingMode??'PER_KM'))throw bad(400,'Datos del local inválidos');
  const args=[tenantId,b.name.trim(),b.address.trim(),b.latitude??null,b.longitude??null,b.radiusKm??null,b.deliveryRatePerKmPen??null,b.deliveryFeePen??null,b.deliveryPricingMode??'PER_KM',b.active,b.delivery_enabled,b.pickup_enabled,b.dine_in_enabled,b.openingHours??null,consultOrderAvailability,b.deliveryPreparationMinutes??null,b.pickupPreparationMinutes??null];
  result=b.id&&uuid(b.id)?await client.query(`UPDATE stores SET name=$2,address=$3,latitude=$4,longitude=$5,radius_km=$6,delivery_rate_per_km_pen=$7,delivery_fee_pen=$8,delivery_pricing_mode=$9,active=$10,delivery_enabled=$11,pickup_enabled=$12,dine_in_enabled=$13,opening_hours=$14,consult_order_availability=$15,delivery_preparation_minutes=$16,pickup_preparation_minutes=$17,updated_at=now() WHERE tenant_id=$1 AND id=$18 RETURNING *`,[...args,b.id]):await client.query(`INSERT INTO stores(tenant_id,name,address,latitude,longitude,radius_km,delivery_rate_per_km_pen,delivery_fee_pen,delivery_pricing_mode,active,delivery_enabled,pickup_enabled,dine_in_enabled,opening_hours,consult_order_availability,delivery_preparation_minutes,pickup_preparation_minutes,code) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING *`,[...args,storeCode])
 }else if(resource==='vacancies'){
  const title=b.title?.trim(),phone=String(b.whatsappPhone||'').replace(/\D/g,'');
  const normalized=phone.length===9?'51'+phone:phone;
  const storeIds=b.storeIds;
  if(!word(title,150)||!/^519\d{8}$/.test(normalized)||!bool(b.active)||
     typeof b.summary!=='string'||b.summary.length>500||
     typeof b.description!=='string'||b.description.length>5000||
     typeof b.requirements!=='string'||b.requirements.length>5000||
     !['Tiempo completo','Medio tiempo'].includes(b.employmentType)||
     !Array.isArray(storeIds)||storeIds.length===0||
     storeIds.length>100||new Set(storeIds).size!==storeIds.length||
     !storeIds.every(uuid)||
     typeof b.imageUrl!=='string'||b.imageUrl.length>1024||
     b.imageUrl!==''&&!/^\/api\/v1\/mobile\/images\/[0-9a-f-]{36}$/.test(b.imageUrl))
    throw bad(400,'Completa puesto, sedes activas, modalidad y teléfono de postulaciones');
  const matching=await client.query(`SELECT id,name FROM stores
    WHERE tenant_id=$1 AND active=true AND id=ANY($2::uuid[])`,[tenantId,storeIds]);
  if(matching.rowCount!==storeIds.length)throw bad(409,'Selecciona únicamente sedes activas de la empresa');
  if(b.imageUrl){
   const imageId=b.imageUrl.split('/').pop();
   const owned=await client.query('SELECT id FROM product_images WHERE id=$1 AND tenant_id=$2',[imageId,tenantId]);
   if(!owned.rowCount)throw bad(400,'La imagen no pertenece a esta empresa');
  }
  const locationLabel=matching.rows.map(row=>row.name).sort().join(', ');
  const args=[tenantId,title,b.summary,b.description,b.requirements,'',b.employmentType,
    locationLabel,b.imageUrl||null,normalized,b.active];
  result=b.id&&uuid(b.id)?await client.query(`UPDATE job_vacancies
    SET title=$2,summary=$3,description=$4,requirements=$5,schedule=$6,
      employment_type=$7,location_label=$8,image_url=$9,whatsapp_phone=$10,
      active=$11,updated_at=now()
    WHERE tenant_id=$1 AND id=$12 RETURNING *`,[...args,b.id]):
   await client.query(`INSERT INTO job_vacancies
    (tenant_id,title,summary,description,requirements,schedule,employment_type,
     location_label,image_url,whatsapp_phone,active)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,args);
  if(result.rowCount===1){
   await client.query('DELETE FROM job_vacancy_stores WHERE tenant_id=$1 AND vacancy_id=$2',[tenantId,result.rows[0].id]);
   await client.query(`INSERT INTO job_vacancy_stores(tenant_id,vacancy_id,store_id)
      SELECT $1,$2,unnest($3::uuid[])`,[tenantId,result.rows[0].id,storeIds]);
  }
 }else if(resource==='products'){
  if(!word(b.name,180)||!safeNumber(b.pricePen)||b.pricePen<0||!bool(b.active)||b.imageUrl&&(!/^https:\/\//.test(b.imageUrl)&&!/^\/api\/v1\/mobile\/images\/[0-9a-f-]{36}$/.test(b.imageUrl)||b.imageUrl.length>1024))throw bad(400,'Producto inválido');const args=[tenantId,b.name,b.description||'',b.category||'',b.pricePen,b.imageUrl||null,b.active];
  result=b.id&&uuid(b.id)?await client.query(`UPDATE products SET name=$2,description=$3,category=$4,price_pen=$5,image_url=$6,active=$7,updated_at=now() WHERE tenant_id=$1 AND id=$8 RETURNING *`,[...args,b.id]):await client.query(`INSERT INTO products(tenant_id,name,description,category,price_pen,image_url,active) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,args)
 }else if(resource==='promotions'){
  if(!word(b.title,180)||!bool(b.active))throw bad(400,'Promoción inválida');
  if(b.startDate!==undefined||b.endDate!==undefined||b.startTime!==undefined||
    b.endTime!==undefined||b.weekdays!==undefined){
   if(!validatePromotionSchedule(b))throw bad(400,'Completa fechas, horas y al menos un día activo. La hora de fin debe ser posterior a la de inicio.');
   result=await client.query(`INSERT INTO promotions(
    tenant_id,title,starts_on,ends_on,active_from,active_until,active_weekdays,active)
    VALUES($1,$2,$3::date,$4::date,$5::time,$6::time,$7::integer[],$8)
    RETURNING *`,
    [tenantId,b.title,b.startDate,b.endDate,b.startTime,b.endTime,b.weekdays,b.active]);
  }else{
   // Keep the preexisting timestamp contract available for older integrations.
   const args=[tenantId,b.title,b.startsAt||null,b.endsAt||null,b.active];
   result=await client.query(`INSERT INTO promotions(tenant_id,title,starts_at,ends_at,active)
    VALUES($1,$2,$3,$4,$5) RETURNING *`,args);
  }
 }else if(resource==='payments'){
  if(!uuid(b.storeId)||!mode(b.mode))throw bad(400,'Pago inválido');
  const exists=await client.query('SELECT id FROM stores WHERE id=$1 AND tenant_id=$2',[b.storeId,tenantId]);
  if(!exists.rowCount)throw bad(404,'Local no encontrado');
  if(b.methods!==undefined){
   const keys=['yape','plin','card','cash'];
   if(!b.methods||typeof b.methods!=='object'||Array.isArray(b.methods)||
      Object.keys(b.methods).length!==keys.length||
      !keys.every(key=>Object.prototype.hasOwnProperty.call(b.methods,key)&&bool(b.methods[key])))
    throw bad(400,'Selecciona el estado de los cuatro métodos de pago');
   const images=b.images??{};
   if(!images||typeof images!=='object'||Array.isArray(images)||
      Object.keys(images).some(key=>!['yape','plin','card'].includes(key))||
      Object.values(images).some(value=>value!==null&&value!==''&&
       (typeof value!=='string'||!/^\/api\/v1\/mobile\/images\/[0-9a-f-]{36}$/i.test(value))))
    throw bad(400,'Imagen de medio de pago inválida');
   const urls=keys.map(key=>key==='cash'?null:(images[key]||null));
   const owned=urls.filter(Boolean).map(value=>value.split('/').pop());
   if(owned.length){
    const photos=await client.query(
     'SELECT id::text FROM product_images WHERE tenant_id=$1 AND id::text=ANY($2::text[])',
     [tenantId,owned]);
    if(new Set(photos.rows.map(x=>x.id)).size!==new Set(owned).size)
     throw bad(400,'Una imagen no pertenece a esta empresa');
   }
   result=await client.query(`INSERT INTO payment_methods(tenant_id,store_id,mode,method,enabled,image_url)
    SELECT $1,$2,$3,p.method,p.enabled,p.image_url
    FROM unnest($4::text[],$5::boolean[],$6::text[]) AS p(method,enabled,image_url)
    ON CONFLICT(tenant_id,store_id,mode,method)
    DO UPDATE SET enabled=EXCLUDED.enabled,image_url=EXCLUDED.image_url RETURNING *`,
    [tenantId,b.storeId,b.mode,keys,keys.map(key=>b.methods[key]),urls]);
  }else{
   if(!method(b.method)||!bool(b.enabled))throw bad(400,'Pago inválido');
   result=await client.query(`INSERT INTO payment_methods(tenant_id,store_id,mode,method,enabled)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(tenant_id,store_id,mode,method)
    DO UPDATE SET enabled=EXCLUDED.enabled RETURNING *`,
    [tenantId,b.storeId,b.mode,b.method,b.enabled]);
  }
 }else if(resource==='apps'){
  if(!word(b.appId,150)||!/^com\.[a-zA-Z0-9_.]+$/.test(b.appId))throw bad(400,'Identificador Android inválido');result=await client.query(`INSERT INTO mobile_apps(tenant_id,app_id) VALUES($1,$2) RETURNING *`,[tenantId,b.appId]);
 }else if(resource==='complaints'){
  if(!word(b.appId,150)||typeof b.url!=='string'||b.url.length>1024)throw bad(400,'Configuración inválida');
  let valid=false;
  if(!b.url)valid=true;
  else try{const u=new URL(b.url);valid=u.protocol==='https:'&&!!u.hostname&&u.port===''&&!u.username&&!u.password&&!['localhost','127.0.0.1','0.0.0.0'].includes(u.hostname)&&!u.hostname.endsWith('.local')&&!u.hostname.endsWith('.internal')&&!/^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)&&!u.hostname.includes('..')}catch{}
  if(!valid)throw bad(400,'La dirección del Libro debe ser HTTPS público, sin credenciales');
  result=await client.query('UPDATE mobile_apps SET complaints_book_url=$3 WHERE tenant_id=$1 AND app_id=$2 RETURNING *',[tenantId,b.appId,b.url||null]);
 }else if(resource==='publish'){
  if(!word(b.appId,150))throw bad(400,'Aplicación inválida');const published=await publish(client,tenantId,b.appId);result={rows:[{revision:published.revision}]};
 }else throw bad(404,'Ruta no encontrada');
 if(!result.rowCount&&resource!=='publish')throw bad(404,'Registro no encontrado');await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[tenantId,user.id,resource.toUpperCase()+'_WRITE',result.rows[0]?.id||b.appId||null]);await client.query('COMMIT');return json(res,200,result.rows[0]);
 }catch(err){await client.query('ROLLBACK');throw err}finally{client.release()}
}
async function serve(res,path){const base=join(process.cwd(),'dist');const target=normalize(join(base,path==='/'?'index.html':path));if(!target.startsWith(base+'/')&&target!==base)throw bad(403,'Ruta inválida');let content;try{content=await readFile(target)}catch{content=await readFile(join(base,'index.html'))}const type=({'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'})[extname(target)]||'application/octet-stream';res.writeHead(200,{'Content-Type':type,'X-Content-Type-Options':'nosniff'});res.end(content)}
// Marketing push is OFF by default. Enable only with real FCM credentials,
// app subscription consent and migration 016 installed in this Administrator DB.
if(process.env.B3_MARKETING_PUSH_ENABLED==='true'){
 let inProgress=false;
 const tick=async()=>{if(inProgress)return;inProgress=true;
  try{await dispatchCommercialNotifications(pool)}
  catch(error){console.error('Pollos B3 marketing notifications:',error.message)}
  finally{inProgress=false}
 };
 const timer=setInterval(()=>{void tick()},30000);
 timer.unref?.();void tick();
}
// Payment timers are server-owned; no mobile foreground timer is authoritative.
// Enable only after applying migration 007 to the isolated Administrator database.
if(process.env.B3_CHECKOUT_WORKER_ENABLED==='true'){
 let running=false
 const tick=async()=>{if(running)return;running=true;try{await runCheckoutNotifications(pool)}catch(e){console.error('Pollos B3 checkout worker:',e.message)}finally{running=false}}
 const worker=setInterval(()=>{void tick()},30000)
 worker.unref?.();void tick()
}
createServer(async(req,res)=>{const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);try{
 if(url.pathname==='/health/live'&&req.method==='GET')return json(res,200,{status:'ok'});
 if(url.pathname==='/health/ready'&&req.method==='GET'){
  let databaseReady=false;
  try{await sql('SELECT 1');databaseReady=true}catch{}
  return json(res,databaseReady?200:503,{status:databaseReady?'ready':'unavailable'});
 }

 if(await serviceCatalogRoute({req,res,url,pool,json}))return
 if(url.pathname.startsWith('/api/v1/mobile/')){
 if(req.method==='OPTIONS'){res.writeHead(204,corsHeaders);res.end();return}
 if(await mobileTuVersoRoutes({req,res,url}))return
 if(await mobileOrderAvailabilityRoutes({req,res,url}))return
  if(/^\/api\/v1\/mobile\/stores\/[0-9a-f-]{36}\/reservation-slots$/i.test(url.pathname))
   return await mobileReservationSlotsRoute({req,res,url})
  if(url.pathname==='/api/v1/mobile/reservations'||url.pathname==='/api/v1/mobile/reservations/quote'||
     /^\/api\/v1\/mobile\/reservations\/by-key\/[0-9a-f-]{36}$/i.test(url.pathname)||
     /^\/api\/v1\/mobile\/reservations\/[0-9a-f-]{36}(?:\/(?:payment|cancel))?$/i.test(url.pathname))
   return await mobileReservationsRoutes({req,res,url})
 if(url.pathname==='/api/v1/mobile/notifications'){
  if(req.method!=='GET')throw bad(405,'Solo se permite consultar notificaciones');
  const id=url.searchParams.get('appId');
  if(!word(id,150))throw bad(400,'appId obligatorio');
  return json(res,200,await publicCommercialNotifications(pool,id),true);
 }
 if(url.pathname==='/api/v1/mobile/config')return await publicConfig(req,res,url)
 const img=url.pathname.match(/^\/api\/v1\/mobile\/images\/([0-9a-f-]{36})$/)
 if(img&&req.method==='GET'){
  let found;
  try{
 found=await sql(`SELECT i.mime,i.content FROM product_images i WHERE i.id=$1 AND (EXISTS(SELECT 1 FROM published_catalogs c JOIN mobile_apps a ON a.app_id=c.app_id JOIN tenants t ON t.id=c.tenant_id WHERE c.tenant_id=i.tenant_id AND a.enabled=true AND t.active=true AND c.payload::text LIKE '%'||$2||'%')
  OR EXISTS(SELECT 1 FROM company_mobile_notifications n
   JOIN mobile_apps a ON a.tenant_id=n.tenant_id
   JOIN tenants t ON t.id=n.tenant_id
   WHERE n.tenant_id=i.tenant_id AND t.active=true AND a.enabled=true
    AND n.status='PUBLISHED' AND n.scheduled_at<=now() AND n.expires_at>now()
    AND n.image_url='/api/v1/mobile/images/'||i.id::text))
  LIMIT 1`,[img[1],img[1]]);
  }catch(error){
   if(error.code!=='42P01')throw error;
   // During local upgrades, old catalog images stay available before migration 016.
   found=await sql(`SELECT i.mime,i.content FROM product_images i WHERE i.id=$1
    AND EXISTS(SELECT 1 FROM published_catalogs c
     JOIN mobile_apps a ON a.app_id=c.app_id
     JOIN tenants t ON t.id=c.tenant_id
     WHERE c.tenant_id=i.tenant_id AND a.enabled=true AND t.active=true
      AND c.payload::text LIKE '%'||$2||'%')
    LIMIT 1`,[img[1],img[1]]);
  }
  if(!found.rowCount)throw bad(404,'Imagen no publicada');res.writeHead(200,{'Content-Type':found.rows[0].mime,'Cache-Control':'public,max-age=300','Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});return res.end(found.rows[0].content)
 }
 if(url.pathname==='/api/v1/mobile/fulfillment/resolve'&&req.method==='POST')return await quote(req,res)
 throw bad(404,'Ruta pública inexistente')}
 if(url.pathname.startsWith('/api/admin/'))return await admin(req,res,url)
 if(req.method==='GET')return await serve(res,url.pathname)
 throw bad(405,'Método no permitido')
 }catch(err){if(res.headersSent || res.writableEnded){console.error('API response already started:',err instanceof Error?err.message:'Unknown error');if(!res.writableEnded&&!res.destroyed)res.destroy();return}if(err.code==='23505')return json(res,409,{error:'Conflicto: registro duplicado'});if(err.code==='23503')return json(res,409,{error:'Referencia no válida'});const code=typeof err.code==='number'?err.code:500;if(code===500)console.error('API error',err.message);json(res,code,{error:code===500?'Error interno':err.message})}}).listen(port,()=>console.log('INTEGRA B2G multitenant admin listening',port))
