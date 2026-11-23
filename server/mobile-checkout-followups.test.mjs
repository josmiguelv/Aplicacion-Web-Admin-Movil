import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
import {checkoutPolicy,updateCheckoutPolicy,bindPersonalDevice,beginCheckoutPayment,readCheckoutPayment,runCheckoutNotifications} from './mobile-checkout-followups.mjs'

const tenantId=randomUUID(),interactionId=randomUUID(),storeId=randomUUID(),accessKey=randomUUID()
const owner={tenantId,interactionId,storeId,appId:'com.integrab2g.pollosb3',accessKey}
const fcmA='f'.repeat(135)
test('tenant payment policy defaults to 10 min / 2 individual reminders and enforces bounds',async()=>{
 let settings=null
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT payment_wait_minutes'))return {rows:settings?[{payment_wait_minutes:settings[0],reminder_count:settings[1]}]:[]}
  if(sql.startsWith('INSERT INTO mobile_checkout_policies')){settings=[args[1],args[2]];return {rowCount:1,rows:[]}}
  throw Error('unexpected policy SQL')
 }}
 assert.deepEqual(await checkoutPolicy(pool,tenantId),{paymentWaitMinutes:10,reminderCount:2})
 await assert.rejects(()=>updateCheckoutPolicy(pool,tenantId,{paymentWaitMinutes:4,reminderCount:2}),/5/)
 await assert.rejects(()=>updateCheckoutPolicy(pool,tenantId,{paymentWaitMinutes:10,reminderCount:3}),/0–2/)
 assert.deepEqual(await updateCheckoutPolicy(pool,tenantId,{paymentWaitMinutes:12,reminderCount:1}),{paymentWaitMinutes:12,reminderCount:1})
})
test('private device token is bound only to authorized interaction and never to a topic',async()=>{
 const seen=[]
 const pool={query:async(sql,args)=>{seen.push({sql,args});return {rowCount:1,rows:[{interaction_id:interactionId}]}}}
 assert.deepEqual(await bindPersonalDevice(pool,owner,fcmA),{registered:true})
 assert.equal(seen[0].args[0],interactionId)
 assert.equal(seen[0].args[1],tenantId)
 assert.equal(seen[0].args[2],owner.appId)
 assert.equal(seen[0].args[5],fcmA)
 assert.ok(!seen[0].sql.includes('topic'))
 const forbidden={query:async()=>({rowCount:0,rows:[]})}
 await assert.rejects(()=>bindPersonalDevice(forbidden,owner,fcmA),err=>err.code===403)
 await assert.rejects(()=>bindPersonalDevice(pool,owner,'short'),err=>err.code===400)
})
test('payment window starts once from server, independent of Android foreground',async()=>{
 const expiry='2026-12-01T15:10:00Z',seen=[]
 const pool={query:async(sql,args)=>{
  seen.push(sql)
  if(sql.startsWith('SELECT payment_wait_minutes'))return {rows:[{payment_wait_minutes:10,reminder_count:2}]}
  if(sql.startsWith('INSERT INTO mobile_checkout_followups'))return {rowCount:1,rows:[{state:'PAYMENT_PENDING',checkout_expires_at:expiry}]}
  if(sql.startsWith('SELECT state,checkout_expires_at'))return {rowCount:1,rows:[{state:'PAYMENT_PENDING',checkout_expires_at:expiry}]}
  throw Error('unknown SQL')
 }}
 const first=await beginCheckoutPayment(pool,owner)
 assert.equal(first.status,'PAYMENT_PENDING')
 assert.equal(first.expiresAt,expiry)
 assert.equal(first.reminderCount,2)
 assert.ok(seen.some(sql=>sql.includes('COALESCE(mobile_checkout_followups.checkout_started_at,now())')))
 assert.equal((await readCheckoutPayment(pool,owner)).status,'PAYMENT_PENDING')
})
test('scheduler sends reminder only to that checkout device; no global broadcast',async()=>{
 const now=Date.now()
 const row={interaction_id:interactionId,fcm_token:fcmA,state:'PAYMENT_PENDING',reminder_count:2,
  reminder_sent_count:0,checkout_started_at:new Date(now-5*60000).toISOString(),
  checkout_expires_at:new Date(now+5*60000).toISOString()}
 const calls=[],updates=[]
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT f.*'))return {rows:[row]}
  if(sql.startsWith('SELECT * FROM mobile_checkout_followups WHERE state=\'WAITING\''))return {rows:[]}
  if(sql.startsWith('SELECT * FROM mobile_checkout_followups WHERE state=\'EXPIRED\''))return {rows:[]}
  if(sql.startsWith('UPDATE mobile_checkout_followups SET reminder_sent_count')){updates.push(args);return {rowCount:1}}
  throw Error('unexpected scheduler SQL '+sql.slice(0,50))
 }}
 await runCheckoutNotifications(pool,{sendPush:async(...args)=>{calls.push(args);return true}})
 assert.equal(calls.length,1)
 assert.equal(calls[0][0],fcmA)
 assert.equal(calls[0][1],'order_reminder')
 assert.equal(calls[0][2],interactionId)
 assert.deepEqual(updates,[[interactionId,0]])
})

