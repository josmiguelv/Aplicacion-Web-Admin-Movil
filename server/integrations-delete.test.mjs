// Focused deletion checks against the real local backend; no TU VERSO requests.
import assert from 'node:assert/strict'
import {randomUUID,randomBytes,scryptSync} from 'node:crypto'
import {spawn} from 'node:child_process'
import pg from 'pg'
const url=new URL(process.env.DATABASE_URL)
assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55432');assert.equal(url.pathname,'/integra_admin')
const pool=new pg.Pool({connectionString:url.href}),tenantIds=[],userIds=[],tag=randomUUID(),password=randomBytes(24).toString('hex'),token='tvi_v1_'+randomBytes(32).toString('hex')
const base='http://127.0.0.1:4400',origin='http://localhost:3000';let child,logs=''
const request=async(path,{method='GET',data,cookie,requestOrigin=origin}={})=>{
 const r=await fetch(base+path,{method,headers:{...(cookie?{cookie}:{}),...(requestOrigin?{Origin:requestOrigin}:{}),...(data===undefined?{}:{'Content-Type':'application/json'})},body:data===undefined?undefined:JSON.stringify(data)})
 const raw=await r.text();assert.ok(!raw.includes(token));return {status:r.status,data:JSON.parse(raw),cookie:r.headers.get('set-cookie')?.split(';')[0]}
}
try{
 for(let n=0;n<2;n++)tenantIds.push((await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',[`PRUEBA ELIMINACION INTEGRACION ${tag} ${n}`])).rows[0].id)
 const emails=[]
 for(const [i,role] of ['SUPER_ADMIN','TENANT_ADMIN'].entries()){
  const salt=randomBytes(16).toString('hex'),hash=`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,email=`delete-integration-${tag}-${i}@example.invalid`;emails.push(email)
  userIds.push((await pool.query('INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,$3,$4) RETURNING id',[email,hash,role,i?tenantIds[0]:null])).rows[0].id)
 }
 const stores=[];for(const id of tenantIds)stores.push((await pool.query("INSERT INTO stores(tenant_id,code,name,address) VALUES($1,'prueba-eliminacion','Sede conservada','Temporal') RETURNING id",[id])).rows[0].id)
 child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,PORT:'4400',NODE_ENV:'test',ADMIN_ORIGIN:origin,TUVERSO_LIVE_CHECKS_ENABLED:'false',TUVERSO_SIMULATION_URL:''},windowsHide:true,stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',v=>logs+=v);child.stderr.on('data',v=>logs+=v)
 const until=Date.now()+10000
 while(true){try{if((await fetch(base+'/health/ready')).status===200)break}catch{}if(Date.now()>until)throw Error('Test backend not ready');await new Promise(r=>setTimeout(r,100))}
 const superLogin=await request('/api/admin/login',{method:'POST',data:{email:emails[0],password}});assert.equal(superLogin.status,200)
 const tenantLogin=await request('/api/admin/login',{method:'POST',data:{email:emails[1],password}});assert.equal(tenantLogin.status,200)
 const cookie=superLogin.cookie,root=id=>`/api/admin/tenants/${id}/integrations`,call=(path,method='GET',data)=>request(path,{cookie,method,data})
 const create=async(tenantId,name,withKey=true)=>{
  const r=await call(root(tenantId),'POST',{name});assert.equal(r.status,201);const path=root(tenantId)+'/'+r.data.id
  if(withKey){assert.equal((await call(path+'/credential','POST',{token})).status,200);assert.equal((await call(path+'/bindings','POST',{storeId:stores[tenantIds.indexOf(tenantId)],purpose:'ORDER_REQUEST',authorizationConfirmed:true})).status,201)}
  return {id:r.data.id,path}
 }
 const primary=await create(tenantIds[0],'Conexión a eliminar'),retained=await create(tenantIds[0],'Conexión conservada'),foreign=await create(tenantIds[1],'Conexión otra empresa'),empty=await create(tenantIds[0],'Conexión creada por error',false)
 const before=(await pool.query('SELECT id,encrypted_credential FROM tenant_integrations WHERE id=ANY($1::uuid[]) ORDER BY id',[[retained.id,foreign.id]])).rows
 const deletion=primary.path+'/delete'
 assert.equal((await request(deletion,{method:'POST',data:{confirm:true}})).status,401)
 assert.equal((await request(deletion,{cookie:tenantLogin.cookie,method:'POST',data:{confirm:true}})).status,403)
 assert.equal((await request(deletion,{cookie,method:'POST',data:{confirm:true},requestOrigin:'https://attacker.invalid'})).status,403)
 assert.equal((await request(deletion,{cookie,method:'POST',data:{confirm:true},requestOrigin:null})).status,403)
 assert.equal((await call(deletion,'POST',{})).status,400);assert.equal((await call(deletion,'POST',{confirm:false})).status,400)
 assert.equal((await call(root(tenantIds[1])+'/'+primary.id+'/delete','POST',{confirm:true})).status,404)
 assert.equal((await call(primary.path)).status,200)
 console.log('PASS deletion requires SUPER_ADMIN, exact origin, confirmation and matching tenant')
 assert.equal((await call(empty.path+'/delete','POST',{confirm:true})).status,200);assert.equal((await call(empty.path)).status,404)
 assert.equal((await call(deletion,'POST',{confirm:true})).status,200)
 assert.equal((await call(primary.path)).status,404);assert.equal((await call(deletion,'POST',{confirm:true})).status,404)
 assert.equal((await call(primary.path+'/credential','POST',{token})).status,404)
 assert.equal((await call(primary.path+'/test','POST',{bindingId:randomUUID(),authorizeCheck:true})).status,404)
 assert.equal((await pool.query('SELECT 1 FROM integration_bindings WHERE integration_id=$1',[primary.id])).rowCount,0)
 assert.equal((await pool.query('SELECT 1 FROM tenant_integrations WHERE id=$1',[primary.id])).rowCount,0)
 const after=(await pool.query('SELECT id,encrypted_credential FROM tenant_integrations WHERE id=ANY($1::uuid[]) ORDER BY id',[[retained.id,foreign.id]])).rows;assert.deepEqual(after,before)
 for(const id of [retained.id,foreign.id])assert.equal((await pool.query('SELECT 1 FROM integration_bindings WHERE integration_id=$1',[id])).rowCount,1)
 for(const id of stores)assert.equal((await pool.query('SELECT 1 FROM stores WHERE id=$1',[id])).rowCount,1)
 assert.deepEqual((await call(root(tenantIds[0]))).data.integrations.map(i=>i.id),[retained.id])
 const audit=await pool.query("SELECT actor_user_id,target_id FROM admin_audit WHERE tenant_id=$1 AND action='TUVERSO_CONNECTION_DELETED' ORDER BY target_id",[tenantIds[0]])
 assert.equal(audit.rowCount,2);assert.ok(audit.rows.every(r=>r.actor_user_id===userIds[0]));assert.ok(audit.rows.some(r=>r.target_id===primary.id))
 assert.ok(!logs.includes(token))
 console.log('PASS empty and configured connections removed with encrypted key and bindings; stores, other connections/tenants and audit preserved; deleted ID cannot be reused')
}finally{
 if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{child.once('exit',resolve);setTimeout(resolve,2000).unref()}})}
 await pool.query('DELETE FROM integration_bindings WHERE tenant_id=ANY($1::uuid[])',[tenantIds]);await pool.query('DELETE FROM tenant_integrations WHERE tenant_id=ANY($1::uuid[])',[tenantIds]);await pool.query('DELETE FROM admin_audit WHERE tenant_id=ANY($1::uuid[])',[tenantIds]);await pool.query('DELETE FROM stores WHERE tenant_id=ANY($1::uuid[])',[tenantIds]);await pool.query('DELETE FROM admin_users WHERE id=ANY($1::uuid[])',[userIds]);await pool.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])',[tenantIds]);await pool.end()
}
