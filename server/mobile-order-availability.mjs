import {createHash, randomUUID} from 'node:crypto'
import {decryptCredential} from './integration-crypto.mjs'
import {checkAvailability} from './tuverso-client.mjs'
import {createMobileInteraction, mobileInteractionMode, readMobileInteraction} from './tuverso-mobile-connector.mjs'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN=/^ordv1_[A-Za-z0-9_-]{43}$/
const APP=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/
const hash=value=>createHash('sha256').update(value).digest('hex')
const fail=(code,message)=>Object.assign(new Error(message),{code})
const text=(value,max)=>typeof value==='string'&&value.trim().length>0&&value.length<=max&&!/[\x00-\x1f]/.test(value)
const object=value=>value&&typeof value==='object'&&!Array.isArray(value)
const terminal=new Set(['READY_FOR_PAYMENT','UNAVAILABLE','VALIDATION_ERROR','CANCELLED'])

export function calculateOrderCart(products,items){
 if(!Array.isArray(items)||items.length<1||items.length>50)throw fail(400,'El pedido debe incluir entre 1 y 50 productos')
 const requested=new Map()
 for(const item of items){
  if(!object(item)||Object.keys(item).some(key=>!['productId','quantity'].includes(key))||!UUID.test(item.productId)||!Number.isInteger(item.quantity)||item.quantity<1||item.quantity>99)throw fail(400,'Producto o cantidad inválidos')
  requested.set(item.productId,(requested.get(item.productId)||0)+item.quantity)
 }
 const byId=new Map((products||[]).map(product=>[product.id,product]))
 let cents=0
 const descriptions=[]
 for(const [id,quantity] of requested){
  const product=byId.get(id),price=Number(product?.pricePen)
  if(!product||product.active===false||!Number.isFinite(price)||price<0)throw fail(409,'Un producto ya no está disponible en el catálogo publicado')
  const unitCents=Math.round((price+Number.EPSILON)*100)
  cents+=unitCents*quantity
  descriptions.push(`${quantity} x ${String(product.name).slice(0,100)}`)
 }
 return {subtotal:cents/100,summary:`Solicitud de validación de pedido: ${descriptions.join(', ')}. Subtotal ${ (cents/100).toFixed(2)}.`,items:[...requested].map(([productId,quantity])=>({productId,quantity}))}
}

function stateView(row){
 const result={validationId:row.id,status:row.status,subtotal:Number(row.subtotal),currency:String(row.currency).trim(),
  deliveryFee:null,total:null,store:null,errorCode:row.status==='VALIDATION_ERROR'?'VALIDATION_ERROR':null}
 if(row.status==='READY_FOR_PAYMENT'){
  const candidate=(row.candidates||[]).find(item=>item.storeId===row.selected_store_id)
  if(candidate){result.deliveryFee=candidate.deliveryFee;result.total=Math.round((Number(row.subtotal)+candidate.deliveryFee+Number.EPSILON)*100)/100
   result.store={id:candidate.storeId,name:candidate.storeName};result.routeDistanceKm=candidate.routeDistanceKm;result.paymentMethods=candidate.paymentMethods||[]}
 }
 return result
}

