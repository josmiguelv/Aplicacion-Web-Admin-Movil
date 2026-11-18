import {useEffect,useRef,useState,type FormEvent} from 'react'

type Store = {id:string;name:string;code:string}
type Binding = {id:string;storeId:string;storeName:string;storeCode:string;externalLocationId:string;purpose:string;queueReference:string;authorizationConfirmedAt:string}
type Check = {httpStatus:number|null;result:string|null;errorCode:string|null;message:string;checkedAt:string;simulation:boolean;bindingId:string}
type Metadata = {name:string;externalTenantId:string;channelAccountId:string;channelType:string;instanceKey:string;baseUrl:string;scopes:string[];credentialReference:string|null;expiresAt:string|null}
type Integration = Metadata & {id:string;hasCredential:boolean;credentialHint:string|null;status:string;suspended:boolean;connectionMode:string;lastCheck:Check|null;bindings?:Binding[]}
const BASE='https://api.tuverso.integra-b2g.com'
const scopes=['queue.availability.read','interactions.create','interactions.read','interactions.events.read','conversations.read','conversations.messages.write']
const statuses:Record<string,string>={UNCONFIGURED:'SIN CONFIGURAR',CONFIGURED:'CONFIGURADA',QUERY_CONNECTED:'CONECTADA PARA CONSULTAS',AUTH_ERROR:'ERROR DE AUTENTICACIÓN',EXPIRED:'VENCIDA',SUSPENDED:'SUSPENDIDA'}
const empty=():Metadata=>({name:'',externalTenantId:'',channelAccountId:'',channelType:'MOBILE_APP',instanceKey:'',baseUrl:BASE,scopes:['queue.availability.read'],credentialReference:'',expiresAt:''})
const date=(value:string|null)=>value?new Date(value).toLocaleString('es-PE'):'Sin comprobación'
const localDate=(value:string|null)=>{if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
const payload=(form:Metadata)=>({...form,expiresAt:form.expiresAt?new Date(form.expiresAt).toISOString():null})
async function api<T>(path:string,method='GET',data?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(path,{method,credentials:'include',cache:'no-store',signal,headers:data===undefined?undefined:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)})
 const result=await response.json().catch(()=>({error:'Respuesta inesperada'}))
 if(!response.ok)throw Error(result.error||'No se pudo procesar la integración')
 return result as T
}
export default function TuVersoIntegrations({tenantId,tenantName}:{tenantId:string;tenantName:string}){
 const root=`/api/admin/tenants/${tenantId}/integrations`
 const [items,setItems]=useState<Integration[]>([]),[stores,setStores]=useState<Store[]>([]),[selectedId,setSelectedId]=useState(''),[detail,setDetail]=useState<Integration|null>(null)
 const [form,setForm]=useState<Metadata>(empty),[busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[loadingDetail,setLoadingDetail]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('')
 const [binding,setBinding]=useState({storeId:'',externalLocationId:'',purpose:'',queueReference:'',authorizationConfirmed:false})
 const [bindingId,setBindingId]=useState(''),[authorizeCheck,setAuthorizeCheck]=useState(false),[confirmDelete,setConfirmDelete]=useState(false),[mode,setMode]=useState('DISABLED')
 const secretForm=useRef<HTMLFormElement>(null)
 const applyDetail=(value:Integration)=>{setDetail(value);setForm({name:value.name,externalTenantId:value.externalTenantId,channelAccountId:value.channelAccountId,channelType:value.channelType,instanceKey:value.instanceKey,baseUrl:value.baseUrl,scopes:value.scopes,credentialReference:value.credentialReference||'',expiresAt:localDate(value.expiresAt)})}
 useEffect(()=>{
  const controller=new AbortController()
  void Promise.all([api<{integrations:Integration[];connectionMode:string}>(root,'GET',undefined,controller.signal),api<{items:Store[]}>(`/api/admin/tenants/${tenantId}/stores`,'GET',undefined,controller.signal)])
   .then(([list,resources])=>{setItems(list.integrations);setMode(list.connectionMode);setStores(resources.items)})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[root,tenantId])
 useEffect(()=>{
  setDetail(null);setAuthorizeCheck(false);setBindingId('');setConfirmDelete(false);setBinding({storeId:'',externalLocationId:'',purpose:'',queueReference:'',authorizationConfirmed:false});secretForm.current?.reset()
  if(!selectedId){setForm(empty());return}
  const controller=new AbortController();setLoadingDetail(true)
  void api<Integration>(root+'/'+selectedId,'GET',undefined,controller.signal).then(applyDetail)
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoadingDetail(false)})
  return()=>controller.abort()
 },[root,selectedId])
 const refresh=async()=>{const list=await api<{integrations:Integration[];connectionMode:string}>(root);setItems(list.integrations);setMode(list.connectionMode);if(selectedId)applyDetail(await api<Integration>(root+'/'+selectedId))}
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await work()}catch(e){setError(e instanceof Error?e.message:'Error de integración')}finally{setBusy(false)}}
 const saveMetadata=(event:FormEvent)=>{event.preventDefault();void run(async()=>{
  if(selectedId){await api(root+'/'+selectedId,'PUT',payload(form));await refresh()}
  else{const created=await api<Integration>(root,'POST',payload(form));setItems(v=>[...v,created]);setSelectedId(created.id)}
  setNotice('Configuración guardada. Los datos externos siguen declarados manualmente; no se ha conectado a TU VERSO.')
 })}
 const saveCredential=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();const dom=event.currentTarget,data=new FormData(dom)
  // Token exists only in the password input and the one-time HTTPS request; never in React state or browser storage.
  const request={token:String(data.get('token')||''),credentialReference:String(data.get('reference')||''),expiresAt:data.get('expires')?new Date(String(data.get('expires'))).toISOString():null};dom.reset()
  void run(async()=>{try{await api(root+'/'+selectedId+'/credential','POST',request);setNotice('Credencial cifrada guardada. No se ha emitido ni revocado ninguna credencial en TU VERSO.');await refresh()}finally{request.token=''}})
 }
 if(loading)return <p className="portal-muted">Consultando integraciones...</p>
 return <section aria-label="Integración TU VERSO">
  <div className="portal-title"><div><h1>Integraciones → TU VERSO</h1><p className="portal-muted">Empresa: <strong>{tenantName}</strong> · Proveedor: TU VERSO</p></div></div>
  <p className="portal-muted">Fase 1A: consulta de disponibilidad sin reserva. Fase 1B: desplegada y deshabilitada; mensajería e interacciones no habilitadas.</p>
  {error&&<p className="portal-error" role="alert">{error}</p>}{notice&&<p className="portal-notice" role="status">{notice}</p>}
  <div className="portal-panel">
   <h2>Integraciones registradas</h2>
   {items.length===0&&<p className="portal-muted">Esta empresa todavía no tiene integraciones TU VERSO.</p>}
   <div className="portal-company-list">{items.map(item=><div className="portal-company" key={item.id}><div><strong>{item.name}</strong><small>{item.channelType} · {item.instanceKey} · {statuses[item.status]}{item.lastCheck?.simulation?' (simulada)':''}</small></div><button className="portal-outline" type="button" disabled={busy||loadingDetail} onClick={()=>{setSelectedId(item.id);setError('');setNotice('')}}>Configurar {item.name}</button></div>)}</div>
   <button className="portal-outline" type="button" disabled={busy||loadingDetail} onClick={()=>{setSelectedId('');setError('');setNotice('')}}>Nueva integración</button>
  </div>
  {loadingDetail?<p>Consultando configuración...</p>:<>
  <form className="portal-panel portal-form" onSubmit={saveMetadata}>
   <h2>{selectedId?'Configuración de TU VERSO':'Nueva integración TU VERSO'}</h2>
   <p className="portal-muted">Identificación, cuenta, instancia, scopes, vencimiento y colas son datos declarados por el Super Administrador. Una consulta 1A no certifica estos metadatos.</p>
   <fieldset disabled={busy} className="integration-fields">
    <label>Nombre de integración<input required maxLength={180} value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <label>Tenant ID de TU VERSO<input required value={form.externalTenantId} onChange={e=>setForm({...form,externalTenantId:e.target.value})}/></label>
    <label>Identificador de cuenta de canal<input required value={form.channelAccountId} onChange={e=>setForm({...form,channelAccountId:e.target.value})}/></label>
    <label>Tipo de canal<select value={form.channelType} onChange={e=>setForm({...form,channelType:e.target.value})}><option>MOBILE_APP</option><option>WEB</option></select></label>
    <label>Identificador de instancia<input required maxLength={180} value={form.instanceKey} onChange={e=>setForm({...form,instanceKey:e.target.value})}/></label>
    <label>URL base documentada<input readOnly value={BASE}/></label>
    <label>Referencia no secreta de credencial<input maxLength={180} value={form.credentialReference||''} onChange={e=>setForm({...form,credentialReference:e.target.value})}/></label>
    <label>Vencimiento registrado<input type="datetime-local" value={form.expiresAt||''} onChange={e=>setForm({...form,expiresAt:e.target.value})}/></label>
   </fieldset>
   <fieldset disabled={busy} className="integration-scopes"><legend>Scopes declarados</legend>{scopes.map(scope=><label key={scope}><input type="checkbox" checked={form.scopes.includes(scope)} disabled={scope==='queue.availability.read'} onChange={e=>setForm({...form,scopes:e.target.checked?[...form.scopes,scope]:form.scopes.filter(s=>s!==scope)})}/>{scope}{scope!=='queue.availability.read'?' (Fase 1B deshabilitada)':''}</label>)}</fieldset>
   <button className="portal-primary" disabled={busy||!!selectedId&&!detail}>Guardar configuración</button>
  </form>
  {detail&&<>
   <section className="portal-panel"><h2>Estado de conexión</h2><p><strong>{statuses[detail.status]}</strong>{detail.lastCheck?.simulation?' · Evidencia simulada, sin conexión real':''}</p>
    <p className="portal-muted">Credencial: {detail.hasCredential?detail.credentialHint:'No registrada'} · Vencimiento declarado: {detail.expiresAt?date(detail.expiresAt):'No informado'}</p>
    <p className="portal-muted">Última comprobación: {date(detail.lastCheck?.checkedAt||null)}</p>
    {detail.lastCheck&&<p>HTTP {detail.lastCheck.httpStatus??'sin respuesta'} · {detail.lastCheck.result||detail.lastCheck.errorCode} · {detail.lastCheck.message}</p>}
    <button className="portal-outline" type="button" disabled={busy} onClick={()=>void run(async()=>{await api(root+'/'+selectedId+'/suspension','POST',{suspended:!detail.suspended});await refresh();setNotice(detail.suspended?'Suspensión local retirada; se requiere una nueva comprobación.':'Conexión suspendida solo en este administrador.')})}>{detail.suspended?'Retirar suspensión local':'Suspender conexión local'}</button>
   </section>
   <form ref={secretForm} className="portal-panel portal-form" onSubmit={saveCredential}>
    <h2>{detail.hasCredential?'Sustituir credencial protegida':'Registrar credencial protegida'}</h2>
    <p className="portal-muted">Registra una credencial ya emitida por un TENANT_ADMIN humano de TU VERSO. Nunca se muestra de nuevo. Este portal no emite ni revoca claves de TU VERSO.</p>
    <label>Credencial S2S<input name="token" type="password" autoComplete="off" required minLength={39} maxLength={519} spellCheck={false}/></label>
    <label>Referencia de la nueva credencial<input name="reference" maxLength={180} autoComplete="off"/></label>
    <label>Vencimiento de la nueva credencial<input name="expires" type="datetime-local"/></label>
    <button className="portal-primary" disabled={busy}>{detail.hasCredential?'Sustituir credencial':'Guardar credencial cifrada'}</button>
   </form>
   {detail.hasCredential&&<div className="portal-panel"><label className="integration-check"><input type="checkbox" checked={confirmDelete} onChange={e=>setConfirmDelete(e.target.checked)}/>Confirmo eliminar la credencial almacenada únicamente en este administrador.</label><button className="portal-outline" type="button" disabled={busy||!confirmDelete} onClick={()=>void run(async()=>{await api(root+'/'+selectedId+'/credential-delete','POST',{confirm:true});setConfirmDelete(false);await refresh();setNotice('Credencial local eliminada. Su revocación en TU VERSO requiere al administrador autorizado de ese sistema.')})}>Eliminar credencial local</button></div>}
   <section className="portal-panel"><h2>Asociaciones autorizadas de sedes</h2>
    <p className="portal-muted">Declara solo asociaciones previamente autorizadas en TU VERSO. La referencia de cola se conserva como dato manual y no se envía en la consulta 1A.</p>
    {!detail.bindings?.length&&<p>No hay asociaciones registradas.</p>}
    {detail.bindings?.map(b=><div className="portal-company" key={b.id}><div><strong>{b.storeName} · {b.storeCode}</strong><small>{b.externalLocationId} · {b.purpose} · Cola declarada: {b.queueReference}</small><small>Autorización declarada manualmente el {date(b.authorizationConfirmedAt)}</small></div><button className="portal-outline" type="button" disabled={busy} onClick={()=>void run(async()=>{await api(root+'/'+selectedId+'/bindings/'+b.id+'/delete','POST',{confirm:true});setBindingId('');setAuthorizeCheck(false);await refresh();setNotice('Asociación local eliminada.')})}>Eliminar asociación</button></div>)}
    <form className="portal-form" onSubmit={e=>{e.preventDefault();void run(async()=>{await api(root+'/'+selectedId+'/bindings','POST',binding);setBinding({storeId:'',externalLocationId:'',purpose:'',queueReference:'',authorizationConfirmed:false});await refresh();setNotice('Asociación local guardada como autorización declarada; no comprobada por TU VERSO.')})}}>
     <div className="integration-fields"><label>Local de la empresa<select aria-label="Local de la empresa" required value={binding.storeId} onChange={e=>setBinding({...binding,storeId:e.target.value})}><option value="">Selecciona una sede</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label>
     <label>externalLocationId<input required maxLength={180} value={binding.externalLocationId} onChange={e=>setBinding({...binding,externalLocationId:e.target.value})}/></label>
     <label>purpose<input required maxLength={80} pattern="[A-Z][A-Z0-9_]*" value={binding.purpose} onChange={e=>setBinding({...binding,purpose:e.target.value})}/></label>
     <label>Referencia de cola autorizada en TU VERSO<input required value={binding.queueReference} onChange={e=>setBinding({...binding,queueReference:e.target.value})}/></label></div>
     <label className="integration-check"><input type="checkbox" required checked={binding.authorizationConfirmed} onChange={e=>setBinding({...binding,authorizationConfirmed:e.target.checked})}/>Confirmo que esta sede, propósito y cola pertenecen a la cuenta y tenant TU VERSO autorizados.</label>
     <button className="portal-primary" disabled={busy||!binding.authorizationConfirmed}>Guardar asociación</button>
    </form>
   </section>
   <form className="portal-panel portal-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const result=await api<Check>(root+'/'+selectedId+'/test','POST',{bindingId,authorizeCheck});await refresh();setAuthorizeCheck(false);setNotice(`HTTP ${result.httpStatus??'sin respuesta'} · ${result.result||result.errorCode}: ${result.message}`)})}}>
    <h2>Probar conexión · Fase 1A</h2>
    <p className="portal-muted">{mode==='DISABLED'?'Las consultas reales están deshabilitadas en el servidor. Se requiere autorización operativa antes de habilitarlas.':mode==='SIMULATED'?'Modo de pruebas simuladas. No certifica una conexión productiva.':'Consulta real autorizada exclusivamente para la asociación seleccionada.'}</p>
    <label>Sede y propósito para la comprobación<select aria-label="Sede y propósito para la comprobación" required value={bindingId} onChange={e=>{setBindingId(e.target.value);setAuthorizeCheck(false)}}><option value="">Selecciona una asociación autorizada</option>{detail.bindings?.map(b=><option key={b.id} value={b.id}>{b.storeName} · {b.externalLocationId} · {b.purpose}</option>)}</select></label>
    <label className="integration-check"><input type="checkbox" required checked={authorizeCheck} onChange={e=>setAuthorizeCheck(e.target.checked)}/>Autorizo esta consulta de disponibilidad para la credencial y asociación registradas.</label>
    <button className="portal-primary" disabled={busy||mode==='DISABLED'||!detail.hasCredential||detail.suspended||detail.status==='EXPIRED'||!bindingId||!authorizeCheck}>Probar conexión</button>
    <p className="portal-muted">HTTP 200 con AVAILABLE o UNAVAILABLE confirma solo una consulta autorizada. No reserva agentes ni acepta pedidos; no activa chats ni la Fase 1B.</p>
   </form>
  </>}
  </>}
 </section>
}
