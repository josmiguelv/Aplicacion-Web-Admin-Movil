// Dedicated, empty PostgreSQL 17 bootstrap for INTEGRA B2G Administrator ONLY.
// Default mode is read-only file verification (no database connection).
// To apply: set DATABASE_URL to a NEW, EMPTY Admin database, then
// ADMIN_DATABASE_BOOTSTRAP_CONFIRM=INIT_EMPTY_ADMIN_DATABASE node scripts/bootstrap-empty-admin-db.mjs --apply-empty
// NEVER run against TU VERSO. No automatic startup execution.
import {readFile,readdir} from 'node:fs/promises'
import {createHash} from 'node:crypto'

const migrationDir=new URL('../server/migrations/',import.meta.url)
const schemaUrl=new URL('../server/schema.sql',import.meta.url)
const schema=await readFile(schemaUrl,'utf8')
const files=(await readdir(migrationDir)).filter(name=>/^\d{3}-.*\.sql$/.test(name)).sort()
const sha256=data=>createHash('sha256').update(data).digest('hex')
const migrations=await Promise.all(files.map(async name=>{
 const raw=await readFile(new URL(name,migrationDir),'utf8')
 // File-scoped BEGIN/COMMIT belong to the outer atomic bootstrap transaction.
 const sql=raw.replace(/^\s*BEGIN;\s*$/gmi,'').replace(/^\s*COMMIT;\s*$/gmi,'')
 return {name,sha:sha256(raw),sql}
}))
function guard(ok,message){if(!ok)throw Error('NO-GO: '+message)}
guard(files.length===23,'expected exactly 23 historical migration files (001,003..024)')
guard(files[0].startsWith('001-')&&files.at(-1).startsWith('024-'),'unexpected migration range')
guard(schema.includes('CREATE TABLE IF NOT EXISTS mobile_scheduled_orders'),
 'schema baseline lacks scheduled orders')
guard(schema.includes('CREATE TABLE IF NOT EXISTS published_catalogs'),
 'schema baseline lacks published catalogs')
guard(!schema.includes('\n )\n);\nCREATE TABLE IF NOT EXISTS published_catalogs'),
 'schema baseline contains corrupt duplicated SQL')
guard((schema.match(/CREATE TABLE IF NOT EXISTS published_catalogs/g)||[]).length===1,
 'duplicate published catalog definition')
guard(migrations.some(m=>m.name.startsWith('023-')),'surveys migration missing')
guard(migrations.some(m=>m.name.startsWith('024-')),'promotion-product migration missing')
console.log('PASS static baseline and '+migrations.length+' migration file(s) found')
if(!process.argv.includes('--apply-empty')){
 console.log('READ-ONLY: no database connection or SQL execution. To initialize a fresh Admin DB use --apply-empty with explicit confirmation.')
 process.exit(0)
}
guard(process.env.ADMIN_DATABASE_BOOTSTRAP_CONFIRM==='INIT_EMPTY_ADMIN_DATABASE',
 'explicit confirmation is required')
guard(Boolean(process.env.DATABASE_URL),'DATABASE_URL is required')
const {default:pg}=await import('pg')
const client=new pg.Client({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000})
await client.connect()
try{
 await client.query('BEGIN')
 await client.query('SET LOCAL lock_timeout = \'10s\'')
 await client.query('SET LOCAL statement_timeout = \'120s\'')
 await client.query('SELECT pg_advisory_xact_lock(634521,20261128)')
 const context=await client.query('SELECT current_database() AS database, current_schema() AS schema, current_setting(\'server_version_num\')::int AS version')
 const ctx=context.rows[0]
 guard(ctx.version>=170000 && ctx.version<180000,'expected PostgreSQL 17')
 guard(ctx.schema==='public','bootstrap must run in the public schema')
 const count=await client.query(`SELECT count(*)::int AS n FROM pg_class c
   JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p','v','m','f')`)
 guard(count.rows[0].n===0,'target database already contains public relations; refusing to change anything')
 console.log('Initializing new empty Administrator database:',ctx.database)
 await client.query(schema)
 await client.query(`CREATE TABLE admin_schema_migrations (
   filename TEXT PRIMARY KEY, sha256 CHAR(64) NOT NULL, applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
 )`)
 await client.query('INSERT INTO admin_schema_migrations(filename,sha256) VALUES($1,$2)',
  ['BASELINE-schema.sql',sha256(schema)])
 for(const m of migrations){
  await client.query(m.sql)
  await client.query('INSERT INTO admin_schema_migrations(filename,sha256) VALUES($1,$2)',[m.name,m.sha])
 }
 const required=['tenants','admin_users','mobile_apps','stores','products',
  'published_catalogs','tenant_integrations','integration_bindings',
  'mobile_order_validations','mobile_scheduled_orders',
  'mobile_payment_receipt_images','mobile_order_surveys','company_payment_images']
 const missing=(await client.query('SELECT unnest($1::text[]) AS name', [required])).rows.map(x=>x.name)
  .filter(Boolean)
 const check=await client.query(`SELECT table_name FROM information_schema.tables
 WHERE table_schema='public' AND table_name=ANY($1::text[])`,[required])
 const found=new Set(check.rows.map(x=>x.table_name))
 guard(missing.every(name=>found.has(name)),
  'required schema tables absent: '+missing.filter(name=>!found.has(name)).join(','))
 const cols=await client.query(`SELECT table_name,column_name FROM information_schema.columns
 WHERE table_schema='public' AND (
 (table_name='promotions' AND column_name='product_id') OR
 (table_name='stores' AND column_name='pickup_preparation_minutes') OR
 (table_name='integration_bindings' AND column_name='app_id'))`)
 guard(cols.rowCount===3,'required migration columns are missing')
 await client.query('COMMIT')
 console.log('PASS Admin PostgreSQL 17 initialized atomically: baseline + '+migrations.length+
  ' migrations; ledger '+(migrations.length+1)+' records; required tables and columns present')
}catch(error){
 await client.query('ROLLBACK').catch(()=>{})
 console.error('NO-GO: empty Administrator DB bootstrap rolled back:',error.message)
 process.exitCode=1
}finally{await client.end()}