export function createMobileOrderAvailabilityRoutes({pool,body,json,loadOrderContext,rateLimit=()=>{},
 isCandidateLive=async()=>true,availability=checkAvailability,createInteraction=createMobileInteraction,readInteraction=readMobileInteraction,
 decrypt=decryptCredential,requestMode=mobileInteractionMode}){
 async function getValidation(id,tokenHash){
  const result=await pool.query(`SELECT v.* FROM mobile_order_validations v
   JOIN mobile_apps a ON a.app_id=v.app_id AND a.tenant_id=v.tenant_id
   JOIN tenants t ON t.id=v.tenant_id
   WHERE v.id=$1 AND v.validation_token_hash=$2 AND a.enabled=true AND t.active=true`,[id,tokenHash])
  if(!result.rowCount)throw fail(404,'Validación no encontrada o no autorizada')
  return result.rows[0]
 }
 async function release(id,values={}){
  const lease=await pool.query(`UPDATE mobile_order_validations SET lease_until=NULL,updated_at=now(),
   status=COALESCE($2,status),candidate_index=COALESCE($3,candidate_index),selected_store_id=COALESCE($4,selected_store_id),error_code=$5
   WHERE id=$1`,[id,values.status??null,values.candidateIndex??null,values.selectedStoreId??null,values.errorCode??null])
  return lease
 }
 async function current(id){return (await pool.query('SELECT * FROM mobile_order_validations WHERE id=$1',[id])).rows[0]}
 async function terminalError(row,code){await release(row.id,{status:'VALIDATION_ERROR',errorCode:code});return stateView(await current(row.id))}
 async function confirm(row,candidate){
  const revision=await pool.query('SELECT revision FROM published_catalogs WHERE tenant_id=$1 AND app_id=$2',[row.tenant_id,row.app_id])
  if(!revision.rowCount||revision.rows[0].revision!==row.catalog_revision){await terminalError(row,'CATALOG_CHANGED');return false}
  await release(row.id,{status:'READY_FOR_PAYMENT',selectedStoreId:candidate.storeId})
  return true
 }
 async function integrationFor(row,candidate){
  const result=await pool.query(`SELECT i.id AS integration_id,i.tenant_id,i.encrypted_credential,i.expires_at,i.suspended,i.scopes,
    b.id AS binding_id,b.store_id,b.external_location_id,b.purpose,b.authorization_confirmed_at
   FROM integration_bindings b
   JOIN tenant_integrations i ON i.id=b.integration_id AND i.tenant_id=b.tenant_id
   JOIN mobile_apps a ON a.app_id=b.app_id AND a.tenant_id=b.tenant_id
   JOIN tenants t ON t.id=b.tenant_id
   WHERE b.tenant_id=$1 AND b.app_id=$2 AND b.store_id=$3 AND b.purpose='ORDER_REQUEST'
    AND b.authorization_confirmed_at IS NOT NULL AND a.enabled=true AND t.active=true
   ORDER BY i.id`,[row.tenant_id,row.app_id,candidate.storeId])
  if(result.rowCount!==1)return null
  const item=result.rows[0]
  if(item.suspended||!item.encrypted_credential||item.expires_at&&new Date(item.expires_at)<=new Date()||
   !Array.isArray(item.scopes)||!item.scopes.includes('queue.availability.read')||!item.scopes.includes('interactions.create')||!item.scopes.includes('interactions.read'))return null
  return {...item,token:decrypt(item.encrypted_credential,row.tenant_id,item.integration_id)}
 }
 async function attemptFor(row){
  return (await pool.query(`SELECT a.*,i.encrypted_credential,i.expires_at,i.suspended,i.scopes,b.external_location_id,b.purpose
   FROM mobile_order_attempts a
   JOIN tenant_integrations i ON i.id=a.integration_id AND i.tenant_id=a.tenant_id
   JOIN integration_bindings b ON b.id=a.binding_id AND b.tenant_id=a.tenant_id
   WHERE a.tenant_id=$1 AND a.validation_id=$2 AND a.attempt_number=$3`,[row.tenant_id,row.id,row.candidate_index+1])).rows[0]
 }
 async function createOrRecover(row,candidate,attempt,integration){
  if(requestMode()!=='LIVE')return terminalError(row,'REQUESTS_DISABLED')
  const result=await createInteraction(integration.token,{external_location_id:integration.external_location_id,purpose:integration.purpose},
   {customerExternalId:row.customer_external_id,externalReference:attempt.external_reference,
    summary:row.request_summary,idempotencyKey:attempt.idempotency_key})
  if(!result.ok){
   if(result.errorCode==='CONNECTION_FAILED'||result.errorCode==='INVALID_RESPONSE'){
    await pool.query(`UPDATE mobile_order_attempts SET status='CREATE_UNCERTAIN',last_error_code=$4,updated_at=now()
     WHERE tenant_id=$1 AND validation_id=$2 AND attempt_number=$3`,[row.tenant_id,row.id,row.candidate_index+1,result.errorCode])
    await release(row.id,{status:'CREATE_UNCERTAIN'})
    return stateView(await current(row.id))
   }
   await pool.query(`UPDATE mobile_order_attempts SET status='ERROR',last_error_code=$4,updated_at=now()
    WHERE tenant_id=$1 AND validation_id=$2 AND attempt_number=$3`,[row.tenant_id,row.id,row.candidate_index+1,result.errorCode||'UPSTREAM_ERROR'])
   return terminalError(row,'TUVERSO_CREATE_FAILED')
  }
  const status=result.data.status
  await pool.query(`UPDATE mobile_order_attempts SET interaction_id=$4,status=$5,decision_reason=$6,last_error_code=NULL,updated_at=now()
   WHERE tenant_id=$1 AND validation_id=$2 AND attempt_number=$3`,[row.tenant_id,row.id,row.candidate_index+1,result.data.interactionId,status,result.data.decisionReason])
  if(status==='ACCEPTED'){
   if(await isCandidateLive(row.tenant_id,candidate))await confirm(row,candidate)
   else await release(row.id,{status:'CHECKING_STORES',candidateIndex:row.candidate_index+1})
  }else if(status==='REJECTED'||status==='EXPIRED'){
   await release(row.id,{status:'CHECKING_STORES',candidateIndex:row.candidate_index+1})
  }else await release(row.id,{status:'WAITING_APPROVAL'})
  return stateView(await current(row.id))
 }
 async function advance(id){
  const claim=await pool.query(`UPDATE mobile_order_validations SET lease_until=now()+interval '35 seconds',updated_at=now()
   WHERE id=$1 AND status=ANY($2::text[]) AND (lease_until IS NULL OR lease_until<now()) RETURNING *`,
   [id,['CHECKING_STORES','WAITING_APPROVAL','CREATE_UNCERTAIN']])
  if(!claim.rowCount)return stateView(await current(id))
  const row=claim.rows[0]
  try{
   if(terminal.has(row.status))return stateView(row)
   if(row.status==='WAITING_APPROVAL'){
    const attempt=await attemptFor(row)
    if(!attempt?.interaction_id)return await terminalError(row,'INTERACTION_MISSING')
    const candidate=row.candidates?.[row.candidate_index]
    const integration=candidate&&await integrationFor(row,candidate)
    if(!integration)return await terminalError(row,'INTEGRATION_UNAVAILABLE')
    const result=await readInteraction(integration.token,attempt.interaction_id)
    if(!result.ok)return await terminalError(row,'TUVERSO_READ_FAILED')
    const decision=result.data.status
    if(decision==='PENDING'){await release(row.id);return stateView(await current(row.id))}
    if(decision==='ACCEPTED'){
     await pool.query(`UPDATE mobile_order_attempts SET status='ACCEPTED',updated_at=now() WHERE id=$1 AND tenant_id=$2`,[attempt.id,row.tenant_id])
     if(await isCandidateLive(row.tenant_id,candidate))await confirm(row,candidate)
     else await release(row.id,{status:'CHECKING_STORES',candidateIndex:row.candidate_index+1})
    }else{
     await pool.query(`UPDATE mobile_order_attempts SET status=$3,decision_reason=$4,updated_at=now() WHERE id=$1 AND tenant_id=$2`,[attempt.id,row.tenant_id,decision,result.data.decisionReason])
     await release(row.id,{status:'CHECKING_STORES',candidateIndex:row.candidate_index+1})
    }
    return stateView(await current(row.id))
   }
   const candidate=row.candidates?.[row.candidate_index]
   if(!candidate){await release(row.id,{status:'UNAVAILABLE'});return stateView(await current(row.id))}
   if(!await isCandidateLive(row.tenant_id,candidate)){
    await release(row.id,{status:'CHECKING_STORES',candidateIndex:row.candidate_index+1})
    return stateView(await current(row.id))
   }
   if(candidate.consultOrderAvailability!==true){await confirm(row,candidate);return stateView(await current(row.id))}
   if(row.status==='CREATE_UNCERTAIN'){
    const attempt=await attemptFor(row),integration=attempt&&await integrationFor(row,candidate)
    if(!attempt||!integration)return await terminalError(row,'INTEGRATION_UNAVAILABLE')
    return createOrRecover(row,candidate,attempt,integration)
   }
   if(requestMode()!=='LIVE')return terminalError(row,'REQUESTS_DISABLED')
   const integration=await integrationFor(row,candidate)
   if(!integration)return await terminalError(row,'INTEGRATION_UNAVAILABLE')
   const available=await availability(integration.token,{...integration,id:integration.binding_id})
   if(available?.result!=='AVAILABLE'&&available?.result!=='UNAVAILABLE')return await terminalError(row,'TUVERSO_AVAILABILITY_FAILED')
   if(available.result==='UNAVAILABLE'){
    await pool.query(`INSERT INTO mobile_order_attempts(tenant_id,validation_id,attempt_number,store_id,binding_id,integration_id,idempotency_key,external_reference,status)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,'NO_CAPACITY')`,[row.tenant_id,row.id,row.candidate_index+1,candidate.storeId,integration.binding_id,integration.integration_id,randomUUID(),`order:${row.id}:${row.candidate_index+1}`])
    await release(row.id,{status:'CHECKING_STORES',candidateIndex:row.candidate_index+1})
    return stateView(await current(row.id))
   }
   const idempotencyKey=randomUUID(),externalReference=`order:${row.id}:${row.candidate_index+1}`
   const saved=await pool.query(`INSERT INTO mobile_order_attempts(tenant_id,validation_id,attempt_number,store_id,binding_id,integration_id,idempotency_key,external_reference,status)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,'CREATE_UNCERTAIN') RETURNING *`,[row.tenant_id,row.id,row.candidate_index+1,candidate.storeId,integration.binding_id,integration.integration_id,idempotencyKey,externalReference])
   return createOrRecover(row,candidate,saved.rows[0],integration)
  }catch(error){
   await release(row.id,{status:'VALIDATION_ERROR',errorCode:'PROCESSING_ERROR'})
   throw error
  }
 }
 async function publicResult(row){
  return stateView(row)
 }
 return async function mobileOrderAvailabilityRoutes({req,res,url}){
  const base='/api/v1/mobile/orders/availability'
  if(!url.pathname.startsWith(base))return false
  try{
   rateLimit(req)
   if(url.pathname===base&&req.method==='POST'){
    const input=await body(req),idempotencyKey=req.headers['idempotency-key']
    if(!object(input)||Object.keys(input).some(key=>!['appId','validationToken','customerExternalId','items','address','district','city','country','latitude','longitude','useGps'].includes(key))||
     !APP.test(input.appId)||!TOKEN.test(input.validationToken)||!UUID.test(idempotencyKey)||!text(input.customerExternalId,180))throw fail(400,'Solicitud de validación inválida')
    const address=typeof input.address==='string'?input.address.trim():''
    const district=typeof input.district==='string'?input.district.trim():''
    const city=typeof input.city==='string'?input.city.trim():''
    const country=typeof input.country==='string'?input.country.trim():''
    const useGps=input.useGps===true&&Number.isFinite(input.latitude)&&input.latitude>=-90&&input.latitude<=90&&Number.isFinite(input.longitude)&&input.longitude>=-180&&input.longitude<=180
    if(!(address.length>0&&address.length<=250&&district.length>0&&district.length<=90&&city.length>0&&city.length<=100&&country.length>0&&country.length<=100)&&!useGps)throw fail(422,'Confirma la dirección completa o ubicación GPS')
    if(input.useGps===true&&!useGps)throw fail(400,'Coordenadas inválidas')
    const canonical={appId:input.appId,customerExternalId:input.customerExternalId,items:input.items,address,district,city,country,
     destination:useGps&&!address?{latitude:input.latitude,longitude:input.longitude}:null}
    const tokenHash=hash(input.validationToken),requestHash=hash(JSON.stringify(canonical))
    const existing=await pool.query(`SELECT v.* FROM mobile_order_validations v
     JOIN mobile_apps a ON a.app_id=v.app_id AND a.tenant_id=v.tenant_id
     JOIN tenants t ON t.id=v.tenant_id
     WHERE v.app_id=$1 AND v.idempotency_key=$2 AND a.enabled=true AND t.active=true`,[input.appId,idempotencyKey])
    let row
    if(existing.rowCount){
     row=existing.rows[0]
     if(row.request_hash!==requestHash||row.validation_token_hash!==tokenHash)throw fail(409,'La clave de idempotencia ya se usó con otra solicitud')
    }else{
     const prepared=await loadOrderContext(input.appId,{...input,address,district,useGps})
     const cart=calculateOrderCart(prepared.products,input.items)
     if(!prepared.candidates.length)throw fail(409,'No hay sedes elegibles para este pedido')
     const saved=await pool.query(`INSERT INTO mobile_order_validations(tenant_id,app_id,idempotency_key,validation_token_hash,request_hash,
       customer_external_id,request_summary,subtotal,currency,catalog_revision,candidates,status)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,'CHECKING_STORES')
      ON CONFLICT(tenant_id,app_id,idempotency_key) DO NOTHING RETURNING *`,
      [prepared.tenantId,input.appId,idempotencyKey,tokenHash,requestHash,input.customerExternalId,cart.summary,cart.subtotal,
       prepared.currency,prepared.revision,JSON.stringify(prepared.candidates)])
     row=saved.rows[0]|| (await pool.query('SELECT * FROM mobile_order_validations WHERE app_id=$1 AND idempotency_key=$2',[input.appId,idempotencyKey])).rows[0]
     if(!row||row.request_hash!==requestHash||row.validation_token_hash!==tokenHash)throw fail(409,'La clave de idempotencia ya se usó con otra solicitud')
    }
    if(['CHECKING_STORES','CREATE_UNCERTAIN','WAITING_APPROVAL'].includes(row.status))row=await current(row.id)
    if(!terminal.has(row.status)&&!row.lease_until)row=await current(row.id)
    if(!terminal.has(row.status)&&!row.lease_until)await advance(row.id)
    row=await current(row.id)
    const output=await publicResult(row)
    return json(res,row.status==='WAITING_APPROVAL'||row.status==='CHECKING_STORES'||row.status==='CREATE_UNCERTAIN'?202:200,output)
   }
   const match=url.pathname.match(/^\/api\/v1\/mobile\/orders\/availability\/([0-9a-f-]{36})$/i)
   if(match&&req.method==='GET'){
    const auth=req.headers.authorization||'',token=auth.startsWith('Bearer ')?auth.slice(7):''
    if(!TOKEN.test(token))throw fail(401,'Token de validación requerido')
    const row=await getValidation(match[1],hash(token))
    if(['CHECKING_STORES','WAITING_APPROVAL','CREATE_UNCERTAIN'].includes(row.status))await advance(row.id)
    const latest=await current(row.id)
    return json(res,latest.status==='WAITING_APPROVAL'||latest.status==='CHECKING_STORES'||latest.status==='CREATE_UNCERTAIN'?202:200,await publicResult(latest))
   }
   throw fail(405,'Método no permitido')
  }catch(error){
   const status=Number.isInteger(error.code)?error.code:500
   return json(res,status,{error:status===500?'No se pudo procesar la validación':error.message})
  }
 }
}
