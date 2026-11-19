import test from 'node:test'
import assert from 'node:assert/strict'
import {randomBytes} from 'node:crypto'
import {normalizeTuVersoCredential} from './tuverso-credential-format.mjs'

const random=()=>randomBytes(40).toString('hex')

test('acepta formatos actuales y futuros sin imponer una versión',()=>{
 for(const value of ['tvi_v1_'+random(),'tvi_v2_'+random(),'tvi_v42_'+random(),
  'tuverso_'+random(),'nuevo_formato_2027_'+random()]) {
  assert.equal(normalizeTuVersoCredential(value),value)
 }
})
test('elimina solo espacios exteriores accidentales',()=>{
 const key='tuverso_'+random()
 assert.equal(normalizeTuVersoCredential('  \n'+key+'  \t'),key)
})
test('rechaza valores inseguros o de otro emisor',()=>{
 const key='tuverso_'+random()
 for(const value of [null,undefined,{},'','tuverso_', 'tvi_v1_','Bearer '+key,
  key+' otro',key+'\r\nInjected: x','ib2g_sk_v1_'+random(),
  'tuverso_'+ 'a'.repeat(1100),'tuverso_'+random()+'!']) {
  assert.equal(normalizeTuVersoCredential(value),null)
 }
})
test('no transforma el contenido interno de una credencial',()=>{
 const key='tuverso_'+random()+'+/=='
 assert.equal(normalizeTuVersoCredential(key),key)
})
