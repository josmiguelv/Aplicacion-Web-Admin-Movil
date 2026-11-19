import test from 'node:test'
import assert from 'node:assert/strict'
import {mobileWeeklyHours} from './mobile-store-hours.mjs'

test('convierte los siete días del administrador al formato del detalle de Android', () => {
 const adminHours = {
  mon:{open:'11:00',close:'23:00'},tue:{open:'11:00',close:'23:00'},
  wed:{open:'11:00',close:'23:00'},thu:{open:'11:00',close:'23:00'},
  fri:{open:'11:00',close:'23:00'},sat:{open:'11:00',close:'23:00'},
  sun:{closed:true},
 }
 const expected = {
  monday:{open:'11:00',close:'23:00'},tuesday:{open:'11:00',close:'23:00'},
  wednesday:{open:'11:00',close:'23:00'},thursday:{open:'11:00',close:'23:00'},
  friday:{open:'11:00',close:'23:00'},saturday:{open:'11:00',close:'23:00'},
  sunday:{closed:true},
 }
 assert.deepEqual(mobileWeeklyHours(adminHours), expected)
 assert.ok(!('monday' in adminHours), 'El horario original no se altera')
})
test('respeta horarios nocturnos y omite días sin publicar', () => {
 assert.deepEqual(mobileWeeklyHours({fri:{open:'18:00',close:'02:00'}}), {
  friday:{open:'18:00',close:'02:00'},
 })
})
test('sin horario publicado no inventa horarios ni apertura', () => {
 for(const value of [null,undefined,[],{}, {other:{open:'11:00',close:'23:00'}}]){
  assert.equal(mobileWeeklyHours(value), null)
 }
})
