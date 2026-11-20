import test from 'node:test'
import assert from 'node:assert/strict'
import {straightLineKm,resolveDeliveryDestination,TEST_DELIVERY_COORDINATES} from './delivery-distance.mjs'

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

test('missing both client coordinates uses precise local test point',()=>{
 assert.deepEqual(resolveDeliveryDestination({}),{...TEST_DELIVERY_COORDINATES,fallbackUsed:true})
 assert.deepEqual(resolveDeliveryDestination({latitude:null,longitude:''}),{...TEST_DELIVERY_COORDINATES,fallbackUsed:true})
})
test('real numeric coordinates are preserved, not overwritten',()=>{
 assert.deepEqual(resolveDeliveryDestination({latitude:-12.08,longitude:-77.15}),{latitude:-12.08,longitude:-77.15,fallbackUsed:false})
})
test('partial or invalid coordinates fail instead of silently mixing locations',()=>{
 assert.throws(()=>resolveDeliveryDestination({latitude:-12.08}),error=>error.code===422)
 assert.throws(()=>resolveDeliveryDestination({latitude:'-12.08',longitude:'-77.15'}),error=>error.code===422)
})
