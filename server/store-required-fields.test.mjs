import test from 'node:test'
import assert from 'node:assert/strict'
import {validateRequiredStoreFields} from './store-required-fields.mjs'

const complete={code:'sede-nogales',name:'Nogales',address:'Av. los Nogales 482, Santa Anita',latitude:-12.043,longitude:-76.969,active:false}
test('sede nueva exige ID, nombre, dirección, latitud y longitud',()=>{
 for(const missing of ['code','name','address','latitude','longitude','active']){
  const input={...complete}
  delete input[missing]
  assert.throws(()=>validateRequiredStoreFields(input,{creating:true}),{code:400},missing)
 }
 for(const empty of [{name:'   '},{address:''},{latitude:null},{longitude:null},{latitude:''},{longitude:''}]){
  assert.throws(()=>validateRequiredStoreFields({...complete,...empty},{creating:true}),{code:400})
 }
})
test('permite sede activa e inactiva; no exige checkbox marcado',()=>{
 assert.equal(validateRequiredStoreFields({...complete,active:false},{creating:true}),true)
 assert.equal(validateRequiredStoreFields({...complete,active:true},{creating:true}),true)
 assert.throws(()=>validateRequiredStoreFields({...complete,active:undefined},{creating:true}),{code:400})
})
test('GPS requiere coordenadas numéricas en rango y permite cero',()=>{
 assert.equal(validateRequiredStoreFields({...complete,latitude:0,longitude:0},{creating:true}),true)
 for(const location of [{latitude:91},{latitude:-91},{longitude:181},{longitude:-181},{latitude:NaN},{longitude:Infinity},{longitude:'-76.969'}])
  assert.throws(()=>validateRequiredStoreFields({...complete,...location},{creating:true}),{code:400})
})
test('al editar valida siempre GPS, nombre y dirección pero permite omitir el código inmutable',()=>{
 const {code,...editing}=complete
 assert.equal(validateRequiredStoreFields(editing,{creating:false}),true)
 assert.throws(()=>validateRequiredStoreFields({...editing,longitude:null},{creating:false}),{code:400})
})
