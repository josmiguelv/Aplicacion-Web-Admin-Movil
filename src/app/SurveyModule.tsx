import {useEffect,useState} from 'react'
import {CalendarDays,ChevronDown,ChevronUp,Filter,MessageSquareText,RefreshCw,Star} from 'lucide-react'

export type SurveyStore={id:string;name:string}
export type SurveySummaryEntry={storeId:string;total:number;average:number}
export type SurveyRecord={
 surveyId:string;appId:string;storeId:string;interactionId:string;
 rating:number;tags:string[];comment:string|null;createdAt:string
}
type SurveyResponse={items:SurveyRecord[];total:number;limit:number;offset:number}
type Props={tenantId:string;isSuperAdmin:boolean;stores:SurveyStore[];initialStoreId:string}
const PAGE_SIZE=10
const queryBase=(tenantId:string,isSuperAdmin:boolean)=>isSuperAdmin?{tenantId}:{}
const stars=(rating:number)=>'★'.repeat(Math.max(0,Math.min(5,Math.round(rating))))+
 '☆'.repeat(Math.max(0,5-Math.round(rating)))
const niceDate=(date:string)=>new Intl.DateTimeFormat('es-PE',{
 dateStyle:'medium',timeStyle:'short',timeZone:'America/Lima'
}).format(new Date(date))
export function SurveyModule({tenantId,isSuperAdmin,stores,initialStoreId}:Props){
 const [storeId,setStoreId]=useState(initialStoreId)
 const [rating,setRating]=useState('')
 const [from,setFrom]=useState('')
 const [to,setTo]=useState('')
 const [appId,setAppId]=useState('')
 const [page,setPage]=useState(0)
 const [revision,setRevision]=useState(0)
 const [data,setData]=useState<SurveyResponse|null>(null)
 const [loading,setLoading]=useState(false)
 const [error,setError]=useState('')
 const [expanded,setExpanded]=useState<string|null>(null)
 useEffect(()=>{setStoreId(initialStoreId);setPage(0);setData(null)},[initialStoreId,tenantId])
 useEffect(()=>{
  if(!tenantId)return
  const controller=new AbortController()
  const params=new URLSearchParams({...queryBase(tenantId,isSuperAdmin),limit:String(PAGE_SIZE),offset:String(page*PAGE_SIZE)})
  if(storeId)params.set('storeId',storeId)
  if(rating)params.set('rating',rating)
  if(from)params.set('from',from)
  if(to)params.set('to',to)
  if(appId.trim())params.set('appId',appId.trim())
  setLoading(true);setError('')
  void fetch('/api/admin/mobile/surveys?'+params.toString(),{
   credentials:'include',cache:'no-store',signal:controller.signal
  }).then(async response=>{
   const payload=await response.json().catch(()=>({error:'Respuesta inválida'}))
   if(!response.ok)throw new Error(payload.error||'Error HTTP '+response.status)
   return payload as SurveyResponse
  }).then(value=>{if(!controller.signal.aborted)setData(value)})
   .catch(err=>{if(!controller.signal.aborted)setError(err instanceof Error?err.message:'No se pudo consultar las encuestas')})
   .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return ()=>controller.abort()
 },[tenantId,isSuperAdmin,storeId,rating,from,to,appId,page,revision])
 const changeFilter=(callback:()=>void)=>{setPage(0);setExpanded(null);callback()}
 const clear=()=>{setStoreId(initialStoreId);setRating('');setFrom('');setTo('');setAppId('');setPage(0);setExpanded(null)}
 return <section className="ops-panel ops-survey-panel" aria-label="Encuestas de satisfacción">
  <div className="ops-survey-header">
   <div><h2><Star size={20}/> Encuestas de satisfacción</h2>
    <p className="ops-hint">Valoraciones recibidas desde Pollos B3. Las encuestas se consultan sin modificar pedidos ni contactar a TU VERSO.</p></div>
   <button className="button button-secondary" onClick={()=>setRevision(x=>x+1)} type="button" disabled={loading}><RefreshCw size={15}/> Actualizar</button>
  </div>
  <div className="ops-survey-filters" aria-label="Filtrar encuestas">
   <label>Sede<select value={storeId} onChange={e=>changeFilter(()=>setStoreId(e.target.value))}>
    <option value="">Todas las sedes</option>
    {stores.map(store=><option key={store.id} value={store.id}>{store.name}</option>)}
   </select></label>
   <label>Calificación<select value={rating} onChange={e=>changeFilter(()=>setRating(e.target.value))}>
    <option value="">Todas</option>
    {[5,4,3,2,1].map(n=><option key={n} value={n}>{n} {n===1?'estrella':'estrellas'}</option>)}
   </select></label>
   <label>Desde<input type="date" value={from} max={to||undefined} onChange={e=>changeFilter(()=>setFrom(e.target.value))}/></label>
   <label>Hasta<input type="date" value={to} min={from||undefined} onChange={e=>changeFilter(()=>setTo(e.target.value))}/></label>
   <label>Aplicación<input value={appId} maxLength={150} placeholder="Todas las aplicaciones" onChange={e=>changeFilter(()=>setAppId(e.target.value))}/></label>
   <button type="button" className="button button-secondary" onClick={clear}><Filter size={15}/> Limpiar</button>
  </div>
  {error&&<div className="ops-error" role="alert">{error} <button className="button button-secondary" type="button" onClick={()=>setRevision(x=>x+1)}>Reintentar</button></div>}
  <div className="ops-survey-count" role="status">{loading?'Consultando encuestas…':data?data.total===1?'1 encuesta encontrada':data.total+' encuestas encontradas':'Sin consulta disponible'}</div>
  {!loading&&!error&&data?.items.length===0&&<p className="ops-survey-empty">No hay encuestas con estos filtros.</p>}
  <div className="ops-survey-list">
   {data?.items.map(survey=>{
    const open=expanded===survey.surveyId
    const name=stores.find(s=>s.id===survey.storeId)?.name||'Sede no disponible'
    return <article className="ops-survey-card" key={survey.surveyId}>
     <button type="button" className="ops-survey-row" aria-expanded={open} onClick={()=>setExpanded(open?null:survey.surveyId)}>
      <span className="ops-survey-rating" aria-label={survey.rating+' de 5 estrellas'}><strong>{survey.rating}/5</strong><span aria-hidden="true">{stars(survey.rating)}</span></span>
      <span className="ops-survey-brief"><strong>{name}</strong><small>{niceDate(survey.createdAt)}</small>
       <span>{survey.tags.length?survey.tags.join(' · '):'Sin etiquetas seleccionadas'}</span></span>
      {open?<ChevronUp size={18}/>:<ChevronDown size={18}/>}
     </button>
     {open&&<div className="ops-survey-detail">
      <p><MessageSquareText size={16}/> <strong>Comentario</strong></p>
      <p>{survey.comment||'El cliente no escribió un comentario.'}</p>
      <dl>
       <div><dt>Pedido original</dt><dd>{survey.interactionId}</dd></div>
       <div><dt>Aplicación</dt><dd>{survey.appId}</dd></div>
       <div><dt>Fecha de recepción</dt><dd><CalendarDays size={14}/>{niceDate(survey.createdAt)}</dd></div>
      </dl>
     </div>}
    </article>
   })}
  </div>
  {data&&data.total>PAGE_SIZE&&<div className="ops-survey-pages">
   <span>Mostrando {page*PAGE_SIZE+1}–{Math.min((page+1)*PAGE_SIZE,data.total)} de {data.total}</span>
   <div><button type="button" className="button button-secondary" disabled={loading||page===0} onClick={()=>{setExpanded(null);setPage(x=>x-1)}}>Anterior</button>
    <button type="button" className="button button-secondary" disabled={loading||(page+1)*PAGE_SIZE>=data.total} onClick={()=>{setExpanded(null);setPage(x=>x+1)}}>Siguiente</button></div>
  </div>}
 </section>
}
