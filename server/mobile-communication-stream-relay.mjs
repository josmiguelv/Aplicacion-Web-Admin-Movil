import {TUVERSO_BASE} from './tuverso-client.mjs'
import {normalizeTuVersoCredential} from './tuverso-credential-format.mjs'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * Per-interaction HTTP event-stream relay (SSE; not RFC6455 WebSocket).
 * TU VERSO credentials stay on this backend and are NEVER sent to Android.
 * A closed stream tears down the upstream reader/socket and this response.
 */
export async function relayMobileCommunicationStream(token,interactionId,{req,res,fetcher=fetch}){
 if(!UUID.test(interactionId)||!normalizeTuVersoCredential(token))throw Error('MOBILE_STREAM_AUTH_DENIED')
 const controller=new AbortController()
 let handshakeTimer=setTimeout(()=>controller.abort(),6000)
 let reader
 let closed=false
 const dispose=()=>{
  if(closed)return
  closed=true
  clearTimeout(handshakeTimer)
  req.off('aborted',dispose)
  res.off('close',dispose)
  controller.abort()
  if(reader)void reader.cancel().catch(()=>undefined)
  if(res.headersSent&&!res.writableEnded)res.end()
 }
 try{
  const response=await fetcher(new URL('/api/v1/conversations/'+interactionId+'/stream',TUVERSO_BASE),{
   method:'GET',redirect:'error',signal:controller.signal,
   headers:{Authorization:'Bearer '+token,Accept:'text/event-stream'},
  })
  clearTimeout(handshakeTimer)
  if(response.status!==200||!response.body||
     !response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream')){
   await response.body?.cancel()
   throw Error('TUVERSO_MOBILE_STREAM_UNAVAILABLE')
  }
  reader=response.body.getReader()
  if(!res.headersSent)res.writeHead(200,{
   'Content-Type':'text/event-stream; charset=utf-8',
   'Cache-Control':'no-cache, no-store',
   'Connection':'keep-alive',
   'X-Accel-Buffering':'no',
  })
  req.on('aborted',dispose)
  res.on('close',dispose)
  while(!closed){
   const part=await reader.read()
   if(part.done)break
   if(part.value.byteLength>16384||!res.write(part.value))break
  }
 }finally{dispose()}
}
