// Read-only Railway packaging preflight. Does not connect to or mutate any database.
// Usage: node scripts/railway-preflight.mjs
// Optional: CHECK_PRODUCTION_ENV=true node scripts/railway-preflight.mjs
import {readFile,access} from 'node:fs/promises'
import {resolve} from 'node:path'

let errors=0
const check=(ok,description)=>{console.log((ok?'PASS':'FAIL')+' '+description);if(!ok)errors++}
const exists=async p=>{try{await access(resolve(p));return true}catch{return false}}
const required=['Dockerfile','railway.json','pnpm-lock.yaml','server/index.mjs',
 'server/schema.sql','server/bootstrap-admin.mjs','server/mobile-interaction-ws.mjs',
 'server/migrations/023-mobile-order-surveys.sql']
for(const path of required)check(await exists(path),'file '+path)
const config=JSON.parse(await readFile('railway.json','utf8'))
check(config.build?.builder==='DOCKERFILE','Dockerfile builder selected')
check(config.deploy?.healthcheckPath==='/health/ready','readiness healthcheck')
check(config.deploy?.startCommand==='node server/index.mjs','API start command')
const docker=await readFile('Dockerfile','utf8')
check(docker.includes('pnpm install --frozen-lockfile'),'frozen dependencies for build')
check(docker.includes('USER node'),'unprivileged runtime user')
if(process.env.CHECK_PRODUCTION_ENV==='true'){
 const origin=process.env.ADMIN_ORIGIN||''
 check(process.env.NODE_ENV==='production','NODE_ENV production')
 check(/^https:\/\/[^/\s]+$/.test(origin),'ADMIN_ORIGIN HTTPS exact origin')
 check(process.env.COOKIE_SECURE==='true','COOKIE_SECURE enabled')
 check(Boolean(process.env.DATABASE_URL),'DATABASE_URL set (not printed)')
 check(Boolean(process.env.INTEGRATION_MASTER_KEY)&&
  Buffer.from(process.env.INTEGRATION_MASTER_KEY||'','base64').length===32,
  'INTEGRATION_MASTER_KEY decodes to 32 bytes (not printed)')
}
console.log(errors?'NO-GO: '+errors+' preflight check(s) failed':'PASS: static packaging preflight only')
console.log('NOTE: database migrations, branch consolidation, network/TUVERSO, Android and live deployment are NOT validated here.')
if(errors)process.exitCode=1
