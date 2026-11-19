// Contrato de lectura móvil: el administrador guarda mon/tue/... pero
// Android presenta los horarios semanales con monday/tuesday/... .
const DAYS = [
 ['mon','monday'],['tue','tuesday'],['wed','wednesday'],
 ['thu','thursday'],['fri','friday'],['sat','saturday'],['sun','sunday'],
]

export function mobileWeeklyHours(openingHours) {
 if (!openingHours || typeof openingHours !== 'object' || Array.isArray(openingHours)) return null
 const result = {}
 for (const [shortDay, longDay] of DAYS) {
  const day = openingHours[shortDay]
  if (!day || typeof day !== 'object' || Array.isArray(day)) continue
  if (day.closed === true) result[longDay] = {closed: true}
  else if (typeof day.open === 'string' && typeof day.close === 'string') {
   result[longDay] = {open: day.open, close: day.close}
  }
 }
 return Object.keys(result).length ? result : null
}
