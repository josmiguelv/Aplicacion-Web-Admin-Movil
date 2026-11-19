// Frecuencia semanal independiente del transporte FCM.
// Genera una ocurrencia por fecha local; la API y FCM existentes la procesan.
const appPattern=/^com\.[A-Za-z0-9_.]+$/
const timePattern=/^(?:[01]\d|2[0-3]):[0-5]\d$/
const validDate=value=>{
 if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(value))return false
 const d=new Date(value+'T00:00:00Z')
 return Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===value
}
const problem=(bad,status,msg)=>{throw bad(status,msg)}
// Normalizar franjas por día. Dos reglas del mismo día pueden ser distintas,
// pero no solaparse: de lo contrario llegarían pushes promocionales duplicados.
export function parseWeeklySlots(data,bad=(status,msg)=>Object.assign(new Error(msg),{code:status})){
 const input=Array.isArray(data.slots)?data.slots:[{weekday:data.weekday,startTime:data.startTime,endTime:data.endTime}]
 if(input.length<1||input.length>42)problem(bad,400,'Elige entre 1 y 42 franjas semanales')
 const slots=input.map(item=>({
  weekday:item?.weekday,
  startTime:item?.startTime,
  endTime:item?.endTime
 }))
 for(const item of slots){
  if(!Number.isInteger(item.weekday)||item.weekday<1||item.weekday>7||
     typeof item.startTime!=='string'||!timePattern.test(item.startTime)||
     typeof item.endTime!=='string'||!timePattern.test(item.endTime)||
     item.startTime>=item.endTime)problem(bad,400,'Día u horario semanal inválido')
 }
 slots.sort((a,b)=>a.weekday-b.weekday||a.startTime.localeCompare(b.startTime)||a.endTime.localeCompare(b.endTime))
 for(let i=1;i<slots.length;i++){
  const left=slots[i-1],right=slots[i]
  if(left.weekday===right.weekday&&left.endTime>right.startTime)
   problem(bad,400,'Hay horarios superpuestos el mismo día: ajusta las franjas')
 }
 return slots
}
async function attachSlots(pool,rows){
 if(!rows.length)return rows
 const q=await pool.query(
  'SELECT recurrence_id AS "recurrenceId",weekday,to_char(start_time,\'HH24:MI\') AS "startTime",to_char(end_time,\'HH24:MI\') AS "endTime" FROM recurring_notification_slots WHERE recurrence_id=ANY($1::uuid[]) AND active=true ORDER BY weekday,start_time,end_time',
  [rows.map(x=>x.id)])
 return rows.map(row=>({...row,slots:q.rows.filter(slot=>slot.recurrenceId===row.id).map(({weekday,startTime,endTime})=>({weekday,startTime,endTime}))}))
}

const rowSQL=[
 'SELECT r.id,r.app_id AS "appId",r.title,r.message,r.image_id AS "imageId",',
 'r.product_id AS "productId",p.name AS "productName",r.weekday,',
 'to_char(r.start_time,\'HH24:MI\') AS "startTime",',
 'to_char(r.end_time,\'HH24:MI\') AS "endTime",',
 'to_char(r.start_date,\'YYYY-MM-DD\') AS "startDate",',
 'to_char(r.until_date,\'YYYY-MM-DD\') AS "untilDate",',
 'r.time_zone AS "timeZone",r.status,r.created_at AS "createdAt",r.updated_at AS "updatedAt"',
 'FROM recurring_notifications r LEFT JOIN products p ON p.id=r.product_id AND p.tenant_id=r.tenant_id'
].join(' ')

