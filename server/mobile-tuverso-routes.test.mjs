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
  decisionMessage='',decisionMessages=null,remoteStatus='PENDING',operationalConversationStatus=null,cancelled=false,messageFailure=false,historyFailure=false,legacyText=null,upstream={}}={}){
 const queries=[],remote=[]
 const createdIds=new Map()
 const terminalSessions=new Map()
 let referenceForTest=''
 const pool={async connect(){return {
  async query(sql,args){
   queries.push({sql,args})
   if(sql==='BEGIN'||sql==='COMMIT'||sql==='ROLLBACK')return {rowCount:0,rows:[]}
   if(sql.startsWith('INSERT INTO product_images'))return {rowCount:1,rows:[{id:'99999999-9999-4999-8999-999999999999'}]}
   if(sql.startsWith('INSERT INTO mobile_payment_receipt_images'))return {rowCount:1,rows:[]}
   throw Error('Unexpected receipt SQL: '+sql)
  },release(){}
 }},async query(sql,args){
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
  imageBody:async req=>req.rawImage||Buffer.from('ffd8ffe0','hex'),imageMime:()=> 'image/jpeg',
  receiptBaseUrl:()=> 'https://admin.example.com',
  storeOpen:()=>open,checkMode:()=>enabled?'LIVE':'DISABLED',
  interactionMode:()=>requests?'LIVE':'DISABLED',rateLimit:()=>{},
  decrypt:()=> 'private-credential',
  availability:async(token,binding)=>{remote.push({operation:'capacity',token,binding});return upstream.availability?{result:null,httpStatus:upstream.availability,errorCode:'UPSTREAM_'+upstream.availability}:{result:capacity,providerCheckedAt:'2026-11-20T16:00:00Z'}},
  createInteraction:async(token,binding,input)=>{remote.push({operation:'interaction',token,binding,input});
   if(upstream.create)return {ok:false,httpStatus:upstream.create,errorCode:'UPSTREAM_'+upstream.create}
   if(!createdIds.has(input.idempotencyKey))createdIds.set(input.idempotencyKey,randomUUID())
   return {ok:true,httpStatus:201,data:{interactionId:createdIds.get(input.idempotencyKey),status:'PENDING',externalReference:input.externalReference,externalLocationId:binding.external_location_id,purpose:'ORDER_REQUEST'}}
  },
  readInteraction:async(token,id)=>{remote.push({operation:'read',token,id});if(upstream.read)return {ok:false,httpStatus:upstream.read};return {ok:true,data:{interactionId:id,status:remoteStatus,externalReference:referenceForTest,externalLocationId:'location-a',purpose:'ORDER_REQUEST',...(operationalConversationStatus?{operationalConversationStatus}:{})}}},
  readMessages:async(token,id)=>{remote.push({operation:'messages',token,id});if(historyFailure)return {ok:false,httpStatus:503,errorCode:'CONNECTION_FAILED'};return {ok:true,data:{interactionId:id,messages:[
   ...(Array.isArray(decisionMessages)?decisionMessages:(decisionMessage?[decisionMessage]:[])).map(text=>({id:randomUUID(),direction:'OUTBOUND',text,createdAt:new Date().toISOString()})),
   ...(cancelled?[{id:randomUUID(),direction:'INBOUND',text:'[Pollos B3 · Sistema] El cliente decidió modificar los productos. Esta solicitud de compra queda cancelada; no preparar ni cobrar. El asesor puede cerrar la atención.',createdAt:new Date().toISOString()}]:[]),
   ...(legacyText?[{id:randomUUID(),direction:'INBOUND',text:legacyText,createdAt:new Date().toISOString()}]:[])
  ]}}},
  sendMessage:async(token,id,value)=>{
   const operation=value.type==='FORM'?'orderForm':value.type==='TEXT'&&value.text?.startsWith('POLLOS B3 - SOLICITUD')?'orderText':value.type==='TEXT'?'plainText':'cancel'
   remote.push({operation,id,value})
   return upstream.message?{ok:false,httpStatus:upstream.message}:messageFailure&&operation==='orderForm'?{ok:false,httpStatus:503}:
    {ok:true,data:{messageId:randomUUID(),created:true}}
  }
 })
 const call=async(method,path,{payload,headers}={})=>{
  const req={method,body:payload,rawImage:Buffer.from('ffd8ffe0','hex'),headers:headers||{},socket:{remoteAddress:'synthetic'}}
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
test('historical local scopes do not deny requests; disabled runtime switches still fail closed',async()=>{
 const a=harness({scopes:['queue.availability.read']}),r=await a.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody()})
 assert.equal(r.code,201);assert.deepEqual(a.remote.map(x=>x.operation),['interaction'])
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
 assert.equal(h.remote[0].input.summary,'Pedido nuevo !! Aplicación móvil')
 assert.equal(h.remote[0].input.idempotencyKey,id)
 assert.equal(h.remote[0].input.externalReference,h.remote[1].input.externalReference)
 assert.equal(h.remote[0].binding.external_location_id,'location-a')
 assert.equal('token' in first.payload,false)
})
test('opening message is always identical across different products, customers and stores',async()=>{
 const cases=[
  {body:createBody(),expected:storeA},
  {body:createBody({items:[{productId:product,quantity:1}],customer:{
   firstName:'Persona',lastName:'Prueba',phone:'987654321',
   address:'Av. Ejemplo 123',district:'Santa Anita',mode:'delivery'}}),expected:storeA},
  {body:{appId:appB,storeId:storeB,quoteRevision:9,customerExternalId:'other-123',
   items:[{productId:product,quantity:2}]},expected:storeB}
 ]
 for(const {body,expected} of cases){
  const h=harness(),r=await h.call('POST','/api/v1/mobile/interactions',{
   headers:headers(),payload:body})
  assert.equal(r.code,201)
  assert.equal(r.payload.storeId,expected)
  assert.deepEqual(h.remote.map(x=>x.operation),['interaction'])
  assert.equal(h.remote[0].input.summary,'Pedido nuevo !! Aplicación móvil')
  assert.equal('text' in h.remote[0].input,false)
 }
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
test('create returns interactionId before FORM, and FORM delivery runs independently',async()=>{
 const h=harness(),key=randomUUID()
 const response=await h.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 assert.equal(response.code,201)
 assert.equal(response.payload.status,'PENDING')
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction'])
 const id=response.payload.interactionId
 const sent=h.remote.find(x=>x.operation==='interaction')
 assert.equal(sent.input.summary,'Pedido nuevo !! Aplicación móvil')
 assert.ok(!sent.input.summary.includes('+51'))
 assert.deepEqual(sent.input.customer,{firstName:'Ana',lastName:'Quispe',
  phone:'+51912345678',phoneVerified:false,emailVerified:false})
 h.setReference(response.payload.externalReference)
 const delivered=await h.call('POST','/api/v1/mobile/interactions/'+id+'/message',{
  headers:{'x-order-access-key':key},payload:{...createBody({customer}),type:'FORM'}})
 assert.equal(delivered.code,200)
 assert.equal(delivered.payload.delivered,true)
 assert.equal(delivered.payload.interactionId,id)
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction','read','orderForm'])
 const sentForm=h.remote.find(x=>x.operation==='orderForm').value
 assert.equal(sentForm.type,'FORM')
 assert.equal('text' in sentForm,false)
 assert.equal(sentForm.form.title,'POLLOS B3 - SOLICITUD DE VALIDACION')
 assert.equal(sentForm.form.fields.length,4)
 const field=Object.fromEntries(sentForm.form.fields.map(x=>[x.variable,x.value]))
 assert.equal(field.Sede,'Sede')
 assert.match(field.Cliente,/Ana Quispe.*\+51 912345678/)
 assert.match(field.Entrega,/Av\. Ejemplo 123.*Santa Anita.*Porton lateral/)
 assert.equal(field.Productos,'2 x Pollo A')
 assert.match(sentForm.form.subtitle,/Subtotal productos: S\/ 40\.00/)
 assert.ok(!JSON.stringify(sentForm).includes('deliveryFeePen'))
  assert.ok(!('phone' in response.payload))
})
test('optional email is forwarded in structured customer; unverified flags never claim verification',async()=>{
 const h=harness()
 const enriched={...customer,email:'ANA@Example.com',phoneVerified:false,emailVerified:false}
 const created=await h.call('POST','/api/v1/mobile/interactions',{
  headers:headers(),payload:createBody({customer:enriched})})
 assert.equal(created.code,201)
 assert.deepEqual(h.remote[0].input.customer,{firstName:'Ana',lastName:'Quispe',
  phone:'+51912345678',email:'ana@example.com',phoneVerified:false,emailVerified:false})
 const legacy=harness()
 const old=await legacy.call('POST','/api/v1/mobile/interactions',{
  headers:headers(),payload:createBody()})
 assert.equal(old.code,201)
 assert.equal('customer' in legacy.remote[0].input,false)
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
   headers:{'x-order-access-key':key},payload:{...createBody({customer}),type:'FORM'}})
  assert.equal(sent.code,200)
  const current=h.remote.filter(x=>x.operation==='orderForm').at(-1).value.idempotencyKey
  if(i===0)messageKey=current
  assert.equal(current,messageKey)
  assert.notEqual(current,key)
 }
})
test('failed FORM delivery returns 503 without undoing a created interaction',async()=>{
 const h=harness({messageFailure:true}),key=randomUUID()
 const created=await h.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 assert.equal(created.code,201)
 h.setReference(created.payload.externalReference)
 const result=await h.call('POST','/api/v1/mobile/interactions/'+created.payload.interactionId+'/message',{
  headers:{'x-order-access-key':key},payload:{...createBody({customer}),type:'FORM'}})
 assert.equal(result.code,503)
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction','read','orderForm'])
})

