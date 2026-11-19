import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {randomBytes,scryptSync} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'

const database=new URL(process.env.DATABASE_URL)
assert.equal(database.hostname,'127.0.0.1','Pruebas solo en PostgreSQL de CI')
assert.equal(database.pathname,'/admin_api_keys_test','No usar BD productiva')
const pool=new pg.Pool({connectionString:database.href})
const base='http://127.0.0.1:4421',origin='http://localhost:3000'
const nonce=randomBytes(5).toString('hex')
const req=async(path,{method='GET',data,cookie}={})=>{
 const res=await fetch(base+path,{method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),
  ...(data===undefined?{}:{'Content-Type':'application/json'})},
  ...(data===undefined?{}:{body:JSON.stringify(data)})})
 const result=await res.json().catch(()=>({error:'Respuesta no JSON'}))
 return {code:res.status,body:result,cookie:res.headers.get('set-cookie')?.split(';')[0]||''}
}
const check=async(path,options,status=200)=>{
 const result=await req(path,options)
 assert.equal(result.code,status,path+' '+JSON.stringify(result.body))
 return result.body
}
let server
try{
 await pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'))
 const tenantA=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['CI notifications '+nonce])).rows[0].id
 const tenantB=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['CI notifications other '+nonce])).rows[0].id
 const appA='com.ci.notification.a'+nonce,appB='com.ci.notification.b'+nonce
 await pool.query('INSERT INTO mobile_apps(tenant_id,app_id,enabled) VALUES($1,$2,true)',[tenantA,appA])
 await pool.query('INSERT INTO mobile_apps(tenant_id,app_id,enabled) VALUES($1,$2,true)',[tenantB,appB])
 const pass=randomBytes(20).toString('hex'),salt=randomBytes(16).toString('hex')
 const hash='scrypt:'+salt+':'+scryptSync(pass,salt,64).toString('hex')
 const email='notify-'+nonce+'@example.invalid',other='notify-other-'+nonce+'@example.invalid'
 await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,'TENANT_ADMIN',$3)",[email,hash,tenantA])
 await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,'TENANT_ADMIN',$3)",[other,hash,tenantB])
 server=spawn(process.execPath,['server/index.mjs'],{
  env:{...process.env,NODE_ENV:'test',PORT:'4421',ADMIN_ORIGIN:origin,COOKIE_SECURE:'false'},
  stdio:'ignore'})
 let online=false
 for(let i=0;i<90;i++){try{if((await fetch(base+'/health/ready')).status===200){online=true;break}}catch{}await delay(100)}
 assert.equal(online,true,'API CI activa')
 const logged=await req('/api/admin/login',{method:'POST',data:{email,password:pass}})
 const otherLogin=await req('/api/admin/login',{method:'POST',data:{email:other,password:pass}})
 assert.equal(logged.code,200);assert.equal(otherLogin.code,200)
 const cookie=logged.cookie,otherCookie=otherLogin.cookie,root='/api/admin/tenants/'+tenantA
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64')
 const uploaded=await fetch(base+root+'/images',{method:'POST',headers:{Origin:origin,Cookie:cookie},body:png})
 assert.equal(uploaded.status,201)
 const image=(await uploaded.json()).id
 const good=(await pool.query("INSERT INTO products(tenant_id,name,price_pen,active) VALUES($1,'Pollo especial',25,true) RETURNING id",[tenantA])).rows[0].id
 const foreign=(await pool.query("INSERT INTO products(tenant_id,name,price_pen,active) VALUES($1,'Producto ajeno',15,true) RETURNING id",[tenantB])).rows[0].id
 const inactive=(await pool.query("INSERT INTO products(tenant_id,name,price_pen,active) VALUES($1,'Fuera de carta',15,false) RETURNING id",[tenantA])).rows[0].id
 const future=new Date(Date.now()+3600000).toISOString()
 const notification={appId:appA,title:'Promoción programada',message:'Disponible únicamente en la hora indicada',
  imageId:image,scheduledAt:future,expiresAt:new Date(Date.now()+86400000).toISOString()}
 await check(root+'/notifications',{method:'POST',data:notification},401)
 await check(root+'/notifications',{method:'POST',cookie:otherCookie,data:notification},403)
 await check(root+'/notifications',{method:'POST',cookie,data:{...notification,appId:appB}},404)
 await check(root+'/notifications',{method:'POST',cookie,data:{...notification,productId:foreign}},400)
 await check(root+'/notifications',{method:'POST',cookie,data:{...notification,productId:inactive}},400)
 await check(root+'/notifications',{method:'POST',cookie,data:{...notification,productId:'not-a-uuid'}},400)
 await check(root+'/notifications',{method:'POST',cookie,data:{...notification,imageId:'00000000-0000-4000-8000-000000000005'}},404)
 await check(root+'/notifications',{method:'POST',cookie,data:{...notification,scheduledAt:'2020-01-01T12:00:00Z'}},400)
 const item=await check(root+'/notifications',{method:'POST',cookie,data:notification},201)
 assert.equal(item.status,'SCHEDULED')
 assert.equal(item.productId,null,'El producto no es obligatorio')
 assert.equal((await check(root+'/notifications',{cookie})).items.length,1)
 const publicPath='/api/v1/mobile/notifications?appId='+appA
 assert.equal((await check(publicPath)).notifications.length,0)
 assert.equal((await fetch(base+'/api/v1/mobile/notification-images/'+image+'?appId='+appA)).status,404)
 const rightNow=new Date(Date.now()-4000).toISOString()
 const updated=await check(root+'/notifications',{method:'POST',cookie,
  data:{...notification,id:item.id,title:'Mensaje entregable',scheduledAt:rightNow,expiresAt:null,productId:good}})
 assert.equal(updated.id,item.id)
 assert.equal(updated.status,'AVAILABLE')
 assert.equal(updated.productId,good)
 assert.equal(updated.productName,'Pollo especial')
 const received=await check(publicPath)
 assert.equal(received.ready,true)
 assert.equal(received.notifications.length,1)
 assert.equal(received.notifications[0].title,'Mensaje entregable')
 assert.equal(received.notifications[0].message,notification.message)
 assert.equal(received.notifications[0].id,item.id)
 assert.equal(received.notifications[0].productId,good)
 assert.equal((await check('/api/v1/mobile/notifications?appId='+appB)).notifications.length,0)
 const imagePath=received.notifications[0].imageUrl
 const photo=await fetch(base+imagePath)
 assert.equal(photo.status,200)
 assert.equal(photo.headers.get('content-type'),'image/png')
 assert.equal((await fetch(base+'/api/v1/mobile/notification-images/'+image+'?appId='+appB)).status,404)
 assert.equal((await check(publicPath)).notifications[0].id,item.id,'Estabilidad para deduplicación móvil')
 await check(root+'/notifications',{method:'POST',cookie,data:{...notification,id:item.id}},409)
 await check(root+'/notifications/'+item.id+'/cancel',{method:'POST',cookie,data:{confirm:true}},409)
 await check(root+'/notifications/'+item.id,{method:'DELETE',cookie,data:{confirm:false}},400)
 await check(root+'/notifications/'+item.id,{method:'DELETE',cookie,data:{confirm:true}})
 assert.equal((await check(publicPath)).notifications.length,0)
 assert.equal((await fetch(base+imagePath)).status,404)
 const futureSecond=await check(root+'/notifications',{method:'POST',cookie,
  data:{...notification,productId:good,scheduledAt:new Date(Date.now()+7200000).toISOString(),
   expiresAt:new Date(Date.now()+10800000).toISOString()}},201)
 assert.equal(futureSecond.productId,good)
 const without=await check(root+'/notifications',{method:'POST',cookie,data:{
  ...notification,id:futureSecond.id,productId:null,
  scheduledAt:new Date(Date.now()+7200000).toISOString(),
  expiresAt:new Date(Date.now()+10800000).toISOString()
 }})
 assert.equal(without.productId,null,'La edición permite quitar producto')
 await check(root+'/notifications/'+futureSecond.id+'/cancel',{method:'POST',cookie,data:{confirm:false}},400)
 await check(root+'/notifications/'+futureSecond.id+'/cancel',{method:'POST',cookie,data:{confirm:true}})
 assert.equal((await check(root+'/notifications',{cookie})).items.find(x=>x.id===futureSecond.id).status,'CANCELLED')
 assert.equal((await check(publicPath)).notifications.length,0)
 // Eliminar un producto desvincula la campaña sin eliminarla.
 const removable=await check(root+'/notifications',{method:'POST',cookie,data:{
  ...notification,productId:good,scheduledAt:new Date(Date.now()+14400000).toISOString(),
  expiresAt:new Date(Date.now()+17280000).toISOString()
 }},201)
 await pool.query('DELETE FROM products WHERE tenant_id=$1 AND id=$2',[tenantA,good])
 assert.equal((await check(root+'/notifications',{cookie})).items.find(n=>n.id===removable.id).productId,null)
 const audit=(await pool.query("SELECT action FROM admin_audit WHERE tenant_id=$1 AND action LIKE 'NOTIFICATION_%'",[tenantA])).rows.map(x=>x.action)
 for(const event of ['NOTIFICATION_CREATED','NOTIFICATION_UPDATED','NOTIFICATION_CANCELLED','NOTIFICATION_DELETED'])assert.ok(audit.includes(event),event)
 console.log('PASS notificaciones: autorización, multitenant, imagen segura, programación, edición, consulta y cancelación')
}finally{
 server?.kill()
 await pool.end()
}