export async function adminRecurrenceRoutes({req,res,url,user,pool,body,json,tenantOf,bad,uuid}){
 const route=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/notification-series(?:\/([0-9a-f-]{36})(?:\/(pause|resume|delete))?)?$/)
 if(!route)return false
 const tenantId=route[1],seriesId=route[2],action=route[3]
 await tenantOf(user,tenantId)
 if(req.method==='GET'&&!seriesId){
  const q=await pool.query(rowSQL+" WHERE r.tenant_id=$1 AND r.status!='DELETED' ORDER BY r.created_at DESC LIMIT 200",[tenantId])
  return json(res,200,{items:await attachSlots(pool,q.rows)})
 }
 if(req.method!=='POST')problem(bad,405,'Método no permitido')
 const data=await body(req)
 if(seriesId&&!uuid(seriesId))problem(bad,400,'Secuencia inválida')
 if(seriesId&&action){
  if(action==='delete'&&data.confirm!==true)problem(bad,400,'Confirma la eliminación de la secuencia')
  const next={pause:'PAUSED',resume:'ACTIVE',delete:'DELETED'}[action]
  const client=await pool.connect()
  try{
   await client.query('BEGIN')
   const q=await client.query(
    "UPDATE recurring_notifications SET status=$3,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status!='DELETED' RETURNING id",
    [tenantId,seriesId,next])
   if(!q.rowCount)problem(bad,404,'Secuencia no encontrada')
   await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',
    [tenantId,user.id,'NOTIFICATION_SERIES_'+action.toUpperCase(),seriesId])
   await client.query('COMMIT')
   return json(res,200,{id:seriesId,status:next})
  }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
 }
 if(seriesId||action)problem(bad,404,'Ruta de secuencia inválida')
 const appId=data.appId,imageId=data.imageId,productId=data.productId||null
 const title=data.title, message=data.message
 const slots=parseWeeklySlots(data,bad)
 const {weekday,startTime,endTime}=slots[0]
 const startDate=data.startDate,untilDate=data.untilDate||null
 if(typeof appId!=='string'||appId.length>150||!appPattern.test(appId)||
   typeof title!=='string'||title.trim().length<2||title.trim().length>120||
   typeof message!=='string'||message.trim().length<1||message.trim().length>2000||
   !uuid(imageId)||productId!==null&&!uuid(productId)||
   !validDate(startDate)||(untilDate!==null&&(!validDate(untilDate)||untilDate<startDate))||
   data.timeZone!=null&&data.timeZone!=='America/Lima')
  problem(bad,400,'Completa aplicación, mensaje, imagen, día, horario y fechas válidas')
 const client=await pool.connect()
 try{
  await client.query('BEGIN')
  const app=await client.query('SELECT 1 FROM mobile_apps WHERE app_id=$1 AND tenant_id=$2',[appId,tenantId])
  if(!app.rowCount)problem(bad,404,'Aplicación no registrada para esta empresa')
  const img=await client.query('SELECT octet_length(content) AS bytes FROM product_images WHERE id=$1 AND tenant_id=$2',[imageId,tenantId])
  if(!img.rowCount)problem(bad,404,'Imagen no pertenece a esta empresa')
  if(Number(img.rows[0].bytes)>1024*1024)problem(bad,400,'La imagen para FCM debe pesar máximo 1 MB')
  if(productId){
   const product=await client.query('SELECT 1 FROM products WHERE id=$1 AND tenant_id=$2 AND active=true',[productId,tenantId])
   if(!product.rowCount)problem(bad,400,'Selecciona un producto activo de esta empresa')
  }
  let q
  if(data.id){
   if(!uuid(data.id))problem(bad,400,'Secuencia inválida')
   q=await client.query(
    "UPDATE recurring_notifications SET app_id=$3,title=$4,message=$5,image_id=$6,product_id=$7,weekday=$8,start_time=$9,end_time=$10,start_date=$11,until_date=$12,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND status!='DELETED' RETURNING id",
    [tenantId,data.id,appId,title.trim(),message.trim(),imageId,productId,weekday,startTime,endTime,startDate,untilDate])
   if(!q.rowCount)problem(bad,404,'Secuencia no encontrada')
  }else{
   q=await client.query(
    'INSERT INTO recurring_notifications(tenant_id,app_id,created_by,title,message,image_id,product_id,weekday,start_time,end_time,start_date,until_date) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id',
    [tenantId,appId,user.id,title.trim(),message.trim(),imageId,productId,weekday,startTime,endTime,startDate,untilDate])
  }
  const id=q.rows[0].id
  // Regla existente conserva su ID e historial al editar o reactivar.
  // Las reglas retiradas permanecen inactivas para preservar auditoría.
  await client.query('UPDATE recurring_notification_slots SET active=false WHERE recurrence_id=$1',[id])
  for(const slot of slots){
   await client.query(
    'INSERT INTO recurring_notification_slots(recurrence_id,weekday,start_time,end_time) VALUES($1,$2,$3,$4) ON CONFLICT (recurrence_id,weekday,start_time,end_time) DO UPDATE SET active=true',
    [id,slot.weekday,slot.startTime,slot.endTime])
  }
  await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',
   [tenantId,user.id,data.id?'NOTIFICATION_SERIES_UPDATED':'NOTIFICATION_SERIES_CREATED',id])
  await client.query('COMMIT')
  const result=await pool.query(rowSQL+' WHERE r.tenant_id=$1 AND r.id=$2',[tenantId,id])
  return json(res,data.id?200:201,(await attachSlots(pool,result.rows))[0])
 }catch(e){await client.query('ROLLBACK');throw e}finally{client.release()}
}