test('legacy Android without type remains TEXT; explicit FORM is never inferred',async()=>{
 const h=harness(),key=randomUUID()
 const created=await h.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 h.setReference(created.payload.externalReference)
 const sent=await h.call('POST','/api/v1/mobile/interactions/'+created.payload.interactionId+'/message',{
  headers:{'x-order-access-key':key},payload:createBody({customer})})
 assert.equal(sent.code,200)
 assert.equal(sent.payload.type,'TEXT')
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction','read','orderText'])
 assert.equal(h.remote.at(-1).value.type,'TEXT')
 assert.match(h.remote.at(-1).value.text,/POLLOS B3 - SOLICITUD DE VALIDACION/)
})

test('explicit TEXT sends exact authorized message with independent UUID, never FORM',async()=>{
 const h=harness(),key=randomUUID(),messageKey=randomUUID(),text='El cliente solicita cambiar el pedido.\nPendiente.'
 const created=await h.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 h.setReference(created.payload.externalReference)
 const path='/api/v1/mobile/interactions/'+created.payload.interactionId+'/message'
 const sent=await h.call('POST',path,{
  headers:{'x-order-access-key':key,'idempotency-key':messageKey},
  payload:{appId:appA,storeId:storeA,type:'TEXT',text}})
 assert.equal(sent.code,200)
 assert.equal(sent.payload.type,'TEXT')
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction','read','plainText'])
 assert.deepEqual(h.remote.at(-1).value,{type:'TEXT',text,idempotencyKey:messageKey})
 const next=await h.call('POST',path,{
  headers:{'x-order-access-key':key,'idempotency-key':randomUUID()},
  payload:{appId:appA,storeId:storeA,type:'TEXT',text:'Otro mensaje independiente'}})
 assert.equal(next.code,200)
 assert.notEqual(h.remote.at(-1).value.idempotencyKey,messageKey)
})

