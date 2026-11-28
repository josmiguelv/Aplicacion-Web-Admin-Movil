// Pollos B3 — reservations are enabled per store; agent availability comes from TU VERSO.
// Only preparation time is configured. A reservation date/time is supplied by the customer.
const error=(code,message)=>Object.assign(new Error(message),{code});
export const DEFAULT_RESERVATION_SETTINGS=Object.freeze({enabled:false,preparationMinutes:null});
export function normalizeReservationSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!['enabled','preparationMinutes'].includes(k))||
    typeof input.enabled!=='boolean')throw error(400,'Configuración de reservas inválida');
 const value=input.preparationMinutes??null;
 if(value!==null&&(!Number.isInteger(value)||value<1||value>240))
  throw error(400,'Tiempo de preparación inválido (1 a 240 minutos)');
 if(input.enabled&&value===null)throw error(400,'Configura el tiempo de preparación para habilitar reservas');
 return {enabled:input.enabled,preparationMinutes:value};
}
export function mapReservationSettings(row){
 if(!row)return {...DEFAULT_RESERVATION_SETTINGS};
 return {enabled:row.enabled===true,preparationMinutes:row.preparation_minutes??null};
}
export function publishedReservationSettings(row){
 return mapReservationSettings(row);
}
export async function readStoreReservationSettings(pool,tenantId,storeId){
 const owned=await pool.query('SELECT id FROM stores WHERE tenant_id=$1 AND id=$2',[tenantId,storeId]);
 if(!owned.rowCount)throw error(404,'Sede no encontrada para esta empresa');
 const rows=await pool.query('SELECT * FROM store_reservation_settings WHERE tenant_id=$1 AND store_id=$2',[tenantId,storeId]);
 return mapReservationSettings(rows.rows[0]);
}
export async function saveStoreReservationSettings(pool,tenantId,storeId,actorId,input){
 const config=normalizeReservationSettings(input);
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const owned=await client.query('SELECT id FROM stores WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[tenantId,storeId]);
  if(!owned.rowCount)throw error(404,'Sede no encontrada para esta empresa');
  const q=await client.query(`INSERT INTO store_reservation_settings
   (tenant_id,store_id,enabled,preparation_minutes)
   VALUES($1,$2,$3,$4)
   ON CONFLICT(tenant_id,store_id) DO UPDATE SET
    enabled=EXCLUDED.enabled,preparation_minutes=EXCLUDED.preparation_minutes,
    min_advance_minutes=NULL,max_advance_days=NULL,first_time=NULL,last_time=NULL,
    slot_minutes=NULL,max_orders_per_slot=NULL,updated_at=now()
   RETURNING *`,[tenantId,storeId,config.enabled,config.preparationMinutes]);
  await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',
   [tenantId,actorId,'STORE_RESERVATION_SETTINGS_UPDATED',storeId]);
  await client.query('COMMIT');
  return mapReservationSettings(q.rows[0]);
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
