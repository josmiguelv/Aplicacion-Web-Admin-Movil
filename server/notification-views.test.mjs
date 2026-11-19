import assert from 'node:assert/strict'
import {test} from 'node:test'
import {groupNotifications,notificationSections} from '../src/app/notification-views.mjs'

test('las cuatro vistas operativas tienen identidad única',()=>{
 assert.deepEqual(notificationSections.map(x=>x.id),['running','scheduled','series','history'])
})
test('los pendientes y los vigentes nunca se mezclan en la operación',()=>{
 const items=[
  {id:'now',status:'AVAILABLE',pushStatus:'PENDING'},
  {id:'soon',status:'SCHEDULED',pushStatus:'PENDING'},
  {id:'done',status:'EXPIRED',pushStatus:'SENT'},
  {id:'off',status:'CANCELLED',pushStatus:'SKIPPED'},
  {id:'sent-live',status:'AVAILABLE',pushStatus:'SENT'},
  {id:'failed',status:'AVAILABLE',pushStatus:'FAILED'},
  {id:'unknown',status:'AVAILABLE',pushStatus:'UNKNOWN'}
 ]
 const out=groupNotifications(items)
 assert.deepEqual(out.running.map(x=>x.id),['now','sent-live','failed','unknown'])
 assert.deepEqual(out.scheduled.map(x=>x.id),['soon'])
 assert.deepEqual(out.history.map(x=>x.id),['done','off','sent-live','failed','unknown'])
 assert.equal(items.length,7,'filtrar no debe eliminar ni modificar notificaciones')
})
test('el historial no supone entrega al dispositivo cuando FCM acepta un push',()=>{
 const {history}=groupNotifications([{status:'AVAILABLE',pushStatus:'SENT',fcmMessageId:'ref'}])
 assert.equal(history.length,1)
 assert.equal(history[0].pushStatus,'SENT')
})
