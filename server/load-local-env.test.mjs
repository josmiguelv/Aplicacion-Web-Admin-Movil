import assert from 'node:assert/strict'
import {mkdtempSync,writeFileSync,rmSync} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {test} from 'node:test'
import {loadLocalEnv} from './load-local-env.mjs'

test('carga de .env local y precedencia de variables del proceso',()=>{
 const folder=mkdtempSync(join(tmpdir(),'admin-fcm-env-'))
 const file=join(folder,'.env')
 const name='FCM_LOCAL_TEST_'+Date.now()
 const override='FCM_LOCAL_PRECEDENCE_'+Date.now()
 writeFileSync(file,name+'=archivo\n'+override+'=archivo\n')
 try{
  assert.equal(loadLocalEnv({file:join(folder,'missing'),environment:'development'}).loaded,false)
  assert.equal(loadLocalEnv({file,environment:'production'}).loaded,false)
  assert.equal(process.env[name],undefined)
  process.env[override]='del-proceso'
  assert.equal(loadLocalEnv({file,environment:'development'}).loaded,true)
  assert.equal(process.env[name],'archivo')
  assert.equal(process.env[override],'del-proceso')
 }finally{
  delete process.env[name]
  delete process.env[override]
  rmSync(folder,{recursive:true,force:true})
 }
})
