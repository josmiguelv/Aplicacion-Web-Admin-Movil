// Diagnóstico de solo lectura para la integración de pedidos móviles Pollos B3.
// No imprime tokens, secretos, referencias externas ni realiza escrituras.
import pg from 'pg'

const appId='com.integrab2g.pollosb3'
if(!process.env.DATABASE_URL) {
 console.error('ERROR: falta DATABASE_URL en el entorno del Administrador')
 process.exitCode=1
} else {
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL,max:1})
 const required=['queue.availability.read','interactions.create','conversations.messages.write']
 const tracking=['interactions.read','conversations.read']
 try {
  const client=await pool.connect()
  try {
   await client.query('BEGIN READ ONLY')
   const {rows}=await client.query(`
    SELECT s.name AS store_name, i.name AS integration_name,
     i.channel_type,i.scopes,i.suspended,
     (i.encrypted_credential IS NOT NULL) AS has_credential,
     (i.expires_at IS NULL OR i.expires_at>now()) AS valid_expiry,
     (b.authorization_confirmed_at IS NOT NULL) AS authorized,
     b.purpose
    FROM integration_bindings b
    JOIN tenant_integrations i ON i.tenant_id=b.tenant_id AND i.id=b.integration_id
    JOIN stores s ON s.tenant_id=b.tenant_id AND s.id=b.store_id
    WHERE b.app_id=$1 AND b.purpose='ORDER_REQUEST'
    ORDER BY s.name,i.name
   `,[appId])
   console.log('Asociaciones locales ORDER_REQUEST encontradas:',rows.length)
   for(const row of rows){
    const scopes=Array.isArray(row.scopes)?row.scopes:[]
    const missing=[...required,...tracking].filter(s=>!scopes.includes(s))
    const problems=[
     ...(!row.authorized?['Sede no confirmada']:[]),
     ...(row.suspended?['Integración suspendida']:[]),
     ...(!row.has_credential?['Credencial local ausente']:[]),
     ...(!row.valid_expiry?['Credencial local vencida']:[]),
     ...(row.channel_type&&row.channel_type!=='MOBILE_APP'?['Canal no MOBILE_APP']:[]),
     ...missing.map(s=>'Permiso local ausente: '+s)
    ]
    console.log(JSON.stringify({
     sede:row.store_name,integracion:row.integration_name,
     diagnostico:problems.length?problems:['Configuración local completa: verificar permiso efectivo remoto'],
     permisosLocales:scopes
    },null,2))
   }
   await client.query('ROLLBACK')
  } finally {client.release()}
 } catch(error){
  console.error('No se pudo consultar la configuración local:',error.code||error.message)
  process.exitCode=1
 } finally {await pool.end()}
}
