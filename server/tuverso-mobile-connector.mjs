import {TUVERSO_BASE} from './tuverso-client.mjs'
import {normalizeTuVersoCredential} from './tuverso-credential-format.mjs'

// Private backend-to-backend client; no TU VERSO bearer may enter the APK,
// browser, access logs, analytics, application config or URLs.
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const id=x=>typeof x==='string'&&uuid.test(x)
const field=(x,max)=>typeof x==='string'&&x.trim().length>0&&x.length<=max&&
  !/[\x00-\x1f]/.test(x)
const purpose=x=>typeof x==='string'&&/^[A-Z][A-Z0-9_]{0,79}$/.test(x)
const mode=()=>process.env.TUVERSO_LIVE_REQUESTS_ENABLED==='true'
const errors={400:'Solicitud inválida para TU VERSO.',401:'Clave, permisos o licencia rechazados.',
  403:'Acceso externo no autorizado.',404:'Solicitud no encontrada.',409:'La cola, el canal o la solicitud no están disponibles.',
  413:'Solicitud demasiado grande.',429:'Límite de solicitudes alcanzado.',503:'Recepción de solicitudes todavía deshabilitada.'}
const FAIL='No se pudo consultar TU VERSO; revisa conexión y disponibilidad.'
const maxResponse=16384

