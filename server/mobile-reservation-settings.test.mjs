import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import pg from 'pg';
import {DEFAULT_RESERVATION_SETTINGS,normalizeReservationSettings,mapReservationSettings,
 publishedReservationSettings,readStoreReservationSettings,saveStoreReservationSettings} from './mobile-reservation-settings.mjs';

const valid={enabled:true,preparationMinutes:40};

test('reservation defaults remain disabled until configured',()=>{
 assert.deepEqual(mapReservationSettings(null),DEFAULT_RESERVATION_SETTINGS);
 assert.equal(publishedReservationSettings(null).acceptingRequests,false);
 assert.equal(publishedReservationSettings({enabled:true,preparation_minutes:30}).acceptingRequests,false);
});
test('enabled reservations require only a valid preparation time',()=>{
 assert.deepEqual(normalizeReservationSettings(valid),valid);
 for(const patch of [{preparationMinutes:0},{preparationMinutes:241},{preparationMinutes:1.5},
  {preparationMinutes:'40'},{firstTime:'12:00'},{maxAdvanceDays:7},
  {minAdvanceMinutes:15},{lastTime:'23:00'},{slotMinutes:30},
  {maxOrdersPerSlot:8},{unexpected:true}]){
  assert.throws(()=>normalizeReservationSettings({...valid,...patch}),{code:400});
 }
 assert.throws(()=>normalizeReservationSettings({enabled:true}),{code:400});
 assert.throws(()=>normalizeReservationSettings({enabled:'true'}),{code:400});
 assert.throws(()=>normalizeReservationSettings([]),{code:400});
});
test('disabled reservations allow an empty preparation value',()=>{
 const config=normalizeReservationSettings({enabled:false,preparationMinutes:null});
 assert.equal(config.enabled,false);
 assert.equal(config.preparationMinutes,null);
});

// Runs exclusively on the disposable GitHub Actions PostgreSQL database.
test('PostgreSQL: cross-tenant read/write denied and policy survives roundtrip', {
 skip:!(process.env.CI==='true'&&/\/b3_test(?:\?|$)/.test(process.env.DATABASE_URL||''))
},async()=>{
 const pool=new pg.Pool({connectionString:process.env.DATABASE_URL});
 const [tenantA,tenantB,storeA,userA]=Array.from({length:4},()=>randomUUID());
 try{
  await pool.query('INSERT INTO tenants(id,name) VALUES($1,$2),($3,$4)',
   [tenantA,'CI Pollos B3 A',tenantB,'CI Pollos B3 B']);
  await pool.query('INSERT INTO stores(id,tenant_id,code,name,address) VALUES($1,$2,$3,$4,$5)',
   [storeA,tenantA,'test-reservation-'+storeA.slice(0,8),'Sede CI','Dirección CI']);
  await pool.query('INSERT INTO admin_users(id,email,password_hash,role,tenant_id) VALUES($1,$2,$3,$4,$5)',
   [userA,'ci-reservation-'+userA+'@invalid.example','not-usable', 'TENANT_ADMIN',tenantA]);
  assert.deepEqual(await readStoreReservationSettings(pool,tenantA,storeA),DEFAULT_RESERVATION_SETTINGS);
  assert.equal((await saveStoreReservationSettings(pool,tenantA,storeA,userA,valid)).enabled,true);
  assert.deepEqual(await readStoreReservationSettings(pool,tenantA,storeA),valid);
  await assert.rejects(()=>readStoreReservationSettings(pool,tenantB,storeA),{code:404});
  await assert.rejects(()=>saveStoreReservationSettings(pool,tenantB,storeA,userA,{enabled:false}),{code:404});
  const audit=await pool.query("SELECT COUNT(*)::int AS n FROM admin_audit WHERE tenant_id=$1 AND action='STORE_RESERVATION_SETTINGS_UPDATED'",[tenantA]);
  assert.equal(audit.rows[0].n,1);
  const off=await saveStoreReservationSettings(pool,tenantA,storeA,userA,{enabled:false,preparationMinutes:35});
  assert.equal(off.enabled,false);
  assert.equal(off.preparationMinutes,35);
 }finally{
  try{
   await pool.query('DELETE FROM admin_audit WHERE tenant_id=$1 OR tenant_id=$2',[tenantA,tenantB]);
   await pool.query('DELETE FROM store_reservation_settings WHERE tenant_id=$1',[tenantA]);
   await pool.query('DELETE FROM admin_users WHERE tenant_id=$1',[tenantA]);
   await pool.query('DELETE FROM stores WHERE tenant_id=$1',[tenantA]);
   await pool.query('DELETE FROM tenants WHERE id IN($1,$2)',[tenantA,tenantB]);
  }finally{await pool.end()}
 }
});
