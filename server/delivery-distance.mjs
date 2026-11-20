// Pure offline distance calculator. No HTTP requests and no Google billing.
const radians=degrees=>degrees*Math.PI/180
export function straightLineKm(from,to){
 const values=[from?.latitude,from?.longitude,to?.latitude,to?.longitude]
 if(values.some(value=>typeof value!=='number'||!Number.isFinite(value)))throw new TypeError('Coordenadas inválidas')
 const [lat1,lon1,lat2,lon2]=values
 if(Math.abs(lat1)>90||Math.abs(lat2)>90||Math.abs(lon1)>180||Math.abs(lon2)>180)throw new RangeError('Coordenadas fuera de rango')
 const dLat=radians(lat2-lat1),dLon=radians(lon2-lon1)
 const h=Math.sin(dLat/2)**2+Math.cos(radians(lat1))*Math.cos(radians(lat2))*Math.sin(dLon/2)**2
 return 6371*2*Math.asin(Math.min(1,Math.sqrt(h)))
}
