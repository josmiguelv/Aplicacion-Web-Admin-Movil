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

export const TEST_DELIVERY_COORDINATES=Object.freeze({latitude:-12.0506096,longitude:-77.1251313})
export function resolveDeliveryDestination(input){
 const missing=value=>value===undefined||value===null||value===''
 const latitudeMissing=missing(input?.latitude),longitudeMissing=missing(input?.longitude)
 if(latitudeMissing&&longitudeMissing)return {...TEST_DELIVERY_COORDINATES,fallbackUsed:true}
 // Do not silently combine a real latitude with the fallback longitude or vice versa.
 if(latitudeMissing||longitudeMissing)throw Object.assign(new Error('Se requieren ambas coordenadas del destino'),{code:422})
 const latitude=input.latitude,longitude=input.longitude
 if(typeof latitude!=='number'||typeof longitude!=='number'||
    !Number.isFinite(latitude)||!Number.isFinite(longitude)||
    latitude < -90||latitude>90||longitude < -180||longitude>180)
  throw Object.assign(new Error('Coordenadas del destino inválidas'),{code:422})
 return {latitude,longitude,fallbackUsed:false}
}
