import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID,createHash} from 'node:crypto'
import {createMobileTuVersoRoutes} from './mobile-tuverso-routes.mjs'

const tenantA='11111111-1111-4111-8111-111111111111'
const tenantB='22222222-2222-4222-8222-222222222222'
const storeA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const storeB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const product='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const appA='com.example.a',appB='com.example.b'
const integration='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const bindingId='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const catalogs={
 [appA]:{tenant_id:tenantA,revision:4,payload:{stores:[{id:storeA,active:true,consultOrderAvailability:true}],products:[{id:product,name:'Pollo A',pricePen:20,active:true}]}},
 [appB]:{tenant_id:tenantB,revision:9,payload:{stores:[{id:storeB,active:true,consultOrderAvailability:true}],products:[{id:product,name:'Pollo B',pricePen:40,active:true}]}}
}
function harness({capacity='AVAILABLE',scopes=['queue.availability.read','interactions.create','interactions.read','conversations.read','conversations.messages.write'],enabled=true,requests=true,open=true,count=1,
  decisionMessage='',decisionMessages=null,remoteStatus='PENDING',cancelled=false,messageFailure=false,historyFailure=false}={}){
 const queries=[],remote=[]
 const createdIds=new Map()
 const terminalSessions=new Map()
 let referenceForTest=''
 const pool={async query(sql,args){
  queries.push({sql,args})
  if(sql.includes('FROM published_catalogs p')){
   const row=catalogs[args[0]]
   return {rowCount:row?1:0,rows:row?[row]:[]}
  }
  if(sql.includes('FROM stores s JOIN tenants t')){
   const matches=(args[0]===tenantA&&args[1]===storeA)||(args[0]===tenantB&&args[1]===storeB)
   return {rowCount:matches?1:0,rows:matches?[{active:true,delivery_enabled:true,opening_hours:{},time_zone:'America/Lima'}]:[]}
  }
  if(sql.includes('FROM integration_bindings b')){
   return {rowCount:count,rows:count?[{integration_id:integration,encrypted_credential:'ciphertext',expires_at:null,suspended:false,scopes,channel_type:'MOBILE_APP',binding_id:bindingId,external_location_id:args[2]===storeA?'location-a':'location-b',purpose:'ORDER_REQUEST'}]:[]}
  }
  if(sql.startsWith('SELECT state FROM mobile_checkout_followups')){
   const state=terminalSessions.get(args.join('|'))
   return {rowCount:state?1:0,rows:state?[{state}]:[]}
  }
  if(sql.startsWith('SELECT payment_wait_minutes'))return {rowCount:0,rows:[]}
  if(sql.startsWith('INSERT INTO mobile_checkout_followups')){
   if(sql.includes('state,agent_notice_sent,expiry_notice_sent')){
    terminalSessions.set(args.join('|'),'CANCELLED')
    return {rowCount:1,rows:[{state:'CANCELLED'}]}
   }
   if(sql.includes('fcm_token)'))return {rowCount:1,rows:[{interaction_id:args[0]}]}
   return {rowCount:1,rows:[{state:'PAYMENT_PENDING',checkout_expires_at:'2099-01-01T00:00:00Z'}]}
  }
  if(sql.startsWith('SELECT state,checkout_expires_at'))return {rowCount:1,rows:[{state:'PAYMENT_PENDING',checkout_expires_at:'2099-01-01T00:00:00Z'}]}
  if(sql.includes('UPDATE mobile_checkout_followups'))return {rowCount:1,rows:[]}
  throw Error('Unexpected SQL: '+sql)
 }}
 const route=createMobileTuVersoRoutes({pool,body:async req=>req.body,
  json:(res,code,payload)=>{res.reply={code,payload}},
  storeOpen:()=>open,checkMode:()=>enabled?'LIVE':'DISABLED',
  interactionMode:()=>requests?'LIVE':'DISABLED',rateLimit:()=>{},
  decrypt:()=> 'private-credential',
  availability:async(token,binding)=>{remote.push({operation:'capacity',token,binding});return {result:capacity,providerCheckedAt:'2026-11-20T16:00:00Z'}},
  createInteraction:async(token,binding,input)=>{remote.push({operation:'interaction',token,binding,input});
   if(!createdIds.has(input.idempotencyKey))createdIds.set(input.idempotencyKey,randomUUID())
   return {ok:true,httpStatus:201,data:{interactionId:createdIds.get(input.idempotencyKey),status:'PENDING',externalReference:input.externalReference,externalLocationId:binding.external_location_id,purpose:'ORDER_REQUEST'}}
  },
  readInteraction:async(token,id)=>{remote.push({operation:'read',token,id});return {ok:true,data:{interactionId:id,status:remoteStatus,externalReference:referenceForTest,externalLocationId:'location-a',purpose:'ORDER_REQUEST'}}},
  readMessages:async(token,id)=>{remote.push({operation:'messages',token,id});if(historyFailure)return {ok:false,httpStatus:503,errorCode:'CONNECTION_FAILED'};return {ok:true,data:{interactionId:id,messages:[
   ...(Array.isArray(decisionMessages)?decisionMessages:(decisionMessage?[decisionMessage]:[])).map(text=>({id:randomUUID(),direction:'OUTBOUND',text,createdAt:new Date().toISOString()})),
   ...(cancelled?[{id:randomUUID(),direction:'INBOUND',text:'[Pollos B3 · Sistema] El cliente decidió modificar los productos. Esta solicitud de compra queda cancelada; no preparar ni cobrar. El asesor puede cerrar la atención.',createdAt:new Date().toISOString()}]:[])
  ]}}},
  sendMessage:async(token,id,value)=>{
   const operation=value.text.startsWith('POLLOS B3 - SOLICITUD')?'orderText':'cancel'
   remote.push({operation,id,value})
   return messageFailure&&operation==='orderText'?{ok:false,httpStatus:503}:
    {ok:true,data:{messageId:randomUUID(),created:true}}
  }
 })
 const call=async(method,path,{payload,headers}={})=>{
  const req={method,body:payload,headers:headers||{},socket:{remoteAddress:'synthetic'}}
  const res={}
  const handled=await route({req,res,url:new URL('http://local.test'+path)})
  assert.equal(handled,undefined)
  return res.reply
 }
 return {call,queries,remote,setReference:value=>{referenceForTest=value}}
}
const endpoint=(id=storeA,app=appA)=>'/api/v1/mobile/stores/'+id+'/agent-availability?appId='+app
const createBody=(extra={})=>({appId:appA,storeId:storeA,quoteRevision:4,customerExternalId:'anonymous-123',items:[{productId:product,quantity:2}],...extra})
const headers=()=>({'idempotency-key':randomUUID()})

