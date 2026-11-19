import {useEffect,useState,type FormEvent} from 'react'
import {ArrowLeft,Bell,CalendarClock,History,ImagePlus,RefreshCw,Trash2} from 'lucide-react'
import {groupNotifications,notificationSections,type NoticeSection} from './notification-views.mjs'

type App = {app_id:string;enabled:boolean}
type CatalogProduct = {id:string;name:string;active:boolean;price_pen:number|string}
type WeekSlot = {weekday:number;startTime:string;endTime:string}
type TimeGroup = {key:string;days:number[];startTime:string;endTime:string}
const newTimeGroup=():TimeGroup=>({key:String(Date.now())+Math.random().toString(36).slice(2),days:[4],startTime:'15:00',endTime:'18:00'})
const groupSlots=(slots:WeekSlot[]):TimeGroup[]=>{
 const groups=new Map<string,TimeGroup>()
 for(const slot of slots){
  const key=slot.startTime+'|'+slot.endTime
  if(!groups.has(key))groups.set(key,{key,days:[],startTime:slot.startTime,endTime:slot.endTime})
  const group=groups.get(key)!
  if(!group.days.includes(slot.weekday))group.days.push(slot.weekday)
 }
 return [...groups.values()]
}
type WeeklySeries = {
 id:string;appId:string;title:string;message:string;imageId:string;
 productId:string|null;productName:string|null;weekday:number;startTime:string;endTime:string;slots:WeekSlot[];
 startDate:string;untilDate:string|null;timeZone:string;status:'ACTIVE'|'PAUSED'
}
const dayNames=['','lunes','martes','miércoles','jueves','viernes','sábado','domingo']
const peruToday=()=>{
 const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date())
 const value=(type:string)=>parts.find(p=>p.type===type)?.value||''
 return `${value('year')}-${value('month')}-${value('day')}`
}
type Notification = {
 id:string;appId:string;title:string;message:string;imageId:string;productId:string|null;productName?:string|null;
 scheduledAt:string;expiresAt:string|null;status:'SCHEDULED'|'AVAILABLE'|'CANCELLED'|'EXPIRED';
 pushStatus?:'PENDING'|'SENDING'|'SENT'|'RETRY'|'FAILED'|'UNKNOWN'|'SKIPPED';
 fcmMessageId?:string|null;pushSentAt?:string|null;pushAttempts?:number;pushLastError?:string|null;
}
type Draft = {id:string;appId:string;title:string;message:string;imageId:string;productId:string;scheduledAt:string;expiresAt:string}
const initial=(appId=''):Draft=>({
 id:'',appId,title:'',message:'',imageId:'',productId:'',
 scheduledAt:new Date(Date.now()+10*60000-new Date().getTimezoneOffset()*60000).toISOString().slice(0,16),
 expiresAt:''
})
const localValue=(value:string|null)=>{
 if(!value)return ''
 const d=new Date(value)
 return Number.isFinite(d.getTime())?new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16):''
}
const pushLabels:Record<NonNullable<Notification['pushStatus']>,string>={
 PENDING:'Pendiente de envío',SENDING:'Enviando a Firebase',SENT:'Aceptada por Firebase',
 RETRY:'Reintento programado',FAILED:'Error de envío',UNKNOWN:'Resultado incierto — revisar',
 SKIPPED:'Solo API (anterior a FCM)'
}
const statusLabel:Record<Notification['status'],string>={
 SCHEDULED:'Programada',AVAILABLE:'Disponible por API',CANCELLED:'Cancelada',EXPIRED:'Vencida'
}
async function api<T>(path:string,method:'GET'|'POST'|'DELETE'='GET',data?:unknown):Promise<T>{
 const response=await fetch(path,{method,credentials:'include',cache:'no-store',
  headers:data===undefined?undefined:{'Content-Type':'application/json'},
  body:data===undefined?undefined:JSON.stringify(data)})
 const result=await response.json().catch(()=>({error:'Respuesta inesperada del servidor'}))
 if(!response.ok)throw Error(result.error||'No se pudo completar la operación')
 return result as T
}

