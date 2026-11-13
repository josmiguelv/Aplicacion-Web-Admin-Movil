export const MODES = new Set(['DELIVERY','PICKUP','DINE_IN'])
export const PAYMENT_CODES = new Set(['YAPE','PLIN','CARD','CASH'])
export function haversineMeters(aLat,aLon,bLat,bLon){
  if(![aLat,aLon,bLat,bLon].every(Number.isFinite))return Infinity
  const radians=x=>x*Math.PI/180
  const dLat=radians(bLat-aLat),dLon=radians(bLon-aLon)
  const a=Math.sin(dLat/2)**2+Math.cos(radians(aLat))*Math.cos(radians(bLat))*Math.sin(dLon/2)**2
  return 6371000*2*Math.atan2(Math.sqrt(a),Math.sqrt(1-a))
}
export function selectDeliveryStore(stores, latitude, longitude) {
 if(!Number.isFinite(latitude)||!Number.isFinite(longitude)||
   latitude < -90||latitude > 90||longitude < -180||longitude > 180) return null
 return stores.filter(s=>s.active&&s.deliveryEnabled&&
   Number.isFinite(s.latitude)&&Number.isFinite(s.longitude)&&
   Number.isFinite(s.deliveryRadiusM)&&s.deliveryRadiusM>0)
  .map(s=>({...s,distanceMeters:haversineMeters(latitude,longitude,s.latitude,s.longitude)}))
  .filter(s=>s.distanceMeters<=s.deliveryRadiusM)
  .sort((a,b)=>a.distanceMeters-b.distanceMeters||(a.priority??100)-(b.priority??100)||a.id.localeCompare(b.id))[0]??null
}
// A distance radius is a temporary coverage policy, NOT proof of drive time or street route.
export function allowedPayments(config,storeId,mode){
 if(!MODES.has(mode))return[]
 return [...new Set(config.filter(p=>p.storeId===storeId&&p.mode===mode&&p.enabled&&PAYMENT_CODES.has(p.method)).map(p=>p.method))]
}
