import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {generateKeyPairSync} from 'node:crypto'
import pg from 'pg'
import {createFcmSender,dispatchDue,pushConfig} from './fcm-push.mjs'

const d=new URL(process.env.DATABASE_URL)
assert.equal(d.hostname,'127.0.0.1','Solo PostgreSQL CI')
assert.equal(d.pathname,'/admin_api_keys_test','Solo base de CI')
const pool=new pg.Pool({connectionString:d.href})
const env={
 FCM_ENABLED:'true',FCM_PROJECT_ID:'pollosb3-84297',
 FCM_TARGET_APP_ID:'com.integrab2g.pollosb3',
 FCM_TOPIC:'pollosb3_promotions',
 FCM_PUBLIC_BASE_URL:'https://example.invalid'
}
const config=pushConfig(env)
const nonce=Math.random().toString(36).slice(2)
const image=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64')
try{
 await pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'))
 const tenant=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['FCM CI '+nonce])).rows[0].id
 const other=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['FCM OTHER '+nonce])).rows[0].id
 const user=(await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,'unused','TENANT_ADMIN',$2) RETURNING id",['fcm-'+nonce+'@example.invalid',tenant])).rows[0].id
 const otherUser=(await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,'unused','TENANT_ADMIN',$2) RETURNING id",['fcm-other-'+nonce+'@example.invalid',other])).rows[0].id
 await pool.query('INSERT INTO mobile_apps(tenant_id,app_id,enabled) VALUES($1,$2,true)',[tenant,config.appId])
 const otherApp='com.ci.other.'+nonce
 await pool.query('INSERT INTO mobile_apps(tenant_id,app_id,enabled) VALUES($1,$2,true)',[other,otherApp])
 const pic=(await pool.query("INSERT INTO product_images(tenant_id,mime,content) VALUES($1,'image/png',$2) RETURNING id",[tenant,image])).rows[0].id
 const otherPic=(await pool.query("INSERT INTO product_images(tenant_id,mime,content) VALUES($1,'image/png',$2) RETURNING id",[other,image])).rows[0].id
 const insert=async(t,a,u,p,secondsAgo=60,expires=null)=>{
  const r=await pool.query(
   "INSERT INTO scheduled_notifications(tenant_id,app_id,title,message,image_id,send_at,expires_at,created_by) VALUES($1,$2,'Promo CI','Contenido exclusivo',$3,now()-make_interval(secs=>$4),$5,$6) RETURNING id",
   [t,a,p,secondsAgo,expires,u])
  return r.rows[0].id
 }
 const id=await insert(tenant,config.appId,user,pic)
 const ignore=await insert(other,otherApp,otherUser,otherPic)
 const never=await insert(tenant,config.appId,user,pic,-3600)
 const expired=await insert(tenant,config.appId,user,pic,3600,new Date(Date.now()-1000))
 const count={value:0}
 const send=async n=>{count.value++;assert.equal(n.appId,config.appId);assert.equal(n.id,id);return 'projects/pollosb3-84297/messages/CI123'}
 let result=await dispatchDue({pool,send,config})
 assert.equal(result.processed,1)
 assert.equal(count.value,1)
 result=await dispatchDue({pool,send,config})
 assert.equal(result.processed,0)
 assert.equal((await pool.query('SELECT push_status,fcm_message_id,push_attempts FROM scheduled_notifications WHERE id=$1',[id])).rows[0].push_status,'SENT')
 assert.equal((await pool.query('SELECT fcm_message_id FROM scheduled_notifications WHERE id=$1',[id])).rows[0].fcm_message_id,'projects/pollosb3-84297/messages/CI123')
 for(const x of [ignore,never,expired])assert.equal((await pool.query('SELECT push_status FROM scheduled_notifications WHERE id=$1',[x])).rows[0].push_status,'PENDING')
 console.log('PASS único envío por fecha, sin duplicar, sin cruzar tenants y sin vencidos')

 const later=await insert(tenant,config.appId,user,pic)
 let failures=0
 result=await dispatchDue({pool,config,send:async()=>{failures++;throw Object.assign(Error('Temporal'),{status:503})},logger:{warn(){}}})
 assert.equal(result.processed,1)
 assert.equal((await pool.query('SELECT push_status FROM scheduled_notifications WHERE id=$1',[later])).rows[0].push_status,'RETRY')
 await pool.query("UPDATE scheduled_notifications SET push_next_attempt_at=now()-interval '1 second' WHERE id=$1",[later])
 await dispatchDue({pool,config,send:async()=>{failures++;return 'projects/pollosb3-84297/messages/CI456'}})
 assert.equal(failures,2)
 assert.equal((await pool.query('SELECT push_status FROM scheduled_notifications WHERE id=$1',[later])).rows[0].push_status,'SENT')
 const uncertain=await insert(tenant,config.appId,user,pic)
 await dispatchDue({pool,config,send:async()=>{throw Object.assign(Error('Sin confirmación'),{status:520})},logger:{warn(){}}})
 assert.equal((await pool.query('SELECT push_status FROM scheduled_notifications WHERE id=$1',[uncertain])).rows[0].push_status,'UNKNOWN')
 assert.equal((await dispatchDue({pool,config,send:async()=>{throw Error('No debe reintentar')}})).processed,0)
 const skipped=await insert(tenant,config.appId,user,pic)
 await pool.query("UPDATE scheduled_notifications SET push_status='SKIPPED' WHERE id=$1",[skipped])
 assert.equal((await dispatchDue({pool,config,send:async()=>{throw Error('Se envió registro anterior')}})).processed,0)
 console.log('PASS reintento 503, estado incierto sin reenvío, legado omitido')

 const keys=generateKeyPairSync('rsa',{modulusLength:2048,publicKeyEncoding:{type:'spki',format:'pem'},privateKeyEncoding:{type:'pkcs8',format:'pem'}})
 let oauth=0,called=0
 const creds={type:'service_account',project_id:config.projectId,
  client_email:'ci@'+config.projectId+'.iam.gserviceaccount.com',private_key:keys.privateKey}
 const fetchMock=async (url,options)=>{
  if(url==='https://oauth2.googleapis.com/token'){
   oauth++
   assert.ok(options.body.get('assertion').split('.').length===3)
   return {ok:true,json:async()=>({access_token:'TEST_ONLY',expires_in:3600})}
  }
  assert.equal(url,'https://fcm.googleapis.com/v1/projects/pollosb3-84297/messages:send')
  assert.equal(options.headers.Authorization,'Bearer TEST_ONLY')
  const m=JSON.parse(options.body).message
  assert.equal(m.topic,config.topic)
  assert.equal(m.notification.title,'Promo CI')
  assert.equal(m.notification.body,'Oferta')
  assert.ok(m.notification.image.startsWith('https://example.invalid/api/v1/mobile/notification-images/'))
  assert.equal(m.data.notificationId,id)
  called++
  return {ok:true,json:async()=>({name:'projects/pollosb3-84297/messages/'+called})}
 }
 const transport=createFcmSender({env:{...env,FCM_SERVICE_ACCOUNT_JSON:JSON.stringify(creds)},fetchImpl:fetchMock})
 const outgoing={id,appId:config.appId,title:'Promo CI',message:'Oferta',imageId:pic,expiresAt:null}
 assert.ok((await transport(outgoing)).endsWith('/1'))
 assert.ok((await transport(outgoing)).endsWith('/2'))
 assert.equal(oauth,1,'token temporal cacheado en servidor')
 assert.equal(called,2)
 await assert.rejects(()=>createFcmSender({env:{...env,FCM_SERVICE_ACCOUNT_JSON:JSON.stringify({...creds,project_id:'other'})},fetchImpl:fetchMock})(outgoing),/cuenta de servicio/)
 console.log('PASS contrato FCM v1 con OAuth RS256, credenciales privadas y tema correcto')
} finally {
 await pool.end()
}