function authorizedTarget(){
 const testUrl=process.env.TUVERSO_INTERACTIONS_TEST_URL
 if(!testUrl)return TUVERSO_BASE
 if(process.env.NODE_ENV!=='test')throw Error('TUVERSO_TARGET_FORBIDDEN')
 const u=new URL(testUrl)
 if(u.protocol!=='http:'||u.hostname!=='127.0.0.1'||u.username||u.password||
    u.search||u.hash||u.pathname!=='/tuverso')throw Error('TUVERSO_TARGET_FORBIDDEN')
 return testUrl
}
const normalizeBinding=b=>{
 const location=b?.external_location_id??b?.externalLocationId
 if(!field(location,180)||!purpose(b?.purpose))throw Error('TUVERSO_BINDING_INVALID')
 return {externalLocationId:location,purpose:b.purpose}
}
function validCustomer(c){
 return c&&typeof c==='object'&&!Array.isArray(c)&&
  Object.keys(c).every(k=>['firstName','lastName','phone','email','phoneVerified','emailVerified'].includes(k))&&
  field(c.firstName,60)&&field(c.lastName,60)&&/^\+519\d{8}$/.test(c.phone)&&
  (c.email===undefined||(typeof c.email==='string'&&c.email.length<=254&&
   /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)))&&
  c.phoneVerified===false&&c.emailVerified===false
}
function validRequest(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['customerExternalId','externalReference','summary','idempotencyKey','customer'].includes(k))||
    !field(input.customerExternalId,180)||!field(input.externalReference,180)||
    !field(input.summary,1200)||!id(input.idempotencyKey)||
    (input.customer!==undefined&&!validCustomer(input.customer)))throw Error('TUVERSO_REQUEST_INVALID')
 return input
}
async function readBoundedJson(response){
 if(!response.body)return null
 const reader=response.body.getReader()
 const chunks=[];let size=0
 while(true){
  const {done,value}=await reader.read()
  if(done)break
  size+=value.byteLength
  if(size>maxResponse){await reader.cancel();throw Error('OVERSIZE')}
  chunks.push(value)
 }
 try{return JSON.parse(Buffer.concat(chunks).toString('utf8'))}catch{return null}
}
function sanitizedData(kind,json){
 const data=json?.data
 if(!data||typeof data!=='object'||Array.isArray(data))return null
 if(kind==='create'||kind==='read'){
  if(!id(data.interactionId)||!field(data.externalReference,180)||
   !['PENDING','ACCEPTED','REJECTED','EXPIRED'].includes(data.status)||!field(data.externalLocationId,180)||
   !purpose(data.purpose))return null
  return {interactionId:data.interactionId,externalReference:data.externalReference,
   externalLocationId:data.externalLocationId,purpose:data.purpose,status:data.status,
   estimatedMinutes:Number.isSafeInteger(data.estimatedMinutes)?data.estimatedMinutes:null,
   decisionReason:typeof data.decisionReason==='string'?data.decisionReason.slice(0,400):null,
    ...(kind==='read'&&['RESOLVED','CLOSED','OPEN'].includes(data.operationalConversationStatus)?
     {operationalConversationStatus:data.operationalConversationStatus}:{})}
 }
 if(kind==='events'){
  if(!Array.isArray(data.events)||data.events.length>100||
     data.events.some(e=>!id(e.id)||!id(e.interactionId)||
      !['REQUEST_CREATED','REQUEST_ACCEPTED','REQUEST_REJECTED','REQUEST_EXPIRED','MESSAGE_OUTBOUND','COMMUNICATION_CLOSED'].includes(e.kind))||
     data.nextCursor!==null&&data.nextCursor!==undefined&&!id(data.nextCursor)||
     typeof data.hasMore!=='boolean')return null
  return {events:data.events.map(e=>({id:e.id,interactionId:e.interactionId,kind:e.kind,
    createdAt:typeof e.createdAt==='string'?e.createdAt:null})),
   nextCursor:data.nextCursor??null,hasMore:data.hasMore}
 }
 if(kind==='close'){
  if(!id(data.interactionId)||!id(data.conversationId)||data.closed!==true||
     typeof data.replayed!=='boolean')return null
  return {interactionId:data.interactionId,conversationId:data.conversationId,
   closed:true,replayed:data.replayed}
 }
 if(kind==='message'){
  if(!id(data.messageId)||typeof data.created!=='boolean')return null
  return {messageId:data.messageId,created:data.created}
 }
 if(kind==='conversation'){
  if(!id(data.interactionId)||data.conversationId!==data.interactionId||
     !Array.isArray(data.messages)||data.messages.length>100||
     data.messages.some(m=>!id(m.id)||!['INBOUND','OUTBOUND'].includes(m.direction)||
       typeof m.text!=='string'||m.text.length>8000||typeof m.createdAt!=='string'))
    return null
  return {interactionId:data.interactionId,status:data.status,
    messages:data.messages.map(m=>({id:m.id,direction:m.direction,text:m.text,createdAt:m.createdAt})),
    hasMore:data.hasMore===true,nextCursor:typeof data.nextCursor==='string'?data.nextCursor:null}
 }
 return null
}
async function perform(token,kind,path,{method='GET',requestBody,idempotencyKey}={}){
 if(!mode())return {ok:false,errorCode:'REQUESTS_DISABLED',httpStatus:null}
 if(!normalizeTuVersoCredential(token))return {ok:false,errorCode:'CREDENTIAL_INVALID',httpStatus:null}
 const endpoint=new URL(authorizedTarget()+path)
 const controller=new AbortController()
 const timer=setTimeout(()=>controller.abort(),6000)
 try{
  const response=await fetch(endpoint,{
   method,signal:controller.signal,redirect:'error',
   headers:{Authorization:`Bearer ${token}`,Accept:'application/json',
    ...(method==='POST'?{'Content-Type':'application/json','Idempotency-Key':idempotencyKey}:{})},
   ...(method==='POST'?{body:JSON.stringify(requestBody)}:{}),
  })
  if(![200,201].includes(response.status)){
   await response.body?.cancel()
   return {ok:false,httpStatus:response.status,
    errorCode:'UPSTREAM_'+response.status,message:errors[response.status]??'Error de TU VERSO.'}
  }
  const result=sanitizedData(kind,await readBoundedJson(response))
  if(!result)return {ok:false,httpStatus:response.status,errorCode:'INVALID_RESPONSE',
    message:'La respuesta de TU VERSO no coincide con el contrato.'}
  return {ok:true,httpStatus:response.status,data:result}
 }catch{
  return {ok:false,httpStatus:null,errorCode:'CONNECTION_FAILED',message:FAIL}
 }finally{clearTimeout(timer)}
}
export async function createMobileInteraction(token,binding,input){
 const {externalLocationId,purpose:kind}=normalizeBinding(binding)
 const b=validRequest(input)
 return perform(token,'create','/api/v1/interactions',{method:'POST',idempotencyKey:b.idempotencyKey,
  requestBody:{externalLocationId,purpose:kind,customerExternalId:b.customerExternalId,
   externalReference:b.externalReference,summary:b.summary,
    ...(b.customer?{customer:b.customer}:{})}})
}
export async function readMobileInteraction(token,interactionId){
 if(!id(interactionId))throw Error('TUVERSO_INTERACTION_INVALID')
 return perform(token,'read','/api/v1/interactions/'+interactionId)
}
export async function readMobileInteractionMessages(token,interactionId){
 if(!id(interactionId))throw Error('TUVERSO_INTERACTION_INVALID')
 return perform(token,'conversation','/api/v1/conversations/'+interactionId+'?limit=100')
}
export async function pollMobileInteractionEvents(token,{after=null,limit=50}={}){
 if(after!==null&&!id(after)||!Number.isInteger(limit)||limit<1||limit>100)
  throw Error('TUVERSO_CURSOR_INVALID')
 const url=new URL('/api/v1/interactions/events',TUVERSO_BASE)
 if(after)url.searchParams.set('after',after)
 url.searchParams.set('limit',String(limit))
 return perform(token,'events',url.pathname+url.search)
}
// Mirrors TU VERSO PRE-F2/07: a FORM has no extra free-text body or buttons.
function validMobileForm(form){
 if(!form||typeof form!=='object'||Array.isArray(form)||
    Object.keys(form).some(k=>!['title','subtitle','fields'].includes(k)))return false
 if(typeof form.title!=='string'||!form.title.trim()||form.title.trim().length>180||
    form.subtitle!==undefined&&(typeof form.subtitle!=='string'||form.subtitle.trim().length>350)||
    !Array.isArray(form.fields)||form.fields.length>5)return false
 const labels=new Set()
 for(const entry of form.fields){
  if(!entry||typeof entry!=='object'||Array.isArray(entry)||
     Object.keys(entry).some(k=>!['variable','value'].includes(k))||
     typeof entry.variable!=='string'||!entry.variable.trim()||entry.variable.trim().length>80||
     typeof entry.value!=='string'||!entry.value.trim()||entry.value.trim().length>500)return false
  const key=entry.variable.trim().toLowerCase()
  if(labels.has(key))return false
  labels.add(key)
 }
 return true
}
export async function sendMobileInteractionMessage(token,interactionId,{idempotencyKey,text,type,form}){
 if(!id(interactionId)||!id(idempotencyKey))throw Error('TUVERSO_MESSAGE_INVALID')
 const isForm=type==='FORM'
 if(isForm){
  if(text!==undefined||!validMobileForm(form))throw Error('TUVERSO_FORM_INVALID')
 }else if(type!==undefined&&type!=='TEXT'||form!==undefined||
    typeof text!=='string'||!text.trim()||text.length>8000||
    /[\x00-\x09\x0b-\x1f]/.test(text)){
  // Preserve legacy free-text messages for cancellation and older clients.
  throw Error('TUVERSO_MESSAGE_INVALID')
 }
 return perform(token,'message',`/api/v1/conversations/${interactionId}/messages`,{
  method:'POST',idempotencyKey,
  requestBody:isForm?{type:'FORM',form}:type==='TEXT'?{type:'TEXT',text}:{text},
 })
}
/** Explicit S2S transport release; never sends text or closes agent capacity. */
export async function closeMobileInteractionCommunication(token,interactionId,{eventId,reason='CLIENT_CANCELLED'}){
 if(!id(interactionId)||!id(eventId)||!['CLIENT_ENDED','CLIENT_CANCELLED','FLOW_FINISHED'].includes(reason))
  throw Error('TUVERSO_COMMUNICATION_CLOSE_INVALID')
 return perform(token,'close',`/api/v1/conversations/${interactionId}/close`,{
  method:'POST',idempotencyKey:eventId,
  requestBody:{version:1,type:'CONVERSATION_CLOSE',eventId,interactionId,reason},
 })
}
export const mobileInteractionMode=()=>mode()?'LIVE':'DISABLED'
