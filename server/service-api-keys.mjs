import { randomBytes, createHash, randomUUID } from 'node:crypto'

// Claves privadas para consumidores servidor-a-servidor de INTEGRA B2G.
// Nunca deben distribuirse a navegadores, APKs ni aplicaciones públicas.
const PREFIX = 'ib2g_sk_v1_'
const VALID_KEY = /^ib2g_sk_v1_[a-f0-9]{64}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const DAYS = [30, 90, 180, 365]
const SCOPE = 'catalog.read'
const fail = (code, message) => Object.assign(new Error(message), {code})
const LIMIT = 120
const usage = new Map()
const allowedName = n => typeof n === 'string' && n.trim().length >= 3 && n.trim().length <= 120 && !/[\x00-\x1f]/.test(n)
const fields = (obj, expected) => obj && typeof obj === 'object' && !Array.isArray(obj) && Object.keys(obj).every(k => expected.includes(k))
const sha = value => createHash('sha256').update(value).digest('hex')
export const issueServiceKey = () => PREFIX + randomBytes(32).toString('hex')
export const digestServiceKey = sha

const selectColumns = 'id,tenant_id,name,key_prefix,scopes,expires_at,revoked_at,created_at,last_used_at'
const display = row => ({
 id: row.id, tenantId: row.tenant_id, name: row.name, prefix: row.key_prefix,
 scopes: row.scopes, expiresAt: row.expires_at, revokedAt: row.revoked_at,
 createdAt: row.created_at, lastUsedAt: row.last_used_at,
 status: row.revoked_at ? 'REVOKED' : new Date(row.expires_at) <= new Date() ? 'EXPIRED' : 'ACTIVE',
})

export async function adminApiKeyRoutes({req,res,url,user,pool,body,json,tenantOf}) {
 if (!url.pathname.includes('/api-keys')) return false
 const match = url.pathname.match(/^\/api\/admin\/tenants\/([^/]+)\/api-keys(?:\/([^/]+)\/revoke)?$/)
 if (user.role !== 'SUPER_ADMIN') {json(res,403,{error:'Solo el Super Administrador puede gestionar API Keys'});return true}
 if (!match) {json(res,404,{error:'Ruta no encontrada'});return true}
 const [,tenantId,keyId] = match
 if (!UUID.test(tenantId) || keyId && !UUID.test(keyId)) {json(res,400,{error:'Identificador inválido'});return true}
 await tenantOf(user,tenantId)
 if (req.method !== 'GET') {
  if (!process.env.ADMIN_ORIGIN || req.headers.origin !== process.env.ADMIN_ORIGIN) {json(res,403,{error:'Origen no autorizado'});return true}
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) {json(res,415,{error:'Se requiere application/json'});return true}
 }
 if (req.method === 'GET' && !keyId) {
  const result = await pool.query(`SELECT ${selectColumns} FROM tenant_api_keys WHERE tenant_id=$1 ORDER BY created_at DESC,id`,[tenantId])
  json(res,200,{keys:result.rows.map(display)})
  return true
 }
 if (req.method === 'POST' && !keyId) {
  const payload = await body(req)
  if (!fields(payload,['name','expiresInDays','scopes']) || !allowedName(payload.name) ||
      !DAYS.includes(payload.expiresInDays) || !Array.isArray(payload.scopes) ||
      payload.scopes.length !== 1 || payload.scopes[0] !== SCOPE) {
   json(res,400,{error:'Nombre, plazo o permisos inválidos'});return true
  }
  const client = await pool.connect()
  try {
   await client.query('BEGIN')
   const count = await client.query('SELECT count(*)::int AS total FROM tenant_api_keys WHERE tenant_id=$1 AND revoked_at IS NULL AND expires_at > now()',[tenantId])
   if (count.rows[0].total >= 50) throw fail(409,'La empresa alcanzó el máximo de claves activas')
   const plain = issueServiceKey()
   const keyHash = digestServiceKey(plain)
   const expiry = new Date(Date.now()+payload.expiresInDays*86400000)
   const id = randomUUID()
   const saved = await client.query(`INSERT INTO tenant_api_keys
    (id,tenant_id,name,key_hash,key_prefix,scopes,expires_at,created_by)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING ${selectColumns}`,
    [id,tenantId,payload.name.trim(),keyHash,plain.slice(0,PREFIX.length+8),[SCOPE],expiry.toISOString(),user.id])
   await client.query("INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,'SERVICE_KEY_CREATED',$3)",[tenantId,user.id,id])
   await client.query('COMMIT')
   json(res,201,{...display(saved.rows[0]),key:plain,oneTimeDisplay:true})
  } catch (e) {
   await client.query('ROLLBACK').catch(()=>{})
   const status = typeof e.code === 'number' ? e.code : 503
   json(res,status,{error:status===503?'No se pudo crear la clave':e.message})
  } finally {client.release()}
  return true
 }
 if (req.method === 'POST' && keyId) {
  const payload = await body(req)
  if (!fields(payload,['confirm']) || payload.confirm !== true) {json(res,400,{error:'Debes confirmar la revocación'});return true}
  const client = await pool.connect()
  try {
   await client.query('BEGIN')
   const updated = await client.query(`UPDATE tenant_api_keys SET revoked_at=now()
    WHERE id=$1 AND tenant_id=$2 AND revoked_at IS NULL RETURNING id`,[keyId,tenantId])
   if (!updated.rowCount) throw fail(404,'Clave inexistente o ya revocada')
   await client.query("INSERT INTO admin_audit(tenant_id,actor_user_id,action,target_id) VALUES($1,$2,'SERVICE_KEY_REVOKED',$3)",[tenantId,user.id,keyId])
   await client.query('COMMIT')
   json(res,200,{revoked:true})
  } catch(e) {
   await client.query('ROLLBACK').catch(()=>{})
   const status = typeof e.code === 'number' ? e.code : 503
   json(res,status,{error:status===503?'No se pudo revocar la clave':e.message})
  } finally {client.release()}
  return true
 }
 json(res,405,{error:'Método no permitido'})
 return true
}

