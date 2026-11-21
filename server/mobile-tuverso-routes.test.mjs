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
  decisionMessage='',decisionMessages=null,cancelled=false,messageFailure=false}={}){
 const queries=[],remote=[]
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
  throw Error('Unexpected SQL: '+sql)
 }}
 const route=createMobileTuVersoRoutes({pool,body:async req=>req.body,
  json:(res,code,payload)=>{res.reply={code,payload}},
  storeOpen:()=>open,checkMode:()=>enabled?'LIVE':'DISABLED',
  interactionMode:()=>requests?'LIVE':'DISABLED',rateLimit:()=>{},
  decrypt:()=> 'private-credential',
  availability:async(token,binding)=>{remote.push({operation:'capacity',token,binding});return {result:capacity,providerCheckedAt:'2026-11-20T16:00:00Z'}},
  createInteraction:async(token,binding,input)=>{remote.push({operation:'interaction',token,binding,input});return {ok:true,httpStatus:201,data:{interactionId:randomUUID(),status:'PENDING',externalReference:input.externalReference,externalLocationId:binding.external_location_id,purpose:'ORDER_REQUEST'}}},
  readInteraction:async(token,id)=>{remote.push({operation:'read',token,id});return {ok:true,data:{interactionId:id,status:'PENDING',externalReference:referenceForTest,externalLocationId:'location-a',purpose:'ORDER_REQUEST'}}},
  readMessages:async(token,id)=>{remote.push({operation:'messages',token,id});return {ok:true,data:{interactionId:id,messages:[
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
 assert.equal(h.remote.length,4)
 assert.equal(h.remote[1].operation,'interaction')
 assert.equal(h.remote[1].input.summary.includes('2 x Pollo A'),true)
 assert.equal(h.remote[1].input.idempotencyKey,id)
 assert.equal(h.remote[1].input.externalReference,h.remote[3].input.externalReference)
 assert.equal(h.remote[1].binding.external_location_id,'location-a')
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
test('capacity lost between read and creation refuses interaction',async()=>{
 const h=harness({capacity:'UNAVAILABLE'})
 const r=await h.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody()})
 assert.equal(r.code,409);assert.deepEqual(h.remote.map(x=>x.operation),['capacity'])
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
test('text-only request uses verified catalog/store and customer-entered delivery contact',async()=>{
 const h=harness()
 const response=await h.call('POST','/api/v1/mobile/interactions',{
  headers:headers(),payload:createBody({customer})})
 assert.equal(response.code,201)
 const sent=h.remote.find(x=>x.operation==='interaction')
 assert.ok(sent)
 const delivered=h.remote.find(x=>x.operation==='orderText')
 assert.ok(delivered,'The chat receives an actual INBOUND order text')
 assert.equal(sent.input.summary.includes('2 x Pollo A'),true)
 assert.equal(sent.input.summary.includes('+51'),false)
 assert.match(delivered.value.idempotencyKey,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
 const message=delivered.value.text
 for(const piece of ['POLLOS B3','Sede consultada:','Ana Quispe','+51 912345678',
  'Av. Ejemplo 123','Santa Anita','Porton lateral','2 x Pollo A',
  'Subtotal productos: S/ 40.00','pendiente tras aceptacion','aceptado o rechazado']){
  assert.ok(message.includes(piece),piece)
 }
 assert.ok(message.includes('\n'),'Summary has line breaks for the agent')
 assert.ok(message.length<=8000)
 assert.ok(!message.includes('deliveryFeePen'))
 assert.ok(!('customer' in response.payload))
 assert.ok(!('phone' in response.payload))
})
test('repeating a full text-only request uses a distinct but stable idempotency key',async()=>{
 const h=harness(),key=randomUUID()
 for(let i=0;i<2;i++){
  const result=await h.call('POST','/api/v1/mobile/interactions',{
   headers:{'idempotency-key':key},payload:createBody({customer})})
  assert.equal(result.code,201)
 }
 const outbound=h.remote.filter(x=>x.operation==='orderText')
 assert.equal(outbound.length,2)
 // Synthetic create mock produces distinct interactions each time. Each still gets a UUID
 // bound deterministically to its own interaction; real TU VERSO replay returns the same ID.
 assert.notEqual(outbound[0].value.idempotencyKey,key)
 assert.equal(outbound[0].value.text,outbound[1].value.text)
})
test('missing message scope and unsuccessful text delivery never report success',async()=>{
 const denied=harness({scopes:['queue.availability.read','interactions.create']})
 const r=await denied.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody({customer})})
 assert.equal(r.code,409);assert.equal(denied.remote.length,0)
 const failed=harness({messageFailure:true})
 const result=await failed.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody({customer})})
 assert.equal(result.code,503)
 assert.deepEqual(failed.remote.map(x=>x.operation),['capacity','interaction','orderText'])
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
test('agent decision comes from exact outbound text; unknown remains pending',async()=>{
 const interactionId=randomUUID(),key=randomUUID()
 const ref='mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48)
 for(const [message,expected] of [['  ACEPTADO.  ','ACCEPTED'],['rechazada','REJECTED'],
  ['rechazado','REJECTED'],['Hola, ¿cómo estás?',null]]){
  const h=harness({decisionMessage:message});h.setReference(ref)
  const r=await h.call('GET','/api/v1/mobile/interactions/'+interactionId+'/status?appId='+appA+'&storeId='+storeA,{
   headers:{'x-order-access-key':key}})
  assert.equal(r.code,200);assert.equal(r.payload.decision,expected)
  assert.equal(JSON.stringify(r.payload).includes('private-credential'),false)
 }
})
test('the first valid agent response is final even if a later text contradicts it',async()=>{
 const interactionId=randomUUID(),key=randomUUID()
 const h=harness({decisionMessages:[' Hola ','aceptado','rechazado']})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const r=await h.call('GET','/api/v1/mobile/interactions/'+interactionId+'/status?appId='+appA+'&storeId='+storeA,{
  headers:{'x-order-access-key':key}})
 assert.equal(r.code,200);assert.equal(r.payload.decision,'ACCEPTED')
})
test('client cannot read decision with wrong key or other tenant',async()=>{
 const id=randomUUID(),key=randomUUID()
 const h=harness({decisionMessage:'aceptado'});h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const wrong=await h.call('GET','/api/v1/mobile/interactions/'+id+'/status?appId='+appA+'&storeId='+storeA,{headers:{'x-order-access-key':randomUUID()}})
 assert.equal(wrong.code,403)
 const other=await h.call('GET','/api/v1/mobile/interactions/'+id+'/status?appId='+appB+'&storeId='+storeB,{headers:{'x-order-access-key':key}})
 assert.equal(other.code,403)
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
