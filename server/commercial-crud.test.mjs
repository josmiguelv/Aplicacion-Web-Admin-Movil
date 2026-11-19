import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {randomBytes,scryptSync} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'

const database=new URL(process.env.DATABASE_URL)
assert.equal(database.hostname,'127.0.0.1','La prueba requiere PostgreSQL CI')
assert.equal(database.pathname,'/admin_api_keys_test','La prueba requiere BD de CI')
const pool=new pg.Pool({connectionString:database.href})
const origin='http://localhost:3000',base='http://127.0.0.1:4417',nonce=randomBytes(4).toString('hex')
let server
const request=async(path,{method='GET',data,cookie,originOverride}={})=>{
 const res=await fetch(base+path,{method,headers:{
  Origin:originOverride||origin,...(data===undefined?{}:{'Content-Type':'application/json'}),
  ...(cookie?{Cookie:cookie}:{})
 },...(data===undefined?{}:{body:JSON.stringify(data)})})
 const body=await res.json()
 return {status:res.status,body,cookie:res.headers.get('set-cookie')?.split(';')[0]||''}
}
const requireStatus=async(path,opts,status=200)=>{
 const res=await request(path,opts)
 assert.equal(res.status,status,path+' -> '+JSON.stringify(res.body))
 return res.body
}
const store=(code)=>({name:'Local '+code,code,address:'Solo para CI',active:true,delivery_enabled:true,
 pickup_enabled:true,dine_in_enabled:false,openingHours:null,latitude:null,longitude:null,
 radiusKm:null,deliveryPricingMode:'PER_KM',deliveryRatePerKmPen:null,deliveryFeePen:null})
