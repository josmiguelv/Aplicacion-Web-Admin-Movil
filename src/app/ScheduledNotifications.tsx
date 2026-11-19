import {useEffect,useState,type FormEvent} from 'react'
import {Bell,CalendarClock,ImagePlus,Trash2} from 'lucide-react'

type App = {app_id:string;enabled:boolean}
type Notification = {
 id:string;appId:string;title:string;message:string;imageId:string;
 scheduledAt:string;expiresAt:string|null;status:'SCHEDULED'|'AVAILABLE'|'CANCELLED'|'EXPIRED';
 pushStatus?:'PENDING'|'SENDING'|'SENT'|'RETRY'|'FAILED'|'UNKNOWN'|'SKIPPED';
 fcmMessageId?:string|null;pushSentAt?:string|null;pushAttempts?:number;pushLastError?:string|null;
}
type Draft = {id:string;appId:string;title:string;message:string;imageId:string;scheduledAt:string;expiresAt:string}
const initial=(appId=''):Draft=>({
 id:'',appId,title:'',message:'',imageId:'',
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

export default function ScheduledNotifications({tenantId,apps}:{tenantId:string;apps:App[]}){
 const root='/api/admin/tenants/'+tenantId
 const [items,setItems]=useState<Notification[]>([])
 const [draft,setDraft]=useState<Draft>(initial(apps[0]?.app_id))
 const [editor,setEditor]=useState(false)
 const [busy,setBusy]=useState(false)
 const [error,setError]=useState('')
 const [notice,setNotice]=useState('')
 const [confirmId,setConfirmId]=useState('')
 const [uploading,setUploading]=useState(false)
 const [ready,setReady]=useState(false)
 const refresh=async()=>{
  const result=await api<{items:Notification[]}>(root+'/notifications')
  setItems(result.items)
  setReady(true)
 }
 useEffect(()=>{
  let cancelled=false
  setReady(false);setItems([]);setEditor(false);setConfirmId('')
  setDraft(initial(apps[0]?.app_id))
  void api<{items:Notification[]}>(root+'/notifications').then(result=>{
   if(!cancelled){setItems(result.items);setReady(true)}
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
   if(!draft.scheduledAt)throw Error('Indica cuándo estará disponible la notificación.')
   const result=await api<Notification>(root+'/notifications','POST',{
    id:draft.id||undefined,appId:draft.appId,title:draft.title.trim(),
    message:draft.message.trim(),imageId:draft.imageId,
    scheduledAt:new Date(draft.scheduledAt).toISOString(),
    expiresAt:draft.expiresAt?new Date(draft.expiresAt).toISOString():null
   })
   await refresh()
   setEditor(true)
   setDraft({...draft,id:result.id})
   setNotice('Notificación guardada. Estará disponible por API en la fecha indicada y se enviará por FCM si está habilitado en el servidor.')
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
 const edit=(item:Notification)=>{
  setDraft({id:item.id,appId:item.appId,title:item.title,message:item.message,imageId:item.imageId,
   scheduledAt:localValue(item.scheduledAt),expiresAt:localValue(item.expiresAt)})
  setEditor(true);setConfirmId('');setError('');setNotice('')
 }
 const remove=(item:Notification,mode:'cancel'|'delete')=>void run(async()=>{
  if(mode==='cancel')await api(root+'/notifications/'+item.id+'/cancel','POST',{confirm:true})
  else await api(root+'/notifications/'+item.id,'DELETE',{confirm:true})
  if(draft.id===item.id){setDraft(initial(apps[0]?.app_id));setEditor(false)}
  await refresh();setConfirmId('')
  setNotice(mode==='cancel'?'Notificación cancelada. No estará disponible por API.':'Notificación eliminada del administrador.')
 })
 return <section className="ops-panel ops-record-section" aria-label="Programación de notificaciones">
  <div className="ops-store-toolbar">
   <div><h2><Bell size={20}/> Notificaciones programadas</h2>
    <p>Crea avisos con imagen y texto para una aplicación específica.</p></div>
   <button className="button button-primary" type="button" disabled={busy||apps.length===0}
    onClick={()=>{setDraft(initial(apps[0]?.app_id));setEditor(true);setConfirmId('');setError('');setNotice('')}}>Programar notificación</button>
  </div>
  <p className="ops-hint">Los avisos se publican por API a su hora programada. El envío FCM se ejecutará únicamente cuando el servidor tenga habilitada y configurada la cuenta de servicio privada. «Aceptada por Firebase» no garantiza entrega en todos los teléfonos.</p>
  {apps.length===0&&<p className="ops-empty">Primero registra una aplicación en la sección Publicar para asociar las notificaciones.</p>}
  {!ready?<p className="ops-empty">Cargando notificaciones...</p>:items.length===0?
   <p className="ops-empty">Todavía no hay notificaciones programadas.</p>:
   <div className="ops-record-list">
    {items.map(item=><article className="ops-record-row ops-notification-card" key={item.id}>
     <img src={imagePreview(item.imageId)} alt={'Imagen de '+item.title} loading="lazy" className="ops-notification-thumb"/>
     <div className="ops-record-info">
      <strong>{item.title}</strong><small>{item.message}</small>
      <small>{item.appId} · {new Date(item.scheduledAt).toLocaleString('es-PE')}</small>
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
   </div>}
  {!editor&&notice&&<p className="ops-success ops-action-feedback" role="status">{notice}</p>}
  {!editor&&error&&<p className="ops-error ops-action-feedback" role="alert">{error}</p>}
  {editor&&<form className="ops-record-editor" onSubmit={save}>
   <h3><CalendarClock size={17}/>{draft.id?'Editar programación':'Nueva notificación'}</h3>
   <div className="ops-grid">
    <label>Aplicación de destino
     <select required value={draft.appId} disabled={busy} onChange={e=>setDraft(v=>({...v,appId:e.target.value}))}>
      <option value="">Selecciona aplicación</option>
      {apps.map(a=><option key={a.app_id} value={a.app_id}>{a.app_id}</option>)}
     </select></label>
    <label>Título<input maxLength={120} minLength={2} required value={draft.title}
     onChange={e=>setDraft(v=>({...v,title:e.target.value}))} placeholder="Ej. Promoción por tiempo limitado"/></label>
    <label>Fecha y hora programadas<input type="datetime-local" required value={draft.scheduledAt}
     onChange={e=>setDraft(v=>({...v,scheduledAt:e.target.value}))}/></label>
    <label>Vencimiento (opcional)<input type="datetime-local" value={draft.expiresAt}
     onChange={e=>setDraft(v=>({...v,expiresAt:e.target.value}))}/></label>
   </div>
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
    <button className="button button-primary" disabled={busy||uploading||!draft.imageId}>{busy?'Guardando...':draft.id?'Guardar cambios':'Guardar programación'}</button>
    <button className="button button-secondary" type="button" disabled={busy||uploading}
     onClick={()=>{setEditor(false);setError('');setNotice('')}}>Cerrar</button>
   </div>
   {notice&&<p className="ops-success ops-action-feedback" role="status">{notice}</p>}
   {error&&<p className="ops-error ops-action-feedback" role="alert">{error}</p>}
  </form>}
 </section>
}
