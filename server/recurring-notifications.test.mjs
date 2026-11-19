import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {randomBytes,scryptSync} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'
import {materializeDue} from './recurring-notifications.mjs'

const url=new URL(process.env.DATABASE_URL)
assert.equal(url.hostname,'127.0.0.1','Solo PostgreSQL de CI')
assert.equal(url.pathname,'/admin_api_keys_test','No utilizar bases productivas')
const pool=new pg.Pool({connectionString:url.href})
const base='http://127.0.0.1:4422',origin='http://localhost:3000'
const nonce=randomBytes(5).toString('hex')
const req=async(path,{method='GET',data,cookie}={})=>{
 const response=await fetch(base+path,{
  method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),
   ...(data===undefined?{}:{'Content-Type':'application/json'})},
  ...(data===undefined?{}:{body:JSON.stringify(data)})})
 const result=await response.json().catch(()=>({error:'Respuesta no JSON'}))
 return {code:response.status,body:result,cookie:response.headers.get('set-cookie')?.split(';')[0]||''}
}
const check=async(path,options,expected=200)=>{
 const result=await req(path,options)
 assert.equal(result.code,expected,path+' '+JSON.stringify(result.body))
 return result.body
}
let server
try{
 await pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'))
 const a=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['CI weekly '+nonce])).rows[0].id
 const b=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['CI weekly other '+nonce])).rows[0].id
 const appA='com.ci.weekly.a'+nonce,appB='com.ci.weekly.b'+nonce
 await pool.query('INSERT INTO mobile_apps(tenant_id,app_id,enabled) VALUES($1,$2,true)',[a,appA])
 await pool.query('INSERT INTO mobile_apps(tenant_id,app_id,enabled) VALUES($1,$2,true)',[b,appB])
 const password=randomBytes(20).toString('hex'),salt=randomBytes(16).toString('hex')
 const hash='scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex')
 const email='weekly-'+nonce+'@example.invalid',other='weekly-other-'+nonce+'@example.invalid'
 await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,'TENANT_ADMIN',$3)",[email,hash,a])
 await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,'TENANT_ADMIN',$3)",[other,hash,b])
 server=spawn(process.execPath,['server/index.mjs'],{
  env:{...process.env,NODE_ENV:'test',PORT:'4422',ADMIN_ORIGIN:origin,COOKIE_SECURE:'false',FCM_ENABLED:'false'},
  stdio:'ignore'})
 let ready=false
 for(let i=0;i<100;i++){
  try{if((await fetch(base+'/health/ready')).status===200){ready=true;break}}catch{}
  await delay(100)
 }
 assert.equal(ready,true)
 const signed=await req('/api/admin/login',{method:'POST',data:{email,password}})
 const signedOther=await req('/api/admin/login',{method:'POST',data:{email:other,password}})
 assert.equal(signed.code,200);assert.equal(signedOther.code,200)
 const cookie=signed.cookie,otherCookie=signedOther.cookie,root='/api/admin/tenants/'+a
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64')
 const upload=await fetch(base+root+'/images',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:png})
 assert.equal(upload.status,201)
 const image=(await upload.json()).id
 const product=(await pool.query("INSERT INTO products(tenant_id,name,price_pen,active) VALUES($1,'Promo semanal',39,true) RETURNING id",[a])).rows[0].id
 const alien=(await pool.query("INSERT INTO products(tenant_id,name,price_pen,active) VALUES($1,'Producto de otro tenant',50,true) RETURNING id",[b])).rows[0].id
 const seriesRoot=root+'/notification-series'
 const input={
  appId:appA,title:'Todos los jueves',message:'Promoción 3 a 6 pm',imageId:image,
  productId:null,weekday:4,startTime:'15:00',endTime:'18:00',
  startDate:'2026-11-19',untilDate:'2026-12-03',timeZone:'America/Lima'
 }
 await check(seriesRoot,{method:'POST',data:input},401)
 await check(seriesRoot,{method:'POST',cookie:otherCookie,data:input},403)
 await check(seriesRoot,{method:'POST',cookie,data:{...input,appId:appB}},404)
 await check(seriesRoot,{method:'POST',cookie,data:{...input,productId:alien}},400)
 await check(seriesRoot,{method:'POST',cookie,data:{...input,weekday:8}},400)
 await check(seriesRoot,{method:'POST',cookie,data:{...input,startTime:'18:00',endTime:'15:00'}},400)
 await check(seriesRoot,{method:'POST',cookie,data:{...input,untilDate:'2026-11-01'}},400)
 const first=await check(seriesRoot,{method:'POST',cookie,data:input},201)
 assert.equal(first.status,'ACTIVE')
 assert.equal(first.productId,null,'Producto opcional')
 assert.equal(first.weekday,4)
 assert.equal(first.startTime,'15:00')
 assert.equal(first.endTime,'18:00')
 assert.equal((await check(seriesRoot,{cookie})).items.length,1)

 const q=async (at)=>materializeDue({pool,at})
 assert.equal((await q('2026-11-19T19:59:59Z')).created,0,'Antes de las 15:00 Perú')
 const simultaneous=await Promise.all([q('2026-11-19T20:00:00Z'),q('2026-11-19T20:00:00Z')])
 assert.equal(simultaneous[0].created+simultaneous[1].created,1,'Única ocurrencia con competencia')
 assert.equal((await q('2026-11-19T21:45:00Z')).created,0,'No reenviar dentro de la ventana')
 assert.equal((await q('2026-11-19T23:00:00Z')).created,0,'No enviar después de las 18:00')
 assert.equal((await q('2026-11-20T20:00:00Z')).created,0,'No enviar viernes')
 const rows=(await pool.query('SELECT occurrence_date,send_at,expires_at,product_id,push_status FROM scheduled_notifications WHERE recurrence_id=$1',[first.id])).rows
 assert.equal(rows.length,1)
 assert.equal(rows[0].occurrence_date.toISOString().slice(0,10),'2026-11-19')
 assert.equal(new Date(rows[0].send_at).toISOString(),'2026-11-19T20:00:00.000Z')
 assert.equal(new Date(rows[0].expires_at).toISOString(),'2026-11-19T23:00:00.000Z')
 assert.equal(rows[0].product_id,null)
 assert.equal(rows[0].push_status,'PENDING')

 // La pausa afecta siguientes fechas, sin borrar avisos históricos.
 const paused=await check(seriesRoot+'/'+first.id+'/pause',{method:'POST',cookie,data:{}})
 assert.equal(paused.status,'PAUSED')
 assert.equal((await q('2026-11-26T20:00:00Z')).created,0)
 const resumed=await check(seriesRoot+'/'+first.id+'/resume',{method:'POST',cookie,data:{}})
 assert.equal(resumed.status,'ACTIVE')
 assert.equal((await q('2026-11-26T20:00:00Z')).created,1)
 assert.equal((await q('2026-11-26T21:00:00Z')).created,0)

 // Edición mantiene historial anterior y cambia futuras repeticiones.
 const edited=await check(seriesRoot,{method:'POST',cookie,data:{...input,id:first.id,productId:product,startTime:'16:00'}},200)
 assert.equal(edited.productId,product)
 assert.equal(edited.startTime,'16:00')
 assert.equal((await q('2026-12-03T20:00:00Z')).created,0,'Horario anterior ya no debe disparar')
 assert.equal((await q('2026-12-03T21:00:00Z')).created,1,'Nuevo horario debe disparar')
 assert.equal((await q('2026-12-10T21:00:00Z')).created,0,'Fecha de finalización respetada')
 const third=(await pool.query('SELECT product_id,expires_at FROM scheduled_notifications WHERE recurrence_id=$1 AND occurrence_date=$2',[first.id,'2026-12-03'])).rows[0]
 assert.equal(third.product_id,product)
 assert.equal(new Date(third.expires_at).toISOString(),'2026-12-03T23:00:00.000Z')
 // Eliminar la plantilla detiene próximas repeticiones, conserva historial.
 await check(seriesRoot+'/'+first.id+'/delete',{method:'POST',cookie,data:{confirm:false}},400)
 await check(seriesRoot+'/'+first.id+'/delete',{method:'POST',cookie,data:{confirm:true}})
 assert.equal((await check(seriesRoot,{cookie})).items.length,0)
 assert.equal((await pool.query('SELECT count(*)::int AS count FROM scheduled_notifications WHERE recurrence_id=$1',[first.id])).rows[0].count,3)
 await check(seriesRoot,{method:'POST',cookie,data:{...input,id:first.id}},404)

 const audit=(await pool.query("SELECT action FROM admin_audit WHERE tenant_id=$1 AND action LIKE 'NOTIFICATION_SERIES_%'",[a])).rows.map(x=>x.action)
 for(const action of ['NOTIFICATION_SERIES_CREATED','NOTIFICATION_SERIES_UPDATED','NOTIFICATION_SERIES_PAUSE','NOTIFICATION_SERIES_RESUME','NOTIFICATION_SERIES_DELETE'])
  assert.ok(audit.includes(action),action)
 console.log('PASS frecuencia semanal: ventana 15-18 Perú, sin duplicados, pausa, edición, caducidad, privacidad y borrado')
}finally{
 server?.kill()
 await pool.end()
}
