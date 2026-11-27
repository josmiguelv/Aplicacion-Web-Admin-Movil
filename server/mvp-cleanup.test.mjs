import test from 'node:test'
import assert from 'node:assert/strict'
import {indexedPromotionProducts} from './promotion-product-projection.mjs'
import {applySecurityHeaders,limitAdminLogin} from './admin-security.mjs'
import {getCatalogPublicationStatus} from './admin-publication-status.mjs'

test('Promotions reuse catalog identity and expose product variables',()=>{
 const rows=indexedPromotionProducts([
  {id:'product-a',name:'Combo',description:'Incluye papas',category:'Combos',price_pen:'49.90',image_url:'/api/v1/mobile/images/sample'}
 ],[
  {id:'promo-a',title:'Oferta',productId:'product-a'},
  {id:'promo-b',title:'Legada',productId:null},
  {id:'promo-c',title:'Producto deshabilitado',productId:'missing'}
 ])
 assert.equal(rows.length,2)
 assert.deepEqual(rows[0].product,{id:'product-a',name:'Combo',description:'Incluye papas',category:'Combos',pricePen:49.9,imageUrl:'/api/v1/mobile/images/sample'})
 assert.equal(rows[1].product,null)
 assert.equal(rows[1].productId,null)
})

test('Security response headers are present',()=>{
 const headers=new Map()
 applySecurityHeaders({setHeader:(key,value)=>headers.set(key,value)})
 assert.equal(headers.get('X-Content-Type-Options'),'nosniff')
 assert.equal(headers.get('X-Frame-Options'),'DENY')
 assert.equal(headers.get('Cross-Origin-Resource-Policy'),'same-origin')
 assert.equal(headers.get('Referrer-Policy'),'strict-origin-when-cross-origin')
})

test('Login throttling restricts repeated attempts and rotated emails',()=>{
 for(let n=0;n<8;n++)assert.equal(limitAdminLogin({address:'test-ip-account',email:'test@example.invalid',now:1000}),true)
 assert.equal(limitAdminLogin({address:'test-ip-account',email:'test@example.invalid',now:1000}),false)
 for(let n=0;n<40;n++)limitAdminLogin({address:'test-ip-rotation',email:n+'@example.invalid',now:1000})
 assert.equal(limitAdminLogin({address:'test-ip-rotation',email:'extra@example.invalid',now:1000}),false)
 assert.equal(limitAdminLogin({address:'test-ip-account',email:'test@example.invalid',now:62000}),true)
})

test('Publication status is tenant scoped and reports pending changes',async()=>{
 let called
 const pool={query:async(sql,args)=>{
  called={sql,args}
  return {rows:[{app_id:'app',published_at:'2026-11-27T12:00:00Z',revision:8,pending:true}]}
 }}
 const result=await getCatalogPublicationStatus(pool,'tenant-1','app')
 assert.equal(result.registered,true)
 assert.equal(result.pending,true)
 assert.equal(result.revision,8)
 assert.equal(called.args[0],'tenant-1')
 assert.equal(called.args[1],'app')
 assert.match(called.sql,/tenant_id=\$1/)
})

test('Publication status differentiates clean snapshots and an unregistered app',async()=>{
 const published=await getCatalogPublicationStatus({
  query:async()=>({rows:[{published_at:'2026-11-27T12:00:00Z',revision:12,pending:false}]})
 },'tenant','app')
 assert.deepEqual({registered:published.registered,pending:published.pending,revision:published.revision},{registered:true,pending:false,revision:12})
 const missing=await getCatalogPublicationStatus({query:async()=>({rows:[]})},'tenant','other')
 assert.equal(missing.registered,false)
 assert.equal(missing.pending,true)
})