test('reject type confusion, cross-content fields, and unsafe TEXT before contacting TU VERSO',async()=>{
 const h=harness(),access=randomUUID(),path='/api/v1/mobile/interactions/'+randomUUID()+'/message'
 const invalid=[
  {body:{...createBody({customer}),type:'FORM',text:'aceptar'}},
  {body:{...createBody({customer}),type:'X'}},
  {body:{...createBody({customer}),type:null}},
  {body:{...createBody({customer}),type:'TEXT',form:{title:'Fake',fields:[]}}},
  {body:{appId:appA,storeId:storeA,type:'FORM',text:'texto'}},
  {body:{appId:appA,storeId:storeA,type:'TEXT',text:'Hola',form:{title:'Mock',fields:[]}}},
  {body:{appId:appA,storeId:storeA,type:'TEXT',text:'Hola',catalogRevision:4}},
  {body:{appId:appA,storeId:storeA,type:'TEXT',text:'Hola',items:[]}},
  {body:{appId:appA,storeId:storeA,type:'TEXT',text:'Hola\rInyección'}},
  {body:{appId:appA,storeId:storeA,type:'TEXT',text:'Hola'},key:null},
  {body:{appId:appA,storeId:storeA,type:'TEXT',text:'Hola'},key:access},
 ]
 for(const item of invalid){
  const got=await h.call('POST',path,{headers:{
   'x-order-access-key':access,...(item.key===null?{}:{'idempotency-key':item.key??randomUUID()})},
   payload:item.body})
  assert.equal(got.code,400)
 }
 assert.equal(h.remote.length,0)
})


