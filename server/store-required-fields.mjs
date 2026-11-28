// Only the core identity and GPS fields are mandatory for a sede.
// "active" is a mandatory BOOLEAN, not a requirement that the checkbox be checked.
export function validateRequiredStoreFields(input,{creating=false}={}){
 const invalid=message=>Object.assign(new Error(message),{code:400})
 if(!input||typeof input!=='object'||Array.isArray(input))throw invalid('Datos de sede inválidos')
 const {code,name,address,latitude,longitude,active}=input
 if(creating&&(typeof code!=='string'||!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(code)||code.length<2||code.length>80))
  throw invalid('El ID de sede es obligatorio: 2 a 80 caracteres, minúsculas, números y guiones')
 if(typeof name!=='string'||!name.trim()||name.trim().length>180)
  throw invalid('El nombre del local es obligatorio (máximo 180 caracteres)')
 if(typeof address!=='string'||!address.trim()||address.trim().length>300)
  throw invalid('La dirección del local es obligatoria (máximo 300 caracteres)')
 if(typeof latitude!=='number'||!Number.isFinite(latitude)||latitude< -90||latitude>90)
  throw invalid('La latitud GPS es obligatoria y debe estar entre -90 y 90')
 if(typeof longitude!=='number'||!Number.isFinite(longitude)||longitude< -180||longitude>180)
  throw invalid('La longitud GPS es obligatoria y debe estar entre -180 y 180')
 if(typeof active!=='boolean')
  throw invalid('El estado del local debe estar definido como activo o inactivo')
 return true
}
