import test from 'node:test'
import assert from 'node:assert/strict'
import {isAllowedAdminOrigin} from './admin-origin-policy.mjs'

const main='http://localhost:3000'
const tunnel='https://surprise-kong-stories-brand.trycloudflare.com'
const args={adminOrigin:main,extraOrigins:[tunnel]}

test('localhost y solo el túnel HTTPS autorizado funcionan en desarrollo',()=>{
 assert.equal(isAllowedAdminOrigin(main,args),true)
 assert.equal(isAllowedAdminOrigin(tunnel,args),true)
 assert.equal(isAllowedAdminOrigin('https://other.trycloudflare.com',args),false)
 assert.equal(isAllowedAdminOrigin('http://surprise-kong-stories-brand.trycloudflare.com',args),false)
 assert.equal(isAllowedAdminOrigin(tunnel+'/login',args),false)
 assert.equal(isAllowedAdminOrigin('null',args),false)
})
test('no acepta entradas de allowlist que no sean orígenes HTTPS exactos',()=>{
 for(const extra of ['*','https://foo.trycloudflare.com/','http://foo.trycloudflare.com',
   'https://foo.trycloudflare.com/login','https://foo.trycloudflare.com?x=y']) {
  assert.equal(isAllowedAdminOrigin(extra,{adminOrigin:main,extraOrigins:[extra]}),false)
 }
})
test('en producción, solo ADMIN_ORIGIN puede iniciar sesiones o escribir',()=>{
 const production={...args,adminOrigin:'https://admin.example.com',production:true}
 assert.equal(isAllowedAdminOrigin('https://admin.example.com',production),true)
 assert.equal(isAllowedAdminOrigin(tunnel,production),false)
 assert.equal(isAllowedAdminOrigin(undefined,production),false)
})
test('mantiene la compatibilidad local sin Origin (herramientas CLI)',()=>{
 assert.equal(isAllowedAdminOrigin(undefined,args),true)
 assert.equal(isAllowedAdminOrigin('',args),true)
})
