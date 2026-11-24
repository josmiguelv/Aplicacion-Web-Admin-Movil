import test from 'node:test'
import assert from 'node:assert/strict'
import {paymentCatalog,paymentImageMap} from './payment-public-config.mjs'

const images=[
 {method:'yape',image_id:'11111111-1111-4111-8111-111111111111'},
 {method:'plin',image_id:'22222222-2222-4222-8222-222222222222'},
 {method:'card',image_id:'33333333-3333-4333-8333-333333333333'}
]
const enabled=[
 {store_id:'nogales',mode:'delivery',method:'yape'},
 {store_id:'nogales',mode:'delivery',method:'card'},
 {store_id:'nogales',mode:'pickup',method:'cash'},
 {store_id:'tallanes',mode:'delivery',method:'plin'}
]
test('public payment options include only enabled methods for requested store and mode',()=>{
 const result=paymentCatalog(images,enabled,'nogales')
 assert.deepEqual(result.paymentMethods,{delivery:['yape','card'],pickup:['cash'],dine_in:[]})
 assert.equal(result.paymentOptions.delivery[0].imageUrl,'/api/v1/mobile/images/'+images[0].image_id)
 assert.equal(result.paymentOptions.delivery[1].imageUrl,'/api/v1/mobile/images/'+images[2].image_id)
 assert.deepEqual(result.paymentOptions.pickup,[{method:'cash',imageUrl:null}])
 assert.deepEqual(result.paymentOptions.dine_in,[])
 assert.equal(JSON.stringify(result).includes(images[1].image_id),false)
})
test('payment images belong to published tenant catalog and cash has no payment image',()=>{
 assert.deepEqual(paymentImageMap(images),{
  yape:'/api/v1/mobile/images/'+images[0].image_id,
  plin:'/api/v1/mobile/images/'+images[1].image_id,
  card:'/api/v1/mobile/images/'+images[2].image_id
 })
 const empty=paymentCatalog([],enabled,'nogales')
 assert.deepEqual(empty.paymentOptions.pickup,[{method:'cash',imageUrl:null}])
 assert.deepEqual(empty.paymentOptions.delivery.map(x=>x.imageUrl),[null,null])
})
