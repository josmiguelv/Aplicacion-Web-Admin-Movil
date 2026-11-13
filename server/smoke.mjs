// Execute ONLY on an isolated, empty PostgreSQL database (never customer data).
import assert from 'node:assert/strict'
const base='http://127.0.0.1:4000'
const origin='http://localhost:3000'
const email='ci-super@invalid.example'
const password='CI-Only-Strong-Secret-2026!'
async function req(path,method='GET',data,session){
 const response=await fetch(base+path,{method,
  headers:{...(method!=='GET'?{Origin:origin,'Content-Type':'application/json'}:{}),
   ...(session?{Cookie:session}:{})},
  body:data?JSON.stringify(data):undefined})
 let payload
 try{payload=await response.json()}catch{payload=null}
 return {status:response.status,data:payload,cookie:response.headers.get('set-cookie')?.split(';')[0]}
}
const superLogin=await req('/api/admin/login','POST',{email,password})
assert.equal(superLogin.status,200,'Superadmin login')
const superSession=superLogin.cookie
assert.ok(superSession?.startsWith('b3sid='))
const one=await req('/api/admin/tenants','POST',{name:'CI EMPRESA A (SOLO PRUEBAS)'},superSession)
const two=await req('/api/admin/tenants','POST',{name:'CI EMPRESA B (SOLO PRUEBAS)'},superSession)
assert.equal(one.status,201);assert.equal(two.status,201)
const a=one.data.id,b=two.data.id;assert.ok(a&&b&&a!==b)
const adminA='ci-admin-a@invalid.example',adminB='ci-admin-b@invalid.example'
assert.equal((await req('/api/admin/tenants/'+a+'/users','POST',{email:adminA,password},superSession)).status,201)
assert.equal((await req('/api/admin/tenants/'+b+'/users','POST',{email:adminB,password},superSession)).status,201)
const cookieA=(await req('/api/admin/login','POST',{email:adminA,password})).cookie
const cookieB=(await req('/api/admin/login','POST',{email:adminB,password})).cookie
assert.ok(cookieA&&cookieB)
assert.equal((await req('/api/admin/tenants/'+b+'/products','GET',undefined,cookieA)).status,403,'Tenant A cannot read B')
assert.equal((await req('/api/admin/tenants/'+a+'/stores','GET',undefined,cookieB)).status,403,'Tenant B cannot read A')
const appId='com.example.pollosb3citest'
const app=await req('/api/admin/tenants/'+a+'/apps','POST',{appId},cookieA)
assert.equal(app.status,200,'App registered')
const notYet=await req('/api/v1/mobile/config?appId='+encodeURIComponent(appId))
assert.equal(notYet.status,200);assert.equal(notYet.data.ready,false,'Unpublished data not exposed')
const store=await req('/api/admin/tenants/'+a+'/stores','POST',{
 name:'CI LOCAL FICTICIO - NO PRODUCCIÓN',address:'PRUEBA SIN DIRECCIÓN REAL',
 latitude:0,longitude:0,radiusKm:2,deliveryRatePerKmPen:2.5,active:true,
 delivery_enabled:true,pickup_enabled:true,dine_in_enabled:true
},cookieA)
assert.equal(store.status,200,JSON.stringify(store.data))
const storeId=store.data.id
const product=await req('/api/admin/tenants/'+a+'/products','POST',{
 name:'CI PRODUCTO FICTICIO',description:'NO PUBLICAR EN UN NEGOCIO REAL',
 category:'PRUEBA',pricePen:5.5,active:true
},cookieA)
assert.equal(product.status,200)
const payment=await req('/api/admin/tenants/'+a+'/payments','POST',{
 storeId,mode:'delivery',method:'yape',enabled:true
},cookieA)
assert.equal(payment.status,200)
const publication=await req('/api/admin/tenants/'+a+'/publish','POST',{appId},cookieA)
assert.equal(publication.status,200)
const publicData=await req('/api/v1/mobile/config?appId='+encodeURIComponent(appId))
assert.equal(publicData.status,200)
assert.equal(publicData.data.ready,true)
assert.equal(publicData.data.stores.length,1)
assert.equal(publicData.data.stores[0].hoursConfigured,false,'Unconfigured hours never claim an opening state')
assert.equal(publicData.data.stores[0].openingHours,null,'No fabricated store hours')
assert.equal(publicData.data.products.length,1)
assert.equal(publicData.data.stores[0].paymentMethods.delivery[0],'yape')
assert.equal(publicData.data.stores[0].deliveryPricingMode,'PER_KM','Existing pricing defaults to per km')
// With no opening hours configured, store eligibility must fail closed.
const delivery=await req('/api/v1/mobile/fulfillment/resolve','POST',{
 appId,mode:'delivery',address:'Calle de prueba 123',district:'Santa Anita'
})
assert.equal(delivery.status,409,'Unconfigured opening hours cannot authorize delivery')
const dine=await req('/api/v1/mobile/fulfillment/resolve','POST',{appId,mode:'dine_in',storeId})
assert.equal(dine.status,200,'Dine-in remains eligible without configured schedule')
const missingPoint=await req('/api/v1/mobile/fulfillment/resolve','POST',{
 appId,mode:'delivery',address:'Calle sin coordenadas'
})
assert.equal(missingPoint.status,409,'No published operating hours')
const closedDays=Object.fromEntries(['sun','mon','tue','wed','thu','fri','sat'].map(x=>[x,{closed:true}]))
const closed=await req('/api/admin/tenants/'+a+'/stores','POST',{
 id:storeId,name:'CI LOCAL FICTICIO - NO PRODUCCIÓN',address:'PRUEBA SIN DIRECCIÓN REAL',
 latitude:0,longitude:0,radiusKm:2,deliveryRatePerKmPen:2.5,active:true,
 delivery_enabled:true,pickup_enabled:true,dine_in_enabled:true,
 openingHours:closedDays
},cookieA)
assert.equal(closed.status,200,JSON.stringify(closed.data))
assert.equal((await req('/api/admin/tenants/'+a+'/publish','POST',{appId},cookieA)).status,200)
const afterClose=await req('/api/v1/mobile/config?appId='+encodeURIComponent(appId))
assert.equal(afterClose.data.stores[0].hoursConfigured,true)
assert.equal(afterClose.data.stores[0].isOpen,false)
assert.equal(afterClose.data.stores[0].closesAt,null)
assert.equal((await req('/api/v1/mobile/fulfillment/resolve','POST',{
 appId,mode:'pickup',storeId
})).status,409,'Closed published store cannot accept immediate pickup')
console.log('PASS: multi-tenant isolation, catalog publication, rate per km, undefined hours deny orders, closed hours block pickup and delivery coverage')
