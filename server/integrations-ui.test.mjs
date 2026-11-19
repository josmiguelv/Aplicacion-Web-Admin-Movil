// Prueba focalizada del flujo UX del administrador (requiere frontend/backend local y Playwright).
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'../.local/browser/node_modules/playwright/index.mjs')
import pg from 'pg'
import {randomBytes,randomUUID,scryptSync} from 'node:crypto'
import assert from 'node:assert/strict'

const db=new URL(process.env.DATABASE_URL)
assert.equal(db.hostname,'127.0.0.1')
assert.equal(db.port,'55432')
assert.equal(db.pathname,'/integra_admin')
const pool=new pg.Pool({connectionString:db.href})
const tag=randomUUID(),password=randomBytes(24).toString('hex')
const salt=randomBytes(16).toString('hex'),hash='scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex')
const email='ux-tuverso-'+tag+'@example.invalid'
const token='tuverso_'+randomBytes(32).toString('hex'),replacement='tuverso_'+randomBytes(32).toString('hex')
let browser,tenantId,userId,storeId,originalId
try{
 tenantId=(await pool.query('INSERT INTO tenants(name) VALUES($1) RETURNING id',['PRUEBA UX INTEGRACIONES '+tag])).rows[0].id
 userId=(await pool.query("INSERT INTO admin_users(email,password_hash,role) VALUES($1,$2,'SUPER_ADMIN') RETURNING id",[email,hash])).rows[0].id
 storeId=(await pool.query("INSERT INTO stores(tenant_id,code,name,address) VALUES($1,'ux-sede-local','Sede UX prueba','Local') RETURNING id",[tenantId])).rows[0].id
 browser=await chromium.launch({channel:'msedge',headless:true})
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 const page=await context.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message))
 await page.goto('http://localhost:3000')
 await page.getByLabel('Correo electrónico').fill(email)
 await page.getByLabel('Contraseña',{exact:true}).fill(password)
 await page.getByRole('button',{name:'Iniciar sesión'}).click()
 const openCompany=async()=>page.locator('.portal-company').filter({hasText:'PRUEBA UX INTEGRACIONES '+tag}).getByRole('button',{name:'Integraciones',exact:true}).click()
 await openCompany()
 await page.getByRole('heading',{name:'Integraciones → TU VERSO'}).waitFor()

 // Primer acceso: clave visible; éxito donde aparece el estado, no arriba de toda la página.
 await page.getByLabel('Clave de integración',{exact:true}).fill(token)
 await page.getByRole('button',{name:'Guardar clave y continuar'}).click()
 await page.getByRole('heading',{name:'Estado de la conexión'}).waitFor()
 await page.locator('.integration-overview .portal-notice').getByText('Clave guardada. Ahora vincula una sede autorizada o comprueba la conexión si ya existe una.').waitFor()
 assert.equal(await page.locator('.integration-page > .portal-notice').count(),0)
 assert.equal(await page.getByLabel('Clave de integración',{exact:true}).count(),0)
 assert.ok(!(await page.content()).includes(token))
 assert.equal(await page.evaluate(()=>JSON.stringify({...localStorage,...sessionStorage})),'{}')
 originalId=(await pool.query('SELECT id FROM tenant_integrations WHERE tenant_id=$1',[tenantId])).rows[0].id

 // Asociar sede: confirmación local debajo de la sección usada.
 await page.getByLabel('Sede',{exact:true}).selectOption(storeId)
 await page.getByLabel('Propósito',{exact:true}).selectOption('ORDER_REQUEST')
 await page.getByLabel('Confirmo que esta sede y propósito ya están autorizados para la clave en TU VERSO.').check()
 await page.getByRole('button',{name:'Guardar asociación',exact:true}).click()
 await page.locator('.integration-locations .portal-notice').getByText('Sede y propósito guardados. Ahora puedes comprobar disponibilidad.').waitFor()
 const bound=(await pool.query('SELECT external_location_id FROM integration_bindings WHERE tenant_id=$1',[tenantId])).rows[0]
 assert.equal(bound.external_location_id,'ux-sede-local')
 assert.equal(await page.getByRole('button',{name:'Probar conexión',exact:true}).isDisabled(),true)

 // Crear una conexión vacía por API. Debe poder eliminarse desde la nueva interfaz.
 const emptyResponse=await context.request.post('http://localhost:3000/api/admin/tenants/'+tenantId+'/integrations',{
  headers:{Origin:'http://localhost:3000'},data:{name:'Conexión vacía de prueba'},
 })
 assert.equal(emptyResponse.status(),201)
 const empty=await emptyResponse.json()
 await page.reload()
 await page.getByRole('heading',{name:'Empresas',exact:true}).waitFor()
 await openCompany()
 await page.getByLabel('Seleccionar conexión',{exact:true}).selectOption(empty.id)
 await page.getByText('Eliminar conexión sin configurar',{exact:true}).click()
 const emptyPanel=page.locator('details.integration-advanced').filter({hasText:'Eliminar conexión sin configurar'})
 await emptyPanel.getByRole('button',{name:'Eliminar conexión',exact:true}).click()
 await emptyPanel.getByRole('button',{name:'Cancelar',exact:true}).click()
 assert.equal((await pool.query('SELECT 1 FROM tenant_integrations WHERE id=$1',[empty.id])).rowCount,1)
 await emptyPanel.getByRole('button',{name:'Eliminar conexión',exact:true}).click()
 await emptyPanel.getByRole('button',{name:'Confirmar eliminación',exact:true}).click()
 assert.equal((await pool.query('SELECT 1 FROM tenant_integrations WHERE id=$1',[empty.id])).rowCount,0)

 // Renovar una clave: confirmación bajo Guardar nueva clave, no en encabezado de página.
 await page.getByRole('heading',{name:'Estado de la conexión'}).waitFor()
 await page.getByText('Acciones avanzadas de esta conexión',{exact:true}).click()
 await page.getByRole('button',{name:'Cambiar clave guardada',exact:true}).click()
 await page.getByLabel('Clave de integración',{exact:true}).fill(replacement)
 await page.getByRole('button',{name:'Guardar nueva clave',exact:true}).click()
 await page.locator('.integration-key-form .portal-notice').getByText('Clave actualizada. La credencial anterior ya no se usa en este administrador.').waitFor()
 assert.ok(!(await page.content()).includes(replacement))
 assert.equal(await page.locator('.integration-page > .portal-notice').count(),0)
 await page.getByRole('button',{name:'Cancelar cambio de clave',exact:true}).click()

 // Activar/desactivar conserva su contrato local, sin cambios en TU VERSO.
 await page.getByRole('button',{name:'Desactivar conexión con TU VERSO',exact:true}).click()
 await page.getByRole('button',{name:'Sí, desactivar',exact:true}).click()
 await page.getByRole('button',{name:'Activar conexión con TU VERSO',exact:true}).waitFor()
 await page.locator('.integration-action-block .portal-notice').getByText('Conexión desactivada en este administrador. TU VERSO no se modificó.').waitFor()
 await page.getByRole('button',{name:'Activar conexión con TU VERSO',exact:true}).click()

 // Eliminación de clave y conexión preserva el local comercial.
 await page.getByText('Eliminar solo la clave guardada',{exact:true}).click()
 await page.getByLabel('Confirmo que quiero eliminar la clave guardada.').check()
 await page.getByRole('button',{name:'Eliminar clave',exact:true}).click()
 await page.getByRole('heading',{name:'1. Registrar clave de TU VERSO',exact:true}).waitFor()
 assert.equal((await pool.query('SELECT encrypted_credential FROM tenant_integrations WHERE id=$1',[originalId])).rows[0].encrypted_credential,null)
 await page.getByText('Eliminar conexión sin configurar',{exact:true}).click()
 await page.locator('details.integration-advanced').getByRole('button',{name:'Eliminar conexión',exact:true}).click()
 await page.getByRole('button',{name:'Confirmar eliminación',exact:true}).click()
 await page.getByRole('heading',{name:'Conexión',exact:true}).waitFor({state:'detached'})
 assert.equal((await pool.query('SELECT 1 FROM tenant_integrations WHERE id=$1',[originalId])).rowCount,0)
 assert.equal((await pool.query('SELECT 1 FROM stores WHERE id=$1',[storeId])).rowCount,1)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false)
 assert.deepEqual(errors,[])
 console.log('PASS: UX TU VERSO, mensajes junto a acciones, clave no expuesta, cambios y eliminación local segura')
}finally{
 if(browser)await browser.close()
 if(tenantId){
  await pool.query('DELETE FROM integration_bindings WHERE tenant_id=$1',[tenantId])
  await pool.query('DELETE FROM tenant_integrations WHERE tenant_id=$1',[tenantId])
  await pool.query('DELETE FROM admin_audit WHERE tenant_id=$1',[tenantId])
  await pool.query('DELETE FROM stores WHERE tenant_id=$1',[tenantId])
  await pool.query('DELETE FROM tenants WHERE id=$1',[tenantId])
 }
 if(userId)await pool.query('DELETE FROM admin_users WHERE id=$1',[userId])
 await pool.end()
}
