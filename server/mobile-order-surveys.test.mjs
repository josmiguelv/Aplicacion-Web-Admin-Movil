import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash,randomUUID} from 'node:crypto'
import {createMobileSurveyRoute,adminSurveyList,parseSurveyFilters,validateSurvey} from './mobile-order-surveys.mjs'

const tenant=randomUUID(),appId='com.integrab2g.pollosb3',storeId=randomUUID(),interactionId=randomUUID(),access=randomUUID()
const otherStore=randomUUID(),otherTenant=randomUUID(),integrationId=randomUUID()
const ref='mobile:'+createHash('sha256').update([tenant,appId,storeId,access].join(':')).digest('hex').slice(0,48)
const input=(overrides={})=>({appId,storeId,rating:5,tags:['Sabor','Temperatura','Atención'],comment:'Muy rico',...overrides})
function harness({remoteStatus='PENDING',reference=ref,remoteFailure=null,validBinding=true}={}){
 const records=[],calls=[],createdAt='2026-11-24T18:00:00.000Z',id=randomUUID()
 const pool={async query(query,args){
  calls.push({query,args})
  if(query.includes('FROM published_catalogs p'))return {rowCount:1,rows:[{tenant_id:tenant,payload:{stores:[{id:storeId}]}}]}
  if(query.includes('FROM integration_bindings b'))return {rowCount:validBinding?1:0,rows:validBinding?[{integration_id:integrationId,encrypted_credential:'ciphertext',suspended:false,expires_at:null,channel_type:'MOBILE_APP',external_location_id:'location-a'}]:[]}
  if(query.includes('INSERT INTO mobile_order_surveys')){
   if(records.some(r=>r.interaction_id===args[3]||r.idempotency_key===args[4]))return {rowCount:0,rows:[]}
   const row={id,tenant_id:args[0],app_id:args[1],store_id:args[2],interaction_id:args[3],idempotency_key:args[4],rating:args[5],tags:JSON.parse(args[6]),comment:args[7],created_at:createdAt}
   records.push(row);return {rowCount:1,rows:[row]}
  }
  if(query.includes('FROM mobile_order_surveys WHERE')){const found=records.filter(r=>r.tenant_id===args[0]&&r.app_id===args[1]&&(r.interaction_id===args[2]||r.idempotency_key===args[3]));return {rowCount:found.length,rows:found}}
  throw Error('Unexpected SQL '+query)
 }}
 const route=createMobileSurveyRoute({pool,body:async req=>req.body,
  json:(res,status,payload)=>{res.reply={status,payload}},rateLimit:()=>{},
  decrypt:()=> 'token',readInteraction:async()=>remoteFailure?{ok:false,httpStatus:remoteFailure}:
  {ok:true,data:{interactionId,externalReference:reference,externalLocationId:'location-a',purpose:'ORDER_REQUEST',status:remoteStatus}}})
 const send=async(body,key=randomUUID(),headers={})=>{
  const res={}
  await route({req:{method:'POST',body,headers:{'idempotency-key':key,'x-order-access-key':access,...headers}},res,url:new URL('http://local/api/v1/mobile/orders/'+interactionId+'/survey')})
  return res.reply
 }
 return {send,records,calls}
}
test('201 new survey, identical retry 200 and no duplicate',async()=>{
 const h=harness(),key=randomUUID(),p=input()
 const first=await h.send(p,key),replay=await h.send(p,key)
 assert.equal(first.status,201);assert.equal(replay.status,200)
 assert.deepEqual(first.payload,replay.payload)
 assert.equal(h.records.length,1)
 assert.equal(h.records[0].tenant_id,tenant)
})
test('different payload or idempotency key cannot overwrite survey',async()=>{
 const h=harness(),key=randomUUID()
 assert.equal((await h.send(input(),key)).status,201)
 assert.equal((await h.send(input({rating:4}),key)).status,409)
 assert.equal((await h.send(input(),randomUUID())).status,409)
 assert.equal(h.records.length,1)
})
test('ratings, tags, duplicate tags, long comments, untrusted tenant forbidden',async()=>{
 for(const p of [input({rating:0}),input({rating:6}),input({rating:3.5}),
  input({tags:['Sabor','Falso']}),input({tags:['Sabor','Sabor']}),
  input({comment:'a'.repeat(501)}),{...input(),tenantId:tenant}]){
  assert.throws(()=>validateSurvey(p),{code:400})
 }
})
test('foreign store, access key, binding, unknown interaction rejected',async()=>{
 assert.equal((await harness().send(input({storeId:otherStore}))).status,403)
 assert.equal((await harness({reference:'mobile:forged'}).send(input())).status,403)
 assert.equal((await harness({validBinding:false}).send(input())).status,403)
 assert.equal((await harness({remoteFailure:404}).send(input())).status,404)
})
test('surveys may arrive after technical conversation closed and do not alter order',async()=>{
 const h=harness({remoteStatus:'EXPIRED'}),r=await h.send(input())
 assert.equal(r.status,201)
 assert.equal(h.calls.some(x=>/UPDATE |DELETE /.test(x.query)),false)
})
test('filters validate UTC dates, paging and unsupported parameters',()=>{
 const params=new URLSearchParams({storeId,rating:'5',from:'2026-11-01',to:'2026-11-24',limit:'25',offset:'10'})
 assert.deepEqual(parseSurveyFilters(params),{storeId,from:'2026-11-01',to:'2026-11-24',rating:5,appId:null,limit:25,offset:10})
 for(const q of ['rating=6','limit=101','offset=-1','from=2026-02-30','from=2026-11-25&to=2026-11-24','unknown=1'])
  assert.throws(()=>parseSurveyFilters(new URLSearchParams(q)),{code:400})
})
test('tenant-scoped admin list applies filters and pagination without upstream calls',async()=>{
 const calls=[],pool={async query(query,args){
  calls.push({query,args})
  if(query.includes('count(*)'))return {rows:[{total:1}]}
  return {rows:[{id:randomUUID(),app_id:appId,store_id:storeId,interaction_id:interactionId,rating:5,tags:['Sabor'],comment:'Excelente',created_at:'2026-11-24T18:00:00Z'}]}
 }}
 const data=await adminSurveyList({pool,user:{role:'TENANT_ADMIN',tenant_id:tenant},params:new URLSearchParams({storeId,appId,rating:'5',limit:'10',offset:'5',from:'2026-11-01',to:'2026-11-24'})})
 assert.equal(data.total,1);assert.equal(data.items[0].rating,5)
 assert.equal(data.limit,10);assert.equal(data.offset,5)
 assert.equal(calls.length,2)
 assert.equal(calls[0].args[0],tenant)
 assert.ok(calls[1].query.includes('LIMIT $'))
 assert.ok(calls[1].query.includes('OFFSET $'))
 await assert.rejects(adminSurveyList({pool,user:{role:'TENANT_ADMIN',tenant_id:tenant},params:new URLSearchParams({tenantId:otherTenant})}),{code:403})
 const root=await adminSurveyList({pool,user:{role:'SUPER_ADMIN',tenant_id:null},params:new URLSearchParams({tenantId:tenant})})
 assert.equal(root.total,1)
})
