// Pollos B3 commercial reservations. No TU VERSO code or schema is changed.
// All provider calls use the Administrator's existing private MOBILE_APP connector.
import {randomUUID} from 'node:crypto';
import {decryptCredential} from './integration-crypto.mjs';
import {checkAvailability,connectionMode} from './tuverso-client.mjs';
import {createMobileInteraction,readMobileInteraction,readMobileInteractionMessages,
 sendMobileInteractionMessage,mobileInteractionMode} from './tuverso-mobile-connector.mjs';
import {calculateOrderCart} from './mobile-order-availability.mjs';
import {checkoutPolicy} from './mobile-checkout-followups.mjs';
import {mapReservationSettings} from './mobile-reservation-settings.mjs';
import {computeReservationSlots,localDateTimeEpoch} from './mobile-reservation-slots.mjs';
import {UUID,APP,DAY,TIME,fail,sha,ownerHash,externalRef,
 normalizeReserveRequest,normalizedForm,explicitAgentDecision,publicReservation} from './mobile-reservation-domain.mjs';

const activeStates=['CREATING','FORM_UNCERTAIN','AWAITING_AGENT','AWAITING_PAYMENT','CONFIRMED'];
const terminal=['CONFIRMED','REJECTED','CANCELLED','EXPIRED'];
const methods=['yape','plin','card','cash'];
const live=()=>process.env.B3_RESERVATIONS_LIVE_ENABLED==='true';
const safeRemote=e=>[401,403,404,409,429].includes(e?.httpStatus)?503:503;
const validQuote=q=>q&&typeof q==='object'&&!Array.isArray(q)&&
 Object.keys(q).every(k=>['appId','catalogRevision','mode','date','time','storeId',
  'latitude','longitude','useGps','address','district','reference'].includes(k))&&
 APP.test(q.appId)&&Number.isSafeInteger(q.catalogRevision)&&q.catalogRevision>0&&
 ['delivery','pickup'].includes(q.mode)&&DAY.test(q.date)&&TIME.test(q.time)&&
 (q.storeId===undefined||UUID.test(q.storeId));
