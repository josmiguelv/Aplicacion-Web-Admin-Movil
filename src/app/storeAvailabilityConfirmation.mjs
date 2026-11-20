// Read-after-write confirmation: never claim that a checkbox was saved
// if a stale backend ignores it or its database migration is missing.
export function verifyStoredOrderAvailability(saved,rows,expected){
 const persisted=rows.find(row=>row.id===saved.id)
 if(!persisted||typeof saved.consult_order_availability!=='boolean'||
   typeof persisted.consult_order_availability!=='boolean'){
  throw new Error('No se pudo verificar el guardado de «Consultar disponibilidad del pedido». Actualiza el backend del administrador y aplica la migración 011.')
 }
 if(saved.consult_order_availability!==expected||persisted.consult_order_availability!==expected){
  throw new Error('El servidor no conservó «Consultar disponibilidad del pedido». Revisa que el backend actualizado y la migración 011 estén instalados.')
 }
 return persisted
}
