import {randomUUID} from 'node:crypto'
import {encryptCredential,decryptCredential,credentialHint} from './integration-crypto.mjs'
import {TUVERSO_BASE,TUVERSO_SCOPES,connectionMode,checkAvailability} from './tuverso-client.mjs'
import {normalizeTuVersoCredential} from './tuverso-credential-format.mjs'
import {createMobileInteraction,mobileInteractionMode} from './tuverso-mobile-connector.mjs'

const uuid=x=>typeof x==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(x)
const fail=(code,message)=>Object.assign(new Error(message),{code})
const text=(v,max)=>typeof v==='string'&&v.trim().length>0&&v.length<=max&&!/[\x00-\x1f]/.test(v)&&!v.includes('tvi_v1_')
const columns='id,tenant_id,provider,name,external_tenant_id,channel_account_id,channel_type,instance_key,base_url,scopes,credential_hint,credential_reference,expires_at,suspended,check_state,last_check,revision,created_at,updated_at'
function state(row){
 if(row.suspended)return 'SUSPENDED'
 if(!row.credential_hint)return 'UNCONFIGURED'
 if(row.expires_at&&new Date(row.expires_at)<=new Date())return 'EXPIRED'
 return row.check_state==='UNCONFIGURED'?'CONFIGURED':row.check_state
}
function view(row){return {id:row.id,tenantId:row.tenant_id,provider:row.provider,name:row.name,externalTenantId:row.external_tenant_id,channelAccountId:row.channel_account_id,channelType:row.channel_type,instanceKey:row.instance_key,baseUrl:row.base_url,scopes:row.scopes,hasCredential:!!row.credential_hint,credentialHint:row.credential_hint,credentialReference:row.credential_reference,expiresAt:row.expires_at,suspended:row.suspended,status:state(row),lastCheck:row.last_check,revision:row.revision,metadataSource:'MANUAL',connectionMode:connectionMode(),requestMode:mobileInteractionMode(),phase1BEnabled:false}}
function keys(b,allowed){if(!b||typeof b!=='object'||Array.isArray(b)||Object.keys(b).some(k=>!allowed.includes(k)))throw fail(400,'Campos no admitidos en esta operación')}
function expiry(value){if(value==null||value==='')return null;if(typeof value!=='string'||!/^\d{4}-\d\d-\d\dT/.test(value)||!Number.isFinite(Date.parse(value)))throw fail(400,'Vencimiento inválido');return new Date(value).toISOString()}
function metadata(b,existing={}){
 keys(b,['name','externalTenantId','channelAccountId','channelType','instanceKey','baseUrl','scopes','credentialReference','expiresAt'])
 const optional=(field,column)=>b[field]===undefined?existing[column]??null:b[field]===''?null:b[field]
 const name=b.name===undefined?existing.name||'TU VERSO':b.name
 const externalTenant=optional('externalTenantId','external_tenant_id'),account=optional('channelAccountId','channel_account_id'),channel=optional('channelType','channel_type'),instance=optional('instanceKey','instance_key'),reference=optional('credentialReference','credential_reference')
 const scopes=b.scopes??existing.scopes??['queue.availability.read']
 if(!text(name,180)||externalTenant!==null&&!text(externalTenant,180)||account!==null&&!uuid(account)||channel!==null&&!['MOBILE_APP','WEB'].includes(channel)||instance!==null&&!text(instance,180)||b.baseUrl!==undefined&&b.baseUrl!==TUVERSO_BASE||!Array.isArray(scopes)||!scopes.includes('queue.availability.read')||new Set(scopes).size!==scopes.length||scopes.some(s=>!TUVERSO_SCOPES.includes(s))||reference!==null&&!text(reference,180))throw fail(400,'Datos de integración inválidos')
 return [name.trim(),externalTenant?.trim()??null,account?.toLowerCase()??null,channel,instance?.trim()??null,scopes,reference,b.expiresAt===undefined?existing.expires_at??null:expiry(b.expiresAt)]
}
const attempts=new Map()
export async function integrationRoutes({req,res,url,user,pool,body,json,tenantOf}){
 const route=url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/integrations(?:\/([^/]+))?(?:\/(credential|credential-delete|bindings|test|request|suspension|delete))?(?:\/([^/]+)\/delete)?$/)
 // Fail closed for malformed integration subroutes as well.
 if(!url.pathname.includes('/integrations'))return false
 if(user.role!=='SUPER_ADMIN'){json(res,403,{error:'Solo el Super Administrador puede gestionar integraciones'});return true}
 let client
 try{
  if(!route)throw fail(404,'Ruta de integración no encontrada')
  const [,tenantId,id,action,bindingToDelete]=route
  if(bindingToDelete&&action!=='bindings')throw fail(404,'Ruta de integración no encontrada')
  if(!uuid(tenantId)||id&&!uuid(id)||bindingToDelete&&!uuid(bindingToDelete))throw fail(400,'Identificador inválido')
  await tenantOf(user,tenantId)
  if(!['GET','POST','PUT'].includes(req.method))throw fail(405,'Método no permitido')
  if(req.method!=='GET'){
   if(!process.env.ADMIN_ORIGIN||req.headers.origin!==process.env.ADMIN_ORIGIN)throw fail(403,'Origen no autorizado')
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))throw fail(415,'Usa application/json')
  }
  if(req.method==='GET'){
   if(action)throw fail(404,'Ruta de integración no encontrada')
   if(!id){const rows=await pool.query(`SELECT ${columns} FROM tenant_integrations WHERE tenant_id=$1 ORDER BY created_at,id`,[tenantId]);json(res,200,{integrations:rows.rows.map(view),connectionMode:connectionMode()});return true}
   const row=(await pool.query(`SELECT ${columns} FROM tenant_integrations WHERE tenant_id=$1 AND id=$2`,[tenantId,id])).rows[0]
   if(!row)throw fail(404,'Integración no encontrada')
   const bindings=await pool.query('SELECT b.id,b.store_id AS "storeId",s.name AS "storeName",s.code AS "storeCode",b.external_location_id AS "externalLocationId",b.purpose,b.queue_reference AS "queueReference",b.authorization_confirmed_at AS "authorizationConfirmedAt" FROM integration_bindings b JOIN stores s ON s.id=b.store_id AND s.tenant_id=b.tenant_id WHERE b.tenant_id=$1 AND b.integration_id=$2 ORDER BY b.authorization_confirmed_at,b.id',[tenantId,id])
   json(res,200,{...view(row),bindings:bindings.rows.map(b=>({...b,source:'MANUAL_AUTHORIZATION'}))});return true
  }
  const b=await body(req)
  client=await pool.connect();await client.query('BEGIN')
  const audit=async(action,target=id)=>client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[tenantId,user.id,'TUVERSO_'+action,target])
  const finish=async(status,data,action,target)=>{await audit(action,target);await client.query('COMMIT');json(res,status,data);return true}
  if(!id){
   if(action||req.method!=='POST')throw fail(405,'Método no permitido')
   const values=metadata(b),created=await client.query(`INSERT INTO tenant_integrations(id,tenant_id,name,external_tenant_id,channel_account_id,channel_type,instance_key,scopes,credential_reference,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING ${columns}`,[randomUUID(),tenantId,...values])
   return await finish(201,view(created.rows[0]),'CREATED',created.rows[0].id)
  }
  const row=(await client.query('SELECT * FROM tenant_integrations WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,id])).rows[0]
  if(!row)throw fail(404,'Integración no encontrada')
  // Invalidate the previous verification on every change affecting identity, bindings or credential.
  const invalidate=async()=>client.query("UPDATE tenant_integrations SET check_state=CASE WHEN encrypted_credential IS NULL THEN 'UNCONFIGURED' ELSE 'CONFIGURED' END,last_check=NULL,revision=revision+1,updated_at=now() WHERE tenant_id=$1 AND id=$2",[tenantId,id])
  if(!action){
   if(req.method!=='PUT')throw fail(405,'Usa PUT para actualizar metadatos')
   const values=metadata(b,row)
   // Changing the remote identity requires removing its old credential and bindings first.
   if(row.external_tenant_id!==values[1]||row.channel_account_id!==values[2]||row.channel_type!==values[3]||row.instance_key!==values[4]){
    const bindings=await client.query('SELECT 1 FROM integration_bindings WHERE tenant_id=$1 AND integration_id=$2 LIMIT 1',[tenantId,id])
    if(row.encrypted_credential||bindings.rowCount)throw fail(409,'Elimina la credencial y las asociaciones antes de cambiar la identidad externa')
   }
   await client.query('UPDATE tenant_integrations SET name=$3,external_tenant_id=$4,channel_account_id=$5,channel_type=$6,instance_key=$7,scopes=$8,credential_reference=$9,expires_at=$10 WHERE tenant_id=$1 AND id=$2',[tenantId,id,...values]);await invalidate()
   return await finish(200,{ok:true},'METADATA_UPDATED')
  }
  if(req.method!=='POST')throw fail(405,'Usa POST para esta operación')
  if(action==='delete'){
   keys(b,['confirm']);if(b.confirm!==true)throw fail(400,'Confirma la eliminación de esta conexión guardada')
   // Binding FK cascades only within this integration. Audit remains in admin_audit.
   await client.query('DELETE FROM tenant_integrations WHERE tenant_id=$1 AND id=$2',[tenantId,id])
   const result=await finish(200,{ok:true},'CONNECTION_DELETED')
   attempts.delete(id)
   return result
  }
  if(action==='credential'){
   keys(b,['token','credentialReference','expiresAt'])
   const token=normalizeTuVersoCredential(b.token)
   if(!token)throw fail(400,'Clave inválida: pega la credencial completa emitida por TU VERSO, sin Bearer ni espacios internos')
   if(b.credentialReference&&!text(b.credentialReference,180))throw fail(400,'Referencia de credencial inválida')
   const expiresAt=b.expiresAt===undefined?row.expires_at:expiry(b.expiresAt)
   if(expiresAt&&new Date(expiresAt)<=new Date())throw fail(400,'La credencial registrada ya está vencida')
   const encrypted=encryptCredential(token,tenantId,id)
   await client.query('UPDATE tenant_integrations SET encrypted_credential=$3,credential_hint=$4,credential_reference=$5,expires_at=$6 WHERE tenant_id=$1 AND id=$2',[tenantId,id,encrypted,credentialHint(token),b.credentialReference=undefined?row.credential_reference:b.credentialReference||null,expiresAt]);await invalidate()
   return await finish(200,{ok:true},row.encrypted_credential?'CREDENTIAL_REPLACED':'CREDENTIAL_SAVED')
  }
  if(action==='credential-delete'){
   keys(b,['confirm']);if(b.confirm!==true)throw fail(400,'Confirma la eliminación local de la credencial')
   await client.query('UPDATE tenant_integrations SET encrypted_credential=NULL,credential_hint=NULL,credential_reference=NULL,expires_at=NULL WHERE tenant_id=$1 AND id=$2',[tenantId,id]);await invalidate()
   return await finish(200,{ok:true},'CREDENTIAL_REMOVED')
  }
  if(action==='suspension'){
   keys(b,['suspended']);if(typeof b.suspended!=='boolean')throw fail(400,'Estado de suspensión inválido')
   await client.query('UPDATE tenant_integrations SET suspended=$3 WHERE tenant_id=$1 AND id=$2',[tenantId,id,b.suspended]);await invalidate()
   return await finish(200,{ok:true},b.suspended?'SUSPENDED':'RESUMED_LOCALLY')
  }
  if(action==='bindings'){
   if(bindingToDelete){
    keys(b,['confirm']);if(b.confirm!==true)throw fail(400,'Confirma la eliminación de la asociación')
    const removed=await client.query('DELETE FROM integration_bindings WHERE tenant_id=$1 AND integration_id=$2 AND id=$3',[tenantId,id,bindingToDelete]);if(!removed.rowCount)throw fail(404,'Asociación no encontrada')
    await invalidate();return await finish(200,{ok:true},'BINDING_REMOVED')
   }
   keys(b,['storeId','externalLocationId','purpose','queueReference','authorizationConfirmed'])
   if(!uuid(b.storeId)||b.externalLocationId!==undefined&&!text(b.externalLocationId,180)||typeof b.purpose!=='string'||b.purpose.length>80||! /^[A-Z][A-Z0-9_]*$/.test(b.purpose)||b.queueReference!=null&&!uuid(b.queueReference)||b.authorizationConfirmed!==true)throw fail(400,'Selecciona una sede y un propósito previamente autorizados en TU VERSO')
   const store=await client.query('SELECT id,code FROM stores WHERE tenant_id=$1 AND id=$2',[tenantId,b.storeId]);if(!store.rowCount)throw fail(400,'La sede no pertenece a esta empresa')
   const created=await client.query('INSERT INTO integration_bindings(tenant_id,integration_id,store_id,external_location_id,purpose,queue_reference,authorization_confirmed_by) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id',[tenantId,id,b.storeId,b.externalLocationId?.trim()??store.rows[0].code,b.purpose,b.queueReference??null,user.id]);await invalidate()
   return await finish(201,{id:created.rows[0].id},'BINDING_SAVED')
  }
  if(action==='request'){
   keys(b,['bindingId','customerExternalId','externalReference','summary','idempotencyKey','authorizeSend'])
   if(b.authorizeSend!==true||!uuid(b.bindingId)||!uuid(b.idempotencyKey)||
      !text(b.customerExternalId,180)||!text(b.externalReference,180)||
      !text(b.summary,1200))throw fail(400,'Solicitud externa inválida')
   if(mobileInteractionMode()!=='LIVE')throw fail(409,'La recepción de solicitudes TU VERSO no está habilitada')
   if(row.suspended||!row.encrypted_credential||
      row.expires_at&&new Date(row.expires_at)<=new Date())
     throw fail(409,'La conexión carece de credencial vigente')
   if(!row.scopes?.includes('interactions.create'))
     throw fail(403,'La conexión no tiene permiso para enviar solicitudes')
   if(row.channel_type&&row.channel_type!=='MOBILE_APP')
     throw fail(409,'El conector solo admite cuentas de aplicación móvil')
   const binding=(await client.query(
    'SELECT b.* FROM integration_bindings b JOIN stores s ON s.id=b.store_id AND s.tenant_id=b.tenant_id WHERE b.tenant_id=$1 AND b.integration_id=$2 AND b.id=$3',
    [tenantId,id,b.bindingId])).rows[0]
   if(!binding||!binding.authorization_confirmed_at)
     throw fail(409,'La sede no tiene autorización vigente para enviar solicitudes')
   // Only the trusted backend selects the external location/purpose; the
   // caller cannot inject tenant, queue, channel or a different location.
   const result=await createMobileInteraction(
    decryptCredential(row.encrypted_credential,tenantId,id),binding,{
     customerExternalId:b.customerExternalId,
     externalReference:b.externalReference,summary:b.summary,
     idempotencyKey:b.idempotencyKey,
    })
   if(!result.ok){
    const status=result.httpStatus===401?401:result.httpStatus===403?403:
      result.httpStatus===429?429:result.httpStatus===409?409:503
    throw fail(status,'TU VERSO no aceptó la solicitud: '+(result.message??result.errorCode))
   }
   // Keep minimal audit: do not store customer/summary/bearer in admin_audit.
   return await finish(result.httpStatus===201?201:200,result.data,'REQUEST_SUBMITTED')
  }
  if(action==='test'){
   keys(b,['bindingId','authorizeCheck'])
   if(!uuid(b.bindingId)||b.authorizeCheck!==true)throw fail(400,'Selecciona y autoriza la comprobación de una asociación')
   if(connectionMode()==='DISABLED')throw fail(409,'Consultas reales deshabilitadas en el servidor; falta autorización operativa')
   if(row.suspended)throw fail(409,'Integración suspendida localmente')
   if(!row.encrypted_credential)throw fail(409,'Primero registra una credencial protegida')
   if(row.expires_at&&new Date(row.expires_at)<=new Date())throw fail(409,'Credencial vencida según la fecha registrada')
   const binding=(await client.query('SELECT b.* FROM integration_bindings b JOIN stores s ON s.id=b.store_id AND s.tenant_id=b.tenant_id WHERE b.tenant_id=$1 AND b.integration_id=$2 AND b.id=$3',[tenantId,id,b.bindingId])).rows[0]
   if(!binding)throw fail(400,'Asociación no autorizada para esta integración')
   const now=Date.now(),attempt=attempts.get(id)
   if(attempt&&now-attempt.since<60000&&attempt.count>=20)throw fail(429,'Demasiadas comprobaciones; espera un minuto')
   if(attempts.size>10000)attempts.clear()
   attempts.set(id,attempt&&now-attempt.since<60000?{...attempt,count:attempt.count+1}:{since:now,count:1})
   const result=await checkAvailability(decryptCredential(row.encrypted_credential,tenantId,id),binding)
   const checkState=[401,403].includes(result.httpStatus)?'AUTH_ERROR':result.result?'QUERY_CONNECTED':'CONFIGURED'
   await client.query('UPDATE tenant_integrations SET check_state=$3,last_check=$4,updated_at=now() WHERE tenant_id=$1 AND id=$2',[tenantId,id,checkState,JSON.stringify(result)])
   return await finish(200,{...result,status:checkState,phase1BEnabled:false},'CONNECTION_CHECKED')
  }
  throw fail(404,'Ruta de integración no encontrada')
 }catch(error){
  if(client)await client.query('ROLLBACK').catch(()=>{})
  const status=typeof error.code==='number'?error.code:['23505','23503'].includes(error.code)?409:503
  const message=typeof error.code==='number'?error.message:error.code==='23505'?'Configuración o asociación duplicada':error.code==='23503'?'Asociación no válida':error.message==='INTEGRATION_KEY_UNAVAILABLE'?'Clave de cifrado ausente, incorrecta o credencial no descifrable':'No se pudo procesar la integración'
  json(res,status,{error:message});return true
 }finally{client?.release()}
}
