// Pollos B3 — commercial scheduling configuration, isolated from TU VERSO.
// A published configuration is NOT a booking or proof of agent availability.
const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
const own=(v,k)=>Object.prototype.hasOwnProperty.call(v,k);
const error=(code,message)=>Object.assign(new Error(message),{code});
export const DEFAULT_RESERVATION_SETTINGS=Object.freeze({
 enabled:false,minAdvanceMinutes:null,maxAdvanceDays:null,firstTime:null,lastTime:null,
 slotMinutes:null,maxOrdersPerSlot:null,preparationMinutes:null
});
const numeric={
 minAdvanceMinutes:[0,10080],maxAdvanceDays:[1,60],slotMinutes:[15,60],
 maxOrdersPerSlot:[1,500],preparationMinutes:[1,240]
};
const allowed=new Set(Object.keys(DEFAULT_RESERVATION_SETTINGS));
export function normalizeReservationSettings(input){
 if(!input||typeof input!=='object'||Array.isArray(input)||
    Object.keys(input).some(k=>!allowed.has(k))||
    typeof input.enabled!=='boolean')throw error(400,'Configuración de reservas inválida');
 const result={...DEFAULT_RESERVATION_SETTINGS,enabled:input.enabled};
 for(const [key,[min,max]] of Object.entries(numeric)){
  const value=own(input,key)?input[key]:null;
  if(value!==null&&(!Number.isInteger(value)||value<min||value>max))
   throw error(400,'Parámetro de reservas inválido: '+key);
  result[key]=value;
 }
 if(result.slotMinutes!==null&&![15,30,60].includes(result.slotMinutes))
  throw error(400,'El intervalo de reservas debe ser 15, 30 o 60 minutos');
 for(const key of ['firstTime','lastTime']){
  const value=own(input,key)?input[key]:null;
  if(value!==null&&(typeof value!=='string'||!TIME.test(value)))
   throw error(400,'Hora de reserva inválida: '+key);
  result[key]=value;
 }
 if(result.enabled&&Object.entries(result).some(([key,value])=>key!=='enabled'&&value===null))
  throw error(400,'Completa horarios, anticipación, capacidad y preparación antes de habilitar reservas');
 if(result.firstTime!==null&&result.lastTime!==null&&result.firstTime>=result.lastTime)
  throw error(400,'El horario final debe ser posterior al horario inicial en el mismo día');
 if(result.minAdvanceMinutes!==null&&result.maxAdvanceDays!==null&&
    result.minAdvanceMinutes>=result.maxAdvanceDays*1440)
  throw error(400,'La anticipación mínima debe ser inferior a la máxima');
 return result;
}
export function mapReservationSettings(row){
 if(!row)return {...DEFAULT_RESERVATION_SETTINGS};
 return {
  enabled:row.enabled===true,
  minAdvanceMinutes:row.min_advance_minutes??null,
  maxAdvanceDays:row.max_advance_days??null,
  firstTime:row.first_time??null,
  lastTime:row.last_time??null,
  slotMinutes:row.slot_minutes??null,
  maxOrdersPerSlot:row.max_orders_per_slot??null,
  preparationMinutes:row.preparation_minutes??null
 };
}
export function publishedReservationSettings(row){
 const config=mapReservationSettings(row);
 return {...config,acceptingRequests:false};
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
   (tenant_id,store_id,enabled,min_advance_minutes,max_advance_days,first_time,last_time,slot_minutes,max_orders_per_slot,preparation_minutes)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
   ON CONFLICT(tenant_id,store_id) DO UPDATE SET
    enabled=EXCLUDED.enabled,min_advance_minutes=EXCLUDED.min_advance_minutes,
    max_advance_days=EXCLUDED.max_advance_days,first_time=EXCLUDED.first_time,
    last_time=EXCLUDED.last_time,slot_minutes=EXCLUDED.slot_minutes,
    max_orders_per_slot=EXCLUDED.max_orders_per_slot,preparation_minutes=EXCLUDED.preparation_minutes,updated_at=now()
   RETURNING *`,[tenantId,storeId,config.enabled,config.minAdvanceMinutes,config.maxAdvanceDays,
    config.firstTime,config.lastTime,config.slotMinutes,config.maxOrdersPerSlot,config.preparationMinutes]);
  await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',
   [tenantId,actorId,'STORE_RESERVATION_SETTINGS_UPDATED',storeId]);
  await client.query('COMMIT');
  return mapReservationSettings(q.rows[0]);
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}
