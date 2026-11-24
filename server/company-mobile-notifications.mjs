// Company-level commercial notices; never send checkout reminders to marketing topics.
// Times submitted as Peru wall-clock values (UTC-05:00), independent of device timezone.
import {createSign} from 'node:crypto'

const fail=(code,message)=>Object.assign(new Error(message),{code});
const dateTime=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;
const WEEKDAYS=[1,2,3,4,5,6,7];
const timePattern=/^(?:[01]\\d|2[0-3]):[0-5]\\d$/;
const datePattern=/^\\d{4}-\\d{2}-\\d{2}$/;
const localDay=(d)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);
const limaParts=d=>Object.fromEntries(new Intl.DateTimeFormat('en-US',{
 timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',
 hour:'2-digit',minute:'2-digit',hourCycle:'h23',weekday:'short'
}).formatToParts(d).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
const limaDate=p=>p.year+'-'+p.month+'-'+p.day;
const weekdayIndex=p=>({Mon:1,Tue:2,Wed:3,Thu:4,Fri:5,Sat:6,Sun:7})[p.weekday];
const safeDate=value=>typeof value==='string'&&datePattern.test(value)&&
 !Number.isNaN(new Date(value+'T12:00:00Z').getTime())&&
 new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
const marketingTopic='pollosb3_promotions';
const mobileAppId='com.integrab2g.pollosb3';

export function parseLimaDatetime(value){
 if(typeof value!=='string'||!dateTime.test(value))throw fail(400,'Ingresa fecha y hora válidas de Perú');
 const parsed=new Date(value+':00-05:00');
 if(Number.isNaN(parsed.getTime()))throw fail(400,'Fecha y hora inválidas');
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{
  timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',
  minute:'2-digit',hourCycle:'h23'
 }).formatToParts(parsed).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));
 if(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`!==value)
  throw fail(400,'Fecha y hora inválidas');
 return parsed;
}
export function validateCommercialNotice(value){
 if(!value||typeof value!=='object'||Array.isArray(value))throw fail(400,'Aviso inválido');
 if(typeof value.title!=='string'||!value.title.trim()||value.title.trim().length>120||
    typeof value.message!=='string'||!value.message.trim()||value.message.trim().length>1000)
  throw fail(400,'Completa título (máximo 120) y mensaje (máximo 1000)');
 if(value.imageUrl!==''&&value.imageUrl!=null&&
    (typeof value.imageUrl!=='string'||!/^\\/api\\/v1\\/mobile\\/images\\/[0-9a-f-]{36}$/i.test(value.imageUrl)))
  throw fail(400,'Usa una imagen cargada en este Administrador');
 if(!safeDate(value.startDate)||!safeDate(value.endDate)||value.startDate>value.endDate)
  throw fail(400,'Selecciona fechas de inicio y fin válidas');
 if(!timePattern.test(value.runTime||'')||!Array.isArray(value.weekdays)||
  !value.weekdays.length||value.weekdays.length>7||
  new Set(value.weekdays).size!==value.weekdays.length||
  !value.weekdays.every(n=>Number.isInteger(n)&&WEEKDAYS.includes(n)))
  throw fail(400,'Selecciona una hora y al menos un día de ejecución');
 // The start date and end date are inclusive, and stored as UTC timestamps
 // bounding the entire Peru-local day.
 const scheduled=parseLimaDatetime(value.startDate+'T00:00');
 const expires=new Date(parseLimaDatetime(value.endDate+'T00:00').getTime()+86400000);
 return {title:value.title.trim(),message:value.message.trim(),imageUrl:value.imageUrl||null,
  scheduledAt:scheduled,expiresAt:expires,weekdays:value.weekdays.slice().sort(),runTime:value.runTime};
}
const serialize=row=>({
 id:row.id,title:row.title,message:row.message,imageUrl:row.image_url||null,
 scheduledAt:row.scheduled_at,expiresAt:row.expires_at,status:row.status,
 publishedAt:row.published_at,pushSentAt:row.push_sent_at,pushError:row.push_error||null,
 startDate:limaDate(limaParts(new Date(row.scheduled_at))),
 endDate:limaDate(limaParts(new Date(new Date(row.expires_at).getTime()-60000))),
 weekdays:row.weekdays||null,runTime:row.run_time?String(row.run_time).slice(0,5):null
});
const validUuid=v=>typeof v==='string'&&/^[0-9a-f-]{36}$/i.test(v);

export async function commercialNotificationsAdmin(pool,tenantId,input,method='GET'){
 if(method==='GET'){
  const q=await pool.query('SELECT * FROM company_mobile_notifications WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100',[tenantId]);
  return {items:q.rows.map(serialize)};
 }
 const action=input?.action||'save';
 if(action==='publish'||action==='disable'){
  if(!validUuid(input.id))throw fail(400,'Selecciona un aviso');
  const q=await pool.query(`UPDATE company_mobile_notifications
    SET status=$3,published_at=CASE WHEN $3='PUBLISHED' THEN COALESCE(published_at,now()) ELSE published_at END,
     updated_at=now()
    WHERE tenant_id=$1 AND id=$2 AND (status='DRAFT' OR $3='DISABLED')
    RETURNING *`,[tenantId,input.id,action==='publish'?'PUBLISHED':'DISABLED']);
  if(!q.rowCount)throw fail(409,'El aviso no existe o ya se publicó');
  return serialize(q.rows[0]);
 }
 if(action!=='save')throw fail(400,'Acción de aviso inválida');
 const notice=validateCommercialNotice(input);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  if(notice.imageUrl){
   const owned=await client.query('SELECT id FROM product_images WHERE tenant_id=$1 AND id=$2',
    [tenantId,notice.imageUrl.split('/').pop()]);
   if(!owned.rowCount)throw fail(400,'La imagen no pertenece a la empresa');
  }
  if(input.id&&!validUuid(input.id))throw fail(400,'Identificador de aviso inválido');
  const args=[tenantId,notice.title,notice.message,notice.imageUrl,notice.scheduledAt,notice.expiresAt,
   notice.weekdays,notice.runTime];
  const q=input.id?await client.query(`UPDATE company_mobile_notifications
    SET title=$2,message=$3,image_url=$4,scheduled_at=$5,expires_at=$6,
        weekdays=$7,run_time=$8,updated_at=now()
    WHERE tenant_id=$1 AND id=$9 AND status IN ('DRAFT','PUBLISHED') RETURNING *`,[...args,input.id]):
   await client.query(`INSERT INTO company_mobile_notifications
    (tenant_id,title,message,image_url,scheduled_at,expires_at,weekdays,run_time)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,args);
  if(!q.rowCount)throw fail(409,'El aviso no existe o está desactivado');
  await client.query('COMMIT');
  return serialize(q.rows[0]);
 }catch(error){await client.query('ROLLBACK');throw error}finally{client.release()}
}
export async function publicCommercialNotifications(pool,appId,now=new Date()){
 const q=await pool.query(`SELECT n.id,n.title,n.message,n.image_url,n.scheduled_at,n.expires_at
  FROM company_mobile_notifications n JOIN mobile_apps a ON a.tenant_id=n.tenant_id
   JOIN tenants t ON t.id=a.tenant_id
  WHERE a.app_id=$1 AND a.enabled=true AND t.active=true AND n.status='PUBLISHED'
   AND n.scheduled_at<=$2 AND n.expires_at>$2
  ORDER BY n.scheduled_at DESC LIMIT 100`,[appId,now]);
 return {items:q.rows.map(n=>({id:n.id,title:n.title,message:n.message,
  imageUrl:n.image_url||null,scheduledAt:n.scheduled_at,expiresAt:n.expires_at}))};
}
let oauthCache=null;
async function fcmAuth(){
 if(oauthCache&&oauthCache.expires>Date.now()+120000)return oauthCache;
 const raw=process.env.B3_FCM_SERVICE_ACCOUNT_JSON;
 if(!raw)return null;
 const account=JSON.parse(raw);
 if(!account.client_email||!account.private_key||!account.project_id)throw Error('FCM no configurado');
 const encode=x=>Buffer.from(JSON.stringify(x)).toString('base64url');
 const now=Math.floor(Date.now()/1000);
 const head=encode({alg:'RS256',typ:'JWT'});
 const body=encode({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',
  aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
 const unsigned=head+'.'+body;
 const signer=createSign('RSA-SHA256');signer.update(unsigned);signer.end();
 const assertion=unsigned+'.'+signer.sign(account.private_key).toString('base64url');
 const response=await fetch('https://oauth2.googleapis.com/token',{
  method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
  body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
  signal:AbortSignal.timeout(8000)
 });
 if(!response.ok)throw Error('FCM autenticación HTTP '+response.status);
 const data=await response.json();
 if(!data.access_token)throw Error('FCM token ausente');
 oauthCache={value:data.access_token,project:account.project_id,expires:Date.now()+3000000};
 return oauthCache;
}
export async function sendCompanyPush(row){
 const auth=await fcmAuth();
 if(!auth)throw Error('Falta B3_FCM_SERVICE_ACCOUNT_JSON');
 const response=await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(auth.project)+'/messages:send',{
  method:'POST',headers:{Authorization:'Bearer '+auth.value,'Content-Type':'application/json'},
  body:JSON.stringify({message:{topic:marketingTopic,notification:{title:row.title,body:row.message},
   data:{type:'promotion',notificationId:String(row.id),
    imageUrl:String(row.image_url||''),scheduledAt:new Date(row.scheduled_at).toISOString(),
    expiresAt:new Date(row.expires_at).toISOString()}}}),
  signal:AbortSignal.timeout(8000)
 });
 if(!response.ok)throw Error('FCM envío HTTP '+response.status);
 return true;
}
export async function dispatchCommercialNotifications(pool,{send=sendCompanyPush,now=new Date()}={}){
 // One attempt per selected Lima-local day. Previous single-shot notices retain
 // their legacy behavior until they are edited with recurring frequency.
 const p=limaParts(now),today=limaDate(p),weekday=weekdayIndex(p),
  clock=p.hour+':'+p.minute;
 const candidates=await pool.query(`SELECT n.*
  FROM company_mobile_notifications n
  WHERE n.status='PUBLISHED' AND n.scheduled_at<=$1 AND n.expires_at>$1
    AND (n.weekdays IS NULL OR ($2=ANY(n.weekdays) AND n.run_time<=$3::time))
    AND (n.weekdays IS NOT NULL OR n.push_sent_at IS NULL)
    AND EXISTS(SELECT 1 FROM mobile_apps a WHERE a.tenant_id=n.tenant_id
       AND a.app_id=$4 AND a.enabled=true)
  ORDER BY n.scheduled_at,n.id LIMIT 100`,[now,weekday,clock,mobileAppId]);
 let claimedCount=0;
 for(const row of candidates.rows){
  // Claim is atomic per (notification, Peru date), retryable after lease expiry;
  // a successful send is never intentionally repeated for that local day.
  const claimed=await pool.query(`INSERT INTO company_mobile_notification_runs
    (notification_id,run_date,claim_at)
    VALUES($1,$2::date,now())
    ON CONFLICT(notification_id,run_date) DO UPDATE SET
     claim_at=EXCLUDED.claim_at,error=NULL
    WHERE company_mobile_notification_runs.sent_at IS NULL
     AND company_mobile_notification_runs.claim_at<now()-interval '2 minutes'
    RETURNING notification_id`,[row.id,today]);
  if(!claimed.rowCount)continue;
  claimedCount++;
  try{
   await send(row);
   await pool.query(`UPDATE company_mobile_notification_runs SET sent_at=now(),error=NULL
    WHERE notification_id=$1 AND run_date=$2::date`,[row.id,today]);
   await pool.query(`UPDATE company_mobile_notifications SET push_sent_at=now(),
    push_error=NULL WHERE id=$1`,[row.id]);
  }catch(e){
   const error=String(e?.message||'Error FCM').slice(0,500);
   await pool.query(`UPDATE company_mobile_notification_runs SET error=$3,
     claim_at=now()-interval '3 minutes'
    WHERE notification_id=$1 AND run_date=$2::date AND sent_at IS NULL`,[row.id,today,error]);
   await pool.query('UPDATE company_mobile_notifications SET push_error=$2 WHERE id=$1',[row.id,error]);
   console.error('Pollos B3 aviso comercial:',error);
  }
 }
 return claimedCount;
}
