// Additive Android payment projection built from the already-published Admin catalog.
// Existing paymentMethods and company_payment_images remain authoritative.
const MODES=['delivery','pickup','dine_in','reservation']
export function publicPaymentOptions(methods,sharedImages){
 const result={}
 for(const mode of MODES){
  result[mode]=(Array.isArray(methods?.[mode])?methods[mode]:[])
   .filter(method=>['yape','plin','card','cash'].includes(method))
   .map(method=>({method,imageUrl:method==='cash'?null:sharedImages?.[method]||null}))
 }
 return result
}
