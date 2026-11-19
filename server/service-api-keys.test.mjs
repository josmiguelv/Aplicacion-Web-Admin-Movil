import assert from 'node:assert/strict'
import {spawn} from 'node:child_process'
import {readFileSync} from 'node:fs'
import {randomBytes,scryptSync} from 'node:crypto'
import {setTimeout as delay} from 'node:timers/promises'
import pg from 'pg'

const database = new URL(process.env.DATABASE_URL)
assert.equal(database.hostname,'127.0.0.1','Solo base aislada CI')
assert.equal(database.pathname,'/admin_api_keys_test','Solo base aislada CI')
const pool = new pg.Pool({connectionString:database.href})
const origin = 'http://localhost:3000'
const base = 'http://127.0.0.1:4412'
let child
const results = []
const pass = name => {results.push(name);console.log('PASS: '+name)}

async function call(path,{method='GET',data,cookie,token,requestOrigin}={}) {
 const res = await fetch(base+path,{
  method,
  headers:{
   ...(cookie?{Cookie:cookie}:{}),
   ...(token?{Authorization:'Bearer '+token}:{}),
   ...(data!==undefined?{'Content-Type':'application/json'}:{}),
   ...(requestOrigin===null?{}:{Origin:requestOrigin||origin}),
  },
  body:data===undefined?undefined:JSON.stringify(data),
 })
 const result = await res.json()
 return {code:res.status,result,cookie:res.headers.get('set-cookie')?.split(';')[0]||null,headers:res.headers}
}
async function ready() {
 for(let i=0;i<80;i++){try{if((await fetch(base+'/health/ready')).status===200)return}catch{}await delay(100)}
 throw Error('API not ready')
}

