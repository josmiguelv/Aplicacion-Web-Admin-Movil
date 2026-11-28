import {createHmac,timingSafeEqual} from 'node:crypto'

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const SIGNATURE=/^[0-9a-f]{64}$/
const PREFIX='b3-receipt-capability-v1:'

// Deterministic, unguessable capability URLs support Android's upload->FORM
// protocol and TU VERSO's ordinary <img src> (which cannot pass auth headers).
// They do NOT authorize access to any other receipt or order endpoint.
// Never include the customer's order access key or integration credentials in URLs.
function keyFromBase64(encoded){
 if(typeof encoded!=='string'||!encoded)throw Error('INTEGRATION_MASTER_KEY required for secure receipt URLs')
 const key=Buffer.from(encoded,'base64')
 if(key.length!==32||key.toString('base64')!==encoded)throw Error('Invalid receipt signing master key')
 return key
}
export function receiptSignature(imageId,masterKey){
 if(typeof imageId!=='string'||!UUID.test(imageId))throw Error('Invalid receipt id')
 return createHmac('sha256',keyFromBase64(masterKey))
   .update(PREFIX+imageId.toLowerCase()).digest('hex')
}
export function receiptCapabilityPath(imageId,masterKey){
 return '/api/v1/mobile/payment-receipts/images/'+imageId+'?s='+receiptSignature(imageId,masterKey)
}
export function verifyReceiptCapability(imageId,signature,masterKey){
 if(!UUID.test(imageId||'')||!SIGNATURE.test(signature||''))return false
 try{
  const expected=Buffer.from(receiptSignature(imageId,masterKey),'hex')
  return timingSafeEqual(expected,Buffer.from(signature,'hex'))
 }catch{return false}
}
export function receiptIdFromCapabilityUrl(imageUrl,origin,masterKey){
 try{
  const url=new URL(imageUrl)
  if(url.origin!==origin||url.hash||[...url.searchParams.keys()].length!==1)return null
  const match=/^\/api\/v1\/mobile\/payment-receipts\/images\/([0-9a-f-]{36})$/i.exec(url.pathname)
  if(!match||!verifyReceiptCapability(match[1],url.searchParams.get('s'),masterKey))return null
  return match[1]
 }catch{return null}
}