test('Android sends title, subtitle and five independent FORM rows unchanged to TU VERSO',async()=>{
 const h=harness(),access=randomUUID(),messageKey=randomUUID(),interactionId=randomUUID()
 const external='mobile:'+createHash('sha256').update([tenantA,appA,storeA,access].join(':')).digest('hex').slice(0,48)
 h.setReference(external)
 const form={title:'VALIDACIÓN DE PEDIDO',subtitle:'Confirmar disponibilidad para delivery',fields:[
  {variable:'Cliente',value:'Ana Quispe'},
  {variable:'Teléfono',value:'912345678'},
  {variable:'Productos',value:'2 pollos a la brasa'},
  {variable:'Subtotal',value:'S/ 90.00'},
  {variable:'Dirección',value:'Av. Principal 123, Santa Anita'},
 ]}
 const payload={type:'FORM',appId:appA,storeId:storeA,form}
 const path='/api/v1/mobile/interactions/'+interactionId+'/message'
 for(let n=0;n<2;n++){
  const r=await h.call('POST',path,{headers:{
   'x-order-access-key':access,'idempotency-key':messageKey},payload})
  assert.equal(r.code,200)
  assert.equal(r.payload.delivered,true)
  assert.equal(r.payload.type,'FORM')
 }
 assert.deepEqual(h.remote.map(x=>x.operation),['read','orderForm','read','orderForm'])
 for(const send of h.remote.filter(x=>x.operation==='orderForm')){
  assert.equal(send.value.idempotencyKey,messageKey)
  assert.equal(send.value.type,'FORM')
  assert.deepEqual(send.value.form,form)
  assert.equal('text' in send.value,false)
 }
})
test('direct FORM rejects invalid rows, missing independent key, and mixed order data',async()=>{
 const h=harness(),access=randomUUID(),interactionId=randomUUID(),messageKey=randomUUID()
 const valid={title:'SOLICITUD',subtitle:'Revisar sede',fields:[{variable:'Cliente',value:'Ana'}]}
 const bad=[
  {form:{...valid,fields:[]}},
  {form:{...valid,fields:Array(6).fill({variable:'A',value:'B'})}},
  {form:{...valid,fields:[{variable:'A',value:'1'},{variable:'a',value:'2'}]}},
  {form:{...valid,title:' '}},
  {form:{...valid,subtitle:'A'.repeat(351)}},
  {form:{...valid,fields:[{variable:'X',value:'B'.repeat(501)}]}},
  {form:{...valid,fields:[{variable:'',value:'B'}]}},
  {form:{...valid,fields:[{variable:'A\nAceptado',value:'B'}]}},
  {form:{...valid,extra:'not-allowed'}},
  {form:{...valid},extra:{items:[{productId:product,quantity:1}]}},
  {form:{...valid},extra:{text:'Esto no es un FORM'}},
  {form:{...valid},extra:{catalogRevision:4}},
  {form:{...valid},key:null},
  {form:{...valid},key:access},
 ]
 const url='/api/v1/mobile/interactions/'+interactionId+'/message'
 for(const item of bad){
  const r=await h.call('POST',url,{
   headers:{'x-order-access-key':access,...(item.key===null?{}:{
    'idempotency-key':item.key??messageKey
   })},payload:{appId:appA,storeId:storeA,type:'FORM',form:item.form,...item.extra}
  })
  assert.equal(r.code,400,JSON.stringify(item))
 }
 assert.equal(h.remote.length,0,'invalid FORM must not query tenant data or TU VERSO')
})
test('direct FORM retains tenant and reference authorization and surfaces upstream conflict',async()=>{
 const interactionId=randomUUID(),access=randomUUID(),key=randomUUID()
 const form={title:'Pedido',fields:[{variable:'Sede',value:'Nogales'}]}
 const path='/api/v1/mobile/interactions/'+interactionId+'/message'
 const mismatch=harness()
 mismatch.setReference('mobile:'+createHash('sha256').update([tenantB,appB,storeB,access].join(':')).digest('hex').slice(0,48))
 const invalid=await mismatch.call('POST',path,{headers:{'x-order-access-key':access,'idempotency-key':key},
  payload:{appId:appA,storeId:storeA,type:'FORM',form}})
 assert.equal(invalid.code,403)
 assert.deepEqual(mismatch.remote.map(x=>x.operation),['read'])
 const conflicts=harness({upstream:{message:409}})
 conflicts.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,access].join(':')).digest('hex').slice(0,48))
 const conflict=await conflicts.call('POST',path,{headers:{'x-order-access-key':access,'idempotency-key':key},
  payload:{appId:appA,storeId:storeA,type:'FORM',form}})
 assert.equal(conflict.code,409)
 assert.deepEqual(conflicts.remote.map(x=>x.operation),['read','orderForm'],
  'custom FORM must never invoke historical TEXT recovery')
})

