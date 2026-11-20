import test from 'node:test'
import assert from 'node:assert/strict'
import {verifyStoredOrderAvailability} from './storeAvailabilityConfirmation.mjs'
const id='48481678-c00b-4a3a-a57f-aeb270e8dbb1'
test('confirma true únicamente tras leer el valor persistido de la misma sede',()=>{
 const saved={id,consult_order_availability:true}
 const rows=[{id:'7edabce0-99fa-4ada-a45c-f9003e9c9dd8',consult_order_availability:false},{id,consult_order_availability:true}]
 assert.equal(verifyStoredOrderAvailability(saved,rows,true).id,id)
})
test('false guardado no equivale a campo ausente en un backend antiguo',()=>{
 assert.equal(verifyStoredOrderAvailability({id,consult_order_availability:false},[{id,consult_order_availability:false}],false).consult_order_availability,false)
 assert.throws(()=>verifyStoredOrderAvailability({id},[{id}],false),/migración 011/)
})
test('rechaza falsos éxitos: valor perdido, respuesta incorrecta o sede ausente',()=>{
 assert.throws(()=>verifyStoredOrderAvailability({id,consult_order_availability:true},[{id,consult_order_availability:false}],true),/no conservó/)
 assert.throws(()=>verifyStoredOrderAvailability({id,consult_order_availability:false},[{id,consult_order_availability:false}],true),/no conservó/)
 assert.throws(()=>verifyStoredOrderAvailability({id,consult_order_availability:true},[],true),/migración 011/)
})
