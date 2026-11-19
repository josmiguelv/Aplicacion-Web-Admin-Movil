// Clasificación exclusiva de la interfaz. No modifica el estado ni el envío de FCM.
// El historial también es un registro de envío: un aviso vigente y ya enviado
// puede verse en "En curso" y "Historial" sin que se genere un segundo push.
export const notificationSections=[
 {id:'running',label:'En curso',description:'Avisos disponibles ahora en la aplicación.'},
 {id:'scheduled',label:'Programadas',description:'Avisos únicos pendientes de su fecha de inicio.'},
 {id:'series',label:'Secuencias',description:'Reglas recurrentes activas o pausadas, con sus horarios.'},
 {id:'history',label:'Historial',description:'Envíos aceptados, incidencias y avisos vencidos o cancelados.'}
]

const registeredSend=new Set(['SENT','FAILED','UNKNOWN','SKIPPED'])
export function groupNotifications(items){
 const running=items.filter(item=>item.status==='AVAILABLE')
 const scheduled=items.filter(item=>item.status==='SCHEDULED')
 const history=items.filter(item=>
  item.status==='EXPIRED'||item.status==='CANCELLED'||registeredSend.has(item.pushStatus))
 return {running,scheduled,history}
}