test('available capacity is boolean; no interaction, secret or queue is exposed',async()=>{
 const h=harness(),r=await h.call('GET',endpoint())
 assert.equal(r.code,200)
 assert.deepEqual(r.payload,{storeId:storeA,status:'AVAILABLE',available:true,checkedAt:'2026-11-20T16:00:00Z',reservation:false})
 assert.equal(h.remote.length,1)
 assert.equal(h.remote[0].operation,'capacity')
 assert.equal(JSON.stringify(r.payload).includes('credential'),false)
})
test('UNAVAILABLE answers 200 false without creating a request',async()=>{
 const h=harness({capacity:'UNAVAILABLE'}),r=await h.call('GET',endpoint())
 assert.equal(r.code,200);assert.equal(r.payload.available,false);assert.equal(h.remote.length,1)
})
test('app cannot query the other tenant store, even when the store UUID is known',async()=>{
 const h=harness(),r=await h.call('GET',endpoint(storeB,appA))
 assert.equal(r.code,409);assert.equal(h.remote.length,0)
})
test('closed store and missing binding fail closed',async()=>{
 const a=harness({open:false}),r=await a.call('GET',endpoint())
 assert.equal(r.code,409);assert.equal(a.remote.length,0)
 const b=harness({count:0}),other=await b.call('GET',endpoint())
 assert.equal(other.code,409);assert.equal(b.remote.length,0)
})
test('missing permission and disabled switches never call remote',async()=>{
 const a=harness({scopes:['queue.availability.read']}),r=await a.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody()})
 assert.equal(r.code,409);assert.equal(a.remote.length,0)
 const b=harness({enabled:false}),other=await b.call('GET',endpoint())
 assert.equal(other.code,503);assert.equal(b.remote.length,0)
 const c=harness({requests:false}),third=await c.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody()})
 assert.equal(third.code,503);assert.equal(c.remote.length,0)
})
test('create uses validated published catalog, exact scoped binding, stable upstream idempotency',async()=>{
 const h=harness(),id=randomUUID(),p=createBody()
 const first=await h.call('POST','/api/v1/mobile/interactions',{headers:{'idempotency-key':id},payload:p})
 const second=await h.call('POST','/api/v1/mobile/interactions',{headers:{'idempotency-key':id},payload:p})
 assert.equal(first.code,201);assert.equal(first.payload.status,'PENDING')
 assert.equal(first.payload.storeId,storeA)
 assert.equal(h.remote.length,2)
 assert.equal(h.remote[0].operation,'interaction')
 assert.equal(h.remote[0].input.summary.includes('2 x Pollo A'),true)
 assert.equal(h.remote[0].input.idempotencyKey,id)
 assert.equal(h.remote[0].input.externalReference,h.remote[1].input.externalReference)
 assert.equal(h.remote[0].binding.external_location_id,'location-a')
 assert.equal('token' in first.payload,false)
})
test('invalid store, injected tenant, outdated catalog and missing idempotency fail before remote',async()=>{
 const h=harness()
 const cross=await h.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody({storeId:storeB})})
 assert.equal(cross.code,409)
 const injected=await h.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody({tenantId:tenantA})})
 assert.equal(injected.code,400)
 const old=await h.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody({quoteRevision:3})})
 assert.equal(old.code,409)
 const missing=await h.call('POST','/api/v1/mobile/interactions',{payload:createBody()})
 assert.equal(missing.code,400)
 assert.equal(h.remote.length,0)
})
test('idempotent creation does not recheck capacity after an agent is already assigned',async()=>{
 const h=harness({capacity:'UNAVAILABLE'}),key=randomUUID()
 const request={headers:{'idempotency-key':key},payload:createBody()}
 const first=await h.call('POST','/api/v1/mobile/interactions',request)
 const second=await h.call('POST','/api/v1/mobile/interactions',request)
 assert.equal(first.code,201);assert.equal(second.code,201)
 assert.equal(first.payload.interactionId,second.payload.interactionId)
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction','interaction'])
})

