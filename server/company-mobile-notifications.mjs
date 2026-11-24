// Company-level commercial notices; never send checkout reminders to marketing topics.
// Times submitted as Peru wall-clock values (UTC-05:00), independent of device timezone.
import {createSign} from 'node:crypto'

const fail=(code,message)=>Object.assign(new Error(message),{code});
const dateTime=/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d$/;
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
    (typeof value.imageUrl!=='string'||!/^\/api\/v1\/mobile\/images\/[0-9a-f-]{36}$/i.test(value.imageUrl)))
  throw fail(400,'Usa una imagen cargada en este Administrador');
 const scheduled=parseLimaDatetime(value.scheduledAt),expires=parseLimaDatetime(value.expiresAt);
 if(expires<=scheduled)throw fail(400,'El vencimiento debe ser posterior al inicio');
 return {title:value.title.trim(),message:value.message.trim(),imageUrl:value.imageUrl||null,scheduledAt:scheduled,expiresAt:expires};
}
const serialize=row=>({
 id:row.id,title:row.title,message:row.message,imageUrl:row.image_url||null,
 scheduledAt:row.scheduled_at,expiresAt:row.expires_at,status:row.status,
 publishedAt:row.published_at,pushSentAt:row.push_sent_at,pushError:row.push_error||null
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
  const args=[tenantId,notice.title,notice.message,notice.imageUrl,notice.scheduledAt,notice.expiresAt];
  const q=input.id?await client.query(`UPDATE company_mobile_notifications
    SET title=$2,message=$3,image_url=$4,scheduled_at=$5,expires_at=$6,updated_at=now()
    WHERE tenant_id=$1 AND id=$7 AND status='DRAFT' RETURNING *`,[...args,input.id]):
   await client.query(`INSERT INTO company_mobile_notifications
    (tenant_id,title,message,image_url,scheduled_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6) RETURNING *`,args);
  if(!q.rowCount)throw fail(409,'Solo puedes modificar avisos en borrador');
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
export async function dispatchCommercialNotifications(pool,{send=sendCompanyPush}={}){
 // A single worker must be enabled for the Pollos B3 app. Never broadcast other tenants to its topic.
 const claimed=await pool.query(`UPDATE company_mobile_notifications n
   SET push_claimed_at=now(),push_error=NULL
   WHERE n.id IN(
    SELECT pending.id FROM company_mobile_notifications pending
    WHERE pending.status='PUBLISHED' AND pending.push_sent_at IS NULL
      AND pending.scheduled_at<=now() AND pending.expires_at>now()
      AND (pending.push_claimed_at IS NULL OR pending.push_claimed_at<now()-interval '2 minutes')
      AND EXISTS(SELECT 1 FROM mobile_apps a WHERE a.tenant_id=pending.tenant_id
       AND a.app_id=$1 AND a.enabled=true)
    ORDER BY pending.scheduled_at LIMIT 20 FOR UPDATE SKIP LOCKED
   ) RETURNING n.*`,[mobileAppId]);
 for(const row of claimed.rows){
  try{
   await send(row);
   await pool.query(`UPDATE company_mobile_notifications SET push_sent_at=now(),push_claimed_at=NULL,
    push_error=NULL WHERE id=$1 AND push_sent_at IS NULL`,[row.id]);
  }catch(e){
   await pool.query(`UPDATE company_mobile_notifications SET push_claimed_at=NULL,
    push_error=$2 WHERE id=$1`,[row.id,String(e?.message||'Error FCM').slice(0,500)]);
   console.error('Pollos B3 aviso comercial:',e?.message);
  }
 }
 return claimed.rowCount;
}
