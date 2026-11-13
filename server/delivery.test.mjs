import test from 'node:test'
import assert from 'node:assert/strict'
import {selectDeliveryStore,allowedPayments} from './delivery.mjs'
const store={id:'s1',name:'Demo',active:true,deliveryEnabled:true,latitude:-12.05,longitude:-76.96,deliveryRadiusM:3500,priority:10}
test('nearest eligible and within radius',()=>{
 const s2={...store,id:'s2',longitude:-76.97}
 assert.equal(selectDeliveryStore([s2,store],-12.05,-76.96)?.id,'s1')
})
test('blocks disabled, out of zone and invalid coordinates',()=>{
 assert.equal(selectDeliveryStore([{...store,active:false}],-12.05,-76.96),null)
 assert.equal(selectDeliveryStore([store],-11.1,-77.1),null)
 assert.equal(selectDeliveryStore([store],NaN,-76.96),null)
})
test('payment methods are enabled per exact store and mode',()=>{
 const data=[{storeId:'s1',mode:'DELIVERY',method:'YAPE',enabled:true},{storeId:'s1',mode:'PICKUP',method:'PLIN',enabled:true},{storeId:'s2',mode:'DELIVERY',method:'CARD',enabled:true},{storeId:'s1',mode:'DELIVERY',method:'CASH',enabled:false}]
 assert.deepEqual(allowedPayments(data,'s1','DELIVERY'),['YAPE'])
})