try{
 await pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'))
 const tA=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['CI CRUD '+nonce])).rows[0].id
 const tB=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['CI OTHER '+nonce])).rows[0].id
 const password=randomBytes(24).toString('hex'),salt=randomBytes(16).toString('hex')
 const hashed='scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex')
 const email='crud-'+nonce+'@example.invalid'
 const superEmail='crud-super-'+nonce+'@example.invalid'
 const otherEmail='crud-other-'+nonce+'@example.invalid'
 await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,'TENANT_ADMIN',$3)",[email,hashed,tA])
 await pool.query("INSERT INTO admin_users(email,password_hash,role) VALUES($1,$2,'SUPER_ADMIN')",[superEmail,hashed])
 await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,'TENANT_ADMIN',$3)",[otherEmail,hashed,tB])
 const app='com.ci.crud.'+nonce
 await pool.query('INSERT INTO mobile_apps(tenant_id,app_id) VALUES($1,$2)',[tA,app])
 server=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:'4417',
  ADMIN_ORIGIN:origin,COOKIE_SECURE:'false',TUVERSO_LIVE_CHECKS_ENABLED:'false'},stdio:'ignore'})
 let ready=false
 for(let i=0;i<100;i++){try{if((await fetch(base+'/health/ready')).status===200){ready=true;break}}catch{}await delay(100)}
 assert.equal(ready,true,'backend CI disponible')
 const cookie=(await request('/api/admin/login',{method:'POST',data:{email,password}})).cookie
 const superCookie=(await request('/api/admin/login',{method:'POST',data:{email:superEmail,password}})).cookie
 const otherCookie=(await request('/api/admin/login',{method:'POST',data:{email:otherEmail,password}})).cookie
 assert.ok(cookie&&superCookie&&otherCookie,'sesiones autenticadas')
 const root='/api/admin/tenants/'+tA,params={cookie}
 const invalidHours=await request(root+'/stores',{...params,method:'POST',data:{
  ...store('crud-'+nonce),openingHours:{mon:{open:'11:00',close:''}}
 }})
 assert.equal(invalidHours.status,400)
 assert.match(invalidHours.body.error,/Horario de atención inválido para el lunes/)
 const incompleteGps=await request(root+'/stores',{...params,method:'POST',data:{
  ...store('crud-'+nonce),latitude:-12.04,longitude:null
 }})
 assert.equal(incompleteGps.status,400)
 assert.match(incompleteGps.body.error,/ambas coordenadas GPS/)
 const invalidCoverage=await request(root+'/stores',{...params,method:'POST',data:{
  ...store('crud-'+nonce),radiusKm:600
 }})
 assert.equal(invalidCoverage.status,400)
 assert.match(invalidCoverage.body.error,/Cobertura máxima inválida/)
 const storeSaved=await requireStatus(root+'/stores',{...params,method:'POST',data:{
  ...store('crud-'+nonce),openingHours:{mon:{open:'11:00',close:'23:00'}}
 }})
 const storeId=storeSaved.id
 const pay={storeId,mode:'pickup',method:'yape',enabled:true}
 assert.equal((await requireStatus(root+'/payments',{...params,method:'POST',data:pay})).enabled,true)
 assert.equal((await requireStatus(root+'/payments',params)).items.length,1)
 await requireStatus(root+'/publish',{...params,method:'POST',data:{appId:app}})
 const publicPath='/api/v1/mobile/config?appId='+app
 assert.deepEqual((await requireStatus(publicPath)).stores[0].paymentMethods.pickup,['yape'])
 assert.equal((await requireStatus(root+'/payments',{...params,method:'POST',data:{...pay,enabled:false}})).enabled,false)
 assert.equal((await requireStatus(root+'/payments',params)).items[0].enabled,false)
 assert.deepEqual((await requireStatus(publicPath)).stores[0].paymentMethods.pickup,['yape'],'sin republicar, permanece snapshot')
 const payPath=root+'/payments/'+storeId+'/pickup/yape'
 await requireStatus(payPath,{...params,method:'DELETE',data:{confirm:false}},400)
 await requireStatus(payPath,{cookie:otherCookie,method:'DELETE',data:{confirm:true}},403)
 await requireStatus(payPath,{method:'DELETE',data:{confirm:true}},401)
 await requireStatus(payPath,{...params,method:'DELETE',data:{confirm:true}})
 assert.equal((await requireStatus(root+'/payments',params)).items.length,0)
 await requireStatus(root+'/publish',{...params,method:'POST',data:{appId:app}})
 assert.deepEqual((await requireStatus(publicPath)).stores[0].paymentMethods.pickup,[])
 console.log('PASS pagos: guardado, lista, edición, eliminación confirmada, tenant y publicación')

 const promo=await requireStatus(root+'/promotions',{...params,method:'POST',data:{title:'Promo original',active:true}})
 const edited=await requireStatus(root+'/promotions',{...params,method:'POST',
  data:{id:promo.id,title:'Promo editada',active:false,startsAt:null,endsAt:null}})
 assert.equal(edited.id,promo.id)
 assert.equal(edited.title,'Promo editada')
 assert.equal((await requireStatus(root+'/promotions',params)).items.filter(x=>x.id===promo.id).length,1)
 await requireStatus(root+'/promotions/'+promo.id,{...params,method:'DELETE',data:{confirm:true}})
 assert.equal((await requireStatus(root+'/promotions',params)).items.filter(x=>x.id===promo.id).length,0)

 const prod=await requireStatus(root+'/products',{...params,method:'POST',
  data:{name:'Producto CI',pricePen:22,active:true,description:'Demo CI',category:'Pollos'}})
 assert.ok((await requireStatus(root+'/products',params)).items.some(x=>x.id===prod.id))
 await requireStatus(root+'/products/'+prod.id,{...params,method:'DELETE',data:{confirm:true}})
 assert.ok(!(await requireStatus(root+'/products',params)).items.some(x=>x.id===prod.id))

 const vacancy=await requireStatus(root+'/vacancies',{...params,method:'POST',
  data:{title:'Auxiliar prueba',whatsappPhone:'51912345678',active:true,
   description:'',summary:'',requirements:'',schedule:'',employmentType:'',locationLabel:'',imageUrl:''}})
 assert.ok((await requireStatus(root+'/vacancies',params)).items.some(x=>x.id===vacancy.id))
 await requireStatus(root+'/vacancies/'+vacancy.id,{...params,method:'DELETE',data:{confirm:true}})
 assert.ok(!(await requireStatus(root+'/vacancies',params)).items.some(x=>x.id===vacancy.id))
 const audit=(await pool.query("SELECT action FROM admin_audit WHERE tenant_id=$1 AND action LIKE '%_DELETED'",[tA])).rows.map(x=>x.action)
 assert.ok(['PAYMENT_DELETED','PROMOTIONS_DELETED','PRODUCTS_DELETED','VACANCIES_DELETED'].every(x=>audit.includes(x)))
 console.log('PASS catálogo: promoción editable sin duplicado, productos/vacantes eliminables y auditados')

 const draft='com.ci.draft.'+nonce
 await requireStatus(root+'/apps',{...params,method:'POST',data:{appId:draft}})
 await requireStatus(root+'/apps/'+draft,{...params,method:'DELETE',data:{confirm:true}})
 assert.ok(!(await requireStatus(root+'/apps',params)).items.some(x=>x.app_id===draft))
 await requireStatus(root+'/apps/'+app,{...params,method:'DELETE',data:{confirm:true}},409)
 assert.ok((await requireStatus(root+'/apps',params)).items.some(x=>x.app_id===app))
 console.log('PASS aplicación: eliminar solo registro sin publicar')

 const users=(await requireStatus(root+'/users',{cookie:superCookie})).items
 assert.ok(users.some(x=>x.email===email))
 await requireStatus(root+'/users',{cookie,method:'GET'},403)
 const account=users.find(x=>x.email===email)
 const newEmail='changed-'+nonce+'@example.invalid'
 await requireStatus(root+'/users/'+account.id,{method:'PUT',cookie:superCookie,data:{email:newEmail,active:true}})
 assert.ok((await requireStatus(root+'/users',{cookie:superCookie})).items.some(x=>x.email===newEmail))
 await requireStatus(root+'/users/'+account.id,{method:'DELETE',cookie:superCookie,data:{confirm:false}},400)
 await requireStatus(root+'/users/'+account.id,{method:'DELETE',cookie:superCookie,data:{confirm:true}})
 assert.equal((await request('/api/admin/login',{method:'POST',data:{email:newEmail,password}})).status,401)
 assert.equal((await request(root+'/stores',{cookie})).status,401,'sesión revocada')
 console.log('PASS usuarios: listado aislado, edición, desactivación y revocación de sesión')
}finally{
 server?.kill()
 await pool.end()
}
