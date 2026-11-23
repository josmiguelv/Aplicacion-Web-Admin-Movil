import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {normalizeReserveRequest,normalizedForm,explicitAgentDecision,publicReservation,ownerHash} from './mobile-reservation-domain.mjs';
const storeId=randomUUID(),prod=randomUUID();
const customer={firstName:'Cliente',lastName:'Prueba',phone:'987654321'};
const base={appId:'com.integrab2g.pollosb3',catalogRevision:2,mode:'pickup',
 date:'2026-11-25',time:'19:30',storeId,customerExternalId:'b3_demo_0001',
 items:[{productId:prod,quantity:2}],customer};
test('request rejects alien fields, missing identity and untrusted delivery price',()=>{
 assert.deepEqual(normalizeReserveRequest(base).customer,customer);
 assert.throws(()=>normalizeReserveRequest({...base,unknown:'x'}),{code:400});
 assert.throws(()=>normalizeReserveRequest({...base,customer:{...customer,phone:'123'}}),{code:400});
 assert.throws(()=>normalizeReserveRequest({...base,mode:'delivery'}),{code:400});
 assert.throws(()=>normalizeReserveRequest({...base,expectedDeliveryFeePen:20}),{code:400});
 const delivery={...base,mode:'delivery',address:'Calle Verificada 123',district:'Santa Anita',
  latitude:-12.06,longitude:-76.97,useGps:true,expectedDeliveryFeePen:570};
 assert.equal(normalizeReserveRequest(delivery).expectedDeliveryFeePen,570);
 assert.throws(()=>normalizeReserveRequest({...delivery,latitude:999}),{code:400});
});
test('FORM scheduled uses precisely four server-derived fields for both fulfillment modes',()=>{
 const cart={subtotal:80.5,summary:'Solicitud de validación de pedido: 2 x Pollo a la Brasa. Subtotal 80.50.'};
 for(const mode of ['pickup','delivery']){
  const form=normalizedForm({date:'2026-11-25',time:'19:30',mode,cart});
  assert.equal(form.title,'RESERVA DE PEDIDO');
  assert.equal(form.fields.length,4);
  assert.equal(form.fields[0].value,'25/11/2026');
  assert.equal(form.fields[1].value,'7:30 p. m.');
  assert.deepEqual(form.fields.map(v=>v.variable),['Fecha solicitada','Hora solicitada','Productos','Subtotal']);
  assert.match(form.subtitle,mode==='pickup'?/Recojo en tienda/:/Delivery/);
  assert.doesNotMatch(JSON.stringify(form),/Dirección y referencia|Sede seleccionada/);
 }
});
test('agent assignment alone and client INBOUND cannot approve commercial order',()=>{
 const m=randomUUID();
 assert.equal(explicitAgentDecision([{id:m,direction:'INBOUND',text:'aceptar'}]),null);
 assert.equal(explicitAgentDecision([{id:m,direction:'OUTBOUND',text:'Buenos días'}]),null);
 assert.deepEqual(explicitAgentDecision([{id:m,direction:'OUTBOUND',text:'Aceptar.'}]),
  {decision:'ACCEPTED',id:m});
 assert.deepEqual(explicitAgentDecision([{id:m,direction:'OUTBOUND',text:'Rechazar'}]),
  {decision:'REJECTED',id:m});
});
test('guest access hashing and public response do not expose secret or PII',()=>{
 const key=randomUUID();
 assert.equal(ownerHash(key).length,64);
 assert.notEqual(ownerHash(key),ownerHash(randomUUID()));
 const row={id:randomUUID(),status:'AWAITING_PAYMENT',mode:'pickup',store_id:storeId,
  service_date:'2026-11-25',service_time:'19:30',scheduled_at:new Date().toISOString(),
  subtotal_pen:'20.00',delivery_fee_pen:'0.00',total_pen:'20.00',preparation_minutes:30,
  payment_status:'NOT_SELECTED',customer,form_sent:true,interaction_id:randomUUID()};
 const publicData=publicReservation(row);
 assert.equal(publicData.status,'AWAITING_PAYMENT');
 assert.equal(publicData.agentAccepted,true);
 assert.doesNotMatch(JSON.stringify(publicData),/987654321|Prueba|idempotency_key|access_hash/);
 assert.notEqual(publicData.status,'CONFIRMED');
});
