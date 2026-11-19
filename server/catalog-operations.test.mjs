import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomBytes,scryptSync} from 'node:crypto'
import {readFileSync} from 'node:fs'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'

const database=new URL(process.env.DATABASE_URL)
assert.equal(database.hostname,'127.0.0.1','Pruebas únicamente en PostgreSQL CI')
assert.equal(database.pathname,'/admin_api_keys_test','Pruebas únicamente en PostgreSQL CI')
const pool=new pg.Pool({connectionString:database.href})
const base='http://127.0.0.1:4414',origin='http://localhost:3000'
const created=[]
let child
async function call(path,{method='GET',data,cookie}={}){
 const r=await fetch(base+path,{
  method,headers:{Origin:origin,...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},
  ...(data===undefined?{}:{body:JSON.stringify(data)})
 })
 const txt=await r.text(),result=txt?JSON.parse(txt):null
 return {status:r.status,result,cookie:r.headers.get('set-cookie')?.split(';')[0]||''}
}
async function ready(){
 for(let i=0;i<90;i++){try{if((await fetch(base+'/health/ready')).ok)return}catch{}await delay(100)}
 throw Error('Servidor de prueba no inició')
}
const storeData=(code,name)=>({code,name,address:'Solo pruebas',active:true,delivery_enabled:true,pickup_enabled:true,dine_in_enabled:false,openingHours:null,
 latitude:null,longitude:null,radiusKm:null,deliveryPricingMode:'PER_KM',deliveryRatePerKmPen:null,deliveryFeePen:null})