export async function serviceCatalogRoute({req,res,url,pool,json}) {
 if (url.pathname !== '/api/v1/integrations/catalog') return false
 if (req.method !== 'GET') {json(res,405,{error:'Método no permitido'});return true}
 const auth = req.headers.authorization || ''
 const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
 if (!VALID_KEY.test(token)) {json(res,401,{error:'Credencial inválida'});return true}
 const hashed = digestServiceKey(token)
 const now = Date.now()
 // Defensa básica por proceso; debe complementarse con cuotas en gateway para producción.
 if (usage.size > 10000) usage.clear()
 const item = usage.get(hashed)
 const count = item && now - item.since < 60000 ? {since:item.since,total:item.total+1} : {since:now,total:1}
 usage.set(hashed,count)
 if (count.total > LIMIT) {json(res,429,{error:'Límite de consultas alcanzado'});return true}
 const check = await pool.query(`SELECT k.id,k.tenant_id,k.scopes FROM tenant_api_keys k
  JOIN tenants t ON t.id=k.tenant_id
  WHERE k.key_hash=$1 AND k.revoked_at IS NULL AND k.expires_at>now() AND t.active=true`,[hashed])
 if (!check.rowCount) {json(res,401,{error:'Credencial inválida'});return true}
 const key = check.rows[0]
 if (!Array.isArray(key.scopes) || !key.scopes.includes(SCOPE)) {json(res,403,{error:'Permiso insuficiente'});return true}
 const appId = url.searchParams.get('appId')
 if (!appId || appId.length > 150 || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(appId)) {
  json(res,400,{error:'appId obligatorio o inválido'});return true
 }
 const catalog = await pool.query(`SELECT p.revision,p.payload FROM published_catalogs p
  JOIN mobile_apps a ON a.app_id=p.app_id AND a.tenant_id=p.tenant_id
  WHERE p.app_id=$1 AND p.tenant_id=$2 AND a.enabled=true`,[appId,key.tenant_id])
 if (!catalog.rowCount) {json(res,404,{error:'Catálogo no publicado para esta empresa'});return true}
 await pool.query('UPDATE tenant_api_keys SET last_used_at=now() WHERE id=$1',[key.id])
 json(res,200,{ready:true,revision:catalog.rows[0].revision,...catalog.rows[0].payload})
 return true
}
