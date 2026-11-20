import test from 'node:test'
import assert from 'node:assert/strict'
import {createMobileOrderAvailabilityRoutes,calculateOrderCart} from './mobile-order-availability.mjs'

const tenantA='11111111-1111-4111-8111-111111111111'
const tenantB='22222222-2222-4222-8222-222222222222'
const storeA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const storeB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const product='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
const validationA='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
const validationB='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
const tokenA='ordv1_'+'A'.repeat(43)
const tokenB='ordv1_'+'B'.repeat(43)

test('cart subtotal comes only from the published tenant catalog',()=>{
 const result=calculateOrderCart([{id:product,name:'Producto de prueba',pricePen:12.35,active:true}],[{productId:product,quantity:2}])
 assert.equal(result.subtotal,24.7)
 assert.throws(()=>calculateOrderCart([],[{productId:product,quantity:1}]),{code:409})
 assert.throws(()=>calculateOrderCart([{id:product,name:'Inactivo',pricePen:1,active:false}],[{productId:product,quantity:1}]),{code:409})
})

test('two registered apps resolve and persist independently by tenant',async()=>{
 const rows=new Map(),calls=[]
 const contexts={
  'mobile.app.alpha':{tenantId:tenantA,revision:3,currency:'PEN',products:[{id:product,name:'A product',pricePen:10,active:true}],candidates:[{storeId:storeA,storeName:'Sede A',deliveryFee:2,routeDistanceKm:1,paymentMethods:['cash'],consultOrderAvailability:false}]},
  'mobile.app.beta':{tenantId:tenantB,revision:8,currency:'PEN',products:[{id:product,name:'B product',pricePen:20,active:true}],candidates:[{storeId:storeB,storeName:'Sede B',deliveryFee:4,routeDistanceKm:2,paymentMethods:['card'],consultOrderAvailability:false}]},
 }
 const pool={async query(sql,args=[]){
  calls.push({sql,args})
  if(sql.includes('FROM mobile_order_validations v')&&sql.includes('v.idempotency_key=$2'))return {rowCount:0,rows:[]}
  if(sql.includes('INSERT INTO mobile_order_validations')){
   const [,appId,idempotencyKey,tokenHash,requestHash,customerExternalId,requestSummary,subtotal,currency,catalogRevision,candidates]=args
   const id=appId.endsWith('alpha')?validationA:validationB
   const row={id,tenant_id:args[0],app_id:appId,idempotency_key:idempotencyKey,validation_token_hash:tokenHash,request_hash:requestHash,
    customer_external_id:customerExternalId,request_summary:requestSummary,subtotal,currency,catalog_revision:catalogRevision,
    candidates:JSON.parse(candidates),candidate_index:0,status:'CHECKING_STORES',selected_store_id:null,lease_until:null}
   rows.set(id,row);return {rowCount:1,rows:[row]}
  }
  if(sql.includes('UPDATE mobile_order_validations SET lease_until=now()+interval')){
   const row=rows.get(args[0]);if(!row||row.lease_until)return {rowCount:0,rows:[]}
   row.lease_until=new Date(Date.now()+35000);return {rowCount:1,rows:[{...row}]}
  }
  if(sql.includes('SELECT revision FROM published_catalogs'))return {rowCount:1,rows:[{revision:args[1]==='mobile.app.alpha'?3:8}]}
  if(sql.includes('UPDATE mobile_order_validations SET lease_until=NULL')){
   const row=rows.get(args[0]);row.lease_until=null
   if(args[1]!==null)row.status=args[1]
   if(args[3]!==null)row.selected_store_id=args[3]
   row.error_code=args[4];return {rowCount:1,rows:[]}
  }
  if(sql.includes('SELECT * FROM mobile_order_validations WHERE id=$1'))return {rowCount:1,rows:[rows.get(args[0])].filter(Boolean)}
  throw new Error('Unexpected SQL in focused test: '+sql)
 }}
 const route=createMobileOrderAvailabilityRoutes({pool,body:async req=>req.input,json:(_res,status,value)=>({status,value}),
  loadOrderContext:async(appId)=>contexts[appId],requestMode:()=> 'LIVE'})
 for(const [index,[appId,token,expectedTenant,expectedStore]] of Object.entries([
  ['mobile.app.alpha',tokenA,tenantA,storeA],['mobile.app.beta',tokenB,tenantB,storeB],
 ])){
  assert.match(`00000000-0000-4000-8000-00000000000${Number(index)+1}`,/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i)
  const response=await route({req:{method:'POST',headers:{'idempotency-key':`00000000-0000-4000-8000-00000000000${Number(index)+1}`},input:{appId,validationToken:token,customerExternalId:'buyer-'+index,
    items:[{productId:product,quantity:1}],address:'Calle de prueba',district:'Distrito',city:'Ciudad ficticia',country:'País ficticio',useGps:false}},res:{},
   url:{pathname:'/api/v1/mobile/orders/availability'}})
  assert.equal(response.status,200,JSON.stringify(response.value))
  assert.equal(response.value.status,'READY_FOR_PAYMENT')
  assert.equal(response.value.store.id,expectedStore)
  assert.equal(rows.get(index==='0'?validationA:validationB).tenant_id,expectedTenant)
  assert.equal(JSON.stringify(response.value).includes(expectedTenant),false)
 }
 const insertCalls=calls.filter(call=>call.sql.includes('INSERT INTO mobile_order_validations'))
 assert.deepEqual(insertCalls.map(call=>call.args[0]),[tenantA,tenantB])
 assert.deepEqual(insertCalls.map(call=>call.args[1]),['mobile.app.alpha','mobile.app.beta'])
})