try{
 await pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'))
 const tenantA=(await pool.query("INSERT INTO tenants(name) VALUES('UX delete store A') RETURNING id")).rows[0].id
 const tenantB=(await pool.query("INSERT INTO tenants(name) VALUES('UX delete store B') RETURNING id")).rows[0].id
 created.push(tenantA,tenantB)
 const salt=randomBytes(16).toString('hex'),pass=randomBytes(24).toString('hex'),hash='scrypt:'+salt+':'+scryptSync(pass,salt,64).toString('hex')
 const email='ux-test-'+randomBytes(8).toString('hex')+'@example.invalid'
 await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,'TENANT_ADMIN',$3)",[email,hash,tenantA])
 const otherEmail='ux-other-'+randomBytes(8).toString('hex')+'@example.invalid'
 await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,'TENANT_ADMIN',$3)",[otherEmail,hash,tenantB])
 const userId=(await pool.query('SELECT id FROM admin_users WHERE email=$1',[email])).rows[0].id
 await pool.query("INSERT INTO mobile_apps(tenant_id,app_id) VALUES($1,$2)",[tenantA,'com.ci.delete.test'])
 child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:'4414',ADMIN_ORIGIN:origin,COOKIE_SECURE:'false'},stdio:'ignore'})
 await ready()
 const logged=await call('/api/admin/login',{method:'POST',data:{email,password:pass}})
 const other=await call('/api/admin/login',{method:'POST',data:{email:otherEmail,password:pass}})
 assert.equal(logged.status,200);assert.equal(other.status,200)
 const root='/api/admin/tenants/'+tenantA
 const first=await call(root+'/stores',{method:'POST',cookie:logged.cookie,data:storeData('ci-delete-one','Sede eliminable')})
 assert.equal(first.status,200);const id=first.result.id
 assert.equal((await call(root+'/stores/'+id,{method:'DELETE',data:{confirm:true}})).status,401)
 assert.equal((await call(root+'/stores/'+id,{method:'DELETE',cookie:other.cookie,data:{confirm:true}})).status,403)
 assert.equal((await call(root+'/stores/'+id,{method:'DELETE',cookie:logged.cookie,data:{confirm:false}})).status,400)
 await pool.query("INSERT INTO payment_methods(tenant_id,store_id,mode,method,enabled) VALUES($1,$2,'pickup','cash',true)",[tenantA,id])
 const published=await call(root+'/publish',{method:'POST',cookie:logged.cookie,data:{appId:'com.ci.delete.test'}})
 assert.equal(published.status,200)
 assert.equal((await call('/api/v1/mobile/config?appId=com.ci.delete.test')).result.stores.length,1)
 const integration=(await pool.query("INSERT INTO tenant_integrations(tenant_id,name) VALUES($1,'CI local') RETURNING id",[tenantA])).rows[0].id
 const bind=(await pool.query("INSERT INTO integration_bindings(tenant_id,integration_id,store_id,external_location_id,purpose,authorization_confirmed_by) VALUES($1,$2,$3,'local-test','ORDER_REQUEST',$4) RETURNING id",[tenantA,integration,id,userId])).rows[0].id
 const blocked=await call(root+'/stores/'+id,{method:'DELETE',cookie:logged.cookie,data:{confirm:true}})
 assert.equal(blocked.status,409)
 assert.match(blocked.result.error,/TU VERSO/)
 assert.equal((await pool.query('SELECT 1 FROM stores WHERE id=$1',[id])).rowCount,1)
 await pool.query('DELETE FROM integration_bindings WHERE id=$1',[bind])
 const removed=await call(root+'/stores/'+id,{method:'DELETE',cookie:logged.cookie,data:{confirm:true}})
 assert.equal(removed.status,200);assert.equal(removed.result.requiresPublish,true)
 assert.equal((await pool.query('SELECT 1 FROM payment_methods WHERE store_id=$1',[id])).rowCount,0)
 assert.equal((await pool.query("SELECT 1 FROM admin_audit WHERE action='STORE_DELETED' AND target_id=$1",[id])).rowCount,1)
 assert.equal((await call(root+'/stores/'+id,{method:'DELETE',cookie:logged.cookie,data:{confirm:true}})).status,404)
 assert.equal((await call('/api/v1/mobile/config?appId=com.ci.delete.test')).result.stores.length,1)
 assert.equal((await call(root+'/publish',{method:'POST',cookie:logged.cookie,data:{appId:'com.ci.delete.test'}})).status,200)
 assert.equal((await call('/api/v1/mobile/config?appId=com.ci.delete.test')).result.stores.length,0)
 console.log('PASS eliminación: auth, tenant, confirmación, vínculos, cascada pagos, snapshot y auditoría')

 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==','base64')
 const imageRes=await fetch(base+root+'/images',{method:'POST',headers:{Origin:origin,Cookie:logged.cookie},body:png})
 assert.equal(imageRes.status,201)
 const image=(await imageRes.json()).url
 const privatePath=image.replace('/api/v1/mobile/images/',root+'/images/')
 const picture=await fetch(base+privatePath,{headers:{Origin:origin,Cookie:logged.cookie}})
 assert.equal(picture.status,200)
 assert.equal(picture.headers.get('cache-control'),'private, no-store')
 assert.equal(picture.headers.get('content-type'),'image/png')
 assert.equal((await fetch(base+privatePath,{headers:{Origin:origin,Cookie:other.cookie}})).status,403)
 assert.equal((await fetch(base+image)).status,404)
 const p=await call(root+'/products',{method:'POST',cookie:logged.cookie,data:{name:'Producto prueba',description:'Vista previa',category:'Pollos',pricePen:12.5,imageUrl:image,active:false}})
 assert.equal(p.status,200)
 const productId=p.result.id
 assert.equal((await call(root+'/products',{cookie:logged.cookie})).result.items.some(x=>x.id===productId),true)
 const edit=await call(root+'/products',{method:'POST',cookie:logged.cookie,data:{id:productId,name:'Producto editado',description:'Detalle nuevo',category:'Pollos',pricePen:14.75,imageUrl:image,active:true}})
 assert.equal(edit.status,200)
 const list=(await call(root+'/products',{cookie:logged.cookie})).result.items.filter(x=>x.id===productId)
 assert.equal(list.length,1)
 assert.equal(list[0].name,'Producto editado')
 assert.equal(Number(list[0].price_pen),14.75)
 assert.equal((await call(root+'/products',{cookie:other.cookie})).status,403)
 console.log('PASS productos: carga de fotografía privada, lista de borradores y edición sin duplicados')
}finally{
 child?.kill()
 await pool.end()
}