export async function materializeDue({pool,at=new Date()}){
 const atDate=new Date(at)
 if(!Number.isFinite(atDate.getTime()))throw Error('Instante de programación inválido')
 // Índice único por fecha y franja: multi-día, multi-horario y sin reenvíos
 // al reiniciar o ejecutar varios workers en paralelo.
 const sql=[
 'INSERT INTO scheduled_notifications',
 '(tenant_id,app_id,created_by,title,message,image_id,product_id,send_at,expires_at,recurrence_id,occurrence_date,recurrence_slot_id)',
 'SELECT r.tenant_id,r.app_id,r.created_by,r.title,r.message,r.image_id,',
 'CASE WHEN p.active=true THEN r.product_id ELSE NULL END,',
 "((clock.local_date+s.start_time) AT TIME ZONE 'America/Lima'),",
 "((clock.local_date+s.end_time) AT TIME ZONE 'America/Lima'),",
 'r.id,clock.local_date,s.id',
 'FROM recurring_notifications r',
 'JOIN recurring_notification_slots s ON s.recurrence_id=r.id AND s.active=true',
 'JOIN tenants t ON t.id=r.tenant_id AND t.active=true',
 'JOIN mobile_apps a ON a.tenant_id=r.tenant_id AND a.app_id=r.app_id AND a.enabled=true',
 'JOIN product_images i ON i.id=r.image_id AND i.tenant_id=r.tenant_id',
 'LEFT JOIN products p ON p.id=r.product_id AND p.tenant_id=r.tenant_id',
 "CROSS JOIN (SELECT ($1::timestamptz AT TIME ZONE 'America/Lima')::date AS local_date) clock",
 "WHERE r.status='ACTIVE' AND r.time_zone='America/Lima'",
 'AND s.weekday=EXTRACT(ISODOW FROM clock.local_date)',
 'AND clock.local_date>=r.start_date AND (r.until_date IS NULL OR clock.local_date<=r.until_date)',
 "AND $1::timestamptz>=((clock.local_date+s.start_time) AT TIME ZONE 'America/Lima')",
 "AND $1::timestamptz<((clock.local_date+s.end_time) AT TIME ZONE 'America/Lima')",
 'AND octet_length(i.content)<=1048576',
 'ON CONFLICT DO NOTHING RETURNING id'
 ].join(' ')
 const result=await pool.query(sql,[atDate.toISOString()])
 return {created:result.rowCount||0}
}
export function startRecurringWorker({pool,logger=console,intervalMs=15000}){
 let running=false,stopped=false
 async function tick(){
  if(running||stopped)return
  running=true
  try{await materializeDue({pool})}
  catch(e){logger.error('Recurring notifications: '+String(e?.message||'Error'))}
  finally{running=false}
 }
 const timer=setInterval(()=>void tick(),Math.max(5000,intervalMs))
 timer.unref?.()
 void tick()
 return {stop(){stopped=true;clearInterval(timer)}}
}
