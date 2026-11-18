import {createCipheriv,createDecipheriv,randomBytes,createHash} from 'node:crypto'

export function masterKey(value=process.env.INTEGRATION_MASTER_KEY){
 if(typeof value!=='string'||! /^[A-Za-z0-9+/]{43}=$/.test(value))throw Error('INTEGRATION_KEY_UNAVAILABLE')
 const key=Buffer.from(value,'base64')
 if(key.length!==32||key.toString('base64')!==value)throw Error('INTEGRATION_KEY_UNAVAILABLE')
 return key
}
const keyId=key=>createHash('sha256').update(key).digest('hex').slice(0,16)
const aad=(tenantId,integrationId)=>Buffer.from(`integra:tuverso:v1:${tenantId}:${integrationId}`)
export function encryptCredential(token,tenantId,integrationId,key=masterKey()){
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',key,iv)
 cipher.setAAD(aad(tenantId,integrationId))
 const data=Buffer.concat([cipher.update(token,'utf8'),cipher.final()])
 return JSON.stringify({v:1,kid:keyId(key),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64'),data:data.toString('base64')})
}
export function decryptCredential(envelope,tenantId,integrationId,key=masterKey()){
 try{
  const value=JSON.parse(envelope)
  if(value.v!==1||value.kid!==keyId(key))throw Error()
  const decipher=createDecipheriv('aes-256-gcm',key,Buffer.from(value.iv,'base64'))
  decipher.setAAD(aad(tenantId,integrationId));decipher.setAuthTag(Buffer.from(value.tag,'base64'))
  return Buffer.concat([decipher.update(Buffer.from(value.data,'base64')),decipher.final()]).toString('utf8')
 }catch{throw Error('INTEGRATION_KEY_UNAVAILABLE')}
}
export function credentialHint(token){return 'sha256:'+createHash('sha256').update(token).digest('hex').slice(0,12)}
