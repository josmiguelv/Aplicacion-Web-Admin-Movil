import test from 'node:test'
import assert from 'node:assert/strict'
import {changeOwnPassword,hashAdminPassword,verifyAdminPassword,validatePasswordChange} from './admin-change-password.mjs'

const initial='Current-Admin-Password-2026!'
const updated='New-Different-Password-2026!'
function harness(){
 const state={hash:hashAdminPassword(initial),sessions:3,queries:[],commits:0,rollbacks:0}
 const client={
  async query(sql,params=[]){
   state.queries.push([sql,params])
   if(sql==='BEGIN')return {}
   if(sql==='COMMIT'){state.commits++;return {}}
   if(sql==='ROLLBACK'){state.rollbacks++;return {}}
   if(sql.startsWith('SELECT password_hash'))return {rowCount:1,rows:[{password_hash:state.hash}]}
   if(sql.startsWith('UPDATE admin_users')){state.hash=params[0];return {rowCount:1}}
   if(sql.startsWith('DELETE FROM admin_sessions')){state.sessions=0;return {rowCount:3}}
   throw new Error('Unexpected SQL: '+sql)
  },
  release(){},
 }
 return {state,pool:{connect:async()=>client}}
}
test('password verification uses salted scrypt and rejects corrupted hashes',()=>{
 const hash=hashAdminPassword(initial)
 assert.equal(verifyAdminPassword(initial,hash),true)
 assert.equal(verifyAdminPassword(updated,hash),false)
 assert.equal(verifyAdminPassword(initial,'plain:password'),false)
 assert.notEqual(hash,hashAdminPassword(initial))
})
test('rejects weak, repeated or unexpected password submissions',()=>{
 for(const input of [
  {},{currentPassword:initial,newPassword:'short'},
  {currentPassword:initial,newPassword:initial},
  {currentPassword:initial,newPassword:'A'.repeat(129)},
  {currentPassword:initial,newPassword:'This has\na newline 1234'},
  {currentPassword:initial,newPassword:updated,role:'SUPER_ADMIN'},
 ]){
  assert.throws(()=>validatePasswordChange(input),{code:400})
 }
 assert.deepEqual(validatePasswordChange({currentPassword:initial,newPassword:updated}),
  {currentPassword:initial,newPassword:updated})
})
test('valid change replaces only the signed-in user password and invalidates all their sessions',async()=>{
 const h=harness()
 const result=await changeOwnPassword({pool:h.pool,userId:'userA',input:{currentPassword:initial,newPassword:updated}})
 assert.deepEqual(result,{ok:true,requiresLogin:true})
 assert.equal(h.state.commits,1)
 assert.equal(h.state.sessions,0)
 assert.equal(verifyAdminPassword(updated,h.state.hash),true)
 assert.equal(verifyAdminPassword(initial,h.state.hash),false)
 const writes=h.state.queries.filter(([sql])=>sql.startsWith('UPDATE')||sql.startsWith('DELETE'))
 assert.equal(writes.length,2)
 assert.equal(writes[0][1][1],'userA')
 assert.equal(writes[1][1][0],'userA')
 assert.equal(h.state.queries.some(([sql])=>sql.includes('FOR UPDATE')),true)
})
test('incorrect current password never changes the hash or revokes sessions',async()=>{
 const h=harness()
 const before=h.state.hash
 await assert.rejects(()=>changeOwnPassword({pool:h.pool,userId:'userA',input:{
  currentPassword:'incorrect',newPassword:updated,
 }}),{code:403})
 assert.equal(h.state.hash,before)
 assert.equal(h.state.sessions,3)
 assert.equal(h.state.commits,0)
 assert.equal(h.state.rollbacks,1)
})
