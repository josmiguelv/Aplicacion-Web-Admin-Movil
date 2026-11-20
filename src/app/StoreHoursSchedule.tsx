import {useState} from 'react'
import {CalendarDays,Clock3} from 'lucide-react'
import {
 applyStoreHoursPreset,storeHoursSummary,
 type OpeningHours,type DayHours,type HoursPreset,
} from './storeHoursUx.mjs'

const weekdays=[
 {id:'mon',label:'Lunes'},{id:'tue',label:'Martes'},{id:'wed',label:'Miércoles'},
 {id:'thu',label:'Jueves'},{id:'fri',label:'Viernes'},{id:'sat',label:'Sábado'},
 {id:'sun',label:'Domingo'},
] as const

export default function StoreHoursSchedule({
 hours,onChange,
}:{hours:OpeningHours;onChange:(next:OpeningHours)=>void}){
 const [open,setOpen]=useState('11:00')
 const [close,setClose]=useState('23:00')
 const [preset,setPreset]=useState<HoursPreset>('all')
 const [error,setError]=useState('')
 const summary=storeHoursSummary(hours)
 const updateDay=(day:typeof weekdays[number]['id'],value:DayHours|undefined)=>{
  const next={...hours}
  if(value)next[day]=value
  else delete next[day]
  onChange(next)
 }
 const apply=()=>{
  try{
   onChange(applyStoreHoursPreset(hours,preset,open,close))
   setError('')
  }catch(e){setError(e instanceof Error?e.message:'Horario inválido')}
 }
 return <div className="ops-hours-experience">
  <div className="ops-hours-quick">
   <div className="ops-hours-quick-title"><CalendarDays size={18}/><div>
    <strong>¿Todos los días tienen un horario parecido?</strong>
    <p>Configúralos juntos y luego ajusta días específicos si lo necesitas.</p>
   </div></div>
   <div className="ops-hours-quick-fields">
    <label>Aplicar a
     <select aria-label="Días a configurar" value={preset} onChange={e=>setPreset(e.target.value as HoursPreset)}>
      <option value="all">Lunes a domingo</option>
      <option value="weekdays">Lunes a viernes</option>
      <option value="weekend">Sábado y domingo</option>
     </select>
    </label>
    <label>Desde
     <input aria-label="Apertura para horario rápido" type="time" value={open} onChange={e=>setOpen(e.target.value)}/>
    </label>
    <label>Hasta
     <input aria-label="Cierre para horario rápido" type="time" value={close} onChange={e=>setClose(e.target.value)}/>
    </label>
    <button type="button" className="button button-secondary" onClick={apply}>Aplicar horario</button>
   </div>
   {error&&<p className="ops-error" role="alert">{error}</p>}
   <small>Solo reemplaza los días seleccionados. Puedes seguir ajustándolos abajo.</small>
  </div>
  <div className="ops-hours-list-header">
   <strong><Clock3 size={17}/> Horario por día</strong>
   <span>{summary.openDays} con horario · {summary.closedDays} cerrados · {summary.unconfigured} sin configurar</span>
  </div>
  <div className="ops-hours-list">
   {weekdays.map(day=>{
    const h=hours[day.id]
    const state=!h?'unset':'closed' in h?'closed':'open'
    return <div className="ops-hours-day" key={day.id}>
     <strong>{day.label}</strong>
     <label className="ops-hours-day-status">
      <span className="sr-only">Estado del {day.label.toLowerCase()}</span>
      <select aria-label={'Estado de '+day.label} value={state} onChange={e=>{
       const mode=e.target.value
       updateDay(day.id,mode==='closed'?{closed:true}:mode==='open'?{open:'11:00',close:'23:00'}:undefined)
      }}>
       <option value="unset">Sin configurar</option>
       <option value="open">Atiende</option>
       <option value="closed">Cerrado</option>
      </select>
     </label>
     {state==='open'&&h&&'open' in h?<>
      <label>Abre <input type="time" aria-label={'Apertura de '+day.label} value={h.open}
       onChange={e=>updateDay(day.id,{open:e.target.value,close:h.close})}/></label>
      <label>Cierra <input type="time" aria-label={'Cierre de '+day.label} value={h.close}
       onChange={e=>updateDay(day.id,{open:h.open,close:e.target.value})}/></label>
     </>:<span className="ops-hours-day-help">{state==='closed'?'No atiende este día':'No se publicará un horario para este día'}</span>}
    </div>
   })}
  </div>
  <p className="ops-store-help">“Sin configurar” es distinto de “Cerrado”. Si un local no atiende ese día, selecciona <strong>Cerrado</strong>.</p>
 </div>
}
