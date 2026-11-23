import {createHash,timingSafeEqual} from 'node:crypto'
import {decryptCredential} from './integration-crypto.mjs'
import {checkAvailability,connectionMode} from './tuverso-client.mjs'
import {createMobileInteraction,readMobileInteraction,readMobileInteractionMessages,sendMobileInteractionMessage,mobileInteractionMode} from './tuverso-mobile-connector.mjs'
import {calculateOrderCart} from './mobile-order-availability.mjs'
import {bindPersonalDevice,beginCheckoutPayment,readCheckoutPayment,closeCheckoutPayment,checkoutSessionState} from './mobile-checkout-followups.mjs'

const VALID_UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const APP=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/
const fail=(code,message)=>Object.assign(new Error(message),{code})
const validText=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value)
const plainObject=value=>value&&typeof value==='object'&&!Array.isArray(value)
const safeError=error=>Number.isInteger(error?.code)&&error.code>=400&&error.code<=599?error.code:503
// Only upstream TU VERSO can confirm a scope failure. Never rely on cached scopes.
const remoteAuthStatus=remote=>[401,403].includes(remote?.httpStatus)?remote.httpStatus:503
const counter=new Map()
const CANCEL_NOTICE='[Pollos B3 · Sistema] El cliente decidió modificar los productos. Esta solicitud de compra queda cancelada; no preparar ni cobrar. El asesor puede cerrar la atención.'
const CANCEL_PURCHASE_NOTICE='[Pollos B3 · Sistema] El cliente canceló su compra antes del pago. Esta solicitud queda cancelada; no preparar ni cobrar. El asesor puede cerrar la atención.'
const reference=(tenantId,appId,storeId,key)=>'mobile:'+createHash('sha256').update([tenantId,appId,storeId,key].join(':')).digest('hex').slice(0,48)
const orderMessageIdempotency=(key,interactionId)=>{
 const bytes=createHash('sha256').update('b3-order-text:'+key+':'+interactionId).digest().subarray(0,16)
 bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128
 const hex=bytes.toString('hex')
 return [hex.slice(0,8),hex.slice(8,12),hex.slice(12,16),hex.slice(16,20),hex.slice(20)].join('-')
}
const equals=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&
 timingSafeEqual(Buffer.from(a),Buffer.from(b))
