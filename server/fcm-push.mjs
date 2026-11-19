// Transporte FCM HTTP v1 y programador seguro; solo backend, sin claves en el APK.
import {createSign} from 'node:crypto'
import {readFile} from 'node:fs/promises'
const scope='https://www.googleapis.com/auth/firebase.messaging'
const b64=obj=>Buffer.from(JSON.stringify(obj)).toString('base64url')
const fault=(status,message)=>Object.assign(new Error(message),{status})
export function pushConfig(env=process.env){
 const projectId=env.FCM_PROJECT_ID||'pollosb3-84297'
 const appId=env.FCM_TARGET_APP_ID||'com.integrab2g.pollosb3'
 const topic=env.FCM_TOPIC||'pollosb3_promotions'
 const origin=(env.FCM_PUBLIC_BASE_URL||'').replace(/\/+$/,'')
 if(!/^[a-z][a-z0-9-]{4,62}$/.test(projectId))throw Error('FCM_PROJECT_ID inválido')
 if(!/^com\.[A-Za-z0-9_.]+$/.test(appId))throw Error('FCM_TARGET_APP_ID inválido')
 if(!/^[a-zA-Z0-9-_.~%]{1,900}$/.test(topic))throw Error('FCM_TOPIC inválido')
 if(env.FCM_ENABLED==='true'&&(!/^https:\/\/[^/?#]+$/.test(origin)||new URL(origin).username||new URL(origin).password))
  throw Error('FCM_PUBLIC_BASE_URL debe ser un origen HTTPS público')
 return {enabled:env.FCM_ENABLED==='true',projectId,appId,topic,origin}
}
export function createFcmSender({env=process.env,fetchImpl=fetch,readFileImpl=readFile}={}){
 const cfg=pushConfig(env)
 let cacheToken='',tokenExpires=0
 async function getCredentials(){
  const raw=env.FCM_SERVICE_ACCOUNT_JSON||(
   env.GOOGLE_APPLICATION_CREDENTIALS?await readFileImpl(env.GOOGLE_APPLICATION_CREDENTIALS,'utf8'):'')
  if(!raw)throw fault(503,'Credencial privada FCM no configurada')
  let data
  try{data=JSON.parse(raw)}catch{throw fault(503,'La cuenta de servicio FCM no es JSON válido')}
  if(data.type!=='service_account'||data.project_id!==cfg.projectId||
   !/^[^\s@]+@[^\s@]+\.iam\.gserviceaccount\.com$/.test(data.client_email||'')||
   typeof data.private_key!=='string'||!data.private_key.includes('BEGIN PRIVATE KEY'))
   throw fault(503,'La cuenta de servicio FCM no coincide con el proyecto')
  return data
 }
 async function getToken(){
  if(cacheToken&&Date.now()<tokenExpires-60000)return cacheToken
  const account=await getCredentials()
  const now=Math.floor(Date.now()/1000)
  const unsigned=b64({alg:'RS256',typ:'JWT'})+'.'+b64({
   iss:account.client_email,scope,aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})
  const signer=createSign('RSA-SHA256')
  signer.update(unsigned)
  const assertion=unsigned+'.'+signer.sign(account.private_key,'base64url')
  const response=await fetchImpl('https://oauth2.googleapis.com/token',{
   method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}),
   signal:AbortSignal.timeout(15000)})
  const data=await response.json().catch(()=>({}))
  if(!response.ok||typeof data.access_token!=='string')
   throw fault(response.status,'Google OAuth rechazó la cuenta FCM (HTTP '+response.status+')')
  cacheToken=data.access_token
  tokenExpires=Date.now()+Math.min(Math.max(Number(data.expires_in)||3600,120),3600)*1000
  return cacheToken
 }
 return async function send(notice){
  if(!cfg.enabled)throw fault(503,'FCM deshabilitado')
  if(notice.appId!==cfg.appId)throw fault(403,'Aplicación FCM no autorizada')
  const auth=await getToken()
  const url=cfg.origin+'/api/v1/mobile/notification-images/'+notice.imageId+'?appId='+encodeURIComponent(notice.appId)
  const secs=notice.expiresAt?Math.max(1,Math.min(2419200,Math.floor((new Date(notice.expiresAt).getTime()-Date.now())/1000))):86400
  const message={message:{
   topic:cfg.topic,notification:{title:notice.title,body:notice.message,image:url},
   android:{ttl:secs+'s',priority:'HIGH',notification:{image:url,channel_id:'pollosb3_promotions'}},
   // Contrato nativo B3FirebaseMessagingService: marketing + title/body.
   data:{notificationId:String(notice.id),appId:notice.appId,type:'marketing',
    screen:'notifications',title:notice.title,body:notice.message}}}
  let response
  try{response=await fetchImpl('https://fcm.googleapis.com/v1/projects/'+cfg.projectId+'/messages:send',{
   method:'POST',headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},
   body:JSON.stringify(message),signal:AbortSignal.timeout(15000)})}
  catch{throw fault(520,'No hay confirmación de FCM. Evitar reenvío automático.')}
  const data=await response.json().catch(()=>({}))
  if(!response.ok)throw fault(response.status,'FCM respondió HTTP '+response.status)
  if(typeof data.name!=='string'||!data.name.startsWith('projects/'+cfg.projectId+'/messages/'))
   throw fault(520,'FCM respondió sin identificador válido')
  return data.name
 }
}
// Reclama trabajos con bloqueo SQL para que múltiples procesos no ejecuten el
// mismo envío a la vez. Un envío interrumpido pasa a UNKNOWN sin reintento
// automático: FCM pudo aceptarlo antes de la interrupción.
export async function dispatchDue({pool,send,config=pushConfig(),limit=10,logger=console}){
 if(!config.enabled)return {processed:0}
 const client=await pool.connect()
 let rows=[]
 try{
  await client.query('BEGIN')
  await client.query("UPDATE scheduled_notifications SET push_status='UNKNOWN',push_last_error='Proceso interrumpido. Revisar manualmente',push_locked_at=NULL WHERE push_status='SENDING' AND push_locked_at<now()-interval '5 minutes'")
  const sql=[
   'SELECT n.id,n.app_id AS "appId",n.title,n.message,n.image_id AS "imageId",n.expires_at AS "expiresAt",octet_length(i.content) AS image_bytes',
   'FROM scheduled_notifications n',
   'JOIN mobile_apps a ON a.app_id=n.app_id AND a.tenant_id=n.tenant_id AND a.enabled=true',
   'JOIN tenants t ON t.id=n.tenant_id AND t.active=true',
   'JOIN product_images i ON i.id=n.image_id AND i.tenant_id=n.tenant_id',
   'WHERE n.app_id=$1 AND n.enabled=true AND n.cancelled_at IS NULL',
   'AND n.send_at<=now() AND (n.expires_at IS NULL OR n.expires_at>now())',
   "AND n.push_status IN ('PENDING','RETRY') AND n.push_next_attempt_at<=now()",
   'ORDER BY n.send_at,n.id LIMIT $2 FOR UPDATE OF n SKIP LOCKED'
  ].join(' ')
  const claim=await client.query(sql,[config.appId,Math.max(1,Math.min(25,limit))])
  rows=claim.rows
  for(const row of rows)await client.query(
   "UPDATE scheduled_notifications SET push_status='SENDING',push_attempts=push_attempts+1,push_locked_at=now(),push_last_error=NULL WHERE id=$1",[row.id])
  await client.query('COMMIT')
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 for(const row of rows){
  try{
   if(Number(row.image_bytes)>1024*1024)throw fault(422,'La imagen supera 1 MB (FCM)')
   const current=await pool.query(
    "SELECT id FROM scheduled_notifications WHERE id=$1 AND enabled=true AND cancelled_at IS NULL AND push_status='SENDING' AND (expires_at IS NULL OR expires_at>now())",[row.id])
   if(!current.rowCount)continue
   const fcmId=await send(row)
   await pool.query(
    "UPDATE scheduled_notifications SET push_status='SENT',fcm_message_id=$2,push_sent_at=now(),push_locked_at=NULL,push_last_error=NULL,updated_at=now() WHERE id=$1 AND push_status='SENDING'",
    [row.id,fcmId])
  }catch(e){
   const status=typeof e?.status==='number'?e.status:520
   const tries=await pool.query('SELECT push_attempts FROM scheduled_notifications WHERE id=$1',[row.id])
   const n=Number(tries.rows[0]?.push_attempts||0)
   const next=[429,503].includes(status)&&n<4?'RETRY':status===520?'UNKNOWN':'FAILED'
   const error=String(e?.message||'FCM no disponible').slice(0,240)
   const seconds=Math.min(3600,60*Math.pow(3,Math.max(0,n-1)))
   await pool.query(
    "UPDATE scheduled_notifications SET push_status=$2,push_last_error=$3,push_locked_at=NULL,push_next_attempt_at=now()+make_interval(secs=>$4),updated_at=now() WHERE id=$1 AND push_status='SENDING'",
    [row.id,next,error,seconds])
   logger.warn('FCM notification '+row.id+' '+next+' HTTP '+status)
  }
 }
 return {processed:rows.length}
}
export function startFcmWorker({pool,env=process.env,logger=console,intervalMs=15000,send=createFcmSender({env})}){
 const config=pushConfig(env)
 if(!config.enabled)return {enabled:false,stop(){}}
 let busy=false,stopped=false
 const tick=async()=>{
  if(busy||stopped)return
  busy=true
  try{await dispatchDue({pool,send,config,logger})}
  catch(e){logger.error('FCM worker: '+String(e?.message||'Error'))}
  finally{busy=false}
 }
 const timer=setInterval(()=>void tick(),Math.max(5000,intervalMs))
 timer.unref?.()
 void tick()
 return {enabled:true,stop(){stopped=true;clearInterval(timer)}}
}