test('already-delivered legacy TEXT is recovered without sending a duplicate FORM',async()=>{
 const key=randomUUID()
 const oldDetail=[
  'POLLOS B3 - SOLICITUD DE VALIDACION',
  'Sede consultada: Sede',
  'Cliente (datos ingresados, no verificados): Ana Quispe',
  'Celular: +51 912345678',
  'Modalidad: Delivery',
  'Direccion: Av. Ejemplo 123',
  'Distrito: Santa Anita',
  'Referencia: Porton lateral',
  'PRODUCTOS: 2 x Pollo A',
  'Subtotal productos: S/ 40.00',
  'Costo delivery: pendiente tras aceptacion (no cobrar)',
  'Estado: PENDIENTE DE VALIDACION',
  'Verificar productos y responder SOLO: aceptado o rechazado.',
 ].join('\n')
 const h=harness({legacyText:oldDetail,upstream:{message:409}})
 const created=await h.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 h.setReference(created.payload.externalReference)
 const result=await h.call('POST','/api/v1/mobile/interactions/'+created.payload.interactionId+'/message',{
  headers:{'x-order-access-key':key},payload:{...createBody({customer}),type:'FORM'}})
 assert.equal(result.code,200)
 assert.equal(result.payload.delivered,true)
 assert.ok(result.payload.messageId)
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction','read','orderForm','messages'])
 const conflict=harness({upstream:{message:409}})
 conflict.setReference(created.payload.externalReference)
 const rejected=await conflict.call('POST','/api/v1/mobile/interactions/'+created.payload.interactionId+'/message',{
  headers:{'x-order-access-key':key},payload:{...createBody({customer}),type:'FORM'}})
 assert.equal(rejected.code,409)
})

