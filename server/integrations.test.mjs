// Focused local integration tests. Requires the local Postman simulation on 4410.
import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {randomBytes,randomUUID,scryptSync} from 'node:crypto'
import {writeFile} from 'node:fs/promises'
import pg from 'pg'
import {encryptCredential,decryptCredential,masterKey} from './integration-crypto.mjs'
import {rotateIntegrationKey} from '../scripts/rotate-integration-key.mjs'

const u=new URL(process.env.DATABASE_URL)
assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55432');assert.equal(u.pathname,'/integra_admin')
const pool=new pg.Pool({connectionString:u.href}),tag=randomUUID(),tenantIds=[],userIds=[],checks=[]
const pass=name=>{checks.push(name);console.log('PASS '+name)}
const key=masterKey(),token='tvi_v1_'+randomBytes(32).toString('hex'),replacement='tvi_v1_'+randomBytes(32).toString('hex'),password=randomBytes(24).toString('hex')
const origin='http://localhost:3000',apiBase='http://127.0.0.1:4400'
let output='',child,failed=false
const request=async(path,{method='GET',data,cookie,requestOrigin=origin}={})=>{
 const response=await fetch(apiBase+path,{method,headers:{...(requestOrigin?{Origin:requestOrigin}:{}),...(data!==undefined?{'Content-Type':'application/json'}:{}),...(cookie?{cookie}:{})},body:data===undefined?undefined:JSON.stringify(data)})
 const raw=await response.text();assert.ok(!raw.includes(token)&&!raw.includes(replacement),'Token leaked in API response')
 return {status:response.status,data:JSON.parse(raw),cookie:response.headers.get('set-cookie')?.split(';')[0]}
}
const scenario=async(value)=>{const r=await fetch('http://127.0.0.1:4410/tuverso/__control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({scenario:value})});assert.equal(r.status,200)}
try{
 await scenario('AVAILABLE')
 for(let i=0;i<2;i++)tenantIds.push((await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',[`PRUEBA INTEGRACIONES ${tag} ${i}`])).rows[0].id)
 const emails=[]
 for(const [i,role] of ['SUPER_ADMIN','TENANT_ADMIN','TENANT_ADMIN'].entries()){
  const salt=randomBytes(16).toString('hex'),hash=`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`,email=`integration-test-${tag}-${i}@example.invalid`;emails.push(email)
  userIds.push((await pool.query('INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,$3,$4) RETURNING id',[email,hash,role,i===0?null:tenantIds[i-1]])).rows[0].id)
 }
 const storeIds=[];for(const tenantId of tenantIds)storeIds.push((await pool.query("INSERT INTO stores(tenant_id,code,name,address) VALUES($1,'prueba-integracion','Sede temporal integración','Solo pruebas') RETURNING id",[tenantId])).rows[0].id)
 child=spawn(process.execPath,['server/index.mjs'],{env:{...process.env,NODE_ENV:'test',PORT:'4400',ADMIN_ORIGIN:origin,TUVERSO_SIMULATION_URL:'http://127.0.0.1:4410/tuverso',TUVERSO_LIVE_CHECKS_ENABLED:'false'},windowsHide:true,stdio:['ignore','pipe','pipe']})
 child.stdout.on('data',v=>output+=v);child.stderr.on('data',v=>output+=v)
 await new Promise((resolve,reject)=>{const until=Date.now()+10000;const poll=async()=>{try{if((await fetch(apiBase+'/health/ready')).status===200)return resolve()}catch{}if(Date.now()>until)return reject(Error('Local test backend did not become ready'));setTimeout(poll,100)};void poll()})
 const sessions=[];for(const email of emails){const r=await request('/api/admin/login',{method:'POST',data:{email,password}});assert.equal(r.status,200);sessions.push(r.cookie)}
 const root=`/api/admin/tenants/${tenantIds[0]}/integrations`,otherRoot=`/api/admin/tenants/${tenantIds[1]}/integrations`,cookie=sessions[0]
 const call=(path,method='GET',data)=>request(path,{cookie,method,data})
 assert.equal((await request(root)).status,401)
 const metadata={name:'PRUEBA TU VERSO '+tag,externalTenantId:'external-tenant-simulated-'+tag,channelAccountId:randomUUID(),channelType:'MOBILE_APP',instanceKey:'simulated-'+tag,baseUrl:'https://api.tuverso.integra-b2g.com',scopes:['queue.availability.read'],expiresAt:new Date(Date.now()+86400000).toISOString(),credentialReference:'referencia-no-secreta'}
 assert.equal((await request(root,{cookie,method:'POST',data:metadata,requestOrigin:'https://attacker.invalid'})).status,403)
 assert.equal((await request(root,{cookie,method:'POST',data:metadata,requestOrigin:null})).status,403)
 assert.equal((await call(root,'POST',{...metadata,baseUrl:'http://127.0.0.1:4410'})).status,400)
 assert.equal((await call(root,'POST',{...metadata,scopes:[]})).status,400)
 const create=await call(root,'POST',metadata);assert.equal(create.status,201);const id=create.data.id,path=root+'/'+id
 assert.equal(create.data.status,'UNCONFIGURED');assert.equal(create.data.metadataSource,'MANUAL')
 const second=await call(otherRoot,'POST',{...metadata,channelAccountId:randomUUID()});assert.equal(second.status,201)
 const otherPath=otherRoot+'/'+second.data.id
 assert.equal((await call(otherRoot+'/'+id)).status,404)
 assert.equal((await call(otherPath+'/suspension','POST',{suspended:true})).status,200)
 assert.equal((await call(path)).data.suspended,false)
 assert.equal((await call(root)).data.integrations.length,1)
 for(const tenantCookie of sessions.slice(1))for(const [route,method,data] of [[root,'GET'],[root,'POST',metadata],[path,'PUT',metadata],[path+'/credential','POST',{token}],[path+'/test','POST',{}],[path+'/bindings','POST',{}],[path+'/suspension','POST',{suspended:true}],[path+'/credential-delete','POST',{confirm:true}]])assert.equal((await request(route,{cookie:tenantCookie,method,data})).status,403)
 pass('Real SUPER_ADMIN session; anonymous and both TENANT_ADMIN users blocked; origin and tenant isolation enforced')
 const bindingBody={storeId:storeIds[0],externalLocationId:'simulated-location',purpose:'ORDER_REQUEST',queueReference:randomUUID(),authorizationConfirmed:true}
 assert.equal((await call(path+'/bindings','POST',{...bindingBody,storeId:storeIds[1]})).status,400)
 assert.equal((await call(path+'/bindings','POST',{...bindingBody,authorizationConfirmed:false})).status,400)
 assert.equal((await call(path+'/bindings','POST',{...bindingBody,purpose:'invalid purpose'})).status,400)
 const binding=await call(path+'/bindings','POST',bindingBody);assert.equal(binding.status,201)
 const testBody={bindingId:binding.data.id,authorizeCheck:true}
 assert.equal((await call(path+'/test','POST',testBody)).status,409)
 await assert.rejects(pool.query('INSERT INTO integration_bindings(tenant_id,integration_id,store_id,external_location_id,purpose,queue_reference,authorization_confirmed_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[tenantIds[1],id,storeIds[1],'forbidden','ORDER_REQUEST',randomUUID(),userIds[0]]),e=>e.code==='23503')
 pass('Bindings require declared authorization and tenant-owned store; PostgreSQL rejects crossed integration tenant')
 const cred=await call(path+'/credential','POST',{token,expiresAt:metadata.expiresAt});assert.equal(cred.status,200)
 const stored=(await pool.query('SELECT encrypted_credential FROM tenant_integrations WHERE id=$1',[id])).rows[0].encrypted_credential
 assert.ok(!stored.includes(token));assert.equal(decryptCredential(stored,tenantIds[0],id,key),token)
 assert.throws(()=>decryptCredential(stored,tenantIds[1],id,key))
 const changed=JSON.parse(stored);changed.tag=Buffer.alloc(16).toString('base64');assert.throws(()=>decryptCredential(JSON.stringify(changed),tenantIds[0],id,key))
 assert.throws(()=>decryptCredential(stored,tenantIds[0],id,randomBytes(32)))
 const rotatedKey=randomBytes(32),rotated=encryptCredential(decryptCredential(stored,tenantIds[0],id,key),tenantIds[0],id,rotatedKey);assert.equal(decryptCredential(rotated,tenantIds[0],id,rotatedKey),token)
 const detail=await call(path);assert.equal(detail.data.status,'CONFIGURED');assert.ok(detail.data.hasCredential);assert.ok(!JSON.stringify(detail).includes('encrypted_credential'))
 assert.equal((await call(path,'PUT',{...metadata,channelAccountId:randomUUID()})).status,409)
 pass('AES-256-GCM ciphertext persisted; AAD prevents transplantation; tamper/wrong key rejected; no secret readback; re-encryption verified')
 // Session-temporary tables shadow the public tables: prove the maintenance transaction
 // without re-encrypting or inspecting any real tenant's credentials.
 const maintenance=new pg.Client({connectionString:u.href});await maintenance.connect()
 try{
  await maintenance.query('CREATE TEMP TABLE tenant_integrations(id UUID,tenant_id UUID,encrypted_credential TEXT,updated_at TIMESTAMPTZ); CREATE TEMP TABLE admin_audit(tenant_id UUID,action TEXT,target_id TEXT)')
  await maintenance.query('INSERT INTO tenant_integrations(id,tenant_id,encrypted_credential) VALUES($1,$2,$3)',[id,tenantIds[0],stored])
  assert.equal(await rotateIntegrationKey(maintenance,key,rotatedKey),1)
  const changedEnvelope=(await maintenance.query('SELECT encrypted_credential FROM tenant_integrations')).rows[0].encrypted_credential
  assert.equal(decryptCredential(changedEnvelope,tenantIds[0],id,rotatedKey),token)
  await assert.rejects(rotateIntegrationKey(maintenance,key,randomBytes(32)))
  assert.equal((await maintenance.query('SELECT encrypted_credential FROM tenant_integrations')).rows[0].encrypted_credential,changedEnvelope)
  assert.equal((await maintenance.query('SELECT count(*)::int AS n FROM admin_audit')).rows[0].n,1)
 }finally{await maintenance.end()}
 pass('Master key maintenance script reciphers transactionally; wrong previous key rolls back (session-temporary tables only)')
 assert.equal((await call(path+'/test','POST',{...testBody,authorizeCheck:false})).status,400)
 assert.equal((await call(path+'/test','POST',{...testBody,bindingId:randomUUID()})).status,400)
 assert.equal((await call(path+'/test','POST',{...testBody,tenantId:tenantIds[1]})).status,400)
 for(const value of ['AVAILABLE','UNAVAILABLE',401,403,409,429,503,'MALFORMED','WRONG_LOCATION','REDIRECT','SLOW']){
  await scenario(value);const result=await call(path+'/test','POST',testBody);assert.equal(result.status,200)
  assert.equal(result.data.simulation,true);assert.equal(result.data.phase1BEnabled,false)
  const status=['AVAILABLE','UNAVAILABLE'].includes(value)?'QUERY_CONNECTED':[401,403].includes(value)?'AUTH_ERROR':'CONFIGURED'
  assert.equal(result.data.status,status);assert.equal((await call(path)).data.status,status)
  if(['AVAILABLE','UNAVAILABLE'].includes(value)){assert.equal(result.data.result,value);assert.equal(result.data.reservation,false);assert.ok(!JSON.stringify(result).includes('ignoredPrivateField'))}
  else{assert.equal(result.data.result,null);assert.ok(result.data.errorCode)}
  pass('Simulated 1A '+value+' with safe persisted outcome '+status)
 }
 await call(path+'/credential','POST',{token:replacement,expiresAt:metadata.expiresAt})
 const replaced=(await pool.query('SELECT encrypted_credential FROM tenant_integrations WHERE id=$1',[id])).rows[0].encrypted_credential;assert.notEqual(stored,replaced);assert.equal(decryptCredential(replaced,tenantIds[0],id,key),replacement);assert.equal((await call(path)).data.lastCheck,null)
 await call(path,'PUT',{...metadata,expiresAt:'2020-01-01T00:00:00.000Z'});assert.equal((await call(path)).data.status,'EXPIRED');assert.equal((await call(path+'/test','POST',testBody)).status,409)
 await call(path,'PUT',metadata);await call(path+'/suspension','POST',{suspended:true});assert.equal((await call(path)).data.status,'SUSPENDED');assert.equal((await call(path+'/test','POST',testBody)).status,409)
 await call(path+'/suspension','POST',{suspended:false});assert.equal((await call(path)).data.status,'CONFIGURED')
 assert.equal((await call(path+'/credential-delete','POST',{confirm:false})).status,400)
 await call(path+'/credential-delete','POST',{confirm:true});assert.equal((await call(path)).data.status,'UNCONFIGURED');assert.equal((await pool.query('SELECT encrypted_credential FROM tenant_integrations WHERE id=$1',[id])).rows[0].encrypted_credential,null)
 pass('Replacement clears stale proof; expiration, suspension, resume and controlled local secret deletion enforced')
 const audit=(await pool.query("SELECT action FROM admin_audit WHERE tenant_id=$1 AND action LIKE 'TUVERSO_%'",[tenantIds[0]])).rows.map(r=>r.action)
 for(const event of ['CREATED','CREDENTIAL_SAVED','CREDENTIAL_REPLACED','CONNECTION_CHECKED','SUSPENDED','CREDENTIAL_REMOVED'])assert.ok(audit.includes('TUVERSO_'+event))
 const stats=await(await fetch('http://127.0.0.1:4410/tuverso/__stats')).json();assert.ok(stats.calls.length>=11);assert.ok(stats.calls.every(c=>c.correct));assert.ok(!JSON.stringify(stats).includes(token));pass('Simulation observed real backend HTTP calls with exactly documented query and no Origin/cookies; audit contains no tokens')
 assert.ok(!output.includes(token)&&!output.includes(replacement));pass('Backend logs do not contain test credentials')
}catch(error){failed=true;console.error(error.message);process.exitCode=1}
finally{
 if(child){child.kill();await new Promise(resolve=>{if(child.exitCode!==null)resolve();else{child.once('exit',resolve);setTimeout(resolve,3000)}})}
 await pool.query('DELETE FROM integration_bindings WHERE tenant_id=ANY($1::uuid[])',[tenantIds]);await pool.query('DELETE FROM tenant_integrations WHERE tenant_id=ANY($1::uuid[])',[tenantIds]);await pool.query('DELETE FROM admin_audit WHERE tenant_id=ANY($1::uuid[])',[tenantIds]);await pool.query('DELETE FROM stores WHERE tenant_id=ANY($1::uuid[])',[tenantIds]);await pool.query('DELETE FROM admin_users WHERE id=ANY($1::uuid[])',[userIds]);await pool.query('DELETE FROM tenants WHERE id=ANY($1::uuid[])',[tenantIds]);await pool.end()
 await writeFile('.local/integrations-test-results.json',JSON.stringify({success:!failed,checks,checkedAt:new Date().toISOString(),productionRequests:0,temporaryRecordsRemoved:true},null,2))
}
