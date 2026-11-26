import test from 'node:test'
import assert from 'node:assert/strict'
import {publicPaymentOptions} from './payment-public-options.mjs'
test('published payment options preserve per-sede mode scopes and shared images',()=>{
 const images={yape:'/api/v1/mobile/images/yape',plin:'/api/v1/mobile/images/plin',card:'/api/v1/mobile/images/izipay'}
 const methods={delivery:['yape','card','cash'],pickup:['plin'],dine_in:[],reservation:['cash','card']}
 const result=publicPaymentOptions(methods,images)
 assert.deepEqual(result.delivery,[
  {method:'yape',imageUrl:images.yape},{method:'card',imageUrl:images.card},{method:'cash',imageUrl:null}
 ])
 assert.deepEqual(result.pickup,[{method:'plin',imageUrl:images.plin}])
 assert.deepEqual(result.dine_in,[])
 assert.deepEqual(result.reservation,[{method:'cash',imageUrl:null},{method:'card',imageUrl:images.card}])
})
test('unconfigured images are null and unknown method never leaves API',()=>{
 assert.deepEqual(publicPaymentOptions({delivery:['cash','yape','bogus']},{})
  .delivery,[{method:'cash',imageUrl:null},{method:'yape',imageUrl:null}])
})
