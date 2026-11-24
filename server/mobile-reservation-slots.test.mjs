import test from 'node:test';
import assert from 'node:assert/strict';
import {computeReservationSlots,createMobileReservationSlotsRoute} from './mobile-reservation-slots.mjs';

const policy={enabled:true,preparationMinutes:35};
const store={active:true,delivery_enabled:true,pickup_enabled:true,openingHours:{wed:{open:'11:00',close:'23:00'}}};
const now=new Date('2026-11-23T18:00:00Z');
const isOpenAt=(_,at,zone)=>{
 const day=new Intl.DateTimeFormat('en-US',{timeZone:zone,weekday:'short'}).format(at);
 const h=new Intl.DateTimeFormat('en-US',{timeZone:zone,hour:'2-digit',hourCycle:'h23'}).format(at);
 return day==='Wed'&&Number(h)>=11&&Number(h)<23;
};
test('Wednesday future Peru slots use local hour, no fabricated reservations',()=>{
 const r=computeReservationSlots({date:'2026-11-25',mode:'delivery',store,settings:policy,now,isOpenAt});
 assert.equal(r.enabled,true);
 assert.equal(r.slots.length,1440);
 assert.equal(r.slots[0].time,'00:00');
 assert.equal(r.slots[1].time,'00:01');
 assert.equal(r.slots[0].scheduledAt,'2026-11-25T05:00:00.000Z');
 assert.equal(r.slots.at(-1).time,'23:59');
});
test('modality, opening hours, planning window and disabled settings fail closed',()=>{
 const args={date:'2026-11-25',mode:'pickup',store,settings:policy,now,isOpenAt};
 assert.equal(computeReservationSlots({...args,store:{...store,pickup_enabled:false}}).slots.length,0);
 assert.equal(computeReservationSlots({...args,settings:{...policy,enabled:false}}).slots.length,0);
 assert.equal(computeReservationSlots({...args,isOpenAt:()=>false}).slots.length,1440);
 assert.equal(computeReservationSlots({...args,date:'2026-11-20'}).slots.length,0);
 assert.equal(computeReservationSlots({...args,date:'2026-12-25'}).slots.length,1440);
 assert.throws(()=>computeReservationSlots({...args,date:'2026-02-30'}),{code:400});
 assert.throws(()=>computeReservationSlots({...args,mode:'dine_in'}),{code:400});
});
test('read-only endpoint does not claim agent, capacity or bookings; tenant-scoped',async()=>{
 const storeId='4b990b87-a2d5-4f01-bae1-e3a3a467a419';
 const tenantId='1b990b87-a2d5-4f01-bae1-e3a3a467a419';
 const pool={query:async(sql,args)=>{
  if(sql.includes('FROM published_catalogs'))return {rowCount:1,rows:[{tenant_id:tenantId,revision:8,
   payload:{stores:[{...store,id:storeId,reservationSettings:{enabled:true}}]}}]};
  assert.deepEqual(args,[tenantId,storeId]);
  return {rowCount:1,rows:[{...store,opening_hours:store.openingHours,
   enabled:true,preparation_minutes:35,time_zone:'America/Lima'}]};
 }};
 let result=null;
 const json=(_res,status,value)=>{result={status,value}};
 const route=createMobileReservationSlotsRoute({pool,json,storeHours:(s,at,zone)=>({hoursConfigured:true,isOpen:isOpenAt(s,at,zone)}),now:()=>now});
 const url=new URL('http://localhost/api/v1/mobile/stores/'+storeId+'/reservation-slots?appId=com.integrab2g.pollosb3&date=2026-11-25&mode=pickup');
 assert.equal(await route({req:{method:'GET'},res:{},url}),undefined);
 assert.equal(result.status,200);
 assert.equal(result.value.enabled,true);
 assert.equal(result.value.acceptingRequests,false);
 assert.equal(result.value.capacityVerified,false);
 assert.equal(result.value.agentAvailable,null);
 assert.equal(result.value.slots.length,1440);
});
