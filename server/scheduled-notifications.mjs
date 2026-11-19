// Programador multitenant de notificaciones disponibles por API.
// No envía push: las aplicaciones clientes deben consultar y deduplicar por id.
const matchApp = /^com\.[a-zA-Z0-9_.]+$/;
const safeDate = x => typeof x === 'string' && Number.isFinite(Date.parse(x)) && /^\d{4}-\d\d-\d\dT/.test(x);
const publicImage = (id,appId) => '/api/v1/mobile/notification-images/'+id+'?appId='+encodeURIComponent(appId);

export async function publicNotificationRoutes({req,res,url,pool,json,bad,corsHeaders}){
 if(url.pathname==='/api/v1/mobile/notifications'){
  if(req.method!=='GET')throw bad(405,'Método no permitido');
  const appId=url.searchParams.get('appId');
  if(!appId||!matchApp.test(appId)||appId.length>150)throw bad(400,'appId inválido');
  const enabled=await pool.query('SELECT a.id FROM mobile_apps a JOIN tenants t ON t.id=a.tenant_id WHERE a.app_id=$1 AND a.enabled=true AND t.active=true',[appId]);
  if(!enabled.rowCount)return json(res,200,{ready:false,notifications:[]},true);
  const q=await pool.query(
   'SELECT n.id,n.title,n.message,n.image_id,n.send_at,n.expires_at FROM scheduled_notifications n JOIN mobile_apps a ON a.app_id=n.app_id AND a.tenant_id=n.tenant_id JOIN tenants t ON t.id=n.tenant_id WHERE n.app_id=$1 AND a.enabled=true AND t.active=true AND n.enabled=true AND n.cancelled_at IS NULL AND n.send_at<=now() AND (n.expires_at IS NULL OR n.expires_at>now()) ORDER BY n.send_at DESC,n.id LIMIT 100',
   [appId]);
  return json(res,200,{ready:true,notifications:q.rows.map(n=>({
   id:n.id,title:n.title,message:n.message,imageUrl:publicImage(n.image_id,appId),
   scheduledAt:n.send_at,expiresAt:n.expires_at
  }))},true);
 }
 const picture=url.pathname.match(/^\/api\/v1\/mobile\/notification-images\/([0-9a-f-]{36})$/);
 if(picture&&req.method==='GET'){
  const imageId=picture[1],appId=url.searchParams.get('appId');
  if(!appId||!matchApp.test(appId)||appId.length>150)throw bad(400,'appId inválido');
  const q=await pool.query(
   'SELECT i.mime,i.content FROM product_images i WHERE i.id=$1 AND EXISTS (SELECT 1 FROM scheduled_notifications n JOIN mobile_apps a ON a.app_id=n.app_id AND a.tenant_id=n.tenant_id JOIN tenants t ON t.id=n.tenant_id WHERE n.image_id=i.id AND n.tenant_id=i.tenant_id AND n.app_id=$2 AND a.enabled=true AND t.active=true AND n.enabled=true AND n.cancelled_at IS NULL AND n.send_at<=now() AND (n.expires_at IS NULL OR n.expires_at>now())) LIMIT 1',
   [imageId,appId]);
  if(!q.rowCount)throw bad(404,'Imagen no disponible');
  res.writeHead(200,{'Content-Type':q.rows[0].mime,'Cache-Control':'public,max-age=60',
   'Access-Control-Allow-Origin':'*','X-Content-Type-Options':'nosniff'});
  res.end(q.rows[0].content);
  return true;
 }
 return false;
}

