import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,writeFile,mkdir,rm,symlink} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {randomUUID} from 'node:crypto'
import {receiptCapabilityPath,verifyReceiptCapability,receiptIdFromCapabilityUrl} from './receipt-access.mjs'
import {createAdminLoginLimiter} from './admin-login-security.mjs'
import {securityHeaders} from './web-security-headers.mjs'
import {resolveStaticRequest} from './safe-static.mjs'

const key=Buffer.alloc(32,7).toString('base64')
test('receipt links require a valid capability and remain compatible with ordinary image URLs',()=>{
 const id=randomUUID(),other=randomUUID(),path=receiptCapabilityPath(id,key)
 const url='https://admin.example.com'+path,params=new URL(url).searchParams
 assert.match(path,/\?s=[a-f0-9]{64}$/)
 assert.equal(verifyReceiptCapability(id,params.get('s'),key),true)
 assert.equal(verifyReceiptCapability(other,params.get('s'),key),false)
 assert.equal(verifyReceiptCapability(id,'0'.repeat(64),key),false)
 assert.equal(verifyReceiptCapability(id,null,key),false)
 assert.equal(receiptIdFromCapabilityUrl(url,'https://admin.example.com',key),id)
 assert.equal(receiptIdFromCapabilityUrl(url,'https://other.example.com',key),null)
 assert.equal(receiptIdFromCapabilityUrl(url+'&untrusted=1','https://admin.example.com',key),null)
 assert.equal(receiptIdFromCapabilityUrl('https://admin.example.com/api/v1/mobile/payment-receipts/images/'+id,
   'https://admin.example.com',key),null)
 assert.equal(receiptIdFromCapabilityUrl(url,'https://admin.example.com',Buffer.alloc(32,8).toString('base64')),null)
})
test('login brute force protection is scoped, bounded, and clears after its window',()=>{
 let clock=0
 const limiter=createAdminLoginLimiter({now:()=>clock,windowMs:1000,accountLimit:3,networkLimit:5})
 assert.equal(limiter.allowed('A@Example.com','network1'),true)
 for(let i=0;i<3;i++)limiter.failed('a@example.com','network1')
 assert.equal(limiter.allowed('A@Example.com','network1'),false)
 assert.equal(limiter.allowed('other@example.com','network1'),true)
 assert.equal(limiter.allowed('a@example.com','network2'),false)
 clock=1001
 assert.equal(limiter.allowed('a@example.com','network1'),true)
 limiter.failed('a@example.com','network1')
 limiter.succeeded('a@example.com')
 assert.equal(limiter.allowed('a@example.com','network1'),true)
})
test('production web headers protect app without preventing Google fonts or WebSocket',()=>{
 const p=securityHeaders({production:true})
 assert.equal(p['X-Frame-Options'],'DENY')
 assert.equal(p['Referrer-Policy'],'no-referrer')
 assert.match(p['Content-Security-Policy'],/fonts.googleapis.com/)
 assert.match(p['Content-Security-Policy'],/wss:/)
 assert.match(p['Content-Security-Policy'],/frame-ancestors 'none'/)
 assert.match(p['Strict-Transport-Security'],/max-age=/)
 assert.equal(securityHeaders({production:false})['Strict-Transport-Security'],undefined)
})
test('static assets and SPA routes remain usable; internal files are not served',async()=>{
 const root=await mkdtemp(join(tmpdir(),'admin-security-')),publicDir=join(root,'dist')
 await mkdir(publicDir)
 await writeFile(join(publicDir,'index.html'),'<html>app</html>')
 await writeFile(join(publicDir,'favicon.svg'),'<svg/>')
 await writeFile(join(root,'.env'),'SENSITIVE=1')
 await writeFile(join(root,'secret.js'),'secrets')
 try{
  assert.equal((await resolveStaticRequest(publicDir,'/')).html,true)
  assert.equal((await resolveStaticRequest(publicDir,'/locales')).html,true)
  assert.equal((await resolveStaticRequest(publicDir,'/favicon.svg')).mime,'image/svg+xml')
  for(const path of ['/../.env','/%2e%2e/.env','/%2fetc/passwd','/.env','/missing.js','/secret.sql','/bad%00route','/dist/../secret.js']){
   await assert.rejects(()=>resolveStaticRequest(publicDir,path))
  }
  try{
   await symlink(join(root,'secret.js'),join(publicDir,'forged.js'))
   await assert.rejects(()=>resolveStaticRequest(publicDir,'/forged.js'))
  }catch(error){if(error.code!=='EPERM')throw error}
 }finally{await rm(root,{recursive:true,force:true})}
})