test('stale local message scopes never reject; forged order references remain forbidden',async()=>{
 const key=randomUUID()
 const denied=harness({scopes:['queue.availability.read','interactions.create','interactions.read']})
 const opened=await denied.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 assert.equal(opened.code,201)
 denied.setReference(opened.payload.externalReference)
 const reply=await denied.call('POST','/api/v1/mobile/interactions/'+opened.payload.interactionId+'/message',{
  headers:{'x-order-access-key':key},payload:{...createBody({customer}),type:'FORM'}})
 assert.equal(reply.code,200)
 assert.deepEqual(denied.remote.map(x=>x.operation),['interaction','read','orderForm'])
 const forged=harness()
 forged.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const other=await forged.call('POST','/api/v1/mobile/interactions/'+randomUUID()+'/message',{
  headers:{'x-order-access-key':randomUUID()},payload:{...createBody({customer}),type:'FORM'}})
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
  {...customer,subtotal:0},
  {...customer,email:'invalid-email'},
  {...customer,phoneVerified:true},
  {...customer,emailVerified:true}
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
  assert.deepEqual(r.payload.agentMessages.map(m=>m.text),['Acepto'])
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
 assert.deepEqual(r.payload.agentMessages,[])
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
test('history outage does not block authorized cancellation; retries stay idempotent',async()=>{
 const id=randomUUID(),key=randomUUID(),h=harness({historyFailure:true})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const path='/api/v1/mobile/interactions/'+id
 const credentials={headers:{'x-order-access-key':key},payload:{appId:appA,storeId:storeA,reason:'CANCEL'}}
 const first=await h.call('POST',path+'/cancel',credentials)
 assert.equal(first.code,200)
 assert.equal(first.payload.status,'CANCELLED')
 const notices=h.remote.filter(x=>x.operation==='cancel')
 assert.equal(notices.length,1)
 assert.equal(notices[0].value.idempotencyKey,key)
 const retry=await h.call('POST',path+'/cancel',credentials)
 assert.equal(retry.code,200)
 assert.equal(retry.payload.status,'CANCELLED')
 assert.equal(h.remote.filter(x=>x.operation==='cancel').length,1)
 const status=await h.call('GET',path+'/status?appId='+appA+'&storeId='+storeA,{headers:credentials.headers})
 assert.equal(status.code,200)
 assert.equal(status.payload.status,'CANCELLED')
})

test('history outage and upstream failure keep cancellation unconfirmed and retryable',async()=>{
 const id=randomUUID(),key=randomUUID(),h=harness({historyFailure:true,upstream:{message:503}})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48))
 const url='/api/v1/mobile/interactions/'+id
 const credentials={headers:{'x-order-access-key':key},payload:{appId:appA,storeId:storeA,reason:'CANCEL'}}
 const first=await h.call('POST',url+'/cancel',credentials)
 assert.equal(first.code,503)
 assert.equal(h.queries.filter(x=>x.sql.startsWith('INSERT INTO mobile_checkout_followups')&&x.sql.includes('agent_notice_sent')).length,0)
 const second=await h.call('POST',url+'/cancel',credentials)
 assert.equal(second.code,503)
 const notices=h.remote.filter(x=>x.operation==='cancel')
 assert.equal(notices.length,2)
 assert.equal(notices[0].value.idempotencyKey,notices[1].value.idempotencyKey)
 const status=await h.call('GET',url+'/status?appId='+appA+'&storeId='+storeA,{headers:credentials.headers})
 assert.equal(status.code,200)
 assert.notEqual(status.payload.status,'CANCELLED')
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

test('effective TU VERSO authorizations pass through as 401/403, not misleading 503',async()=>{
 for(const status of [401,403]){
  const availability=harness({scopes:[],upstream:{availability:status}})
  const check=await availability.call('GET',endpoint())
  assert.equal(check.code,status)
  assert.deepEqual(availability.remote.map(x=>x.operation),['capacity'])
  const create=harness({scopes:[],upstream:{create:status}})
  const started=await create.call('POST','/api/v1/mobile/interactions',{headers:headers(),payload:createBody()})
  assert.equal(started.code,status)
  assert.deepEqual(create.remote.map(x=>x.operation),['interaction'])
  const read=harness({scopes:[],upstream:{read:status}})
  const tracked=await read.call('GET','/api/v1/mobile/interactions/'+randomUUID()+'/status?appId='+appA+'&storeId='+storeA,{
   headers:{'x-order-access-key':randomUUID()}
  })
  assert.equal(tracked.code,status)
  assert.deepEqual(read.remote.map(x=>x.operation),['read'])
 }
})

test('upstream failure to send FORM is authoritative while local order isolation is unchanged',async()=>{
 const key=randomUUID()
 const h=harness({scopes:[],upstream:{message:403}})
 const created=await h.call('POST','/api/v1/mobile/interactions',{
  headers:{'idempotency-key':key},payload:createBody({customer})})
 assert.equal(created.code,201)
 h.setReference(created.payload.externalReference)
 const reply=await h.call('POST','/api/v1/mobile/interactions/'+created.payload.interactionId+'/message',{
  headers:{'x-order-access-key':key},payload:{...createBody({customer}),type:'FORM'}})
 assert.equal(reply.code,403)
 assert.deepEqual(h.remote.map(x=>x.operation),['interaction','read','orderForm'])
 const other=harness({scopes:[]})
 const unauthorized=await other.call('GET',endpoint(storeB,appA))
 assert.equal(unauthorized.code,409)
 assert.equal(other.remote.length,0)
})

test('closed MOBILE_APP agent conversation is visible and customer cancel is idempotent without message',async()=>{
 const id=randomUUID(),key=randomUUID();
 const ref='mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48);
 const path='/api/v1/mobile/interactions/'+id;
 const owner={headers:{'x-order-access-key':key},payload:{appId:appA,storeId:storeA,reason:'CANCEL'}};
 const closed=harness({remoteStatus:'ACCEPTED',operationalConversationStatus:'CLOSED',upstream:{message:409}});
 closed.setReference(ref);
 const status=await closed.call('GET',path+'/status?appId='+appA+'&storeId='+storeA,{headers:owner.headers});
 assert.equal(status.code,200);
 assert.equal(status.payload.operationalConversationStatus,'CLOSED');
 assert.equal(status.payload.conversationState,'CLOSED');
 assert.equal(status.payload.messagesAvailable,true);
 const cancelled=await closed.call('POST',path+'/cancel',owner);
 assert.equal(cancelled.code,200);
 assert.equal(cancelled.payload.status,'CANCELLED');
 assert.equal(closed.remote.filter(x=>x.operation==='cancel').length,0);
 const repeat=await closed.call('POST',path+'/cancel',owner);
 assert.equal(repeat.code,200);
 assert.equal(closed.remote.filter(x=>x.operation==='cancel').length,0);
 const noHistory=harness({remoteStatus:'ACCEPTED',operationalConversationStatus:'RESOLVED',historyFailure:true});
 noHistory.setReference(ref);
 const read=await noHistory.call('GET',path+'/status?appId='+appA+'&storeId='+storeA,{headers:owner.headers});
 assert.equal(read.code,200);
 assert.equal(read.payload.messagesAvailable,false);
 assert.equal(read.payload.conversationState,'CLOSED');
 assert.equal(read.payload.operationalConversationStatus,'RESOLVED',
  'Verified closure is independent of message-history availability');
 assert.equal((await noHistory.call('POST',path+'/cancel',owner)).code,200);
 const unverified=harness({remoteStatus:'ACCEPTED',upstream:{message:409}});
 unverified.setReference(ref);
 assert.equal((await unverified.call('POST',path+'/cancel',owner)).code,409);
});

test('TU VERSO explicit OPEN is recognized while absence remains UNKNOWN',async()=>{
 const id=randomUUID(),key=randomUUID()
 const ref='mobile:'+createHash('sha256').update([tenantA,appA,storeA,key].join(':')).digest('hex').slice(0,48)
 const path='/api/v1/mobile/interactions/'+id+'/status?appId='+appA+'&storeId='+storeA
 const headers={'x-order-access-key':key}
 const opened=harness({remoteStatus:'ACCEPTED',operationalConversationStatus:'OPEN'})
 opened.setReference(ref)
 const active=await opened.call('GET',path,{headers})
 assert.equal(active.code,200)
 assert.equal(active.payload.conversationState,'OPEN')
 assert.equal(active.payload.operationalConversationStatus,'OPEN')
 const unknown=harness({remoteStatus:'ACCEPTED',historyFailure:true})
 unknown.setReference(ref)
 const missing=await unknown.call('GET',path,{headers})
 assert.equal(missing.code,200)
 assert.equal(missing.payload.conversationState,'UNKNOWN')
 assert.equal(Object.hasOwn(missing.payload,'operationalConversationStatus'),false)
 assert.equal(missing.payload.messagesAvailable,false)
})


test('payment receipt sends exactly one image FORM for an accepted authorized order',async()=>{
 const access=randomUUID(),id=randomUUID(),messageKey=randomUUID()
 const h=harness({remoteStatus:'ACCEPTED'})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,access].join(':')).digest('hex').slice(0,48))
 const payload={appId:appA,storeId:storeA,form:{title:'Validación de pago',
  subtitle:'Comprobante de pago Yape',imageUrl:'https://cdn.example.com/comprobante.jpg',
  fields:[{variable:'Pedido',value:'B3-1025'},{variable:'Método',value:'Yape'}]}}
 const result=await h.call('POST','/api/v1/mobile/interactions/'+id+'/payment-receipt',{
  headers:{'x-order-access-key':access,'idempotency-key':messageKey},payload})
 assert.equal(result.code,200)
 assert.equal(result.payload.type,'FORM')
 assert.equal(result.payload.paymentStatus,'PENDING_VALIDATION')
 assert.deepEqual(h.remote.map(x=>x.operation),['read','orderForm'])
 assert.equal(h.remote[1].value.idempotencyKey,messageKey)
 assert.equal(h.remote[1].value.form.imageUrl,payload.form.imageUrl)
})
test('payment receipt rejects invalid image, missing idempotency, wrong access and unaccepted order',async()=>{
 const access=randomUUID(),id=randomUUID(),key=randomUUID()
 const payload={appId:appA,storeId:storeA,form:{title:'Validación de pago',
  imageUrl:'https://127.0.0.1/private.png',fields:[{variable:'Método',value:'Yape'}]}}
 const h=harness({remoteStatus:'ACCEPTED'})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,access].join(':')).digest('hex').slice(0,48))
 const path='/api/v1/mobile/interactions/'+id+'/payment-receipt'
 const bad=await h.call('POST',path,{headers:{'x-order-access-key':access,'idempotency-key':key},payload})
 assert.equal(bad.code,400)
 assert.equal(h.remote.length,0)
 payload.form.imageUrl='https://cdn.example.com/receipt.png'
 const noKey=await h.call('POST',path,{headers:{'x-order-access-key':access},payload})
 assert.equal(noKey.code,400)
 const rejected=harness({remoteStatus:'PENDING'})
 rejected.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,access].join(':')).digest('hex').slice(0,48))
 const pending=await rejected.call('POST',path,{headers:{'x-order-access-key':access,'idempotency-key':key},payload})
 assert.equal(pending.code,409)
 assert.deepEqual(rejected.remote.map(x=>x.operation),['read'])
 const forbidden=await h.call('POST',path,{headers:{'x-order-access-key':randomUUID(),'idempotency-key':key},payload})
 assert.equal(forbidden.code,403)
 assert.deepEqual(h.remote.map(x=>x.operation),['read'])
})

