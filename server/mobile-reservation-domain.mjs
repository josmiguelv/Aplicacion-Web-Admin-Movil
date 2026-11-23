import {createHash,randomUUID} from 'node:crypto';
export const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const APP=/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,149}$/;
export const DAY=/^\d{4}-\d{2}-\d{2}$/;
export const TIME=/^([01]\d|2[0-3]):[0-5]\d$/;
export const fail=(code,message)=>Object.assign(new Error(message),{code});
export const sha=value=>createHash('sha256').update(value).digest('hex');
export const ownerHash=key=>sha('b3-reservation:'+key);
export const externalRef=(tenantId,appId,storeId,key)=>
 'mobile:'+sha([tenantId,appId,storeId,key].join(':')).slice(0,48);
export function normalizeReserveRequest(raw){
 const allowed=['appId','catalogRevision','mode','date','time','storeId','latitude','longitude',
  'useGps','address','district','reference','items','customer','customerExternalId',
  'expectedDeliveryFeePen'];
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||
  Object.keys(raw).some(k=>!allowed.includes(k))||
  !APP.test(raw.appId)||!Number.isSafeInteger(raw.catalogRevision)||raw.catalogRevision<1||
  !['delivery','pickup'].includes(raw.mode)||!DAY.test(raw.date)||!TIME.test(raw.time)||
  !UUID.test(raw.storeId)||!Array.isArray(raw.items)||raw.items.length<1||
  typeof raw.customerExternalId!=='string'||raw.customerExternalId.length>180||
  raw.customerExternalId.length<3)
  throw fail(400,'Datos de reserva inválidos');
 const c=raw.customer;
 if(!c||typeof c!=='object'||Array.isArray(c)||
  Object.keys(c).some(k=>!['firstName','lastName','phone','email'].includes(k))||
  !['firstName','lastName'].every(k=>typeof c[k]==='string'&&c[k].trim().length>=2&&
   c[k].length<=60&&!/[\x00-\x1f]/.test(c[k]))||
  typeof c.phone!=='string'||!/^9\d{8}$/.test(c.phone)||
  c.email!==undefined&&(typeof c.email!=='string'||c.email.length>254||
   !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(c.email)))
  throw fail(400,'Confirma los datos de la persona que recibirá el pedido');
 if(raw.mode==='delivery'&&(
  raw.useGps!==true||!Number.isFinite(raw.latitude)||Math.abs(raw.latitude)>90||
  !Number.isFinite(raw.longitude)||Math.abs(raw.longitude)>180||
  typeof raw.address!=='string'||raw.address.trim().length<6||raw.address.length>180||
  typeof raw.district!=='string'||raw.district.trim().length<2||raw.district.length>80||
  raw.reference!==undefined&&(typeof raw.reference!=='string'||raw.reference.length>180)||
  !Number.isSafeInteger(raw.expectedDeliveryFeePen)||raw.expectedDeliveryFeePen<0))
  throw fail(400,'Confirma la dirección, coordenadas y tarifa de Delivery');
 if(raw.mode==='pickup'&&['latitude','longitude','useGps','address','district','reference','expectedDeliveryFeePen']
    .some(k=>raw[k]!==undefined))
  throw fail(400,'Recojo en tienda no requiere datos de Delivery');
 return {...raw,customer:{firstName:c.firstName.trim(),lastName:c.lastName.trim(),
  phone:c.phone,...(c.email?{email:c.email.toLowerCase().trim()}:{})}};
}
export function normalizedForm({date,time,mode,cart}){
 if(!DAY.test(date)||!TIME.test(time)||!['delivery','pickup'].includes(mode))
  throw fail(400,'Fecha u hora inválida');
 const subtotal=Number(cart.subtotal);
 if(!Number.isFinite(subtotal)||subtotal<0)throw fail(409,'Importe del catálogo inválido');
 const products=cart.summary.replace(/^Solicitud de validación de pedido: /,'')
  .replace(/\. Subtotal \d+\.\d{2}\.$/,'').trim();
 if(!products||products.length>500)throw fail(422,'Demasiados productos para el FORM');
 const [y,m,d]=date.split('-'),[h,mm]=time.split(':').map(Number);
 const twelve=(h%12||12)+':'+String(mm).padStart(2,'0')+(h<12?' a. m.':' p. m.');
 const fields=[{variable:'Fecha solicitada',value:d+'/'+m+'/'+y},
  {variable:'Hora solicitada',value:twelve},
  {variable:'Productos',value:products},
  {variable:'Subtotal',value:'S/ '+subtotal.toFixed(2)}];
 return {title:'RESERVA DE PEDIDO',
  subtitle:'Confirmar pedido programado - '+(mode==='delivery'?'Delivery':'Recojo en tienda'),
  fields};
}
export function explicitAgentDecision(messages){
 if(!Array.isArray(messages))return null;
 for(const m of messages){
  if(m?.direction!=='OUTBOUND'||typeof m.text!=='string'||!UUID.test(m.id))continue;
  const t=m.text.toLocaleLowerCase('es-PE').trim().replace(/[.!]+$/,'').trim();
  if(['aceptar','acepto','aceptado','aceptada'].includes(t))return {decision:'ACCEPTED',id:m.id};
  if(['rechazar','rechazado','rechazada'].includes(t))return {decision:'REJECTED',id:m.id};
 }
 return null;
}
export function publicReservation(row){
 return {id:row.id,status:row.status,mode:row.mode,storeId:row.store_id,
  date:row.service_date,time:row.service_time,scheduledAt:row.scheduled_at,
  subtotalPen:Number(row.subtotal_pen),deliveryFeePen:Number(row.delivery_fee_pen),
  totalPen:Number(row.total_pen),preparationMinutes:row.preparation_minutes,
  paymentMethod:row.payment_method,paymentStatus:row.payment_status,
  paymentExpiresAt:row.payment_expires_at,confirmedAt:row.confirmed_at,
  // Technical assignment is not approval; never return CONFIRMED while unpaid.
  agentAccepted:['AWAITING_PAYMENT','CONFIRMED'].includes(row.status),
  interactionCreated:!!row.interaction_id,formDelivered:row.form_sent===true};
}
export function reserveFormKey(){return randomUUID();}