const quoteInput=q=>{
 if(!validQuote(q))throw fail(400,'Completa modalidad, fecha y horario para la reserva');
 if(q.mode==='pickup'&&!UUID.test(q.storeId))throw fail(400,'Elige una sede para recojo');
 if(q.mode==='delivery'&&(!Number.isFinite(q.latitude)||Math.abs(q.latitude)>90||
   !Number.isFinite(q.longitude)||Math.abs(q.longitude)>180||q.useGps!==true||
   typeof q.address!=='string'||q.address.trim().length<6||q.address.length>180||
   typeof q.district!=='string'||q.district.trim().length<2||q.district.length>80))
  throw fail(400,'Se necesitan coordenadas verificadas para el Delivery programado');
 return q;
};
function humanStatus(status){
 return status==='CREATING'?'CREANDO_SOLICITUD':status==='FORM_UNCERTAIN'?'FORM_PENDIENTE_DE_VERIFICAR':status;
}
export function createMobileReservationsRoutes({pool,body,json,storeHours,deliveryQuotes,
 availability=checkAvailability,createInteraction=createMobileInteraction,
 readInteraction=readMobileInteraction,readMessages=readMobileInteractionMessages,
 sendMessage=sendMobileInteractionMessage,now=()=>new Date()}){
 async function catalog(appId){
  const result=await pool.query(`SELECT p.tenant_id,p.revision,p.payload FROM published_catalogs p
   JOIN mobile_apps a ON a.app_id=p.app_id AND a.tenant_id=p.tenant_id
   JOIN tenants t ON t.id=p.tenant_id WHERE p.app_id=$1 AND a.enabled=true AND t.active=true`,[appId]);
  if(result.rowCount!==1)throw fail(409,'Catálogo del negocio no publicado');
  return {tenantId:result.rows[0].tenant_id,revision:result.rows[0].revision,payload:result.rows[0].payload,appId};
 }
 async function storeLive(ctx,storeId,client=pool){
  const result=await client.query(`SELECT s.id,s.name,s.active,s.delivery_enabled,s.pickup_enabled,s.opening_hours,
   t.time_zone,r.enabled,r.min_advance_minutes,r.max_advance_days,r.first_time,r.last_time,
   r.slot_minutes,r.max_orders_per_slot,r.preparation_minutes
   FROM stores s JOIN tenants t ON t.id=s.tenant_id
   LEFT JOIN store_reservation_settings r ON r.tenant_id=s.tenant_id AND r.store_id=s.id
   WHERE s.id=$1 AND s.tenant_id=$2 AND t.active=true`,[storeId,ctx.tenantId]);
  if(result.rowCount!==1)throw fail(409,'Sede deshabilitada');
  return result.rows[0];
 }
 async function binding(ctx,storeId){
  const result=await pool.query(`SELECT i.id AS integration_id,i.encrypted_credential,i.expires_at,i.suspended,
   i.channel_type,b.id AS binding_id,b.external_location_id,b.purpose
   FROM integration_bindings b JOIN tenant_integrations i
    ON i.id=b.integration_id AND i.tenant_id=b.tenant_id
   WHERE b.tenant_id=$1 AND b.app_id=$2 AND b.store_id=$3 AND b.purpose='ORDER_REQUEST'
     AND b.authorization_confirmed_at IS NOT NULL ORDER BY i.id`,[ctx.tenantId,ctx.appId,storeId]);
  if(result.rowCount!==1)throw fail(409,'La sede no tiene una conexión autorizada y única');
  const row=result.rows[0];
  if(row.suspended||!row.encrypted_credential||row.expires_at&&new Date(row.expires_at)<=now()||
   row.channel_type&&row.channel_type!=='MOBILE_APP')throw fail(409,'Conexión de sede inactiva');
  return {...row,token:decryptCredential(row.encrypted_credential,ctx.tenantId,row.integration_id)};
 }
 async function agent(ctx,storeId){
  if(mobileInteractionMode()!=='LIVE'||connectionMode()==='DISABLED')
   throw fail(503,'Recepción de reservas no disponible');
  const b=await binding(ctx,storeId);
  const result=await availability(b.token,{external_location_id:b.external_location_id,
   purpose:'ORDER_REQUEST',id:b.binding_id});
  if(!['AVAILABLE','UNAVAILABLE'].includes(result?.result))
   throw fail(503,'No se pudo comprobar el asesor de esta sede');
  return {online:result.result==='AVAILABLE',binding:b};
 }
 async function selection(ctx,q,checkOnline=true){
  if(ctx.revision!==q.catalogRevision)throw fail(409,'El catálogo cambió. Actualiza el pedido');
  const published=ctx.payload?.stores||[];
  const candidateStores=q.mode==='delivery'
   ?await deliveryQuotes(ctx.payload,{...q,useGps:true},ctx.revision,false,
      // Iterate future opening hours, never the current isOpen flag.
      new Date(localDateTimeEpoch(q.date,q.time,ctx.payload.timeZone||'America/Lima')))
   :[{storeId:q.storeId,deliveryFee:0,routeDistanceKm:null}];
  for(const candidate of candidateStores){
   if(q.storeId&&candidate.storeId!==q.storeId)continue;
   const old=published.find(x=>x.id===candidate.storeId);
   if(!old||old.reservationSettings?.enabled!==true)continue;
   const row=await storeLive(ctx,candidate.storeId);
   const settings=mapReservationSettings(row);
   const scheduled=computeReservationSlots({date:q.date,mode:q.mode,
    store:{...old,active:row.active,delivery_enabled:row.delivery_enabled,
     pickup_enabled:row.pickup_enabled,openingHours:row.opening_hours},
    settings:{...settings,enabled:settings.enabled&&old.reservationSettings.enabled},
    timeZone:row.time_zone||'America/Lima',now:now(),
    isOpenAt:(store,at,zone)=>{
     const h=storeHours(store,at,zone);
     return h.hoursConfigured===true&&h.isOpen===true;
    }});
   const slot=scheduled.slots.find(x=>x.time===q.time);
   if(!slot)continue;
   const total=await pool.query(`SELECT count(*)::int AS n FROM mobile_scheduled_orders
    WHERE tenant_id=$1 AND store_id=$2 AND scheduled_at=$3
     AND status=ANY($4::text[]) AND (status='CONFIRMED' OR hold_until>now())`,
    [ctx.tenantId,candidate.storeId,slot.scheduledAt,activeStates]);
   if(total.rows[0].n>=settings.maxOrdersPerSlot)continue;
   if(checkOnline){
    const a=await agent(ctx,candidate.storeId);
    if(!a.online)continue;
   }
   return {storeId:candidate.storeId,storeName:row.name,scheduledAt:slot.scheduledAt,
    mode:q.mode,date:q.date,time:q.time,
    deliveryFeePen:q.mode==='delivery'?Number(candidate.deliveryFee):0,
    routeDistanceKm:candidate.routeDistanceKm,
    preparationMinutes:settings.preparationMinutes,
    maxOrdersPerSlot:settings.maxOrdersPerSlot,
    paymentMethods:old.paymentMethods?.[q.mode]||[]};
  }
  throw fail(409,'No hay sedes con agente disponible, cupos y horario habilitados para esta solicitud');
 }
 async function findMine(appId,id,key){
  if(!UUID.test(id)||!APP.test(appId)||!UUID.test(key))throw fail(400,'Datos de seguimiento inválidos');
  const r=await pool.query(`SELECT o.*,s.name AS store_name FROM mobile_scheduled_orders o
   JOIN stores s ON s.id=o.store_id AND s.tenant_id=o.tenant_id
   JOIN mobile_apps a ON a.app_id=o.app_id AND a.tenant_id=o.tenant_id
   JOIN tenants t ON t.id=o.tenant_id
   WHERE o.id=$1 AND o.app_id=$2 AND o.access_hash=$3 AND a.enabled=true AND t.active=true`,
   [id,appId,ownerHash(key)]);
  if(r.rowCount!==1)throw fail(404,'Reserva no disponible');
  return r.rows[0];
 }
 const response=row=>({...publicReservation(row),storeName:row.store_name||null,
  statusLabel:humanStatus(row.status),paymentVerified:row.payment_status==='VERIFIED',
  preparationStartsAt:row.status==='CONFIRMED'?
   new Date(new Date(row.scheduled_at).getTime()-row.preparation_minutes*60000).toISOString():null});
 async function expire(row){
  if((row.status==='AWAITING_PAYMENT'&&row.payment_expires_at&&new Date(row.payment_expires_at)<=now())||
    (activeStates.includes(row.status)&&new Date(row.scheduled_at)<=now())){
   const q=await pool.query(`UPDATE mobile_scheduled_orders SET status='EXPIRED',updated_at=now()
    WHERE id=$1 AND status IN ('CREATING','FORM_UNCERTAIN','AWAITING_AGENT','AWAITING_PAYMENT')
      AND (hold_until<=now() OR scheduled_at<=now()) RETURNING *`,[row.id]);
   if(q.rowCount)return {...row,...q.rows[0]};
  }
  return row;
 }
 async function advanceAgent(row){
  row=await expire(row);
  if(row.status!=='AWAITING_AGENT'||!row.form_sent||!row.interaction_id)return row;
  const ctx={tenantId:row.tenant_id,appId:row.app_id};
  const b=await binding(ctx,row.store_id);
  const remote=await readInteraction(b.token,row.interaction_id);
  if(!remote.ok)throw fail(503,'No se pudo consultar la decisión del agente');
  if(remote.data?.externalReference!==externalRef(ctx.tenantId,ctx.appId,row.store_id,row.idempotency_key)||
    remote.data?.externalLocationId!==b.external_location_id||remote.data?.purpose!=='ORDER_REQUEST')
   throw fail(403,'La interacción no corresponde a la sede');
  if(['REJECTED','EXPIRED'].includes(remote.data.status)){
   const state=remote.data.status;
   await pool.query(`UPDATE mobile_scheduled_orders SET status=$2,updated_at=now()
    WHERE id=$1 AND status='AWAITING_AGENT'`,[row.id,state]);
   return {...row,status:state};
  }
  const history=await readMessages(b.token,row.interaction_id);
  const known=history.ok===true&&history.data?.interactionId===row.interaction_id;
  const decision=known?explicitAgentDecision(history.data.messages):null;
  // Assignment to an agent (technical ACCEPTED) is never commercial approval.
  if(decision?.decision==='REJECTED'){
   await pool.query(`UPDATE mobile_scheduled_orders SET status='REJECTED',
    agent_decision_message_id=$2,updated_at=now() WHERE id=$1 AND status='AWAITING_AGENT'`,
    [row.id,decision.id]);return {...row,status:'REJECTED'};
  }
  if(decision?.decision==='ACCEPTED'){
   const policy=await checkoutPolicy(pool,row.tenant_id);
   const q=await pool.query(`UPDATE mobile_scheduled_orders SET
    status='AWAITING_PAYMENT',agent_decision_message_id=$2,approved_at=now(),
    payment_expires_at=now()+($3*interval '1 minute'),
    hold_until=now()+($3*interval '1 minute'),updated_at=now()
    WHERE id=$1 AND status='AWAITING_AGENT' AND scheduled_at>now()
    RETURNING *`,[row.id,decision.id,policy.paymentWaitMinutes]);
   return q.rows[0]?{...row,...q.rows[0]}:expire(await findMine(row.app_id,row.id,row._accessKey));
  }
  // Closure without readable history does not prove rejection.
  const conversation=remote.data.operationalConversationStatus;
  if(known&&['CLOSED','RESOLVED'].includes(conversation)){
   await pool.query(`UPDATE mobile_scheduled_orders SET status='REJECTED',updated_at=now()
    WHERE id=$1 AND status='AWAITING_AGENT'`,[row.id]);
   return {...row,status:'REJECTED'};
  }
  return row;
 }
 async function createRemote(row){
  const ctx={tenantId:row.tenant_id,appId:row.app_id};
  const b=await binding(ctx,row.store_id);
  let interactionId=row.interaction_id;
  if(!interactionId){
   const c=row.customer;
   const r=await createInteraction(b.token,{external_location_id:b.external_location_id,
    purpose:'ORDER_REQUEST'},{
    customerExternalId:c.customerExternalId,
    externalReference:externalRef(row.tenant_id,row.app_id,row.store_id,row.idempotency_key),
    idempotencyKey:row.idempotency_key,summary:'Pedido nuevo !! Aplicación móvil',
    customer:{firstName:c.firstName,lastName:c.lastName,phone:'+51'+c.phone,
     ...(c.email?{email:c.email}:{}),phoneVerified:false,emailVerified:false}});
   if(!r.ok||!UUID.test(r.data?.interactionId)||
    r.data?.externalReference!==externalRef(row.tenant_id,row.app_id,row.store_id,row.idempotency_key)||
    r.data?.externalLocationId!==b.external_location_id||r.data?.purpose!=='ORDER_REQUEST')
    throw fail(503,'No se pudo confirmar la creación de la interacción');
   interactionId=r.data.interactionId;
   await pool.query(`UPDATE mobile_scheduled_orders SET interaction_id=$2,updated_at=now()
    WHERE id=$1 AND (interaction_id IS NULL OR interaction_id=$2)`,[row.id,interactionId]);
  }
  const form=normalizedForm({date:row.service_date,time:row.service_time,
   mode:row.mode,cart:{subtotal:Number(row.subtotal_pen),summary:row.products.summary}});
  const sent=await sendMessage(b.token,interactionId,{idempotencyKey:row.form_key,type:'FORM',form});
  if(!sent.ok||!UUID.test(sent.data?.messageId))
   throw fail(503,'No se pudo confirmar la entrega del FORM');
  await pool.query(`UPDATE mobile_scheduled_orders SET status='AWAITING_AGENT',
   interaction_id=$2,form_sent=true,updated_at=now()
   WHERE id=$1 AND status IN ('CREATING','FORM_UNCERTAIN')`,[row.id,interactionId]);
 }
 return async function route({req,res,url}){
  if(url.pathname==='/api/v1/mobile/reservations/quote'){
   if(req.method!=='POST')throw fail(405,'Método no permitido');
   if(!live())throw fail(503,'Reservas pendientes de habilitación');
   const q=quoteInput(await body(req)),ctx=await catalog(q.appId);
   const sel=await selection(ctx,q);
   return json(res,200,{...sel,revision:ctx.revision,agentAvailable:true,
    capacityAvailable:true,provisional:true,acceptingRequests:true},true);
  }
  if(url.pathname==='/api/v1/mobile/reservations'){
   if(req.method!=='POST')throw fail(405,'Método no permitido');
   if(!live())throw fail(503,'Reservas pendientes de habilitación');
   const value=normalizeReserveRequest(await body(req));
   const key=req.headers['idempotency-key'],access=req.headers['x-order-access-key'];
   if(!UUID.test(key||'')||!UUID.test(access||'')||key===access)
    throw fail(400,'Identificadores de pedido inválidos');
   const ctx=await catalog(value.appId);
   const requestHash=sha(JSON.stringify(value));
   const existing=await pool.query(`SELECT o.*,s.name AS store_name
    FROM mobile_scheduled_orders o JOIN stores s ON s.id=o.store_id
    WHERE o.tenant_id=$1 AND o.app_id=$2 AND o.idempotency_key=$3`,
    [ctx.tenantId,value.appId,key]);
   if(existing.rowCount){
    const prior=existing.rows[0];
    if(prior.request_hash!==requestHash||prior.access_hash!==ownerHash(access))
     throw fail(409,'El identificador pertenece a una solicitud diferente');
    return json(res,200,response(await expire(prior)),true);
   }
   const sel=await selection(ctx,value);
   if(value.storeId!==sel.storeId||
     value.mode==='delivery'&&value.expectedDeliveryFeePen!==Math.round(sel.deliveryFeePen*100))
    throw fail(409,'La sede o tarifa cambiaron. Revisa la cotización');
   const cart=calculateOrderCart(ctx.payload.products,value.items);
   normalizedForm({date:value.date,time:value.time,mode:value.mode,cart});
   const subtotalPen=Number(cart.subtotal.toFixed(2));
   const feePen=Number(sel.deliveryFeePen.toFixed(2));
   let saved;
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const lock=await client.query('SELECT id FROM stores WHERE id=$1 AND tenant_id=$2 FOR UPDATE',
     [sel.storeId,ctx.tenantId]);
    if(lock.rowCount!==1)throw fail(409,'Sede deshabilitada');
    // Recheck live capacity while holding a per-store row lock. Other creates
    // for this store serialize here, preventing oversubscription.
    const current=await client.query(`SELECT r.max_orders_per_slot,r.enabled
      FROM store_reservation_settings r WHERE r.tenant_id=$1 AND r.store_id=$2`,
      [ctx.tenantId,sel.storeId]);
    if(current.rowCount!==1||current.rows[0].enabled!==true)
     throw fail(409,'La sede dejó de aceptar reservas');
    const count=await client.query(`SELECT count(*)::int AS n FROM mobile_scheduled_orders
      WHERE tenant_id=$1 AND store_id=$2 AND scheduled_at=$3 AND
      status=ANY($4::text[]) AND (status='CONFIRMED' OR hold_until>now())`,
      [ctx.tenantId,sel.storeId,sel.scheduledAt,activeStates]);
    if(count.rows[0].n>=current.rows[0].max_orders_per_slot)
     throw fail(409,'Ya no quedan cupos en este horario');
    const customer={...value.customer,customerExternalId:value.customerExternalId};
    const dest=value.mode==='delivery'?
     {address:value.address.trim(),district:value.district.trim(),reference:value.reference||'',
      latitude:value.latitude,longitude:value.longitude}:null;
    const ins=await client.query(`INSERT INTO mobile_scheduled_orders
     (tenant_id,app_id,store_id,idempotency_key,access_hash,request_hash,mode,scheduled_at,
      service_date,service_time,hold_until,catalog_revision,products,customer,destination,
      subtotal_pen,delivery_fee_pen,total_pen,preparation_minutes,form_key)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$8,$11,$12::jsonb,$13::jsonb,
      $14::jsonb,$15,$16,$17,$18,$19)
     RETURNING *`,
     [ctx.tenantId,value.appId,sel.storeId,key,ownerHash(access),requestHash,
      value.mode,sel.scheduledAt,value.date,value.time,ctx.revision,JSON.stringify(cart),
      JSON.stringify(customer),JSON.stringify(dest),subtotalPen,feePen,
      Number((subtotalPen+feePen).toFixed(2)),sel.preparationMinutes,randomUUID()]);
    saved={...ins.rows[0],store_name:sel.storeName};
    await client.query('COMMIT');
   }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
   try{await createRemote(saved)}
   catch(e){
    await pool.query(`UPDATE mobile_scheduled_orders SET
      status=CASE WHEN interaction_id IS NOT NULL THEN 'FORM_UNCERTAIN' ELSE 'CREATING' END,
      updated_at=now() WHERE id=$1 AND status='CREATING'`,[saved.id]);
    // Do not auto-resend a possibly delivered FORM. It is safe to inspect manually.
    const again=await findMine(value.appId,saved.id,access);
    return json(res,202,{...response(again),warning:'La entrega al asesor requiere comprobación; no se reenviará automáticamente.'},true);
   }
   return json(res,201,response(await findMine(value.appId,saved.id,access)),true);
  }
  const recovery=url.pathname.match(/^\/api\/v1\/mobile\/reservations\/by-key\/([0-9a-f-]{36})$/i);
  if(recovery){
   if(req.method!=='GET')throw fail(405,'Método no permitido');
   const appId=url.searchParams.get('appId'),access=req.headers['x-order-access-key'];
   if(!APP.test(appId||'')||!UUID.test(access||''))throw fail(400,'Datos de recuperación inválidos');
   const ctx=await catalog(appId);
   const q=await pool.query(`SELECT o.*,s.name AS store_name FROM mobile_scheduled_orders o
    JOIN stores s ON s.id=o.store_id AND s.tenant_id=o.tenant_id
    WHERE o.tenant_id=$1 AND o.app_id=$2 AND o.idempotency_key=$3 AND o.access_hash=$4`,
    [ctx.tenantId,appId,recovery[1],ownerHash(access)]);
   if(!q.rowCount)throw fail(404,'No se encontró la solicitud');
   return json(res,200,response(await expire(q.rows[0])),true);
  }
  const found=url.pathname.match(/^\/api\/v1\/mobile\/reservations\/([0-9a-f-]{36})(?:\/(payment|cancel))?$/i);
  if(!found)return false;
  const id=found[1],action=found[2]||'status';
  if(req.method!==(action==='status'?'GET':'POST'))throw fail(405,'Método no permitido');
  const input=action==='status'?Object.fromEntries(url.searchParams):await body(req);
  if(!APP.test(input.appId||''))throw fail(400,'Aplicación inválida');
  const access=req.headers['x-order-access-key'];
  let row=await findMine(input.appId,id,access);
  row=await expire(row);
  if(action==='status'){
   if(row.status==='AWAITING_AGENT')row=await advanceAgent({...row,_accessKey:access});
   row=await expire(row);
   return json(res,200,response(row),true);
  }
  if(action==='cancel'){
   if(row.status==='CONFIRMED')throw fail(409,'Una reserva confirmada debe gestionarse con la sede');
   if(!['REJECTED','CANCELLED','EXPIRED'].includes(row.status)){
    const result=await pool.query(`UPDATE mobile_scheduled_orders SET status='CANCELLED',updated_at=now()
      WHERE id=$1 AND status NOT IN ('CONFIRMED','REJECTED','CANCELLED','EXPIRED') RETURNING *`,[row.id]);
    if(result.rowCount)row={...row,...result.rows[0]};
   }
   return json(res,200,response(row),true);
  }
  if(action==='payment'){
   if(row.status!=='AWAITING_PAYMENT')throw fail(409,'La reserva aún no está aprobada para pagar');
   if(!methods.includes(input.method)||Object.keys(input).some(k=>!['appId','method'].includes(k)))
    throw fail(400,'Método de pago inválido');
   const ctx=await catalog(input.appId);
   if(ctx.tenantId!==row.tenant_id)throw fail(403,'Reserva de otra empresa');
   const pay=await pool.query(`SELECT 1 FROM payment_methods
    WHERE tenant_id=$1 AND store_id=$2 AND mode=$3 AND method=$4 AND enabled=true`,
    [row.tenant_id,row.store_id,row.mode,input.method]);
   if(pay.rowCount!==1)throw fail(409,'Método de pago no habilitado por la sede');
   const client=await pool.connect();
   try{
    await client.query('BEGIN');
    const locked=await client.query('SELECT * FROM mobile_scheduled_orders WHERE id=$1 FOR UPDATE',[row.id]);
    const x=locked.rows[0];
    if(x.status!=='AWAITING_PAYMENT'||new Date(x.payment_expires_at)<=now())
     throw fail(409,'La aprobación o el plazo de pago ya no están vigentes');
    if(x.payment_method&&x.payment_method!==input.method)
     throw fail(409,'Ya se eligió otro medio de pago para la reserva');
    const cash=input.method==='cash';
    const updated=await client.query(`UPDATE mobile_scheduled_orders SET
     payment_method=$2,payment_status=$3,status=$4,
     confirmed_at=CASE WHEN $5 THEN now() ELSE confirmed_at END,
     updated_at=now() WHERE id=$1 RETURNING *`,[row.id,input.method,
     cash?'DUE_AT_RECEIPT':'AWAITING_VERIFICATION',
     cash?'CONFIRMED':'AWAITING_PAYMENT',cash]);
    await client.query('COMMIT');
    row={...row,...updated.rows[0]};
   }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
   return json(res,200,response(row),true);
  }
  return false;
 };
}
