// Administrative review/attestation; never equate an unverified mobile payment
// selection with real funds. No provider callback is invented.
import {UUID,fail} from './mobile-reservation-domain.mjs';
export function createAdminReservationRoutes({pool,body,json,tenantOf}){
 return async function route({req,res,url,user}){
  const list=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]{36})\/reservations$/i);
  const action=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]{36})\/reservations\/([0-9a-f-]{36})\/(verify-payment|cancel)$/i);
  if(!list&&!action)return false;
  const tenantId=(list||action)[1];
  await tenantOf(user,tenantId);
  if(list){
   if(req.method!=='GET')throw fail(405,'Método no permitido');
   const result=await pool.query(`SELECT o.id,o.store_id,s.name AS store_name,o.app_id,o.mode,
    o.service_date,o.service_time,o.scheduled_at,o.status,o.payment_method,o.payment_status,
    o.subtotal_pen,o.delivery_fee_pen,o.total_pen,o.preparation_minutes,o.interaction_id,
    o.customer->>'firstName' AS first_name,o.customer->>'lastName' AS last_name,
    o.customer->>'phone' AS customer_phone,
    o.destination->>'address' AS delivery_address,o.destination->>'district' AS delivery_district,
    o.created_at,o.confirmed_at,o.payment_expires_at,o.form_sent
    FROM mobile_scheduled_orders o JOIN stores s ON s.id=o.store_id AND s.tenant_id=o.tenant_id
    WHERE o.tenant_id=$1 ORDER BY o.created_at DESC LIMIT 100`,[tenantId]);
   return json(res,200,{items:result.rows});
  }
  if(req.method!=='POST')throw fail(405,'Método no permitido');
  const id=action[2],kind=action[3],input=await body(req);
  if(!UUID.test(id))throw fail(400,'Reserva inválida');
  if(!input||typeof input!=='object'||Array.isArray(input))throw fail(400,'Datos inválidos');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query(`SELECT * FROM mobile_scheduled_orders
    WHERE tenant_id=$1 AND id=$2 FOR UPDATE`,[tenantId,id]);
   if(q.rowCount!==1)throw fail(404,'Reserva no encontrada');
   const row=q.rows[0];
   if(kind==='cancel'){
    if(Object.keys(input).some(k=>k!=='reason')||
      typeof input.reason!=='string'||input.reason.trim().length<6||input.reason.length>280)
     throw fail(400,'Indica motivo administrativo de cancelación');
    if(row.status==='CONFIRMED')throw fail(409,'No cancelar un pedido confirmado sin gestión de devolución');
    if(!['REJECTED','CANCELLED','EXPIRED'].includes(row.status)){
     await client.query(`UPDATE mobile_scheduled_orders SET status='CANCELLED',updated_at=now()
      WHERE id=$1`,[id]);
     await client.query(`INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id)
      VALUES($1,$2,$3,$4)`,[tenantId,user.id,'RESERVATION_CANCELLED',id]);
    }
   }else{
    if(Object.keys(input).some(k=>!['providerReference','amountPen','verified'].includes(k))||
      input.verified!==true||typeof input.providerReference!=='string'||
      input.providerReference.trim().length<6||input.providerReference.length>120||
      !Number.isFinite(input.amountPen)||
      Math.round(input.amountPen*100)!==Math.round(Number(row.total_pen)*100))
     throw fail(400,'Verifica en el proveedor el importe completo y la referencia real del cobro');
    if(row.status==='CONFIRMED'&&row.payment_status==='VERIFIED'&&
      row.payment_reference===input.providerReference.trim()){
     await client.query('COMMIT');return json(res,200,{id,status:'CONFIRMED',paymentStatus:'VERIFIED'});
    }
    if(row.status!=='AWAITING_PAYMENT'||row.payment_status!=='AWAITING_VERIFICATION'||
      !['yape','plin','card'].includes(row.payment_method)||
      !row.payment_expires_at||new Date(row.payment_expires_at)<=new Date())
     throw fail(409,'La reserva no admite esta verificación de pago');
    await client.query(`UPDATE mobile_scheduled_orders SET
     status='CONFIRMED',payment_status='VERIFIED',payment_reference=$2,
     confirmed_at=now(),updated_at=now() WHERE id=$1`,[id,input.providerReference.trim()]);
    await client.query(`INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id)
     VALUES($1,$2,$3,$4)`,[tenantId,user.id,'RESERVATION_PAYMENT_MANUALLY_VERIFIED',id]);
   }
   await client.query('COMMIT');
   return json(res,200,{id,status:kind==='cancel'?'CANCELLED':'CONFIRMED',
    ...(kind==='verify-payment'?{paymentStatus:'VERIFIED'}:{})});
  }catch(e){await client.query('ROLLBACK');throw e}
  finally{client.release()}
 };
}
