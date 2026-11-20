import test from 'node:test'
import assert from 'node:assert/strict'
import {straightLineKm} from './delivery-distance.mjs'

test('same location costs zero kilometers',()=>assert.equal(straightLineKm({latitude:-12.05,longitude:-77.12},{latitude:-12.05,longitude:-77.12}),0))
test('known equator distance ~111.2 km per longitude degree',()=>{
 const km=straightLineKm({latitude:0,longitude:0},{latitude:0,longitude:1})
 assert.ok(km>111&&km<112)
})
test('symmetric calculation, never depends on paid services',()=>{
 const a={latitude:-12.0506096,longitude:-77.1251313},b={latitude:-12.0606096,longitude:-77.1451313}
 assert.equal(straightLineKm(a,b),straightLineKm(b,a))
})
test('coordinate validation prevents inaccurate quotes',()=>{
 assert.throws(()=>straightLineKm({latitude:91,longitude:0},{latitude:0,longitude:0}),RangeError)
 assert.throws(()=>straightLineKm({latitude:null,longitude:0},{latitude:0,longitude:0}),TypeError)
})
