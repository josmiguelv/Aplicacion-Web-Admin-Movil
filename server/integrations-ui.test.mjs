const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'../.local/browser/node_modules/playwright/index.mjs')
import pg from 'pg'
import {randomBytes,randomUUID,scryptSync} from 'node:crypto'
import assert from 'node:assert/strict'
const u=new URL(process.env.DATABASE_URL);assert.equal(u.hostname,'127.0.0.1');assert.equal(u.port,'55432');assert.equal(u.pathname,'/integra_admin')
const pool=new pg.Pool({connectionString:u.href}),tag=randomUUID(),password=randomBytes(24).toString('hex'),token='tvi_v1_'+randomBytes(32).toString('hex'),replacement='tvi_v1_'+randomBytes(32).toString('hex'),salt=randomBytes(16).toString('hex'),email=`ui-integration-${tag}@example.invalid`,hash=`scrypt:${salt}:${scryptSync(password,salt,64).toString('hex')}`
let browser,tenantId,userId
try{
 tenantId=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['PRUEBA UI INTEGRACIONES '+tag])).rows[0].id
 userId=(await pool.query("INSERT INTO admin_users(email,password_hash,role) VALUES($1,$2,'SUPER_ADMIN') RETURNING id",[email,hash])).rows[0].id
 const storeId=(await pool.query("INSERT INTO stores(tenant_id,code,name,address) VALUES($1,'prueba-ui-integracion','Sede prueba UI','Solo local') RETURNING id",[tenantId])).rows[0].id
 browser=await chromium.launch({channel:'msedge',headless:true})
 const context=await browser.newContext({viewport:{width:1440,height:1000}}),page=await context.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://localhost:3000');await page.getByLabel('Correo electrónico').fill(email);await page.getByLabel('Contraseña',{exact:true}).fill(password);await page.getByRole('button',{name:'Iniciar sesión'}).click()
 const openCompany=async()=>page.locator('.portal-company').filter({hasText:'PRUEBA UI INTEGRACIONES '+tag}).getByRole('button',{name:'Integraciones',exact:true}).click()
 await openCompany();await page.getByRole('heading',{name:'Integraciones → TU VERSO'}).waitFor()
 assert.equal(await page.getByLabel('Clave de integración',{exact:true}).isVisible(),true)
 for(const label of ['Código de cuenta en TU VERSO','Código de empresa en TU VERSO','Código de la aplicación o web en TU VERSO','Referencia de cola autorizada en TU VERSO'])assert.equal(await page.getByLabel(label,{exact:true}).count(),0)
 assert.equal(await page.getByRole('button',{name:'Guardar configuración',exact:true}).count(),0)
 assert.ok(!(await page.locator('body').innerText()).includes('queue.availability.read'))
 await page.getByLabel('Clave de integración',{exact:true}).fill(token);await page.getByRole('button',{name:'Guardar clave y continuar',exact:true}).click()
 await page.getByRole('heading',{name:'1. Sustituir clave de conexión',exact:true}).waitFor()
 assert.equal(await page.getByLabel('Clave de integración',{exact:true}).inputValue(),'')
 assert.ok(!(await page.content()).includes(token));assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage})), '{}')
 const original=(await pool.query('SELECT * FROM tenant_integrations WHERE tenant_id=$1',[tenantId])).rows[0]
 for(const key of ['external_tenant_id','channel_account_id','channel_type','instance_key'])assert.equal(original[key],null)
 assert.ok(original.encrypted_credential&&!original.encrypted_credential.includes(token))
 await page.getByLabel('Sede',{exact:true}).selectOption(storeId);await page.getByLabel('Propósito',{exact:true}).selectOption('ORDER_REQUEST')
 await page.getByLabel('Confirmo que esta sede y este propósito están autorizados para la clave en TU VERSO.').check()
 await page.getByRole('button',{name:'Guardar sede y propósito',exact:true}).click();await page.getByText('Sede y propósito guardados. Puedes comprobar la conexión.').waitFor()
 const binding=(await pool.query('SELECT external_location_id,queue_reference FROM integration_bindings WHERE tenant_id=$1',[tenantId])).rows[0]
 assert.equal(binding.external_location_id,'prueba-ui-integracion');assert.equal(binding.queue_reference,null)
 assert.equal(await page.getByRole('button',{name:'Probar conexión',exact:true}).isDisabled(),true)
 const emptyResponse=await context.request.post(`http://localhost:3000/api/admin/tenants/${tenantId}/integrations`,{headers:{Origin:'http://localhost:3000'},data:{name:'Conexión vacía de prueba'}})
 assert.equal(emptyResponse.status(),201);const empty=await emptyResponse.json()
 await page.reload();await page.getByRole('heading',{name:'Empresas',exact:true}).waitFor();await openCompany();await page.getByRole('button',{name:'Configurar TU VERSO',exact:true}).click();await page.getByRole('heading',{name:'1. Sustituir clave de conexión',exact:true}).waitFor()
 await page.getByText('Atención de pedidos · Código de sede: prueba-ui-integracion',{exact:true}).waitFor()
 const emptyRow=page.locator(`[data-connection-id="${empty.id}"]`)
 await emptyRow.getByRole('button',{name:'Eliminar conexión',exact:true}).click()
 await emptyRow.getByRole('button',{name:'Cancelar',exact:true}).click()
 assert.equal((await pool.query('SELECT 1 FROM tenant_integrations WHERE id=$1',[empty.id])).rowCount,1)
 await emptyRow.getByRole('button',{name:'Eliminar conexión',exact:true}).click()
 await emptyRow.getByRole('button',{name:'Confirmar eliminación',exact:true}).click()
 await emptyRow.waitFor({state:'detached'})
 assert.equal((await pool.query('SELECT 1 FROM tenant_integrations WHERE id=$1',[empty.id])).rowCount,0)
 assert.equal(await page.getByRole('heading',{name:'1. Sustituir clave de conexión',exact:true}).isVisible(),true)
 await page.getByLabel('Clave de integración',{exact:true}).fill(replacement);await page.getByRole('button',{name:'Guardar nueva clave',exact:true}).click();await page.getByText('Clave guardada de forma segura. Ahora selecciona la sede y el propósito autorizados.').waitFor()
 const updated=(await pool.query('SELECT encrypted_credential FROM tenant_integrations WHERE id=$1',[original.id])).rows[0]
 assert.notEqual(updated.encrypted_credential,original.encrypted_credential)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 await page.screenshot({path:'.local/tuverso-integrations-desktop.png',fullPage:true})
 await page.getByRole('button',{name:'Desactivar conexión con TU VERSO',exact:true}).click();await page.getByRole('button',{name:'Sí, desactivar conexión',exact:true}).click();await page.getByRole('button',{name:'Activar conexión con TU VERSO',exact:true}).waitFor()
 await page.getByText('Eliminar clave guardada',{exact:true}).click();await page.getByLabel('Confirmo que quiero eliminar la clave guardada.').check();await page.getByRole('button',{name:'Eliminar clave',exact:true}).click();await page.getByRole('heading',{name:'1. Clave de integración',exact:true}).waitFor()
 assert.deepEqual(errors,[])
 const final=(await pool.query('SELECT encrypted_credential,last_check FROM tenant_integrations WHERE tenant_id=$1',[tenantId])).rows[0];assert.equal(final.encrypted_credential,null);assert.equal(final.last_check,null)
 await page.locator(`[data-connection-id="${original.id}"]`).getByRole('button',{name:'Eliminar conexión',exact:true}).click()
 await page.getByRole('button',{name:'Confirmar eliminación',exact:true}).click()
 await page.getByRole('heading',{name:'Conexiones guardadas',exact:true}).waitFor({state:'detached'})
 assert.equal((await pool.query('SELECT 1 FROM tenant_integrations WHERE id=$1',[original.id])).rowCount,0)
 assert.equal((await pool.query('SELECT 1 FROM integration_bindings WHERE integration_id=$1',[original.id])).rowCount,0)
 assert.equal((await pool.query('SELECT 1 FROM stores WHERE id=$1',[storeId])).rowCount,1)
 await page.reload();await page.getByRole('heading',{name:'Empresas',exact:true}).waitFor();await openCompany();await page.getByRole('heading',{name:'1. Clave de integración',exact:true}).waitFor()
 assert.equal(await page.getByRole('heading',{name:'Conexiones guardadas',exact:true}).count(),0)
 console.log('PASS saved connection deletion: cancel, empty unselected connection, selected connection and persistent removal after reload; commercial store preserved.')
 console.log('PASS minimal desktop flow: key visible immediately; no account/tenant/instance/queue inputs; key + store + purpose saved and persisted; replacement, suspension and deletion verified; live checks blocked; no browser storage secrets or JS errors.')
}finally{
 if(browser)await browser.close()
 if(tenantId){await pool.query('DELETE FROM integration_bindings WHERE tenant_id=$1',[tenantId]);await pool.query('DELETE FROM tenant_integrations WHERE tenant_id=$1',[tenantId]);await pool.query('DELETE FROM admin_audit WHERE tenant_id=$1',[tenantId]);await pool.query('DELETE FROM stores WHERE tenant_id=$1',[tenantId]);await pool.query('DELETE FROM tenants WHERE id=$1',[tenantId])}
 if(userId)await pool.query('DELETE FROM admin_users WHERE id=$1',[userId]);await pool.end()
}