try{
 await pool.query(readFileSync(new URL('./schema.sql',import.meta.url),'utf8'))
 const t1=(await pool.query("INSERT INTO tenants(name) VALUES('CI restaurant 1') RETURNING id")).rows[0].id
 const t2=(await pool.query("INSERT INTO tenants(name) VALUES('CI restaurant 2') RETURNING id")).rows[0].id
 const password=randomBytes(22).toString('hex')
 const salt=randomBytes(16).toString('hex')
 const hashed='scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex')
 const superEmail='ci-super@example.invalid',tenantEmail='ci-tenant@example.invalid'
 await pool.query("INSERT INTO admin_users(email,password_hash,role) VALUES($1,$2,'SUPER_ADMIN')",[superEmail,hashed])
 await pool.query("INSERT INTO admin_users(email,password_hash,role,tenant_id) VALUES($1,$2,'TENANT_ADMIN',$3)",[tenantEmail,hashed,t1])
 for(const [tenantId,appId] of [[t1,'com.ci.restaurant1'],[t2,'com.ci.restaurant2']]) {
  await pool.query("INSERT INTO mobile_apps(tenant_id,app_id,enabled,published_revision) VALUES($1,$2,true,1)",[tenantId,appId])
  await pool.query('INSERT INTO published_catalogs(app_id,tenant_id,revision,payload) VALUES($1,$2,1,$3)',
   [appId,tenantId,{schemaVersion:1,appId,currency:'PEN',products:[{name:appId,pricePen:15}],stores:[],promotions:[]}])
 }
 child=spawn(process.execPath,['server/index.mjs'],{
  env:{...process.env,NODE_ENV:'test',PORT:'4412',ADMIN_ORIGIN:origin,COOKIE_SECURE:'false',TUVERSO_LIVE_CHECKS_ENABLED:'false'},
  stdio:'ignore',windowsHide:true,
 })
 await ready()
 const root='/api/admin/tenants/'+t1+'/api-keys'
 const otherRoot='/api/admin/tenants/'+t2+'/api-keys'
 const anon=await call(root);assert.equal(anon.code,401)
 const logged=await call('/api/admin/login',{method:'POST',data:{email:superEmail,password}})
 assert.equal(logged.code,200)
 const adminCookie=logged.cookie
 const otherLogin=await call('/api/admin/login',{method:'POST',data:{email:tenantEmail,password}})
 assert.equal(otherLogin.code,200)
 assert.equal((await call(root,{cookie:otherLogin.cookie})).code,403)
 pass('Login real y Super Admin; TENANT_ADMIN y anónimos bloqueados')
 assert.equal((await call(root,{method:'POST',cookie:adminCookie,data:{name:'Servidor de pruebas',expiresInDays:90,scopes:['catalog.read']},requestOrigin:'https://attacker.invalid'})).code,403)
 assert.equal((await call(root,{method:'POST',cookie:adminCookie,data:{name:'Servidor de pruebas',expiresInDays:90,scopes:['admin.write']}})).code,400)
 const issued=await call(root,{method:'POST',cookie:adminCookie,data:{name:'Servidor de pruebas',expiresInDays:90,scopes:['catalog.read']}})
 assert.equal(issued.code,201)
 const secret=issued.result.key, id=issued.result.id
 assert.match(secret,/^ib2g_sk_v1_[a-f0-9]{64}$/)
 assert.equal(issued.result.oneTimeDisplay,true)
 const saved=(await pool.query('SELECT key_hash,key_prefix FROM tenant_api_keys WHERE id=$1',[id])).rows[0]
 assert.ok(!JSON.stringify(saved).includes(secret))
 const listing=await call(root,{cookie:adminCookie})
 assert.equal(listing.code,200)
 assert.equal(listing.result.keys.length,1)
 assert.ok(!JSON.stringify(listing.result).includes(secret))
 assert.ok(!JSON.stringify(listing.result).includes(saved.key_hash))
 assert.equal((await call(otherRoot,{cookie:adminCookie})).result.keys.length,0)
 pass('Creación única, secreto no recuperable, hash en PostgreSQL y aislamiento administrativo')
 const catalog='/api/v1/integrations/catalog?appId=com.ci.restaurant1'
 assert.equal((await call(catalog)).code,401)
 assert.equal((await call(catalog,{token:'ib2g_sk_v1_'+'0'.repeat(64)})).code,401)
 const allowed=await call(catalog,{token:secret})
 assert.equal(allowed.code,200)
 assert.equal(allowed.result.ready,true)
 assert.equal(allowed.result.products[0].name,'com.ci.restaurant1')
 assert.equal(allowed.headers.get('access-control-allow-origin'),null)
 assert.equal((await call('/api/v1/integrations/catalog?appId=com.ci.restaurant2',{token:secret})).code,404)
 const publicCatalog=await call('/api/v1/mobile/config?appId=com.ci.restaurant1')
 assert.equal(publicCatalog.code,200)
 assert.equal(publicCatalog.result.ready,true)
 pass('S2S con catálogo propio; 404 para catálogo ajeno; API pública Android intacta')
 const revoke=await call(root+'/'+id+'/revoke',{method:'POST',cookie:adminCookie,data:{confirm:true}})
 assert.equal(revoke.code,200)
 assert.equal((await call(catalog,{token:secret})).code,401)
 assert.equal((await call(root+'/'+id+'/revoke',{method:'POST',cookie:adminCookie,data:{confirm:true}})).code,404)
 const exp=await call(root,{method:'POST',cookie:adminCookie,data:{name:'Otra clave de prueba',expiresInDays:30,scopes:['catalog.read']}})
 assert.equal(exp.code,201)
 await pool.query("UPDATE tenant_api_keys SET expires_at=now()-interval '1 hour' WHERE id=$1",[exp.result.id])
 assert.equal((await call(catalog,{token:exp.result.key})).code,401)
 const actions=(await pool.query("SELECT action FROM admin_audit WHERE tenant_id=$1 AND action LIKE 'SERVICE_KEY_%'",[t1])).rows.map(x=>x.action)
 assert.ok(actions.includes('SERVICE_KEY_CREATED')&&actions.includes('SERVICE_KEY_REVOKED'))
 pass('Revocación, caducidad y auditoría')
 console.log('PASS total: '+results.length)
} finally {
 child?.kill()
 await pool.end()
}