// Retained only to recognize in-flight TEXT messages sent before the FORM cutover.
function normalizeCustomer(input){
 if(input===undefined)return null // Backward compatibility for already-issued clients.
 if(!plainObject(input)||Object.keys(input).some(k=>!['firstName','lastName','phone','email','phoneVerified','emailVerified','address','district','reference','mode'].includes(k))||
    input.mode!=='delivery'||!validText(input.firstName,60)||input.firstName.trim().length<2||
    !validText(input.lastName,60)||input.lastName.trim().length<2||
    typeof input.phone!=='string'||!/^9[0-9]{8}$/.test(input.phone)||
    !validText(input.address,180)||input.address.trim().length<6||
    !validText(input.district,80)||input.district.trim().length<2||
    (input.reference!==undefined&&(typeof input.reference!=='string'||input.reference.length>180||
      /[\x00-\x1f]/.test(input.reference)))||
    (input.email!==undefined&&(typeof input.email!=='string'||input.email.length>254||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email)))||
    (input.phoneVerified!==undefined&&input.phoneVerified!==false)||
    (input.emailVerified!==undefined&&input.emailVerified!==false))throw fail(400,'Datos de contacto o dirección inválidos')
 return {firstName:input.firstName.trim(),lastName:input.lastName.trim(),
  phone:input.phone,email:input.email?.trim().toLowerCase(),
  phoneVerified:false,emailVerified:false,address:input.address.trim(),district:input.district.trim(),
  reference:(input.reference||'').trim()}
}
function orderSummaryText(cart,store,customer){
 if(!customer)return cart.summary
 const message=[
  'POLLOS B3 - SOLICITUD DE VALIDACION',
  'Sede consultada: '+String(store.name||'Sede').trim(),
  'Cliente (datos ingresados, no verificados): '+customer.firstName+' '+customer.lastName,
  'Celular: +51 '+customer.phone,
  'Modalidad: Delivery',
  'Direccion: '+customer.address,
  'Distrito: '+customer.district,
  ...(customer.reference?['Referencia: '+customer.reference]:[]),
  'PRODUCTOS: '+cart.summary.replace(/^Solicitud de validación de pedido: /,'').replace(/\. Subtotal [0-9]+\.[0-9]{2}\.$/,''),
  'Subtotal productos: S/ '+cart.subtotal.toFixed(2),
  'Costo delivery: pendiente tras aceptacion (no cobrar)',
  'Estado: PENDIENTE DE VALIDACION',
  'Verificar productos y responder SOLO: aceptado o rechazado.'
 ].join('\n')
 // TU VERSO supports 8000 characters per conversation message. Never truncate silently.
 if(message.length>8000)throw fail(422,'El detalle del pedido supera el limite de texto permitido. Reduce los productos o la longitud de los datos.')
 return message
}
// The Android payload contains IDs and quantities, never a trusted FORM.
// Build the 1–5 structured fields exclusively from the published catalog and
// the normalized, unverified customer profile. Never truncate order details.
function orderForm(cart,store,customer){
 const prefix='Solicitud de validación de pedido: '
 const suffix='. Subtotal '+cart.subtotal.toFixed(2)+'.'
 if(!cart.summary.startsWith(prefix)||!cart.summary.endsWith(suffix))
  throw fail(422,'No se pudo reconstruir el detalle del catálogo')
 let remaining=cart.summary.slice(prefix.length,-suffix.length)
 const products=[]
 while(remaining.length>500&&products.length<2){
  const delimiter=remaining.lastIndexOf(', ',500)
  const split=delimiter>=100?delimiter:500
  products.push(remaining.slice(0,split).trim())
  remaining=remaining.slice(split+(split===delimiter?2:0)).trim()
 }
 products.push(remaining.trim())
 if(products.length>2||products.some(part=>!part||part.length>500))
  throw fail(422,'El pedido supera el límite de información del formulario. Reduce los productos.')
 const form={
  title:'POLLOS B3 - SOLICITUD DE VALIDACION',
  subtitle:'Subtotal productos: S/ '+cart.subtotal.toFixed(2)+'. Delivery pendiente. No preparar ni cobrar antes de la confirmación.',
  fields:[
   {variable:'Sede',value:String(store.name||'Sede').trim()},
   {variable:'Cliente',value:customer.firstName+' '+customer.lastName+' · +51 '+customer.phone+' (sin verificar)'+(customer.email?' · '+customer.email:'')},
   {variable:'Entrega',value:'Delivery · '+customer.address+' · '+customer.district+(customer.reference?' · Ref.: '+customer.reference:'')},
   ...products.map((value,index)=>({variable:products.length===1?'Productos':'Productos ('+(index+1)+'/2)',value})),
  ],
 }
 if(form.fields.some(item=>!item.value.trim()||item.value.trim().length>500))
  throw fail(422,'La información de la solicitud supera el tamaño permitido del formulario')
 return form
}
// A client-authored FORM is informational only: it never supplies authoritative prices,
// store availability, fulfillment status or an approval decision.
function validClientForm(value){
 if(!plainObject(value)||Object.keys(value).some(key=>!['title','subtitle','fields'].includes(key))||
    !validText(value.title,180)||
    value.subtitle!==undefined&&(typeof value.subtitle!=='string'||value.subtitle.length>350||
     /[\x00-\x1f\x7f]/.test(value.subtitle))||
    !Array.isArray(value.fields)||value.fields.length<1||value.fields.length>5)return false
 const names=new Set()
 for(const row of value.fields){
  if(!plainObject(row)||Object.keys(row).some(k=>!['variable','value'].includes(k))||
     !validText(row.variable,80)||!validText(row.value,500)||
     /[\x7f]/.test(row.variable)||/[\x7f]/.test(row.value))return false
  const label=row.variable.trim().toLowerCase()
  if(names.has(label))return false
  names.add(label)
 }
 return true
}
function throttled(req){
 const key=req.socket?.remoteAddress||'unknown',now=Date.now()
 if(counter.size>5000)counter.clear()
 const current=counter.get(key)
 const max=req.method==='GET'?60:10
 if(!current||now-current.since>=60000){counter.set(key,{since:now,count:1});return}
 if(++current.count>max)throw fail(429,'Demasiadas solicitudes; vuelve a intentarlo más tarde')
}
function publicStore(payload,storeId){
 const store=payload?.stores?.find(store=>store.id===storeId)
 if(!store||store.active===false||store.consultOrderAvailability!==true)throw fail(409,'La sede no está habilitada para consultar atención')
 return store
}
function authorizedHour(store,storeOpen){
 if(!storeOpen(store))throw fail(409,'La sede no está abierta o habilitada')
}
export function createMobileTuVersoRoutes({pool,body,json,storeOpen,
 availability=checkAvailability,createInteraction=createMobileInteraction,
 readInteraction=readMobileInteraction,readMessages=readMobileInteractionMessages,
 sendMessage=sendMobileInteractionMessage,decrypt=decryptCredential,
 checkMode=connectionMode,interactionMode=mobileInteractionMode,rateLimit=throttled}){
 async function context(appId,storeId,requireOpen=true){
  const result=await pool.query(`SELECT p.tenant_id,p.revision,p.payload
   FROM published_catalogs p
   JOIN mobile_apps a ON a.app_id=p.app_id AND a.tenant_id=p.tenant_id
   JOIN tenants t ON t.id=p.tenant_id
   WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[appId])
  if(result.rowCount!==1)throw fail(409,'Aplicación sin catálogo publicado')
  const catalog=result.rows[0]
  const store=publicStore(catalog.payload,storeId)
  if(requireOpen)authorizedHour(store,storeOpen)
  if(!requireOpen)return {tenantId:catalog.tenant_id,revision:catalog.revision,payload:catalog.payload,store}
  const live=await pool.query(`SELECT s.active,s.delivery_enabled,s.opening_hours,t.time_zone
   FROM stores s JOIN tenants t ON t.id=s.tenant_id
   WHERE s.tenant_id=$1 AND s.id=$2 AND t.active=true`,[catalog.tenant_id,storeId])
  if(live.rowCount!==1||!live.rows[0].active||!live.rows[0].delivery_enabled||!storeOpen({
   ...store,openingHours:live.rows[0].opening_hours
  },live.rows[0].time_zone))throw fail(409,'La sede ya no está abierta o habilitada')
  return {tenantId:catalog.tenant_id,revision:catalog.revision,payload:catalog.payload,store}
 }
 async function binding(tenantId,appId,storeId){
  const result=await pool.query(`SELECT i.id AS integration_id,i.encrypted_credential,i.expires_at,i.suspended,
    i.channel_type,b.id AS binding_id,b.external_location_id,b.purpose
    FROM integration_bindings b JOIN tenant_integrations i
    ON i.id=b.integration_id AND i.tenant_id=b.tenant_id
    WHERE b.tenant_id=$1 AND b.app_id=$2 AND b.store_id=$3
    AND b.purpose='ORDER_REQUEST' AND b.authorization_confirmed_at IS NOT NULL
    ORDER BY i.id`,[tenantId,appId,storeId])
  if(result.rowCount!==1)throw fail(409,'La sede no tiene una integración única y autorizada')
  const row=result.rows[0]
  // Local tenant/app/store binding, suspension and credential remain mandatory.
  // Historical scopes stored here are NOT effective permissions: TU VERSO
  // authorizes the operation from the bearer, entitlement and real scope.
  if(row.suspended||!row.encrypted_credential||row.expires_at&&new Date(row.expires_at)<=new Date()||
     row.channel_type&&row.channel_type!=='MOBILE_APP')
    throw fail(409,'La conexión no está activa o carece de credencial válida')
  return {...row,token:decrypt(row.encrypted_credential,tenantId,row.integration_id)}
 }
 return async function route({req,res,url}){
  const match=url.pathname.match(/^\/api\/v1\/mobile\/stores\/([0-9a-f-]{36})\/agent-availability$/i)
  const creating=url.pathname==='/api/v1/mobile/interactions'
  const statusMatch=url.pathname.match(/^\/api\/v1\/mobile\/interactions\/([0-9a-f-]{36})\/(status|cancel|device|payment)$/i)
  const messageMatch=url.pathname.match(/^\/api\/v1\/mobile\/interactions\/([0-9a-f-]{36})\/message$/i)
  if(!match&&!creating&&!statusMatch&&!messageMatch)return false
  try{
   rateLimit(req)
   if(match){
    if(req.method!=='GET')throw fail(405,'Método no permitido')
    const storeId=match[1],appId=url.searchParams.get('appId')
    if(!VALID_UUID.test(storeId)||!APP.test(appId||''))throw fail(400,'Sede o aplicación inválida')
    const ctx=await context(appId,storeId)
    if(checkMode()==='DISABLED')throw fail(503,'Consulta de TU VERSO no habilitada')
    const integration=await binding(ctx.tenantId,appId,storeId)
    const result=await availability(integration.token,{external_location_id:integration.external_location_id,purpose:'ORDER_REQUEST',id:integration.binding_id})
    if(result.result!=='AVAILABLE'&&result.result!=='UNAVAILABLE')throw fail(remoteAuthStatus(result),'No se pudo comprobar la disponibilidad')
    return json(res,200,{storeId,status:result.result,available:result.result==='AVAILABLE',checkedAt:result.providerCheckedAt??result.checkedAt,reservation:false})
   }
   if(statusMatch){
    const interactionId=statusMatch[1],operation=statusMatch[2]
    if(req.method!==(operation==='status'?'GET':'POST')&&!(operation==='payment'&&req.method==='GET'))throw fail(405,'Método no permitido')
    const input=(operation==='status'||operation==='payment'&&req.method==='GET')?Object.fromEntries(url.searchParams):await body(req)
    if(!plainObject(input)||Object.keys(input).some(k=>!['appId','storeId','fcmToken','reason'].includes(k))||
       (operation!=='device'&&input.fcmToken!==undefined)||
       (operation!=='cancel'&&input.reason!==undefined)||
       !APP.test(input.appId||'')||!VALID_UUID.test(input.storeId||''))throw fail(400,'Identificadores de seguimiento inválidos')
    const access=req.headers['x-order-access-key']
    if(!VALID_UUID.test(access||''))throw fail(403,'Clave de seguimiento inválida')
    const ctx=await context(input.appId,input.storeId,false)
    const owner={interactionId,tenantId:ctx.tenantId,appId:input.appId,storeId:input.storeId,accessKey:access}
    // A cancelled B3 order stays locally closed without polling upstream or
    // delivering new messages, independently of TU VERSO availability.
    const closed=await checkoutSessionState(pool,owner)
    if(['CANCELLED','EXPIRED','FINISHED'].includes(closed)){
     if(operation==='status')return json(res,200,{interactionId,storeId:input.storeId,
      status:closed,agentMessages:[],messagesAvailable:false})
     if(operation==='cancel'&&closed==='CANCELLED')return json(res,200,{interactionId,status:'CANCELLED'})
     if(operation==='payment'&&req.method==='GET')return json(res,200,{status:closed,expiresAt:null})
     throw fail(409,'La solicitud ya se cerró y no admite más operaciones')
    }
    if(interactionMode()!=='LIVE')throw fail(503,'Seguimiento de TU VERSO no disponible')
    const integration=await binding(ctx.tenantId,input.appId,input.storeId)
    const expected=reference(ctx.tenantId,input.appId,input.storeId,access)
    const remote=await readInteraction(integration.token,interactionId)
    if(!remote.ok)throw fail(remote.httpStatus===404?404:remoteAuthStatus(remote),'No se pudo consultar la interacción')
    if(!equals(remote.data?.externalReference,expected)||
       remote.data?.externalLocationId!==integration.external_location_id||
       remote.data?.purpose!=='ORDER_REQUEST')throw fail(403,'Seguimiento no autorizado')
    if(operation==='device')return json(res,200,await bindPersonalDevice(pool,owner,input.fcmToken))
    if(operation==='payment'){
     const data=req.method==='GET'?await readCheckoutPayment(pool,owner):await beginCheckoutPayment(pool,owner)
     return json(res,200,data)
    }
    // A canonical MOBILE_APP conversation may be closed before the customer
    // presses Cancel. Do not attempt to send a message into an already closed chat.
    const operationalConversationStatus=remote.data?.operationalConversationStatus
    if(operation==='cancel'&&['CLOSED','RESOLVED'].includes(operationalConversationStatus)){
     await closeCheckoutPayment(pool,owner)
     return json(res,200,{interactionId,status:'CANCELLED'})
    }
    const history=await readMessages(integration.token,interactionId)
    // Interaction status and conversation history are independent requests.
    // For a read-only poll, a transient history failure must not make a
    // successfully identified interaction look lost or rejected to Android.
    const messagesAvailable=history.ok===true&&history.data?.interactionId===interactionId
    if(!messagesAvailable&&operation==='cancel')
      throw fail(503,'No se pudo verificar la conversación antes de cancelar')
    const messages=messagesAvailable?history.data.messages:[]
    const cancelled=messages.some(m=>m.direction==='INBOUND'&&(m.text===CANCEL_NOTICE||m.text===CANCEL_PURCHASE_NOTICE))
    if(operation==='cancel'){
     if(cancelled){await closeCheckoutPayment(pool,owner);return json(res,200,{interactionId,status:'CANCELLED'})}
     if(remote.data.status==='EXPIRED')throw fail(409,'La interacción ya expiró')
     const sent=await sendMessage(integration.token,interactionId,{idempotencyKey:access,text:input.reason==='CANCEL'?CANCEL_PURCHASE_NOTICE:CANCEL_NOTICE})
     if(!sent.ok)throw fail(sent.httpStatus===409?409:remoteAuthStatus(sent),'No se pudo notificar la cancelación')
     await closeCheckoutPayment(pool,owner)
     return json(res,200,{interactionId,status:'CANCELLED'})
    }
    if(cancelled){
     await closeCheckoutPayment(pool,owner)
     return json(res,200,{interactionId,storeId:input.storeId,
      status:'CANCELLED',agentMessages:[],messagesAvailable:false})
    }
    // Relay verified conversation facts only. Android owns decision parsing, store
    // fallback and delivery-quote progression; the Administrator never decides.
    const agentMessages=messages.filter(message=>message.direction==='OUTBOUND')
     .map(message=>({id:message.id,text:message.text,createdAt:message.createdAt}))
    return json(res,200,{interactionId,storeId:input.storeId,
     status:remote.data.status,agentMessages,messagesAvailable,
     ...(['CLOSED','RESOLVED'].includes(operationalConversationStatus)?
      {operationalConversationStatus}:{})})
   }
   if(messageMatch){
    if(req.method!=='POST')throw fail(405,'Método no permitido')
    if(interactionMode()!=='LIVE')throw fail(503,'Mensajes de TU VERSO no habilitados')
    const interactionId=messageMatch[1],access=req.headers['x-order-access-key']
    if(!VALID_UUID.test(access||''))throw fail(403,'Clave de seguimiento inválida')
    const input=await body(req)
    const requestedType=input?.type
    // Pre-existing Android clients sent an order body without type. They remain
    // TEXT for backward compatibility; new clients must select TEXT or FORM.
    const type=requestedType===undefined?'TEXT':requestedType
    const freeText=type==='TEXT'&&input?.text!==undefined
    const directForm=type==='FORM'&&input?.form!==undefined
    const orderKeys=['appId','storeId','type','quoteRevision','catalogRevision','customerExternalId','items','customer']
    const textKeys=['appId','storeId','type','text']
    const formKeys=['appId','storeId','type','form']
    const rawMessageKey=req.headers['idempotency-key']
    const independentMessage=freeText||directForm
    const independentKeyValid=VALID_UUID.test(rawMessageKey||'')&&rawMessageKey!==access&&
     rawMessageKey!==orderMessageIdempotency(access,interactionId)
    if(!plainObject(input)||!['TEXT','FORM'].includes(type)||
       !APP.test(input.appId)||!VALID_UUID.test(input.storeId)||
       Object.keys(input).some(k=>!(directForm?formKeys:freeText?textKeys:orderKeys).includes(k))||
       (directForm?(
         requestedType!=='FORM'||!independentKeyValid||!validClientForm(input.form)
       ):freeText?(
         requestedType!=='TEXT'||typeof input.text!=='string'||!input.text.trim()||
         input.text.length>8000||/[\x00-\x09\x0b-\x1f]/.test(input.text)||
         !independentKeyValid
       ):(
         input.quoteRevision!==undefined&&input.catalogRevision!==undefined||
         !Number.isSafeInteger(input.catalogRevision??input.quoteRevision)||
         (input.catalogRevision??input.quoteRevision)<1||
         !validText(input.customerExternalId,180)
       )))
      throw fail(400,'Mensaje MOBILE_APP inválido para el tipo solicitado')
    // The structured order remains server-derived. A separately supplied
    // FORM is displayed literally but can never authorize an order or price.
    const ctx=await context(input.appId,input.storeId,false)
    const session=await checkoutSessionState(pool,{interactionId,tenantId:ctx.tenantId,
     appId:input.appId,storeId:input.storeId,accessKey:access})
    if(['CANCELLED','EXPIRED','FINISHED'].includes(session))
     throw fail(409,'La solicitud ya está cerrada; no se enviarán más mensajes')
    let text,form,legacyText
    if(freeText){
     text=input.text
    }else if(directForm){
     form={
      title:input.form.title.trim(),
      ...(input.form.subtitle!==undefined?{subtitle:input.form.subtitle.trim()}:{}),
      fields:input.form.fields.map(row=>({variable:row.variable.trim(),value:row.value.trim()})),
     }
    }else{
     if(ctx.revision!==(input.catalogRevision??input.quoteRevision))
       throw fail(409,'El catálogo cambió: no se puede enviar un detalle de otra revisión')
     const cart=calculateOrderCart(ctx.payload.products,input.items)
     const customer=normalizeCustomer(input.customer)
     if(!customer)throw fail(400,'Faltan datos del cliente para enviar el pedido')
     legacyText=orderSummaryText(cart,ctx.store,customer)
     if(type==='FORM')form=orderForm(cart,ctx.store,customer)
     else text=legacyText
    }
    const integration=await binding(ctx.tenantId,input.appId,input.storeId)
    const remote=await readInteraction(integration.token,interactionId)
    if(!remote.ok)throw fail(remote.httpStatus===404?404:remoteAuthStatus(remote),'No se pudo verificar la interacción')
    const expected=reference(ctx.tenantId,input.appId,input.storeId,access)
    if(!equals(remote.data?.externalReference,expected)||
       remote.data?.externalLocationId!==integration.external_location_id||
       remote.data?.purpose!=='ORDER_REQUEST')
      throw fail(403,'Interacción no autorizada para esta aplicación y sede')
    if(remote.data.status==='EXPIRED'||remote.data.status==='REJECTED')
      throw fail(409,'La solicitud ya no permite enviar mensajes')
    if(type==='FORM'){
      // Existing clients issue a second FORM after creation. When the first
      // message already is a FORM, return that receipt instead of sending a
      // duplicate. Read is scoped by the validated interaction + binding.
      // A failed lookup must never fall back to blind re-send.
      const existing=await readMessages(integration.token,interactionId)
      if(!existing.ok||existing.data?.interactionId!==interactionId)
        throw fail(503,'No se pudo comprobar el formulario existente')
      const initial=existing.data.messages?.find(row=>
        row.direction==='INBOUND'&&row.type==='FORM'&&VALID_UUID.test(row.id))
      if(initial)return json(res,200,{interactionId,delivered:true,
        messageId:initial.id,type:'FORM'})
    }
    const delivered=await sendMessage(integration.token,interactionId,
     type==='FORM'?{
      idempotencyKey:directForm?rawMessageKey:orderMessageIdempotency(access,interactionId),type:'FORM',form
     }:{
      idempotencyKey:independentMessage?rawMessageKey:orderMessageIdempotency(access,interactionId),
      type:'TEXT',text
     })
    // An already-delivered order TEXT from before the FORM cutover may hold
    // the same deterministic idempotency key. Never insert a duplicate FORM.
    // Never reinterpret an explicit TEXT request as an existing FORM.
    if(type==='FORM'&&!directForm&&!delivered.ok&&delivered.httpStatus===409){
     const history=await readMessages(integration.token,interactionId)
     const prior=history.ok&&history.data?.interactionId===interactionId&&
      history.data.messages.find(item=>item.direction==='INBOUND'&&
       item.text===legacyText&&VALID_UUID.test(item.id))
     if(prior)return json(res,200,{interactionId,delivered:true,messageId:prior.id,type:'TEXT'})
    }
    if(!delivered.ok||!VALID_UUID.test(delivered.data?.messageId||''))
      throw fail(delivered.httpStatus===409?409:remoteAuthStatus(delivered),'TU VERSO no confirmó el mensaje '+type)
    return json(res,200,{interactionId,delivered:true,messageId:delivered.data.messageId,type})
   }
   if(req.method!=='POST')throw fail(405,'Método no permitido')
   if(interactionMode()!=='LIVE'||checkMode()==='DISABLED')throw fail(503,'Interacciones TU VERSO no habilitadas')
   const input=await body(req)
   if(!plainObject(input)||Object.keys(input).some(key=>!['appId','storeId','quoteRevision','catalogRevision','customerExternalId','items','customer'].includes(key))||
      !APP.test(input.appId)||!VALID_UUID.test(input.storeId)||
      (input.quoteRevision!==undefined&&input.catalogRevision!==undefined)||
      !Number.isSafeInteger(input.catalogRevision??input.quoteRevision)||(input.catalogRevision??input.quoteRevision)<1||
      !validText(input.customerExternalId,180))throw fail(400,'Solicitud de interacción inválida')
   const idempotencyKey=req.headers['idempotency-key']
   if(!VALID_UUID.test(idempotencyKey||''))throw fail(400,'Idempotency-Key UUID obligatorio')
   const ctx=await context(input.appId,input.storeId)
   if(ctx.revision!==(input.catalogRevision??input.quoteRevision))throw fail(409,'El catálogo cambió: actualiza tu pedido')
   const cart=calculateOrderCart(ctx.payload.products,input.items)
   const customer=normalizeCustomer(input.customer)
   // A mobile checkout with customer details starts with ONE canonical FORM.
   // TU VERSO supports FORM atomically at POST /api/v1/interactions.
   // The old Android follow-up POST is retained for legacy requests only.
   const initialForm=customer?orderForm(cart,ctx.store,customer):undefined
   // Open promptly; an agent's response is checked with separate short GET requests.
   const listSummary=cart.summary.length<=1200?cart.summary:(
    customer?('Pedido de '+cart.items.length+' productos del catálogo. Subtotal S/ '+cart.subtotal.toFixed(2)+'. Revisar detalle en conversación.'):null)
   if(!listSummary)throw fail(422,'El resumen del pedido supera el limite permitido')
   const integration=await binding(ctx.tenantId,input.appId,input.storeId)
   // Do not precheck availability again here: a prior create may have succeeded
   // upstream before its HTTP acknowledgement was lost, and the assigned agent
   // may now occupy the last available slot. Android has already checked capacity.
   // TU VERSO remains authoritative for actual create admission and idempotency.
   // Replays must reach the same upstream idempotency key.
   // Stable upstream reference for retries. The public caller cannot set location, queue, price or summary.
   const externalReference=reference(ctx.tenantId,input.appId,input.storeId,idempotencyKey)
   const result=await createInteraction(integration.token,{external_location_id:integration.external_location_id,purpose:'ORDER_REQUEST'},{
    customerExternalId:input.customerExternalId,externalReference,summary:listSummary,idempotencyKey,
     ...(customer?{customer:{firstName:customer.firstName,lastName:customer.lastName,
      phone:'+51'+customer.phone,...(customer.email?{email:customer.email}:{}),
      phoneVerified:false,emailVerified:false}}:{}),
     ...(initialForm?{type:'FORM',form:initialForm}:{})
   })
   if(!result.ok)throw fail(result.httpStatus===409?409:result.httpStatus===429?429:remoteAuthStatus(result),'TU VERSO no pudo iniciar la solicitud')
   if(result.data?.externalReference!==externalReference||result.data?.externalLocationId!==integration.external_location_id||
      result.data?.purpose!=='ORDER_REQUEST')throw fail(503,'Respuesta de TU VERSO no corresponde a la sede autorizada')
   return json(res,result.httpStatus===201?201:200,{interactionId:result.data.interactionId,status:result.data.status,storeId:input.storeId,externalReference:result.data.externalReference,
     ...(initialForm?{formIncluded:true}:{})})
  }catch(error){
   const status=safeError(error)
   return json(res,status,{error:status===503?'Operación temporalmente no disponible':error.message})
  }
 }
}
