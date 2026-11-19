import assert from 'node:assert/strict'
import {readFileSync} from 'node:fs'
import {test} from 'node:test'
import vm from 'node:vm'

const source=readFileSync(new URL('../server/index.mjs',import.meta.url),'utf8')
const kmCode=source.match(/function kmDistance\(a,b,c,d\)\{[^\n]+\}/)?.[0]
const quoteCode=source.match(/function straightLineQuote\([\s\S]*?\n\}(?=\n\nasync function quote)/)?.[0]
assert.ok(kmCode&&quoteCode,'Backend must expose straight-line quote helpers')
const radians=x=>x*Math.PI/180
const kmDistance=vm.runInNewContext('('+kmCode+')',{radians})
const bad=(code,message)=>Object.assign(new Error(message),{code})
const checkLatLng=(lat,lng)=>Number.isFinite(lat)&&Number.isFinite(lng)&&lat>=-90&&lat<=90&&lng>=-180&&lng<=180
const quote=vm.runInNewContext('('+quoteCode+')',{kmDistance,bad,checkLatLng})

const nogales={id:'0221b719-195a-45f9-a54a-08e4ef56625c',name:'Nogales',latitude:-12.0506096,longitude:-77.1251313,
 radiusKm:5,deliveryPricingMode:'PER_KM',deliveryRatePerKmPen:2.5,deliveryFeePen:null}
const tallanes={id:'ab05c102-7850-419f-ad0c-829dce200f39',name:'Tallanes',latitude:-12.0506625,longitude:-77.1038664,
 radiusKm:4,deliveryPricingMode:'PER_KM',deliveryRatePerKmPen:3,deliveryFeePen:null}

test('Nogales: distancia geográfica y S/ 2.50 por km',()=>{
 const v=quote([nogales],-12.0406096,-77.1251313)
 assert.equal(v.store.id,nogales.id)
 assert.equal(v.straightDistanceKm,1.11)
 assert.equal(v.deliveryFeePen,2.78)
})
test('FIXED cobra importe único sin multiplicar distancia pero exige cobertura',()=>{
 const fixed={...nogales,deliveryPricingMode:'FIXED',deliveryFeePen:8}
 assert.equal(quote([fixed],-12.0406096,-77.1251313).deliveryFeePen,8)
 assert.throws(()=>quote([fixed],-11.95,-77.1251313),error=>error.code===409)
})
test('radio nulo es ilimitado y tarifa inválida no se presupone',()=>{
 assert.ok(quote([{...nogales,radiusKm:null}],-11.95,-77.1251313).straightDistanceKm>10)
 assert.throws(()=>quote([{...nogales,deliveryRatePerKmPen:null}],-12.05,-77.12),e=>e.code===409)
})
test('la selección automática comprueba cercanía y cobertura sin sede preferida',()=>{
 assert.equal(quote([nogales,tallanes],-12.05065,-77.1039).store.id,tallanes.id)
 assert.equal(quote([tallanes,nogales],-12.05065,-77.1039).store.id,tallanes.id)
 assert.equal(quote([{...nogales,radiusKm:0.1},tallanes],-12.05065,-77.1039).store.id,tallanes.id)
})
test('API pública devuelve origen STRAIGHT_LINE y CORS también en errores',()=>{
 assert.match(source,/distanceSource:b\.mode==='delivery'\?'STRAIGHT_LINE':null/)
 assert.match(source,/const publicRead=url\.pathname\.startsWith\('\/api\/v1\/mobile\/'\)/)
 assert.doesNotMatch(source,/GOOGLE_ROUTES_API_KEY/)
 assert.match(source,/s\.hoursConfigured===true&&s\.isOpen===true/)
})

const universal={id:'7585340e-6d4d-4764-b127-b892dc50909d',name:'Universal',
 latitude:-12.0482197,longitude:-77.1114342,radiusKm:10,
 deliveryPricingMode:'FIXED',deliveryRatePerKmPen:null,deliveryFeePen:15}
test('Universal: S/ 15 fijos si está dentro de 10 km, sin multiplicación por kilómetros',()=>{
 const c=quote([universal],-12.048,-77.111)
 assert.equal(c.store.name,'Universal')
 assert.equal(c.deliveryFeePen,15)
 assert.ok(c.straightDistanceKm<10)
 assert.throws(()=>quote([universal],-11.90,-77.111),e=>e.code===409)
})
test('la sede siempre se asigna por cercanía y disponibilidad, sin preferencia del usuario',()=>{
 const point={latitude:-12.0506096,longitude:-77.1251313}
 assert.equal(quote([nogales,universal],point.latitude,point.longitude).store.id,nogales.id)
 assert.equal(quote([universal,nogales],point.latitude,point.longitude).store.id,nogales.id)
})
test('si la más cercana sale de cobertura se elige automáticamente otra abierta y cubierta',()=>{
 const restricted={...nogales,radiusKm:0.01}
 const selected=quote([restricted,universal],-12.0482197,-77.1114342)
 assert.equal(selected.store.id,universal.id)
 assert.equal(selected.deliveryFeePen,15)
})