test('pending asesor rejection advances once to the next eligible tenant store',async()=>{
 const tenant='33333333-3333-4333-8333-333333333333'
 const validation='ffffffff-ffff-4fff-8fff-ffffffffffff'
 const integration='12121212-1212-4121-8121-121212121212'
 const binding='13131313-1313-4131-8131-131313131313'
 const interaction='14141414-1414-4141-8141-141414141414'
 const appId='mobile.app.gamma',token='ordv1_'+'C'.repeat(43),idempotency='15151515-1515-4151-8151-151515151515'
 const firstStore='16161616-1616-4161-8161-161616161616',secondStore='17171717-1717-4171-8171-171717171717'
 let row=null,attempt=null,decision='PENDING',creates=0,availabilityChecks=0
 const linked={integration_id:integration,tenant_id:tenant,encrypted_credential:'ciphertext',expires_at:null,suspended:false,
  scopes:['queue.availability.read'],binding_id:binding,store_id:firstStore,
  external_location_id:'authorized-location',purpose:'ORDER_REQUEST',authorization_confirmed_at:new Date()}
 const pool={async query(sql,args=[]){
  if(sql.includes('FROM mobile_order_validations v')&&sql.includes('v.idempotency_key=$2'))return {rowCount:0,rows:[]}
  if(sql.includes('INSERT INTO mobile_order_validations')){row={id:validation,tenant_id:tenant,app_id:appId,idempotency_key:idempotency,
   validation_token_hash:args[3],request_hash:args[4],customer_external_id:args[5],request_summary:args[6],subtotal:10,currency:'PEN',
   catalog_revision:2,candidates:[{storeId:firstStore,storeName:'Primera',deliveryFee:2,routeDistanceKm:1,paymentMethods:['cash'],consultOrderAvailability:true},
    {storeId:secondStore,storeName:'Segunda',deliveryFee:3,routeDistanceKm:2,paymentMethods:['card'],consultOrderAvailability:false}],
   candidate_index:0,status:'CHECKING_STORES',selected_store_id:null,lease_until:null};return {rowCount:1,rows:[row]}}
  if(sql.includes('UPDATE mobile_order_validations SET lease_until=now()+interval')){if(row.lease_until)return {rowCount:0,rows:[]};row.lease_until=new Date(Date.now()+35000);return {rowCount:1,rows:[{...row}]}}
  if(sql.includes('FROM integration_bindings b')&&sql.includes("b.purpose='ORDER_REQUEST'"))return {rowCount:1,rows:[linked]}
  if(sql.includes('INSERT INTO mobile_order_attempts')){attempt={id:'18181818-1818-4181-8181-181818181818',tenant_id:tenant,validation_id:validation,
   attempt_number:args[2],store_id:args[3],binding_id:args[4],integration_id:args[5],idempotency_key:args[6],external_reference:args[7],
   interaction_id:null,status:'CREATE_UNCERTAIN'};return {rowCount:1,rows:[attempt]}}
  if(sql.includes('UPDATE mobile_order_attempts SET interaction_id=$4')){attempt.interaction_id=args[3];attempt.status=args[4];return {rowCount:1,rows:[]}}
  if(sql.includes('FROM mobile_order_attempts a'))return {rowCount:attempt?1:0,rows:attempt?[{...attempt,...linked}]:[]}
  if(sql.includes('FROM mobile_order_validations v')&&sql.includes('a.enabled=true'))return {rowCount:1,rows:[row]}
  if(sql.includes('UPDATE mobile_order_attempts SET status=$3')){attempt.status=args[2];attempt.decision_reason=args[3];return {rowCount:1,rows:[]}}
  if(sql.includes("UPDATE mobile_order_attempts SET status='ACCEPTED'")){attempt.status='ACCEPTED';return {rowCount:1,rows:[]}}
  if(sql.includes('SELECT revision FROM published_catalogs'))return {rowCount:1,rows:[{revision:2}]}
  if(sql.includes('UPDATE mobile_order_validations SET lease_until=NULL')){row.lease_until=null;if(args[1]!==null)row.status=args[1];if(args[2]!==null)row.candidate_index=args[2];if(args[3]!==null)row.selected_store_id=args[3];row.error_code=args[4];return {rowCount:1,rows:[]}}
  if(sql.includes('SELECT * FROM mobile_order_validations WHERE id=$1'))return {rowCount:row?1:0,rows:row?[row]:[]}
  throw new Error('Unexpected SQL in pending/fallback test: '+sql)
 }}
 const route=createMobileOrderAvailabilityRoutes({pool,body:async req=>req.input,json:(_res,status,value)=>({status,value}),
  loadOrderContext:async()=>({tenantId:tenant,revision:2,currency:'PEN',products:[{id:product,name:'Gamma item',pricePen:10,active:true}],candidates:row?.candidates||[
   {storeId:firstStore,storeName:'Primera',deliveryFee:2,routeDistanceKm:1,paymentMethods:['cash'],consultOrderAvailability:true},
   {storeId:secondStore,storeName:'Segunda',deliveryFee:3,routeDistanceKm:2,paymentMethods:['card'],consultOrderAvailability:false}]}),
  isCandidateLive:async()=>true,requestMode:()=> 'LIVE',decrypt:()=> 'server-only-token',
  availability:async(secret)=>{assert.equal(secret,'server-only-token');availabilityChecks++;return {result:'AVAILABLE'}},
  createInteraction:async(secret,_binding,input)=>{assert.equal(secret,'server-only-token');creates++;return {ok:true,data:{status:'PENDING',interactionId:interaction,
   externalReference:input.externalReference,externalLocationId:'authorized-location',purpose:'ORDER_REQUEST',decisionReason:null}}},
  readInteraction:async()=>({ok:true,data:{status:decision,interactionId:interaction,externalReference:attempt.external_reference,
   externalLocationId:'authorized-location',purpose:'ORDER_REQUEST',decisionReason:decision==='REJECTED'?'No hay capacidad en esta sede':null}})
 })
 const req={method:'POST',headers:{'idempotency-key':idempotency},input:{appId,validationToken:token,customerExternalId:'buyer-gamma',
  items:[{productId:product,quantity:1}],address:'Calle válida',district:'Distrito',city:'Ciudad ficticia',country:'País ficticio',useGps:false}}
 let response=await route({req,res:{},url:{pathname:'/api/v1/mobile/orders/availability'}})
 assert.equal(response.status,202);assert.equal(response.value.status,'WAITING_APPROVAL');assert.equal(response.value.deliveryFee,null)
 response=await route({req:{method:'GET',headers:{authorization:'Bearer '+token}},res:{},url:{pathname:`/api/v1/mobile/orders/availability/${validation}`}})
 assert.equal(response.status,202);assert.equal(response.value.status,'WAITING_APPROVAL')
 decision='REJECTED'
 response=await route({req:{method:'GET',headers:{authorization:'Bearer '+token}},res:{},url:{pathname:`/api/v1/mobile/orders/availability/${validation}`}})
 assert.equal(response.status,202);assert.equal(response.value.status,'CHECKING_STORES')
 response=await route({req:{method:'GET',headers:{authorization:'Bearer '+token}},res:{},url:{pathname:`/api/v1/mobile/orders/availability/${validation}`}})
 assert.equal(response.status,200);assert.equal(response.value.status,'READY_FOR_PAYMENT')
 assert.equal(response.value.store.id,secondStore);assert.equal(response.value.deliveryFee,3);assert.deepEqual(response.value.paymentMethods,['card'])
 assert.equal(creates,1);assert.equal(availabilityChecks,1)
})