test('receipt upload stores image for the authorized accepted order and returns a public URL',async()=>{
 const access=randomUUID(),interactionId=randomUUID(),h=harness({remoteStatus:'ACCEPTED'})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,access].join(':')).digest('hex').slice(0,48))
 const url='/api/v1/mobile/interactions/'+interactionId+'/payment-receipt/upload?appId='+appA+'&storeId='+storeA
 const result=await h.call('POST',url,{headers:{'x-order-access-key':access,'content-type':'image/jpeg'}})
 assert.equal(result.code,201)
 assert.equal(result.payload.imageId,'99999999-9999-4999-8999-999999999999')
 assert.equal(result.payload.imageUrl,'https://admin.example.com/api/v1/mobile/payment-receipts/images/'+result.payload.imageId)
 assert.deepEqual(h.remote.map(x=>x.operation),['read'])
 assert.equal(h.queries.some(x=>x.sql.startsWith('INSERT INTO mobile_payment_receipt_images')),true)
})
test('receipt upload never persists a non-accepted order or mismatched access key',async()=>{
 const access=randomUUID(),id=randomUUID(),h=harness({remoteStatus:'PENDING'})
 h.setReference('mobile:'+createHash('sha256').update([tenantA,appA,storeA,access].join(':')).digest('hex').slice(0,48))
 const path='/api/v1/mobile/interactions/'+id+'/payment-receipt/upload?appId='+appA+'&storeId='+storeA
 const pending=await h.call('POST',path,{headers:{'x-order-access-key':access}})
 assert.equal(pending.code,409)
 assert.equal(h.queries.some(x=>x.sql.startsWith('INSERT INTO product_images')),false)
 const other=await h.call('POST',path,{headers:{'x-order-access-key':randomUUID()}})
 assert.equal(other.code,403)
 assert.equal(h.queries.some(x=>x.sql.startsWith('INSERT INTO product_images')),false)
})
