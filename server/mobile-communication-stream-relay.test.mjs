import test from 'node:test'
import assert from 'node:assert/strict'
import {EventEmitter} from 'node:events'
import {randomUUID} from 'node:crypto'
import {relayMobileCommunicationStream} from './mobile-communication-stream-relay.mjs'

const token='tuverso_'+'a'.repeat(64)
const interactionId=randomUUID()
function pair(){
 const req=new EventEmitter(),res=new EventEmitter()
 res.headersSent=false;res.writableEnded=false;res.chunks=[]
 res.writeHead=(code,headers)=>{res.headersSent=true;res.status=code;res.headers=headers}
 res.write=chunk=>{res.chunks.push(Buffer.from(chunk).toString());return true}
 res.end=()=>{if(res.writableEnded)return;res.writableEnded=true;res.emit('close')}
 return {req,res}
}
test('stream relays only authorized event stream, then aborts and ends its socket',async()=>{
 const {req,res}=pair()
 let signal
 const stream=new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode('event: communication.closed\\ndata: {}\\n\\n'))
  controller.close()
 }})
 await relayMobileCommunicationStream(token,interactionId,{req,res,fetcher:async(url,opts)=>{
  assert.equal(String(url),'https://api.tuverso.integra-b2g.com/api/v1/conversations/'+interactionId+'/stream')
  assert.equal(opts.headers.Authorization,'Bearer '+token)
  assert.equal(opts.headers.Cookie,undefined)
  assert.equal(opts.headers.Origin,undefined)
  signal=opts.signal
  return new Response(stream,{status:200,headers:{'Content-Type':'text/event-stream'}})
 }})
 assert.equal(res.status,200)
 assert.equal(res.writableEnded,true)
 assert.equal(signal.aborted,true)
 assert.match(res.chunks.join(''),'communication.closed')
 assert.equal(req.listenerCount('aborted'),0)
 assert.equal(res.listenerCount('close'),0)
})
test('client disconnect cancels the remote reader and upstream request',async()=>{
 const {req,res}=pair()
 let signal,cancelled=false
 const stream=new ReadableStream({start(controller){
  controller.enqueue(new TextEncoder().encode(': alive\\n\\n'))
 },cancel(){cancelled=true}})
 const work=relayMobileCommunicationStream(token,interactionId,{req,res,fetcher:async(_url,opts)=>{
  signal=opts.signal
  return new Response(stream,{status:200,headers:{'Content-Type':'text/event-stream'}})
 }})
 await new Promise(resolve=>setImmediate(resolve))
 res.emit('close')
 await work
 assert.equal(signal.aborted,true)
 assert.equal(cancelled,true)
 assert.equal(req.listenerCount('aborted'),0)
 assert.equal(res.listenerCount('close'),0)
})
test('rejects invalid bearer or interaction ID before opening a stream',async()=>{
 const {req,res}=pair()
 let calls=0
 const fetcher=async()=>{calls++;throw Error('NETWORK MUST NOT BE ACCESSED')}
 await assert.rejects(()=>relayMobileCommunicationStream('invalid',interactionId,{req,res,fetcher}))
 await assert.rejects(()=>relayMobileCommunicationStream(token,'../other',{req,res,fetcher}))
 assert.equal(calls,0)
})
