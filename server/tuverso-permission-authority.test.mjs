import test from 'node:test'
import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'

const mobile=readFileSync(new URL('./mobile-tuverso-routes.mjs',import.meta.url),'utf8')
const admin=readFileSync(new URL('./integrations.mjs',import.meta.url),'utf8')
const ui=readFileSync(new URL('../src/app/TuVersoIntegrations.tsx',import.meta.url),'utf8')

test('PRE-F2/08: no cached TU VERSO scopes deny real mobile S2S requests',()=>{
 assert.doesNotMatch(mobile,/i\.scopes/)
 assert.doesNotMatch(mobile,/row\.scopes/)
 assert.doesNotMatch(mobile,/kind==='(create|message|status|cancel)'/)
 assert.match(mobile,/return \{\.\.\.row,token:decrypt\(row\.encrypted_credential,tenantId,row\.integration_id\)\}/)
 assert.match(mobile,/createInteraction\(integration\.token/)
 assert.match(mobile,/readInteraction\(integration\.token/)
 assert.match(mobile,/sendMessage\(integration\.token/)
})

test('PRE-F2/08: tenant/app/store binding, real credential and user tracking remain enforced',()=>{
 assert.match(mobile,/JOIN mobile_apps a ON a\.app_id=p\.app_id AND a\.tenant_id=p\.tenant_id/)
 assert.match(mobile,/b\.authorization_confirmed_at IS NOT NULL/)
 assert.match(mobile,/WHERE b\.tenant_id=\$1 AND b\.app_id=\$2 AND b\.store_id=\$3/)
 assert.match(mobile,/row\.suspended\|\|!row\.encrypted_credential/)
 assert.match(mobile,/x-order-access-key/)
 assert.match(mobile,/equals\(remote\.data\?\.externalReference,expected\)/)
 assert.match(mobile,/idempotency-key/)
})

test('PRE-F2/08: legacy admin integration forwarding no longer denies interactions.create locally',()=>{
 assert.doesNotMatch(admin,/row\.scopes\?\.includes\('interactions\.create'\)/)
 assert.match(admin,/b\.authorizeSend!==true/)
 assert.match(admin,/binding\.authorization_confirmed_at/)
 assert.match(admin,/createMobileInteraction\(/)
 assert.match(admin,/decryptCredential\(/)
})

test('PRE-F2/08: admin UI no longer edits a shadow scope permission list',()=>{
 assert.doesNotMatch(ui,/Guardar permisos locales|Confirmo que la credencial de TU VERSO ya tiene autorizados los permisos seleccionados/)
 assert.doesNotMatch(ui,/localScopes|confirmScopeUpdate|textOrderReady/)
 assert.match(ui,/Los permisos de disponibilidad, solicitudes y mensajes se gestionan en TU VERSO/)
})
