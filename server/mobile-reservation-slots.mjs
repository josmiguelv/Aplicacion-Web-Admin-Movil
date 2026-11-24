// Pollos B3 — read-only future schedule preview. A slot is NOT a capacity hold,
// agent acceptance or a confirmed reservation. No changes to TU VERSO.
import {mapReservationSettings} from './mobile-reservation-settings.mjs';
const FAIL=(code,message)=>Object.assign(new Error(message),{code});
const DAY=/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const APP=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/;
function validDate(s){
 if(!DAY.test(s||''))return false;
 const d=new Date(s+'T12:00:00Z');
 return !Number.isNaN(d.getTime())&&d.toISOString().slice(0,10)===s;
}
const hhmm=m=>String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
function timeParts(date,timeZone){
 const p=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',
  hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date);
 return Object.fromEntries(p.filter(x=>x.type!=='literal').map(x=>[x.type,x.value]));
}
export function localDateTimeEpoch(date,time,timeZone){
 // Determine the UTC instant represented by a timezone's local date+time,
 // then verify the roundtrip (DST gaps are rejected, never silently shifted).
 const [y,m,d]=date.split('-').map(Number),[h,min]=time.split(':').map(Number);
 const target=Date.UTC(y,m-1,d,h,min);
 let instant=target;
 for(let i=0;i<4;i++){
  const parts=timeParts(new Date(instant),timeZone);
  const displayed=Date.UTC(Number(parts.year),Number(parts.month)-1,Number(parts.day),
   Number(parts.hour),Number(parts.minute));
  instant+=target-displayed;
 }
 const parts=timeParts(new Date(instant),timeZone);
 const valid=parts.year===String(y)&&parts.month===String(m).padStart(2,'0')&&
  parts.day===String(d).padStart(2,'0')&&parts.hour===String(h).padStart(2,'0')&&
  parts.minute===String(min).padStart(2,'0');
 return valid?instant:null;
}
export function computeReservationSlots({date,mode,store,settings,timeZone='America/Lima',
 now=new Date(),isOpenAt}){
 if(!validDate(date)||!['delivery','pickup'].includes(mode))throw FAIL(400,'Fecha o modalidad de reserva inválida');
 if(!store||store.active!==true||store[mode+'_enabled']!==true||
  !settings?.enabled)return {enabled:false,slots:[]};
 const cfg=settings;
 if(!Number.isSafeInteger(cfg.preparationMinutes)||cfg.preparationMinutes<1||
    cfg.preparationMinutes>240)return {enabled:false,slots:[]};
 // No time windows, advance limits, or capacity limits. The requested time
 // must be in the future; TU VERSO still decides if an agent can receive it.
 const slots=[];
 for(let m=0;m<1440;m++){
  const time=hhmm(m),epoch=localDateTimeEpoch(date,time,timeZone);
  if(epoch===null||epoch<=now.getTime())continue;
  slots.push({time,scheduledAt:new Date(epoch).toISOString()});
 }
 return {enabled:true,slots};
}
export function createMobileReservationSlotsRoute({pool,json,storeHours,now=()=>new Date()}){
 return async function route({req,res,url}){
  const match=url.pathname.match(/^\/api\/v1\/mobile\/stores\/([0-9a-f-]{36})\/reservation-slots$/i);
  if(!match)return false;
  if(req.method!=='GET')throw FAIL(405,'Método no permitido');
  const storeId=match[1],appId=url.searchParams.get('appId'),
   date=url.searchParams.get('date'),mode=url.searchParams.get('mode');
  if(!UUID.test(storeId)||!APP.test(appId||'')||!validDate(date)||!['delivery','pickup'].includes(mode))
   throw FAIL(400,'Parámetros de programación inválidos');
  const p=await pool.query(`SELECT c.tenant_id,c.revision,c.payload
   FROM published_catalogs c JOIN mobile_apps a ON a.app_id=c.app_id AND a.tenant_id=c.tenant_id
   JOIN tenants t ON t.id=c.tenant_id WHERE c.app_id=$1 AND a.enabled=true AND t.active=true`,[appId]);
  if(p.rowCount!==1)throw FAIL(404,'Catálogo no disponible');
  const published=p.rows[0],store=published.payload?.stores?.find(s=>s.id===storeId);
  if(!store||store.active!==true)throw FAIL(404,'Sede no disponible');
  const live=await pool.query(`SELECT s.active,s.delivery_enabled,s.pickup_enabled,s.opening_hours,
    r.*,t.time_zone FROM stores s
    JOIN tenants t ON t.id=s.tenant_id
    LEFT JOIN store_reservation_settings r ON r.tenant_id=s.tenant_id AND r.store_id=s.id
    WHERE s.tenant_id=$1 AND s.id=$2 AND t.active=true`,[published.tenant_id,storeId]);
  if(live.rowCount!==1)throw FAIL(404,'Sede no disponible');
  const row=live.rows[0],config=mapReservationSettings(row);
  const openStore={...store,serviceMode:mode,active:row.active,delivery_enabled:row.delivery_enabled,
   pickup_enabled:row.pickup_enabled,openingHours:row.opening_hours};
  const calculated=computeReservationSlots({date,mode,store:openStore,settings:{
   ...config,enabled:config.enabled&&store.reservationSettings?.enabled===true
  },timeZone:row.time_zone||'America/Lima',now:now(),
   isOpenAt:()=>true});
  return json(res,200,{storeId,appId,revision:published.revision,date,mode,
   timeZone:row.time_zone||'America/Lima',enabled:calculated.enabled,
   slots:calculated.slots,capacityVerified:false,agentAvailable:null,
   acceptingRequests:false,notice:'Horarios preliminares. Aún no se pueden confirmar reservas.'},true);
 }
}
