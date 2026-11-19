import test from 'node:test'
import assert from 'node:assert/strict'
import {posix, win32} from 'node:path'
import {isStaticPathAllowed} from './static-path-policy.mjs'

test('Linux / Railway: permite raíz, index y recursos dentro de dist', () => {
 const base='/app/dist'
 for(const p of [base, '/app/dist/index.html', '/app/dist/assets/app.js', '/app/dist/.well-known/asset']) {
  assert.equal(isStaticPathAllowed(base,p,posix),true,p)
 }
 for(const p of ['/app', '/app/dist-other/app.js', '/app/secret.env','/etc/passwd']) {
  assert.equal(isStaticPathAllowed(base,p,posix),false,p)
 }
})
test('Windows local: permite raíz y recursos con separadores nativos', () => {
 const base='C:\\Integra-B2G\\Administrador Negocios\\dist'
 for(const p of [base,win32.join(base,'index.html'),win32.join(base,'assets','main.js')]) {
  assert.equal(isStaticPathAllowed(base,p,win32),true,p)
 }
 for(const p of [win32.dirname(base),win32.join(win32.dirname(base),'dist-old','index.html'),
  'D:\\secret.txt',win32.join(base,'..','..','secrets.env')]) {
  assert.equal(isStaticPathAllowed(base,p,win32),false,p)
 }
})