test('only exact agent decision triggers private accepted hint; backend never approves an order',async()=>{
 const calls=[],updates=[]
 const row={interaction_id:interactionId,tenant_id:tenantId,app_id:owner.appId,store_id:storeId,
  fcm_token:fcmA,state:'WAITING',agent_notice_sent:false}
 const pool={query:async(sql,args)=>{
  if(sql.startsWith('SELECT f.*'))return {rows:[]}
  if(sql.startsWith('SELECT * FROM mobile_checkout_followups WHERE state=\'WAITING\''))return {rows:[row]}
  if(sql.startsWith('SELECT * FROM mobile_checkout_followups WHERE state=\'EXPIRED\''))return {rows:[]}
  if(sql.startsWith('UPDATE mobile_checkout_followups')){updates.push(sql);return {rowCount:1}}
  throw Error('unhandled SQL')
 }}
 await runCheckoutNotifications(pool,{
  resolveRemoteToken:async()=> 'synthetic-remote-bearer',
  readMessages:async()=>({ok:true,data:{messages:[
   {direction:'OUTBOUND',text:'Hola, reviso tu pedido'},
   {direction:'OUTBOUND',text:' ACEPTADO. '}
  ]}}),
  sendPush:async(...args)=>{calls.push(args);return true}
 })
 assert.equal(calls.length,1)
 assert.equal(calls[0][0],fcmA)
 assert.equal(calls[0][1],'order_status')
 assert.equal(calls[0][2],interactionId)
 assert.equal(calls[0][5],'ACCEPTED')
 assert.ok(updates.every(q=>!q.includes('state=\'PAYMENT_PENDING\'')))
});
test('a generic message from the agent is not misrepresented as an order decision',async()=>{
 const calls=[]
 const row={interaction_id:interactionId,tenant_id:tenantId,app_id:owner.appId,store_id:storeId,
  fcm_token:fcmA,state:'WAITING',agent_notice_sent:false}
 const pool={query:async(sql)=>{
  if(sql.startsWith('SELECT f.*'))return {rows:[]}
  if(sql.startsWith('SELECT * FROM mobile_checkout_followups WHERE state=\'WAITING\''))return {rows:[row]}
  if(sql.startsWith('SELECT * FROM mobile_checkout_followups WHERE state=\'EXPIRED\''))return {rows:[]}
  if(sql.startsWith('UPDATE mobile_checkout_followups'))return {rowCount:1}
  throw Error('unhandled SQL')
 }}
 await runCheckoutNotifications(pool,{
  resolveRemoteToken:async()=> 'synthetic-remote-bearer',
  readMessages:async()=>({ok:true,data:{messages:[{direction:'OUTBOUND',text:'Tu pedido está en revisión'}]}}),
  sendPush:async(...args)=>{calls.push(args);return true}
 })
 assert.equal(calls.length,0)
});
