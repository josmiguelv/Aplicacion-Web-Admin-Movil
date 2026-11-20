import {test} from 'node:test'
import assert from 'node:assert/strict'
import {applyStoreHoursPreset,storeHoursSummary} from './storeHoursUx.mjs'
test('horario rápido para toda la semana crea siete días válidos',()=>{
 const hours=applyStoreHoursPreset({},'all','11:00','23:00')
 assert.equal(Object.keys(hours).length,7)
 assert.deepEqual(storeHoursSummary(hours),{openDays:7,closedDays:0,unconfigured:0})
})
test('lunes a viernes preserva configuraciones del fin de semana',()=>{
 const original={sat:{open:'10:00',close:'22:00'},sun:{closed:true}}
 const result=applyStoreHoursPreset(original,'weekdays','09:00','18:00')
 assert.deepEqual(result.sat,original.sat)
 assert.deepEqual(result.sun,original.sun)
 assert.equal(result.mon.open,'09:00')
 assert.deepEqual(storeHoursSummary(result),{openDays:6,closedDays:1,unconfigured:0})
 assert.deepEqual(original,{sat:{open:'10:00',close:'22:00'},sun:{closed:true}})
})
test('solo sábados y domingos no modifica días laborales',()=>{
 const result=applyStoreHoursPreset({mon:{closed:true}},'weekend','11:00','22:00')
 assert.deepEqual(result.mon,{closed:true})
 assert.equal(result.sat.close,'22:00')
 assert.equal(result.tue,undefined)
})
test('rechaza franjas incompletas, idénticas y selector inválido',()=>{
 for(const args of [['all','11:00','11:00'],['all','23:00',''],['all','abc','21:00'],['invalid','09:00','19:00']])
  assert.throws(()=>applyStoreHoursPreset({},...args))
})
