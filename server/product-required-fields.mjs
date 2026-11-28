// Validation shared by create and update. A product may be unavailable and have no image.
const invalid=message=>Object.assign(new Error(message),{code:400})
export function validateRequiredProductFields(input){
 if(!input||typeof input!=='object'||Array.isArray(input))throw invalid('Datos del producto inválidos')
 if(typeof input.name!=='string'||!input.name.trim()||input.name.trim().length>180)
  throw invalid('El nombre del producto es obligatorio (máximo 180 caracteres)')
 if(typeof input.category!=='string'||!input.category.trim()||input.category.trim().length>150)
  throw invalid('La categoría del producto es obligatoria (máximo 150 caracteres)')
 if(typeof input.pricePen!=='number'||!Number.isFinite(input.pricePen)||input.pricePen<=0)
  throw invalid('El precio del producto debe ser mayor que S/ 0')
 if(typeof input.active!=='boolean')
  throw invalid('La disponibilidad del producto debe ser activa o inactiva')
 return true
}
