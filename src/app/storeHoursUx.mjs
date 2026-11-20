export const WEEKDAYS=['mon','tue','wed','thu','fri','sat','sun']
export function applyStoreHoursPreset(current,preset,open,close){
 if(!/^([01]\d|2[0-3]):[0-5]\d$/.test(open)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(close)||open===close)
  throw new Error('Selecciona horas de apertura y cierre distintas.')
 const selected=preset==='weekdays'?WEEKDAYS.slice(0,5):preset==='weekend'?WEEKDAYS.slice(5):preset==='all'?WEEKDAYS:null
 if(!selected)throw new Error('Selección de días inválida')
 const next={...current}
 for(const day of selected)next[day]={open,close}
 return next
}
export function storeHoursSummary(hours){
 const entries=Object.values(hours??{})
 const openDays=entries.filter(entry=>entry&&entry.closed!==true&&entry.open&&entry.close).length
 const closedDays=entries.filter(entry=>entry?.closed===true).length
 return {openDays,closedDays,unconfigured:7-openDays-closedDays}
}
