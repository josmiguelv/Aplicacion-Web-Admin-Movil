import {createHash,timingSafeEqual} from 'node:crypto'
import {WebSocketServer,WebSocket} from 'ws'
import {decryptCredential} from './integration-crypto.mjs'
import {readMobileInteraction,pollMobileInteractionEvents} from './tuverso-mobile-connector.mjs'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const APP=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/
const PATH=/^\/api\/v1\/mobile\/interactions\/([0-9a-f-]{36})\/events\/ws$/i
const PERIOD_MS=3000
const MAX_CLIENTS=40
const MAX_IP_CLIENTS=3
const MAX_GROUPS=12
const MAX_EVENTS=100
const eq=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&
 timingSafeEqual(Buffer.from(a),Buffer.from(b))
const externalReference=(tenant,app,store,key)=>'mobile:'+createHash('sha256')
 .update([tenant,app,store,key].join(':')).digest('hex').slice(0,48)
const failure=(socket,status)=>{if(socket.destroyed)return;socket.write(
 `HTTP/1.1 ${status} \r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);socket.destroy()}
const send=(client,payload)=>{if(client.readyState===WebSocket.OPEN&&client.bufferedAmount<8192)
 client.send(JSON.stringify(payload))}
 
// Notification-only bridge. The existing REST status endpoint remains authoritative.
// TU VERSO is never modified and the Administrator does not parse advisor answers.
export function attachMobileInteractionWebSocket(server,{pool,decrypt=decryptCredential,
 readInteraction=readMobileInteraction,pollEvents=pollMobileInteractionEvents,
 enabled=()=>process.env.B3_MOBILE_WS_ENABLED==='true',intervalMs=PERIOD_MS}={}){
 const wsServer=new WebSocketServer({noServer:true,maxPayload:1024,perMessageDeflate:false,clientTracking:false})
 const subscriptions=new Set()
 const groups=new Map()
 let shutdown=false
 function detach(client){
  const item=[...subscriptions].find(x=>x.client===client)
  if(!item)return
  subscriptions.delete(item)
  const group=groups.get(item.group)
  group?.clients.delete(item)
  if(group&&!group.clients.size){clearInterval(group.timer);groups.delete(item.group)}
 }
 async function tick(group){
  if(group.running||shutdown)return
  group.running=true
  try{
   let rounds=0
   do{
    const result=await pollEvents(group.token,{after:group.cursor,limit:MAX_EVENTS})
    if(!result.ok){
     if([401,403].includes(result.httpStatus)){
      for(const item of group.clients)item.client.close(1008,'Subscription revoked')
     }
     return
    }
    const page=result.data
    for(const event of page.events){
     // Never invent ACCEPTED/REJECTED from a FORM response: Android interprets REST.
     if(group.ready&&['MESSAGE_OUTBOUND','REQUEST_ACCEPTED','REQUEST_REJECTED'].includes(event.kind)){
      for(const item of group.clients)if(item.interactionId===event.interactionId&&
       !item.sent.has(event.id)){
       item.sent.add(event.id)
       if(item.sent.size>100)item.sent.delete(item.sent.values().next().value)
       send(item.client,{type:'INTERACTION_UPDATED',interactionId:event.interactionId,
        eventId:event.id,occurredAt:event.createdAt})
      }
     }
    }
    if(page.nextCursor)group.cursor=page.nextCursor
    if(!page.hasMore||!page.events.length){group.ready=true;break}
    rounds++
   }while(rounds<4)
  }catch{
   // An upstream outage must not change an order or the existing REST path.
  }finally{group.running=false}
 }
 async function authorize(req,interactionId,appId,storeId,access){
  const catalog=await pool.query(`SELECT p.tenant_id,p.payload FROM published_catalogs p
   JOIN mobile_apps a ON a.app_id=p.app_id AND a.tenant_id=p.tenant_id
   JOIN tenants t ON t.id=p.tenant_id
   WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[appId])
  if(catalog.rowCount!==1||!catalog.rows[0].payload?.stores?.some(s=>s.id===storeId&&s.active!==false&&s.consultOrderAvailability===true))return null
  const tenant=catalog.rows[0].tenant_id
  const records=await pool.query(`SELECT i.id AS integration_id,i.encrypted_credential,i.expires_at,i.suspended,
   i.channel_type,b.external_location_id,b.purpose
   FROM integration_bindings b JOIN tenant_integrations i
   ON i.id=b.integration_id AND i.tenant_id=b.tenant_id
   WHERE b.tenant_id=$1 AND b.app_id=$2 AND b.store_id=$3
   AND b.purpose='ORDER_REQUEST' AND b.authorization_confirmed_at IS NOT NULL`,[tenant,appId,storeId])
  if(records.rowCount!==1)return null
  const row=records.rows[0]
  if(row.suspended||!row.encrypted_credential||row.expires_at&&new Date(row.expires_at)<=new Date()||
   row.channel_type&&row.channel_type!=='MOBILE_APP')return null
  const token=decrypt(row.encrypted_credential,tenant,row.integration_id)
  const remote=await readInteraction(token,interactionId)
  if(!remote.ok||!eq(remote.data?.externalReference,externalReference(tenant,appId,storeId,access))||
   remote.data?.externalLocationId!==row.external_location_id||remote.data?.purpose!=='ORDER_REQUEST')return null
  return {tenant,integrationId:row.integration_id,token}
 }
 async function upgrade(req,socket,head){
  if(shutdown||!enabled())return failure(socket,'404 Not Found')
  let url
  try{url=new URL(req.url,'http://localhost')}catch{return failure(socket,'400 Bad Request')}
  const match=PATH.exec(url.pathname)
  if(!match)return failure(socket,'404 Not Found')
  const interactionId=match[1],appId=url.searchParams.get('appId'),storeId=url.searchParams.get('storeId')
  const access=req.headers['x-order-access-key']
  if(!UUID.test(interactionId)||!APP.test(appId||'')||!UUID.test(storeId||'')||
   !UUID.test(access||'')||[...url.searchParams.keys()].some(k=>!['appId','storeId'].includes(k))||
   req.headers.origin||req.headers.cookie||req.headers.authorization)
   return failure(socket,'403 Forbidden')
  const secure=req.socket.encrypted===true||req.headers['x-forwarded-proto']==='https'
  if(process.env.NODE_ENV==='production'&&!secure)return failure(socket,'403 Forbidden')
  const ip=req.socket.remoteAddress||'unknown'
  if(subscriptions.size>=MAX_CLIENTS||
   [...subscriptions].filter(x=>x.ip===ip).length>=MAX_IP_CLIENTS)return failure(socket,'429 Too Many Requests')
  let identity
  try{identity=await authorize(req,interactionId,appId,storeId,access)}catch{return failure(socket,'503 Service Unavailable')}
  if(!identity)return failure(socket,'403 Forbidden')
  if(socket.destroyed||shutdown)return
  const groupKey=identity.tenant+':'+identity.integrationId
  if(!groups.has(groupKey)&&groups.size>=MAX_GROUPS)return failure(socket,'429 Too Many Requests')
  wsServer.handleUpgrade(req,socket,head,client=>{
   const item={client,interactionId,ip,group:groupKey,sent:new Set()}
   subscriptions.add(item)
   let group=groups.get(groupKey)
   if(!group){
    group={token:identity.token,cursor:null,ready:false,running:false,clients:new Set(),timer:null}
    groups.set(groupKey,group)
    group.timer=setInterval(()=>{void tick(group)},intervalMs)
    group.timer.unref?.()
    void tick(group)
   }
   group.clients.add(item)
   // REST reconciliation on connection prevents lost updates during offline periods.
   send(client,{type:'INTERACTION_SYNC_REQUIRED',interactionId})
   client.on('message',()=>client.close(1008,'Read-only channel'))
   client.on('close',()=>detach(client))
   client.on('error',()=>detach(client))
   client.isAlive=true
   client.on('pong',()=>{client.isAlive=true})
  })
 }
 const onUpgrade=(req,socket,head)=>{
  let url
  try{url=new URL(req.url,'http://localhost')}catch{return}
  if(!PATH.test(url.pathname))return
  socket.on('error',()=>{})
  void upgrade(req,socket,head)
 }
 server.on('upgrade',onUpgrade)
 const heartbeat=setInterval(()=>{
  for(const item of subscriptions){
   if(!item.client.isAlive){item.client.terminate();detach(item.client);continue}
   item.client.isAlive=false
   item.client.ping()
  }
 },25000)
 heartbeat.unref?.()
 return async function close(){
  shutdown=true;clearInterval(heartbeat);server.off('upgrade',onUpgrade)
  for(const item of subscriptions)item.client.terminate()
  for(const group of groups.values())clearInterval(group.timer)
  subscriptions.clear();groups.clear();wsServer.close()
 }
}