export default function ScheduledNotifications({tenantId,apps,products}:{tenantId:string;apps:App[];products:CatalogProduct[]}){
 const root='/api/admin/tenants/'+tenantId
 const [items,setItems]=useState<Notification[]>([])
 const [series,setSeries]=useState<WeeklySeries[]>([])
 const [frequency,setFrequency]=useState<'once'|'weekly'>('once')
 const [seriesId,setSeriesId]=useState('')
 const [timeGroups,setTimeGroups]=useState<TimeGroup[]>([newTimeGroup()])
 const [startDate,setStartDate]=useState(peruToday())
 const [untilDate,setUntilDate]=useState('')
 const [draft,setDraft]=useState<Draft>(initial(apps[0]?.app_id))
 const [editor,setEditor]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [confirmId,setConfirmId]=useState('')
 const [uploading,setUploading]=useState(false)
 const [ready,setReady]=useState(false)
 const [view,setView]=useState<NoticeSection>('running')
 const groups=groupNotifications(items)
 const viewItems=view==='running'?groups.running:view==='scheduled'?groups.scheduled:groups.history
 const sectionCounts:Record<NoticeSection,number>={
  running:groups.running.length,scheduled:groups.scheduled.length,
  series:series.length,history:groups.history.length
 }
 const activeSection=notificationSections.find(section=>section.id===view)??notificationSections[0]
 const switchView=(next:NoticeSection)=>{
  setView(next);setEditor(false);setConfirmId('');setNotice('');setError('')
 }
 const refresh=async()=>{
  const [notices,recurrences]=await Promise.all([
   api<{items:Notification[]}>(root+'/notifications'),
   api<{items:WeeklySeries[]}>(root+'/notification-series')
  ])
  setItems(notices.items);setSeries(recurrences.items)
  setReady(true)
 }
 useEffect(()=>{
  let cancelled=false
  setReady(false);setItems([]);setSeries([]);setEditor(false);setConfirmId('');setSeriesId('');setFrequency('once');setView('running')
  setDraft(initial(apps[0]?.app_id))
  void Promise.all([
   api<{items:Notification[]}>(root+'/notifications'),
   api<{items:WeeklySeries[]}>(root+'/notification-series')
  ]).then(([notices,recurrences])=>{
   if(!cancelled){setItems(notices.items);setSeries(recurrences.items);setReady(true)}
  }).catch(e=>{if(!cancelled){setError(e.message);setReady(true)}})
  return ()=>{cancelled=true}
 },[tenantId])
 useEffect(()=>{
  if(!draft.appId&&apps.length===1)setDraft(v=>({...v,appId:apps[0].app_id}))
 },[apps,draft.appId])
 const run=async(action:()=>Promise<void>)=>{
  setBusy(true);setError('');setNotice('')
  try{await action()}catch(e){setError(e instanceof Error?e.message:'No se pudo completar')}
  finally{setBusy(false)}
 }
 const imagePreview=(id:string)=>root+'/images/'+id
 const save=(e:FormEvent<HTMLFormElement>)=>{
  e.preventDefault()
  void run(async()=>{
   if(!draft.imageId)throw Error('Adjunta una imagen antes de programar la notificación.')
   if(frequency==='weekly'){
    const slots=timeGroups.flatMap(group=>group.days.map(weekday=>({
     weekday,startTime:group.startTime,endTime:group.endTime
    })))
    if(!slots.length)throw Error('Selecciona al menos un día para repetir la promoción.')
    if(slots.some(slot=>slot.startTime>=slot.endTime))throw Error('Cada horario debe terminar después de empezar.')
    const result=await api<WeeklySeries>(root+'/notification-series','POST',{
     id:seriesId||undefined,appId:draft.appId,title:draft.title.trim(),message:draft.message.trim(),
     productId:draft.productId||null,imageId:draft.imageId,slots,startDate,
     untilDate:untilDate||null,timeZone:'America/Lima'
    })
    await refresh();setSeriesId(result.id);setEditor(false);setView('series')
    setNotice('Secuencia guardada: un envío por día y franja configurados, sin duplicados al reiniciar.')
   }else{
    if(!draft.scheduledAt)throw Error('Indica cuándo estará disponible la notificación.')
    const result=await api<Notification>(root+'/notifications','POST',{
     id:draft.id||undefined,appId:draft.appId,title:draft.title.trim(),
     productId:draft.productId||null,
     message:draft.message.trim(),imageId:draft.imageId,
     scheduledAt:new Date(draft.scheduledAt).toISOString(),
     expiresAt:draft.expiresAt?new Date(draft.expiresAt).toISOString():null
    })
    await refresh();setEditor(false);setView('scheduled');setDraft({...draft,id:result.id})
    setNotice('Notificación guardada. Estará disponible por API en la fecha indicada y se enviará por FCM si está habilitado en el servidor.')
   }
  })
 }
 const upload=async(file:File)=>{
  setUploading(true);setError('');setNotice('')
  try{
   if(file.size>1024*1024)throw Error('La imagen para FCM debe pesar máximo 1 MB.')
   const response=await fetch(root+'/images',{method:'POST',credentials:'include',body:file})
   const result=await response.json().catch(()=>({error:'Respuesta inesperada'}))
   if(!response.ok)throw Error(result.error||'No se pudo cargar la imagen')
   setDraft(d=>({...d,imageId:result.id}))
   setNotice('Imagen cargada. Guarda la notificación para programarla.')
  }catch(e){setError(e instanceof Error?e.message:'Error al cargar imagen')}
  finally{setUploading(false)}
 }
 const newNotice=(kind:'once'|'weekly')=>{
  setFrequency(kind);setSeriesId('');setDraft(initial(apps[0]?.app_id))
  setTimeGroups([newTimeGroup()]);setStartDate(peruToday());setUntilDate('')
  setEditor(true);setConfirmId('');setError('');setNotice('')
 }
 const editSeries=(item:WeeklySeries)=>{
  setFrequency('weekly');setSeriesId(item.id)
  setDraft({...initial(item.appId),appId:item.appId,title:item.title,message:item.message,imageId:item.imageId,
   productId:item.productId||''})
  setTimeGroups(groupSlots(item.slots?.length?item.slots:[{
   weekday:item.weekday,startTime:item.startTime,endTime:item.endTime
  }]))
  setStartDate(item.startDate);setUntilDate(item.untilDate||'')
  setEditor(true);setConfirmId('');setError('');setNotice('')
 }
 const seriesAction=(item:WeeklySeries,action:'pause'|'resume'|'delete')=>void run(async()=>{
  await api(root+'/notification-series/'+item.id+'/'+action,'POST',action==='delete'?{confirm:true}:{})
  if(seriesId===item.id){setEditor(false);setSeriesId('')}
  await refresh();setConfirmId('')
  setNotice(action==='delete'?'Secuencia eliminada. No habrá nuevas repeticiones.':
   action==='pause'?'Secuencia pausada. No se generarán nuevos avisos hasta reanudarla.':'Secuencia reanudada.')
 })
 const edit=(item:Notification)=>{
  setFrequency('once');setSeriesId('')
  setDraft({id:item.id,appId:item.appId,title:item.title,message:item.message,imageId:item.imageId,productId:item.productId||'',
   scheduledAt:localValue(item.scheduledAt),expiresAt:localValue(item.expiresAt)})
  setEditor(true);setConfirmId('');setError('');setNotice('')
 }
 const remove=(item:Notification,mode:'cancel'|'delete')=>void run(async()=>{
  if(mode==='cancel')await api(root+'/notifications/'+item.id+'/cancel','POST',{confirm:true})
  else await api(root+'/notifications/'+item.id,'DELETE',{confirm:true})
  if(draft.id===item.id){setDraft(initial(apps[0]?.app_id));setEditor(false)}
  await refresh();setConfirmId('')
  if(mode==='cancel')setView('history')
  setNotice(mode==='cancel'?'Notificación cancelada. Puedes consultarla en el historial.':'Notificación eliminada del administrador.')
 })
 return <section className="ops-panel ops-record-section ops-notification-center" aria-label="Centro de notificaciones">
  <div className="ops-store-toolbar">
   <div><h2><Bell size={20}/> Centro de notificaciones</h2>
    <p>Consulta la actividad, organiza campañas y revisa los resultados de envío desde un solo lugar.</p></div>
   {editor?<button className="button button-secondary" type="button" disabled={busy||uploading}
     onClick={()=>{setEditor(false);setError('');setNotice('')}}><ArrowLeft size={15}/> Volver al listado</button>:
    <div className="ops-record-actions">
     <button className="button button-secondary" type="button" disabled={busy||!ready}
      onClick={()=>void run(async()=>{await refresh();setNotice('Información actualizada.')})}>
      <RefreshCw size={15}/> Actualizar</button>
     <button className="button button-primary" type="button" disabled={busy||apps.length===0}
      onClick={()=>newNotice('once')}>Nueva notificación</button>
     <button className="button button-secondary" type="button" disabled={busy||apps.length===0}
      onClick={()=>newNotice('weekly')}>Nueva secuencia</button>
    </div>}
  </div>
  {apps.length===0&&<p className="ops-empty">Primero registra una aplicación en la sección Publicar para asociar las notificaciones.</p>}
  {!editor&&<>
   <nav className="ops-notification-tabs" aria-label="Vistas de notificaciones">
    {notificationSections.map(section=><button key={section.id} type="button"
     className={'ops-notification-tab'+(view===section.id?' is-active':'')}
     aria-current={view===section.id?'page':undefined}
     onClick={()=>switchView(section.id)}>
     <span className="ops-notification-tab-label">{section.id==='history'&&<History size={15}/>}
      {section.label}</span>
     <span className="ops-notification-tab-count">{sectionCounts[section.id]}</span>
    </button>)}
   </nav>
   <div className="ops-notification-view-heading">
    <div><h3>{activeSection.label}</h3><p>{activeSection.description}</p></div>
    <small>{view==='history'?'Un aviso vigente enviado también figura aquí como registro de FCM.':'Horarios y fechas según la programación de cada aviso.'}</small>
   </div>
   {notice&&<p className="ops-success ops-action-feedback" role="status">{notice}</p>}
   {error&&<p className="ops-error ops-action-feedback" role="alert">{error}</p>}
   {view==='series'&&<>

  {ready&&series.length===0&&<p className="ops-empty">Todavía no hay secuencias. Crea una para repetir las promociones automáticamente.</p>}
  {ready&&series.length>0&&<div className="ops-record-list">
   {series.map(item=><article key={item.id} className="ops-record-row ops-notification-card">
    <img className="ops-notification-thumb" src={imagePreview(item.imageId)} loading="lazy" alt={'Imagen de '+item.title}/>
    <div className="ops-record-info">
     <strong>{item.title}</strong><small>{item.message}</small>
     {(item.slots?.length?groupSlots(item.slots):groupSlots([{weekday:item.weekday,startTime:item.startTime,endTime:item.endTime}])).map(group=>
      <small key={group.key}>{group.days.sort((a,b)=>a-b).map(day=>dayNames[day]).join(', ')} · {group.startTime}–{group.endTime} (Perú)</small>)}
     <small>Desde {item.startDate}{item.untilDate?' hasta '+item.untilDate:' · Sin fecha de finalización'}</small>
     <small>{item.appId}{item.productId?' · '+(item.productName||'Producto asociado'):''}</small>
     <span className={'ops-record-status'+(item.status==='ACTIVE'?' enabled':'')}>{item.status==='ACTIVE'?'Secuencia activa':'Pausada'}</span>
    </div>
    <div className="ops-record-actions">
     <button type="button" className="button button-secondary" disabled={busy} onClick={()=>editSeries(item)}>Editar</button>
     <button type="button" className="button button-secondary" disabled={busy}
      onClick={()=>seriesAction(item,item.status==='ACTIVE'?'pause':'resume')}>{item.status==='ACTIVE'?'Pausar':'Reanudar'}</button>
     <button type="button" className="button button-secondary ops-delete-trigger" disabled={busy}
      onClick={()=>{setConfirmId('series:'+item.id);setError('');setNotice('')}}><Trash2 size={14}/> Eliminar</button>
    </div>
    {confirmId==='series:'+item.id&&<div className="ops-delete-confirm">
     <strong>¿Eliminar esta secuencia semanal?</strong>
     <p>Se detendrán futuras repeticiones. Los avisos ya enviados no se pueden retirar de los teléfonos.</p>
     <div className="ops-record-actions">
      <button type="button" className="button button-secondary ops-delete-trigger" disabled={busy} onClick={()=>seriesAction(item,'delete')}>Confirmar</button>
      <button type="button" className="button button-secondary" onClick={()=>setConfirmId('')}>Volver</button>
     </div>
    </div>}
   </article>)}
  </div>}
  </>}
  {view!=='series'&&(!ready?<p className="ops-empty">Cargando notificaciones...</p>:viewItems.length===0?
   <p className="ops-empty">{view==='running'?'No hay avisos disponibles en este momento.':
    view==='scheduled'?'No hay notificaciones pendientes.':'Todavía no hay registros históricos de envío o avisos finalizados.'}</p>:
   <div className="ops-record-list">
    {viewItems.map(item=><article className="ops-record-row ops-notification-card" key={item.id}>
     <img src={imagePreview(item.imageId)} alt={'Imagen de '+item.title} loading="lazy" className="ops-notification-thumb"/>
     <div className="ops-record-info">
      <strong>{item.title}</strong><small>{item.message}</small>
      <small>{item.appId} · {new Date(item.scheduledAt).toLocaleString('es-PE')}</small>
      {item.productId&&<small><strong>Producto asociado:</strong> {item.productName||products.find(p=>p.id===item.productId)?.name||'Producto no disponible'}</small>}
      <span className={'ops-record-status'+(item.status==='AVAILABLE'?' enabled':'')}>{statusLabel[item.status]}</span>
      {item.pushStatus&&<small><strong>FCM:</strong> {pushLabels[item.pushStatus]}{item.pushSentAt?' · '+new Date(item.pushSentAt).toLocaleString('es-PE'):''}</small>}
      {item.fcmMessageId&&<small title={item.fcmMessageId}>Referencia FCM: {item.fcmMessageId}</small>}
      {item.pushLastError&&<small role="status">Detalle de envío: {item.pushLastError}</small>}
     </div>
     <div className="ops-record-actions">
      {item.status==='SCHEDULED'&&<button type="button" className="button button-secondary" disabled={busy} onClick={()=>edit(item)}>Editar</button>}
      {item.status==='SCHEDULED'&&<button type="button" className="button button-secondary" disabled={busy}
       onClick={()=>{setConfirmId('cancel:'+item.id);setNotice('');setError('')}}>Cancelar</button>}
      <button type="button" className="button button-secondary ops-delete-trigger" disabled={busy}
       onClick={()=>{setConfirmId('delete:'+item.id);setNotice('');setError('')}}><Trash2 size={14}/> Eliminar</button>
     </div>
     {(confirmId==='cancel:'+item.id||confirmId==='delete:'+item.id)&&<div className="ops-delete-confirm" role="group" aria-label={'Confirmar acción sobre '+item.title}>
      <strong>{confirmId.startsWith('cancel:')?'¿Cancelar esta notificación?':'¿Eliminar esta notificación?'}</strong>
      <p>{confirmId.startsWith('cancel:')?'No aparecerá en la API al llegar su fecha.':'Desaparecerá del administrador y dejará de estar disponible por API. No cancela un envío que Firebase ya haya aceptado.'}</p>
      <div className="ops-record-actions">
       <button type="button" className="button button-secondary ops-delete-trigger" disabled={busy}
        onClick={()=>remove(item,confirmId.startsWith('cancel:')?'cancel':'delete')}>Confirmar</button>
       <button type="button" className="button button-secondary" disabled={busy} onClick={()=>setConfirmId('')}>Volver</button>
      </div>
     </div>}
    </article>)}
   </div>)}
   {!ready&&<p className="ops-empty">Cargando campañas...</p>}
  </>}
  {editor&&<form className="ops-record-editor" onSubmit={save}>
   <h3><CalendarClock size={17}/>{frequency==='weekly'?(seriesId?'Editar secuencia semanal':'Nueva secuencia semanal'):(draft.id?'Editar programación':'Nueva notificación')}</h3>
   <label>Frecuencia
    <select value={frequency} disabled={!!draft.id||!!seriesId||busy} onChange={e=>setFrequency(e.target.value as 'once'|'weekly')}>
     <option value="once">Una sola vez</option>
     <option value="weekly">Repetir semanalmente</option>
    </select>
   </label>
   <div className="ops-grid">
    <label>Aplicación de destino
     <select required value={draft.appId} disabled={busy} onChange={e=>setDraft(v=>({...v,appId:e.target.value}))}>
      <option value="">Selecciona aplicación</option>
      {apps.map(a=><option key={a.app_id} value={a.app_id}>{a.app_id}</option>)}
     </select></label>
    <label>Producto asociado (opcional)
     <select value={draft.productId} disabled={busy} onChange={e=>setDraft(v=>({...v,productId:e.target.value}))}>
      <option value="">Sin producto asociado</option>
      {draft.productId&&!products.some(p=>p.id===draft.productId&&p.active)&&<option value={draft.productId} disabled>Producto antes vinculado no disponible: selecciona otro</option>}
      {products.filter(p=>p.active).map(p=><option key={p.id} value={p.id}>{p.name} · S/ {Number(p.price_pen).toFixed(2)}</option>)}
     </select>
    </label>
    <label>Título<input maxLength={120} minLength={2} required value={draft.title}
     onChange={e=>setDraft(v=>({...v,title:e.target.value}))} placeholder="Ej. Promoción por tiempo limitado"/></label>
    {frequency==='once'?<>
     <label>Fecha y hora programadas<input type="datetime-local" required value={draft.scheduledAt}
      onChange={e=>setDraft(v=>({...v,scheduledAt:e.target.value}))}/></label>
     <label>Vencimiento (opcional)<input type="datetime-local" value={draft.expiresAt}
      onChange={e=>setDraft(v=>({...v,expiresAt:e.target.value}))}/></label>
    </>:<>
     <label>Comenzar a partir de<input required type="date" value={startDate} onChange={e=>setStartDate(e.target.value)}/></label>
     <label>Última repetición (opcional)<input type="date" min={startDate} value={untilDate} onChange={e=>setUntilDate(e.target.value)}/></label>
    </>}
   </div>
   {frequency==='weekly'&&<div className="ops-record-section">
    <h4>Días y horarios de repetición</h4>
    <p className="ops-hint">Marca varios días que compartan horario. Para otros días u otra franja, utiliza «Agregar otro horario».</p>
    {timeGroups.map((group,index)=><div className="ops-record-editor" key={group.key}>
     <strong>Horario {index+1}</strong>
     <div className="ops-grid">
      <label>Enviar a las (Perú)
       <input type="time" required value={group.startTime} onChange={e=>setTimeGroups(groups=>groups.map(g=>g.key===group.key?{...g,startTime:e.target.value}:g))}/>
      </label>
      <label>Vigente hasta (Perú)
       <input type="time" required value={group.endTime} onChange={e=>setTimeGroups(groups=>groups.map(g=>g.key===group.key?{...g,endTime:e.target.value}:g))}/>
      </label>
     </div>
     <div className="ops-record-actions" role="group" aria-label={'Días del horario '+(index+1)}>
      {dayNames.slice(1).map((day,i)=><label className="ops-check" key={day}>
       <input type="checkbox" checked={group.days.includes(i+1)} onChange={e=>setTimeGroups(groups=>groups.map(g=>g.key!==group.key?g:{
        ...g,days:e.target.checked?[...g.days,i+1].sort((a,b)=>a-b):g.days.filter(dayNumber=>dayNumber!==i+1)
       }))}/>
       {day[0].toUpperCase()+day.slice(1)}
      </label>)}
     </div>
     {timeGroups.length>1&&<button type="button" className="button button-secondary" disabled={busy}
      onClick={()=>setTimeGroups(groups=>groups.filter(g=>g.key!==group.key))}>Quitar este horario</button>}
    </div>)}
    <button type="button" className="button button-secondary" disabled={busy||timeGroups.length>=6}
     onClick={()=>setTimeGroups(groups=>[...groups,{...newTimeGroup(),days:[]}])}>Agregar otro horario</button>
    <p className="ops-hint">Máximo 6 horarios y 7 días por horario. No se permiten franjas superpuestas el mismo día; cada combinación elegida genera un push independiente.</p>
   </div>}
   <p className="ops-hint">{frequency==='weekly'?'Horario de Perú (America/Lima). Cada franja genera una notificación al comenzar y permanece vigente hasta su cierre.':'Selecciona una fecha y hora para un envío único.'} Si vinculas un producto, comprueba que esté activo y publicado en la aplicación; es opcional.</p>
   <label>Texto de la notificación<textarea rows={4} required minLength={1} maxLength={2000}
    value={draft.message} onChange={e=>setDraft(v=>({...v,message:e.target.value}))}
    placeholder="Escribe lo que verá el cliente"/></label>
   <label><ImagePlus size={17}/> Imagen de la notificación
    <input type="file" accept="image/jpeg,image/png,image/webp" disabled={busy||uploading}
     onChange={e=>{const file=e.target.files?.[0];if(file)void upload(file)}}/>
   </label>
   {draft.imageId?<div className="ops-notification-image-preview">
     <img src={imagePreview(draft.imageId)} alt="Vista previa de la imagen" />
     <span>Imagen adjunta</span>
    </div>:<p className="ops-hint">La imagen es obligatoria. Máximo 1 MB para FCM; JPG, PNG o WebP.</p>}
   <div className="ops-record-actions">
    <button className="button button-primary" disabled={busy||uploading||!draft.imageId}>{busy?'Guardando...':(draft.id||seriesId)?'Guardar cambios':frequency==='weekly'?'Guardar secuencia semanal':'Guardar programación'}</button>
    <button className="button button-secondary" type="button" disabled={busy||uploading}
     onClick={()=>{setEditor(false);setError('');setNotice('')}}>Cerrar</button>
   </div>
   {notice&&<p className="ops-success ops-action-feedback" role="status">{notice}</p>}
   {error&&<p className="ops-error ops-action-feedback" role="alert">{error}</p>}
  </form>}
 </section>
}