const selectFields = 'SELECT n.id,n.app_id AS "appId",n.title,n.message,n.image_id AS "imageId",n.send_at AS "scheduledAt",n.expires_at AS "expiresAt",n.cancelled_at AS "cancelledAt",n.enabled,n.created_at AS "createdAt",n.push_status AS "pushStatus",n.fcm_message_id AS "fcmMessageId",n.push_sent_at AS "pushSentAt",n.push_attempts AS "pushAttempts",n.push_last_error AS "pushLastError",CASE WHEN n.cancelled_at IS NOT NULL OR n.enabled=false THEN \'CANCELLED\' WHEN n.expires_at IS NOT NULL AND n.expires_at<=now() THEN \'EXPIRED\' WHEN n.send_at<=now() THEN \'AVAILABLE\' ELSE \'SCHEDULED\' END AS status FROM scheduled_notifications n ';
export async function adminNotificationRoutes({req,res,url,user,pool,body,json,tenantOf,bad,uuid}){
 const route=url.pathname.match(/^\/api\/admin\/tenants\/([0-9a-f-]+)\/notifications(?:\/([0-9a-f-]{36})(?:\/(cancel))?)?$/);
 if(!route)return false;
 const tenantId=route[1],notificationId=route[2],action=route[3];
 await tenantOf(user,tenantId);
 if(req.method==='GET'&&!notificationId){
  const q=await pool.query(selectFields+'WHERE n.tenant_id=$1 ORDER BY n.send_at DESC,n.created_at DESC LIMIT 200',[tenantId]);
  return json(res,200,{items:q.rows});
 }
 if(!['POST','DELETE'].includes(req.method))throw bad(405,'Método no permitido');
 const payload=await body(req);
 if(notificationId&&!uuid(notificationId))throw bad(400,'Notificación inválida');
 if(req.method==='POST'&&!notificationId&&!action){
  const appId=payload.appId,imageId=payload.imageId,title=payload.title,message=payload.message;
  if(typeof appId!=='string'||appId.length>150||!matchApp.test(appId)||
     typeof title!=='string'||title.trim().length<2||title.trim().length>120||
     typeof message!=='string'||message.trim().length<1||message.trim().length>2000||
     !uuid(imageId)||!safeDate(payload.scheduledAt)||
     payload.expiresAt!=null&&(!safeDate(payload.expiresAt)||Date.parse(payload.expiresAt)<=Date.parse(payload.scheduledAt)))
   throw bad(400,'Completa aplicación, título, texto, imagen y fecha válida');
  const schedule=new Date(payload.scheduledAt);
  if(schedule.getTime()<Date.now()-60000)throw bad(400,'La fecha programada ya pasó');
  if(payload.expiresAt&&Date.parse(payload.expiresAt)-schedule.getTime()>90*86400000)
   throw bad(400,'La caducidad no puede exceder 90 días');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const app=await client.query('SELECT 1 FROM mobile_apps WHERE tenant_id=$1 AND app_id=$2',[tenantId,appId]);
   if(!app.rowCount)throw bad(404,'Aplicación no registrada para esta empresa');
   const image=await client.query('SELECT octet_length(content) AS bytes FROM product_images WHERE tenant_id=$1 AND id=$2',[tenantId,imageId]);
   if(!image.rowCount)throw bad(404,'Imagen no pertenece a esta empresa');
   if(Number(image.rows[0].bytes)>1024*1024)throw bad(400,'Para enviar notificaciones por FCM la imagen debe pesar máximo 1 MB');
   let q;
   if(payload.id){
    if(!uuid(payload.id))throw bad(400,'Notificación inválida');
    q=await client.query(
     "UPDATE scheduled_notifications SET app_id=$3,title=$4,message=$5,image_id=$6,send_at=$7,expires_at=$8,updated_at=now() WHERE tenant_id=$1 AND id=$2 AND cancelled_at IS NULL AND enabled=true AND send_at>now() AND push_status IN ('PENDING','RETRY','SKIPPED') RETURNING id",
     [tenantId,payload.id,appId,title.trim(),message.trim(),imageId,schedule,payload.expiresAt||null]);
    if(!q.rowCount)throw bad(409,'Solo puedes editar notificaciones pendientes');
   }else{
    q=await client.query(
     'INSERT INTO scheduled_notifications(tenant_id,app_id,title,message,image_id,send_at,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
     [tenantId,appId,title.trim(),message.trim(),imageId,schedule,payload.expiresAt||null,user.id]);
   }
   const id=q.rows[0].id;
   await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',
    [tenantId,user.id,payload.id?'NOTIFICATION_UPDATED':'NOTIFICATION_CREATED',id]);
   await client.query('COMMIT');
   const result=await pool.query(selectFields+'WHERE n.tenant_id=$1 AND n.id=$2',[tenantId,id]);
   return json(res,payload.id?200:201,result.rows[0]);
  }catch(err){await client.query('ROLLBACK');throw err}finally{client.release()}
 }
 if(notificationId&&req.method==='POST'&&action==='cancel'){
  if(payload.confirm!==true)throw bad(400,'Confirma la cancelación');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query("UPDATE scheduled_notifications SET enabled=false,cancelled_at=now(),updated_at=now() WHERE tenant_id=$1 AND id=$2 AND cancelled_at IS NULL AND send_at>now() AND push_status IN ('PENDING','RETRY','SKIPPED') RETURNING id",[tenantId,notificationId]);
   if(!q.rowCount)throw bad(409,'No se puede cancelar: la notificación ya estaba disponible o no existe');
   await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[tenantId,user.id,'NOTIFICATION_CANCELLED',notificationId]);
   await client.query('COMMIT');
   return json(res,200,{cancelled:true,id:notificationId});
  }catch(err){await client.query('ROLLBACK');throw err}finally{client.release()}
 }
 if(notificationId&&req.method==='DELETE'&&!action){
  if(payload.confirm!==true)throw bad(400,'Confirma la eliminación');
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   const q=await client.query('DELETE FROM scheduled_notifications WHERE tenant_id=$1 AND id=$2 RETURNING id',[tenantId,notificationId]);
   if(!q.rowCount)throw bad(404,'Notificación no encontrada');
   await client.query('INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,$3,$4)',[tenantId,user.id,'NOTIFICATION_DELETED',notificationId]);
   await client.query('COMMIT');
   return json(res,200,{deleted:true,id:notificationId});
  }catch(err){await client.query('ROLLBACK');throw err}finally{client.release()}
 }
 throw bad(405,'Acción no permitida');
}
