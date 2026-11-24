// Public payment catalog mapper. Keep legacy paymentMethods intact for older Android clients.
export function paymentCatalog(imageRows,enabledRows,storeId) {
 const images=Object.fromEntries(imageRows.filter(row=>['yape','plin','card'].includes(row.method)).map(row=>[row.method,'/api/v1/mobile/images/'+row.image_id]))
 const methods=enabledRows.filter(row=>row.store_id===storeId)
 const paymentMethods={delivery:[],pickup:[],dine_in:[]}
 const paymentOptions={delivery:[],pickup:[],dine_in:[]}
 for(const row of methods){
  if(!Object.hasOwn(paymentMethods,row.mode)||!['yape','plin','card','cash'].includes(row.method))continue
  paymentMethods[row.mode].push(row.method)
  paymentOptions[row.mode].push({method:row.method,imageUrl:images[row.method]??null})
 }
 return {paymentMethods,paymentOptions}
}
export const paymentImageMap=imageRows=>Object.fromEntries(imageRows.filter(row=>['yape','plin','card'].includes(row.method)).map(row=>[row.method,'/api/v1/mobile/images/'+row.image_id]))
