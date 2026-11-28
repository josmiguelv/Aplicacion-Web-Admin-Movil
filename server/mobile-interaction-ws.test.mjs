import test from 'node:test'
import assert from 'node:assert/strict'
import {createServer} from 'node:http'
import {createHash,randomUUID} from 'node:crypto'
import {once} from 'node:events'
import {WebSocket} from 'ws'
import {attachMobileInteractionWebSocket} from './mobile-interaction-ws.mjs'

const tenant=randomUUID(),integration=randomUUID(),store=randomUUID()
const app='com.integrab2g.pollosb3',location='nogales'
const a={interactionId:randomUUID(),key:randomUUID()}
const b={interactionId:randomUUID(),key:randomUUID()}
const reference=key=>'mobile:'+createHash('sha256')
 .update([tenant,app,store,key].join(':')).digest('hex').slice(0,48)

function setup(){
 const map=new Map([[a.interactionId,a.key],[b.interactionId,b.key]])
 const queue=[]
 let polls=0
 const pool={async query(sql,args){
  if(sql.includes('FROM published_catalogs'))return {rowCount:1,rows:[{
   tenant_id:tenant,payload:{stores:[{id:store,active:true,consultOrderAvailability:true}]}
  }]}
  if(sql.includes('FROM integration_bindings b'))return {rowCount:1,rows:[{
   integration_id:integration,encrypted_credential:'opaque',external_location_id:location,
   purpose:'ORDER_REQUEST',suspended:false,channel_type:'MOBILE_APP'
  }]}
  throw Error('Unexpected SQL')
 }}
 const readInteraction=async(_token,id)=>({ok:true,data:{
  interactionId:id,externalReference:reference(map.get(id)||randomUUID()),
  externalLocationId:location,purpose:'ORDER_REQUEST',status:'PENDING'
 }})
 const pollEvents=async()=>({ok:true,data:{
  events:queue.splice(0),nextCursor:randomUUID(),hasMore:false
 }})
 const server=createServer((_req,res)=>{res.writeHead(200,{'Content-Type':'application/json'});res.end('{"rest":"unchanged"}')})
 const stop=attachMobileInteractionWebSocket(server,{pool,decrypt:()=> 'secret',
  readInteraction,pollEvents:async(...args)=>{polls++;return pollEvents(...args)},
  enabled:()=>true,intervalMs:20})
 return {server,stop,queue,get polls(){return polls}}
}
async function connect(port,interactionId,key,extra={}){
 const path='/api/v1/mobile/interactions/'+interactionId+
  '/events/ws?appId='+app+'&storeId='+store
 const ws=new WebSocket('ws://127.0.0.1:'+port+path,{headers:{
  'X-Order-Access-Key':key,...extra
 }})
 const incoming=[]
 ws.on('message',data=>incoming.push(JSON.parse(data.toString())))
 await once(ws,'open')
 return {ws,incoming}
}
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms))
async function until(predicate){
 for(let i=0;i<60;i++){if(predicate())return;await sleep(20)}
 throw Error('Timed out waiting for notification')
}

test('REST stays unchanged; only authorized interaction receives events; duplicates suppressed',async()=>{
 const h=setup()
 h.server.listen(0,'127.0.0.1');await once(h.server,'listening')
 const port=h.server.address().port
 const clients=[]
 try{
  const ordinary=await fetch('http://127.0.0.1:'+port+'/health')
  assert.deepEqual(await ordinary.json(),{rest:'unchanged'})
  const ca=await connect(port,a.interactionId,a.key)
  clients.push(ca.ws)
  const cb=await connect(port,b.interactionId,b.key)
  clients.push(cb.ws)
  await until(()=>ca.incoming.some(x=>x.type==='INTERACTION_SYNC_REQUIRED')&&
   cb.incoming.some(x=>x.type==='INTERACTION_SYNC_REQUIRED')&&h.polls>=2)
  const event={id:randomUUID(),interactionId:a.interactionId,kind:'MESSAGE_OUTBOUND',
   createdAt:new Date().toISOString()}
  h.queue.push(event)
  await until(()=>ca.incoming.some(x=>x.eventId===event.id))
  assert.equal(cb.incoming.some(x=>x.eventId===event.id),false)
  assert.deepEqual(Object.keys(ca.incoming.find(x=>x.eventId===event.id)).sort(),
   ['eventId','interactionId','occurredAt','type'])
  h.queue.push(event)
  await sleep(100)
  assert.equal(ca.incoming.filter(x=>x.eventId===event.id).length,1)
  // Never infer commercial ACCEPTED from the text of a FORM response.
  assert.equal(ca.incoming.find(x=>x.eventId===event.id).status,undefined)
 }finally{
  for(const ws of clients)ws.terminate()
  await h.stop()
  await new Promise(resolve=>h.server.close(resolve))
 }
})

test('foreign key and missing key do not establish a subscription',async()=>{
 const h=setup();h.server.listen(0,'127.0.0.1');await once(h.server,'listening')
 const port=h.server.address().port
 try{
  for(const key of [b.key,undefined]){
   const url='ws://127.0.0.1:'+port+'/api/v1/mobile/interactions/'+a.interactionId+
    '/events/ws?appId='+app+'&storeId='+store
   const headers=key?{'X-Order-Access-Key':key}:{}
   const ws=new WebSocket(url,{headers})
   const result=await new Promise(resolve=>{
    ws.once('unexpected-response',(_req,response)=>resolve(response.statusCode))
    ws.once('error',()=>resolve('error'))
   })
   assert.ok(result===403||result==='error')
   ws.terminate()
  }
 }finally{await h.stop();await new Promise(resolve=>h.server.close(resolve))}
})

test('reconnection always requests authoritative REST reconciliation',async()=>{
 const h=setup();h.server.listen(0,'127.0.0.1');await once(h.server,'listening')
 const port=h.server.address().port
 try{
  const first=await connect(port,a.interactionId,a.key)
  await until(()=>first.incoming.some(x=>x.type==='INTERACTION_SYNC_REQUIRED'))
  first.ws.terminate()
  await sleep(25)
  const next=await connect(port,a.interactionId,a.key)
  await until(()=>next.incoming.some(x=>x.type==='INTERACTION_SYNC_REQUIRED'))
  next.ws.terminate()
 }finally{await h.stop();await new Promise(resolve=>h.server.close(resolve))}
})