test('new interaction creation accepts catalog revision before pricing',async()=>{
 const h=harness()
 const r=await h.call('POST','/api/v1/mobile/interactions',{
  headers:headers(),payload:{appId:appA,storeId:storeA,catalogRevision:4,
   customerExternalId:'anonymous-123',items:[{productId:product,quantity:2}]}})
 assert.equal(r.code,201)
 assert.equal(r.payload.status,'PENDING')
})
const customer={firstName:'Ana',lastName:'Quispe',phone:'912345678',
 address:'Av. Ejemplo 123',district:'Santa Anita',reference:'Porton lateral',mode:'delivery'}
test('create returns interactionId before chat text, and text delivery runs independently',async()=>{
 const h=harness(),key=randomUUID()
 const response=await h.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 assert.equal(response.code,201)
 assert.equal(response.payload.status,'PENDING')
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction'])
 const id=response.payload.interactionId
 const sent=h.remote.find(x=>x.operation==='interaction')
 assert.ok(sent.input.summary.includes('2 x Pollo A'))
 assert.ok(!sent.input.summary.includes('+51'))
 h.setReference(response.payload.externalReference)
 const delivered=await h.call('POST','/api/v1/mobile/interactions/'+id+'/message',{
  headers:{'x-order-access-key':key},payload:createBody({customer})})
 assert.equal(delivered.code,200)
 assert.equal(delivered.payload.delivered,true)
 assert.equal(delivered.payload.interactionId,id)
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction','read','orderText'])
 const message=h.remote.find(x=>x.operation==='orderText').value.text
 for(const part of ['POLLOS B3','Sede consultada:','Ana Quispe','+51 912345678',
  'Av. Ejemplo 123','Santa Anita','Porton lateral','2 x Pollo A',
  'Subtotal productos: S/ 40.00','pendiente tras aceptacion']){
  assert.ok(message.includes(part),part)
 }
 assert.ok(message.includes('\n'))
 assert.ok(message.length<=8000)
 assert.ok(!message.includes('deliveryFeePen'))
 assert.ok(!('phone' in response.payload))
})
test('replaying both steps uses one conversation ID and one deterministic message key',async()=>{
 const h=harness(),key=randomUUID()
 let id=null,messageKey=null
 for(let i=0;i<2;i++){
  const created=await h.call('POST','/api/v1/mobile/interactions',{
   headers:{'idempotency-key':key},payload:createBody({customer})})
  assert.equal(created.code,201)
  if(i===0)id=created.payload.interactionId
  assert.equal(created.payload.interactionId,id)
  h.setReference(created.payload.externalReference)
  const sent=await h.call('POST','/api/v1/mobile/interactions/'+id+'/message',{
   headers:{'x-order-access-key':key},payload:createBody({customer})})
  assert.equal(sent.code,200)
  const current=h.remote.filter(x=>x.operation==='orderText').at(-1).value.idempotencyKey
  if(i===0)messageKey=current
  assert.equal(current,messageKey)
  assert.notEqual(current,key)
 }
})
test('failed text delivery returns 503 without undoing a created interaction',async()=>{
 const h=harness({messageFailure:true}),key=randomUUID()
 const created=await h.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 assert.equal(created.code,201)
 h.setReference(created.payload.externalReference)
 const result=await h.call('POST','/api/v1/mobile/interactions/'+created.payload.interactionId+'/message',{
  headers:{'x-order-access-key':key},payload:createBody({customer})})
 assert.equal(result.code,503)
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction','read','orderText'])
})
test('message scope and forged order reference cannot access other conversations',async()=>{
 const key=randomUUID()
 const denied=harness({scopes:['queue.availability.read','interactions.create','interactions.read']})
 const opened=await denied.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 assert.equal(opened.code,201)
 denied.setReference(opened.payload.externalReference)
 const reply=await denied.call('POST','/api/v1/mobile/interactions/'+opened.payload.interactionId+'/message',{
  headers:{'x-order-access-key':key},payload:createBody({customer})})
 assert.equal(reply.code,409)
 assert.deepEqual(denied.remote.map(x=>x.operation),['interaction'])
 const forged=harness()
 forged.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const other=await forged.call('POST','/api/v1/mobile/interactions/'+randomUUID()+'/message',{
  headers:{'x-order-access-key':randomUUID()},payload:createBody({customer})})
 assert.equal(other.code,403)
 assert.deepEqual(forged.remote.map(x=>x.operation),['read'])
})
test('contact injection, invalid cellphone and client price fields are rejected before TU VERSO',async()=>{
 const invalid=[
  {...customer,firstName:'Ana'+String.fromCharCode(10)+'aceptado'},
  {...customer,phone:'99999'},
  {...customer,address:''},
  {...customer,mode:'pickup'},
  {...customer,reference:'A'.repeat(181)},
  {...customer,subtotal:0}
 ]
 for(const bad of invalid){
  const h=harness()
  const result=await h.call('POST','/api/v1/mobile/interactions',{headers:headers(),
    payload:createBody({customer:bad})})
  assert.equal(result.code,400);assert.equal(h.remote.length,0)
 }
 const h=harness(),result=await h.call('POST','/api/v1/mobile/interactions',{
  headers:headers(),payload:createBody({customer,deliveryFeePen:0})})
 assert.equal(result.code,400);assert.equal(h.remote.length,0)
})
test('backend relays authenticated agent text without deciding the order',async()=>{
 const id=randomUUID(),key=randomUUID()
 const ref='mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48)
 const h=harness({decisionMessages:['Hola','Acepto','rechazado']});h.setReference(ref)
 const r=await h.call('GET','/api/v1/mobile/interactions/'+id+'/status?appId='+appA+'&storeId='+storeA,{
  headers:{'x-order-access-key':key}})
 assert.equal(r.code,200)
 assert.equal(r.payload.status,'PENDING')
 assert.deepEqual(r.payload.agentMessages.map(m=>m.text),['Hola','Acepto','rechazado'])
 assert.equal(r.payload.agentMessages.every(m=>typeof m.id==='string'&&typeof m.createdAt==='string'),true)
 assert.equal('decision' in r.payload,false)
 assert.equal('agentMessageId' in r.payload,false)
 assert.equal(JSON.stringify(r.payload).includes('private-credential'),false)
})
test('backend relays formal status unchanged and never overrides it from text',async()=>{
 const id=randomUUID(),key=randomUUID()
 const ref='mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48)
 for(const state of ['PENDING','ACCEPTED','REJECTED','EXPIRED']){
  const h=harness({remoteStatus:state,decisionMessage:'Acepto'});h.setReference(ref)
  const r=await h.call('GET','/api/v1/mobile/interactions/'+id+'/status?appId='+appA+'&storeId='+storeA,{
   headers:{'x-order-access-key':key}})
  assert.equal(r.code,200)
  assert.equal(r.payload.status,state)
  assert.deepEqual(r.payload.agentMessages,[])
  assert.equal('decision' in r.payload,false)
 }
})
test('cancellation status remains authoritative; inbound client text is not relayed as agent text',async()=>{
 const id=randomUUID(),key=randomUUID(),h=harness({cancelled:true,decisionMessage:'Acepto'})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const r=await h.call('GET','/api/v1/mobile/interactions/'+id+'/status?appId='+appA+'&storeId='+storeA,{
  headers:{'x-order-access-key':key}})
 assert.equal(r.code,200)
 assert.equal(r.payload.status,'CANCELLED')
 assert.deepEqual(r.payload.agentMessages.map(m=>m.text),['Acepto'])
 assert.equal('decision' in r.payload,false)
})
test('temporary history outage keeps accepted interaction pending for Android without inventing a reply',async()=>{
 const id=randomUUID(),key=randomUUID()
 const h=harness({remoteStatus:'ACCEPTED',historyFailure:true})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const path='/api/v1/mobile/interactions/'+id+'/status?appId='+appA+'&storeId='+storeA
 const r=await h.call('GET',path,{headers:{'x-order-access-key':key}})
 assert.equal(r.code,200)
 assert.equal(r.payload.interactionId,id)
 assert.equal(r.payload.status,'ACCEPTED')
 assert.deepEqual(r.payload.agentMessages,[])
 assert.equal(r.payload.messagesAvailable,false)
 assert.equal(h.remote.filter(x=>x.operation==='interaction').length,0)
})
test('cancellation refuses to proceed when prior conversation cannot be checked',async()=>{
 const id=randomUUID(),key=randomUUID(),h=harness({historyFailure:true})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const r=await h.call('POST','/api/v1/mobile/interactions/'+id+'/cancel',{
  headers:{'x-order-access-key':key},payload:{appId:appA,storeId:storeA}})
 assert.equal(r.code,503)
 assert.equal(h.remote.filter(x=>x.operation==='cancel').length,0)
})
test('personal FCM device is registered only after authorized conversation read, without broadcasting',async()=>{
 const id=randomUUID(),key=randomUUID(),token='f'.repeat(160)
 const h=harness()
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const uri='/api/v1/mobile/interactions/'+id+'/device'
 const r=await h.call('POST',uri,{headers:{'x-order-access-key':key},
  payload:{appId:appA,storeId:storeA,fcmToken:token}})
 assert.equal(r.code,200)
 assert.deepEqual(r.payload,{registered:true})
 assert.deepEqual(h.remote.map(x=>x.operation),['read'])
 const forged=await h.call('POST',uri,{headers:{'x-order-access-key':randomUUID()},
  payload:{appId:appA,storeId:storeA,fcmToken:token}})
 assert.equal(forged.code,403)
})
test('payment deadline belongs to one authorized interaction and does not restart on GET',async()=>{
 const id=randomUUID(),key=randomUUID(),h=harness()
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const uri='/api/v1/mobile/interactions/'+id+'/payment'
 const input={appId:appA,storeId:storeA}
 const opened=await h.call('POST',uri,{headers:{'x-order-access-key':key},payload:input})
 assert.equal(opened.code,200);assert.equal(opened.payload.status,'PAYMENT_PENDING')
 assert.ok(opened.payload.expiresAt)
 const follow=await h.call('GET',uri+'?appId='+appA+'&storeId='+storeA,{headers:{'x-order-access-key':key}})
 assert.equal(follow.code,200);assert.equal(follow.payload.status,'PAYMENT_PENDING')
 assert.equal(follow.payload.expiresAt,opened.payload.expiresAt)
 assert.equal(h.remote.filter(x=>x.operation==='interaction').length,0)
})
test('client cannot read decision with wrong key or other tenant',async()=>{
 const id=randomUUID(),key=randomUUID()
 const h=harness({decisionMessage:'aceptado'});h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const wrong=await h.call('GET','/api/v1/mobile/interactions/'+id+'/status?appId='+appA+'&storeId='+storeA,{headers:{'x-order-access-key':randomUUID()}})
 assert.equal(wrong.code,403)
 const other=await h.call('GET','/api/v1/mobile/interactions/'+id+'/status?appId='+appB+'&storeId='+storeB,{headers:{'x-order-access-key':key}})
 assert.equal(other.code,403)
})
test('customer cancellation sends one notice then permanently blocks mobile messages and late replies',async()=>{
 const id=randomUUID(),key=randomUUID(),h=harness({decisionMessage:'aceptado'})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const path='/api/v1/mobile/interactions/'+id
 const credentials={headers:{'x-order-access-key':key},payload:{appId:appA,storeId:storeA,reason:'CANCEL'}}
 const cancel=await h.call('POST',path+'/cancel',credentials)
 assert.equal(cancel.code,200)
 assert.equal(cancel.payload.status,'CANCELLED')
 assert.equal(h.remote.filter(x=>x.operation==='cancel').length,1)
 assert.match(h.remote.find(x=>x.operation==='cancel').value.text,/El cliente canceló su compra/)
 const callsBefore=h.remote.length
 const replay=await h.call('POST',path+'/cancel',credentials)
 assert.equal(replay.code,200)
 assert.equal(h.remote.length,callsBefore,'a second cancellation must not post another message')
 const status=await h.call('GET',path+'/status?appId='+appA+'&storeId='+storeA,{
  headers:{'x-order-access-key':key}})
 assert.equal(status.code,200)
 assert.equal(status.payload.status,'CANCELLED')
 assert.deepEqual(status.payload.agentMessages,[])
 assert.equal(status.payload.messagesAvailable,false)
 const payment=await h.call('GET',path+'/payment?appId='+appA+'&storeId='+storeA,{
  headers:{'x-order-access-key':key}})
 assert.equal(payment.code,200)
 assert.equal(payment.payload.status,'CANCELLED')
 const originalOrder=createBody({customer:{firstName:'Ana',lastName:'Flores',phone:'999999999',
  mode:'delivery',address:'Av. Los Nogales 123',district:'Santa Anita'}})
 const message=await h.call('POST',path+'/message',{
  headers:{'x-order-access-key':key},payload:originalOrder})
 assert.equal(message.code,409)
 assert.equal(h.remote.length,callsBefore,'closed backend must never read or send to remote')
})
test('cancellation without prior notification registration persists a local closed state',async()=>{
 const id=randomUUID(),key=randomUUID(),h=harness()
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const cancelled=await h.call('POST','/api/v1/mobile/interactions/'+id+'/cancel',{
  headers:{'x-order-access-key':key},payload:{appId:appA,storeId:storeA,reason:'MODIFY'}})
 assert.equal(cancelled.code,200)
 const inserts=h.queries.filter(x=>x.sql.startsWith('INSERT INTO mobile_checkout_followups')&&x.sql.includes('state,agent_notice_sent'))
 assert.equal(inserts.length,1,'cancellation tombstone must be created even without a device token')
})
test('cart modification sends cancellation notice without marking a paid order',async()=>{
 const id=randomUUID(),key=randomUUID(),h=harness({decisionMessage:'aceptado'})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const r=await h.call('POST','/api/v1/mobile/interactions/'+id+'/cancel',{
  headers:{'x-order-access-key':key},payload:{appId:appA,storeId:storeA}})
 assert.equal(r.code,200);assert.equal(r.payload.status,'CANCELLED')
 assert.equal(h.remote.filter(x=>x.operation==='cancel').length,1)
 assert.match(h.remote.find(x=>x.operation==='cancel').value.text,/no preparar ni cobrar/)
})
