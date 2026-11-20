import test from 'node:test'
import assert from 'node:assert/strict'
import {randomUUID} from 'node:crypto'
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
function harness({capacity='AVAILABLE',scopes=['queue.availability.read','interactions.create'],enabled=true,requests=true,open=true,count=1}={}){
 const queries=[],remote=[]
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
  createInteraction:async(token,binding,input)=>{remote.push({operation:'interaction',token,binding,input});return {ok:true,httpStatus:201,data:{interactionId:randomUUID(),status:'PENDING',externalReference:input.externalReference,externalLocationId:binding.external_location_id,purpose:'ORDER_REQUEST'}}}
 })
 const call=async(method,path,{payload,headers}={})=>{
  const req={method,body:payload,headers:headers||{},socket:{remoteAddress:'synthetic'}}
  const res={}
  const handled=await route({req,res,url:new URL('http://local.test'+path)})
  assert.equal(handled,undefined)
  return res.reply
 }
 return {call,queries,remote}
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
