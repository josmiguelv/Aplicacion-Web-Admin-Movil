import {createHash,createSign} from 'node:crypto'
import {decryptCredential} from './integration-crypto.mjs'
import {readMobileInteractionMessages,readMobileInteraction,sendMobileInteractionMessage} from './tuverso-mobile-connector.mjs'

const hash=value=>createHash('sha256').update(value).digest('hex')
const FAIL=(code,message)=>Object.assign(new Error(message),{code})
const MAX_BATCH=40
const CANCEL_ON_TIMEOUT='[Pollos B3 · Sistema] El plazo de pago del cliente terminó. Esta solicitud queda vencida; no preparar ni cobrar. El asesor puede cerrar la atención.'
let oauth=null

export async function checkoutPolicy(pool,tenantId) {
 const r=await pool.query('SELECT payment_wait_minutes,reminder_count FROM mobile_checkout_policies WHERE tenant_id=$1',[tenantId])
 const row=r.rows[0]
 return {paymentWaitMinutes:row?.payment_wait_minutes??10,reminderCount:row?.reminder_count??2}
}
export async function updateCheckoutPolicy(pool,tenantId,{paymentWaitMinutes,reminderCount}) {
 if(!Number.isInteger(paymentWaitMinutes)||paymentWaitMinutes<5||paymentWaitMinutes>30||
   !Number.isInteger(reminderCount)||reminderCount<0||reminderCount>2)throw FAIL(400,'Plazo 5–30 minutos y recordatorios 0–2')
 await pool.query('INSERT INTO mobile_checkout_policies(tenant_id,payment_wait_minutes,reminder_count) VALUES($1,$2,$3) ON CONFLICT(tenant_id) DO UPDATE SET payment_wait_minutes=excluded.payment_wait_minutes,reminder_count=excluded.reminder_count,updated_at=now()',[tenantId,paymentWaitMinutes,reminderCount])
 return checkoutPolicy(pool,tenantId)
}
const keyHash=key=>hash('b3-checkout:'+key)
const ownership=()=> 'interaction_id=$1 AND tenant_id=$2 AND app_id=$3 AND store_id=$4 AND access_hash=$5'
const keys=({interactionId,tenantId,appId,storeId,accessKey})=>[interactionId,tenantId,appId,storeId,keyHash(accessKey)]
export async function bindPersonalDevice(pool,params,token) {
 if(typeof token!=='string'||token.length<50||token.length>4096||!/^[A-Za-z0-9_:.-]+$/.test(token))
  throw FAIL(400,'Token de dispositivo inválido')
 const args=keys(params)
 const result=await pool.query(
  'INSERT INTO mobile_checkout_followups(interaction_id,tenant_id,app_id,store_id,access_hash,fcm_token) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(interaction_id) DO UPDATE SET fcm_token=excluded.fcm_token,updated_at=now() WHERE mobile_checkout_followups.tenant_id=excluded.tenant_id AND mobile_checkout_followups.app_id=excluded.app_id AND mobile_checkout_followups.store_id=excluded.store_id AND mobile_checkout_followups.access_hash=excluded.access_hash AND mobile_checkout_followups.state NOT IN (\'CANCELLED\',\'EXPIRED\',\'FINISHED\') RETURNING interaction_id',
  [...args,token])
 if(result.rowCount!==1)throw FAIL(403,'Notificaciones no autorizadas para esta solicitud')
 return {registered:true}
}
export async function beginCheckoutPayment(pool,params) {
 const args=keys(params)
 const policy=await checkoutPolicy(pool,params.tenantId)
 const row=await pool.query(
  'INSERT INTO mobile_checkout_followups(interaction_id,tenant_id,app_id,store_id,access_hash,state,checkout_started_at,checkout_expires_at) VALUES($1,$2,$3,$4,$5,\'PAYMENT_PENDING\',now(),now()+($6*interval \'1 minute\')) ON CONFLICT(interaction_id) DO UPDATE SET state=\'PAYMENT_PENDING\',checkout_started_at=COALESCE(mobile_checkout_followups.checkout_started_at,now()),checkout_expires_at=COALESCE(mobile_checkout_followups.checkout_expires_at,now()+($6*interval \'1 minute\')),updated_at=now() WHERE mobile_checkout_followups.tenant_id=excluded.tenant_id AND mobile_checkout_followups.app_id=excluded.app_id AND mobile_checkout_followups.store_id=excluded.store_id AND mobile_checkout_followups.access_hash=excluded.access_hash AND mobile_checkout_followups.state IN (\'WAITING\',\'PAYMENT_PENDING\') RETURNING state,checkout_expires_at',
  [...args,policy.paymentWaitMinutes])
 if(row.rowCount!==1)throw FAIL(409,'La solicitud ya no admite continuar con el pago')
 return {status:row.rows[0].state,expiresAt:row.rows[0].checkout_expires_at,reminderCount:policy.reminderCount}
}
export async function readCheckoutPayment(pool,params) {
 const r=await pool.query('SELECT state,checkout_expires_at FROM mobile_checkout_followups WHERE '+ownership(),keys(params))
 if(r.rowCount!==1)throw FAIL(404,'Seguimiento de compra no encontrado')
 const row=r.rows[0],expired=row.state==='PAYMENT_PENDING'&&row.checkout_expires_at&&new Date(row.checkout_expires_at)<=new Date()
 return {status:expired?'EXPIRED':row.state,expiresAt:row.checkout_expires_at}
}
// A canceled order remains a durable authorization-scoped tombstone even when
// the customer never granted notification permission / never registered FCM.
export async function checkoutSessionState(pool,params) {
 const result=await pool.query('SELECT state FROM mobile_checkout_followups WHERE '+ownership(),keys(params))
 return result.rowCount===1?result.rows[0].state:null
}
export async function closeCheckoutPayment(pool,params) {
 const result=await pool.query(
  "INSERT INTO mobile_checkout_followups(interaction_id,tenant_id,app_id,store_id,access_hash,state,agent_notice_sent,expiry_notice_sent) "+
  "VALUES($1,$2,$3,$4,$5,'CANCELLED',true,true) "+
  "ON CONFLICT(interaction_id) DO UPDATE SET state='CANCELLED',fcm_token=NULL,agent_notice_sent=true,expiry_notice_sent=true,updated_at=now() "+
  "WHERE mobile_checkout_followups.tenant_id=excluded.tenant_id "+
  "AND mobile_checkout_followups.app_id=excluded.app_id "+
  "AND mobile_checkout_followups.store_id=excluded.store_id "+
  "AND mobile_checkout_followups.access_hash=excluded.access_hash "+
  "AND mobile_checkout_followups.state IN ('WAITING','PAYMENT_PENDING','CANCELLED') RETURNING state",
  keys(params))
 if(result.rowCount!==1)throw FAIL(409,'La compra ya terminó o esta solicitud no pertenece al cliente')
 return {status:'CANCELLED'}
}
const uuidFrom=(value)=>{
 const bytes=Buffer.from(hash(value).slice(0,32),'hex')
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
 const hex=bytes.toString('hex')
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')
}
async function oauthToken() {
 if(oauth&&oauth.until>Date.now()+120000)return oauth.value
 const raw=process.env.B3_FCM_SERVICE_ACCOUNT_JSON
 if(!raw)return null
 const account=JSON.parse(raw)
 if(typeof account.project_id!=='string'||typeof account.client_email!=='string'||typeof account.private_key!=='string')throw Error('FCM service account incompleta')
 const encoded=x=>Buffer.from(JSON.stringify(x)).toString('base64url')
 const now=Math.floor(Date.now()/1000)
 const unsigned=encoded({alg:'RS256',typ:'JWT'})+'.'+encoded({iss:account.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600})
 const signer=createSign('RSA-SHA256');signer.update(unsigned);signer.end()
 const assertion=unsigned+'.'+signer.sign(account.private_key).toString('base64url')
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
 try{
  const result=await fetch('https://oauth2.googleapis.com/token',{method:'POST',signal:controller.signal,
   headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion})})
  if(!result.ok)throw Error('FCM OAuth '+result.status)
  const json=await result.json()
  if(typeof json.access_token!=='string')throw Error('FCM OAuth token ausente')
  oauth={value:json.access_token,until:Date.now()+Math.min(3500,Number(json.expires_in)||3500)*1000,projectId:account.project_id}
  return oauth.value
 }finally{clearTimeout(timer)}
}
async function sendPersonalPush(token,type,interactionId,title,message,statusHint='') {
 const auth=await oauthToken()
 if(!auth||!token)return false
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),8000)
 try{
  const response=await fetch('https://fcm.googleapis.com/v1/projects/'+encodeURIComponent(oauth.projectId)+'/messages:send',{
   method:'POST',signal:controller.signal,headers:{Authorization:'Bearer '+auth,'Content-Type':'application/json'},
   body:JSON.stringify({message:{token,android:{priority:'high'},data:{type,interactionId,title,body:message,statusHint}}})
  })
  if(!response.ok)throw new Error('FCM send HTTP '+response.status)
  return true
 }finally{clearTimeout(timer)}
}
async function tokenFor(pool,row) {
 const r=await pool.query(
  'SELECT i.id,i.encrypted_credential FROM integration_bindings b JOIN tenant_integrations i ON i.id=b.integration_id AND i.tenant_id=b.tenant_id WHERE b.tenant_id=$1 AND b.app_id=$2 AND b.store_id=$3 AND b.purpose=\'ORDER_REQUEST\' AND i.suspended=false AND i.encrypted_credential IS NOT NULL',
  [row.tenant_id,row.app_id,row.store_id])
 if(r.rowCount!==1)return null
 return decryptCredential(r.rows[0].encrypted_credential,row.tenant_id,r.rows[0].id)
}
export async function runCheckoutNotifications(pool,{sendPush=sendPersonalPush,readMessages=readMobileInteractionMessages,readInteraction=readMobileInteraction,sendMessage=sendMobileInteractionMessage,resolveRemoteToken=tokenFor}={}) {
 // Claim each step only after successful delivery, and never send to a topic.
 const due=await pool.query('SELECT f.*,COALESCE(p.reminder_count,2) AS reminder_count FROM mobile_checkout_followups f LEFT JOIN mobile_checkout_policies p ON p.tenant_id=f.tenant_id WHERE f.state=\'PAYMENT_PENDING\' AND f.checkout_expires_at IS NOT NULL AND (f.checkout_expires_at<=now() OR (f.fcm_token IS NOT NULL AND f.reminder_sent_count<COALESCE(p.reminder_count,2) AND now()>=f.checkout_started_at+(f.checkout_expires_at-f.checkout_started_at)*((f.reminder_sent_count+1.0)/(COALESCE(p.reminder_count,2)+1)))) ORDER BY f.checkout_expires_at LIMIT '+MAX_BATCH)
 for(const row of due.rows){
  try{
   const expired=new Date(row.checkout_expires_at)<=new Date()
   if(expired){
    const x=await pool.query('UPDATE mobile_checkout_followups SET state=\'EXPIRED\',updated_at=now() WHERE interaction_id=$1 AND state=\'PAYMENT_PENDING\' RETURNING interaction_id',[row.interaction_id])
    if(x.rowCount&&row.fcm_token)await sendPush(row.fcm_token,'order_expired',row.interaction_id,'Tiempo de pago terminado','Tu solicitud venció. Puedes iniciar una nueva compra.')
    continue
   }
   const count=Number(row.reminder_count),sent=row.reminder_sent_count
   if(sent>=count||!row.fcm_token)continue
   const start=new Date(row.checkout_started_at).getTime(),end=new Date(row.checkout_expires_at).getTime()
   const threshold=start+(end-start)*(sent+1)/(count+1)
   if(Date.now()<threshold)continue
   const success=await sendPush(row.fcm_token,'order_reminder',row.interaction_id,'Tu compra está pendiente','Continúa con el pago o cancela tu solicitud de Pollos B3.')
   if(success)await pool.query('UPDATE mobile_checkout_followups SET reminder_sent_count=reminder_sent_count+1,updated_at=now() WHERE interaction_id=$1 AND state=\'PAYMENT_PENDING\' AND reminder_sent_count=$2',[row.interaction_id,sent])
  }catch(error){console.error('Pollos B3 checkout reminder:',error.message)}
 }
 // Generic notification only: Android interprets agent text; the admin never decides.
 const waiting=await pool.query('SELECT * FROM mobile_checkout_followups WHERE state=\'WAITING\' AND fcm_token IS NOT NULL AND agent_notice_sent=false AND (agent_checked_at IS NULL OR agent_checked_at<now()-interval \'60 seconds\') ORDER BY created_at LIMIT '+MAX_BATCH)
 for(const row of waiting.rows){
  try{
   await pool.query('UPDATE mobile_checkout_followups SET agent_checked_at=now() WHERE interaction_id=$1 AND state=\'WAITING\'',[row.interaction_id])
   const token=await resolveRemoteToken(pool,row);if(!token)continue
   const history=await readMessages(token,row.interaction_id)
   if(!history.ok)continue
   // Exact text is used only to label a personal notification, NEVER to approve
   // an order, calculate a price, change the backend order state or take payment.
   // Android remains the sole consumer of the decision after re-reading the chat.
   const response=(history.data?.messages||[]).filter(m=>m.direction==='OUTBOUND')
    .map(m=>String(m.text||'').trim().toLocaleLowerCase('es-PE').replace(/[.!]+$/,'').trim())
    .find(t=>['acepto','aceptado','aceptada','rechazado','rechazada'].includes(t))
   if(!response)continue
   const accepted=['acepto','aceptado','aceptada'].includes(response)
   if(await sendPush(row.fcm_token,'order_status',row.interaction_id,
     accepted?'¡Tu pedido fue aceptado!':'La sede no pudo atender tu pedido',
     accepted?'Abre Pollos B3 para revisar el total y continuar con el pago.':'Revisa las alternativas en la aplicación.',
     accepted?'ACCEPTED':'REJECTED'))
    await pool.query('UPDATE mobile_checkout_followups SET agent_notice_sent=true WHERE interaction_id=$1 AND state=\'WAITING\'',[row.interaction_id])
  }catch(error){console.error('Pollos B3 agent follow-up:',error.message)}
 }
 const expired=await pool.query('SELECT * FROM mobile_checkout_followups WHERE state=\'EXPIRED\' AND expiry_notice_sent=false ORDER BY checkout_expires_at LIMIT '+MAX_BATCH)
 for(const row of expired.rows){
  try{
   const token=await tokenFor(pool,row);if(!token)continue
   const remote=await readInteraction(token,row.interaction_id)
   if(!remote.ok)continue
   if(remote.data?.status!=='EXPIRED'&&remote.data?.status!=='CANCELLED'){
    const sent=await sendMessage(token,row.interaction_id,{idempotencyKey:uuidFrom('b3-expire:'+row.interaction_id),text:CANCEL_ON_TIMEOUT})
    if(!sent.ok)continue
   }
   await pool.query('UPDATE mobile_checkout_followups SET expiry_notice_sent=true WHERE interaction_id=$1',[row.interaction_id])
  }catch(error){console.error('Pollos B3 timeout notice:',error.message)}
 }
}
