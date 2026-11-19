import {useEffect,useRef,useState,type FormEvent} from 'react'

type Store={id:string;name:string;code:string}
type Binding={id:string;storeId:string;storeName:string;storeCode:string;externalLocationId:string;purpose:string;queueReference:string|null}
type Check={httpStatus:number|null;result:string|null;errorCode:string|null;message:string;checkedAt:string;simulation:boolean;bindingId:string}
type Integration={id:string;name:string;hasCredential:boolean;credentialHint:string|null;expiresAt:string|null;status:string;suspended:boolean;connectionMode:string;lastCheck:Check|null;bindings?:Binding[]}
const statuses:Record<string,string>={UNCONFIGURED:'SIN CONFIGURAR',CONFIGURED:'PENDIENTE DE VERIFICAR CONEXIÓN',QUERY_CONNECTED:'CONECTADA PARA CONSULTAS',AUTH_ERROR:'NO SE PUDO CONECTAR CON TU VERSO',EXPIRED:'CLAVE VENCIDA',SUSPENDED:'DESACTIVADA EN ESTE ADMINISTRADOR'}
const date=(value:string|null)=>value?new Date(value).toLocaleString('es-PE'):'Sin comprobación'
const localDate=(value:string|null)=>{if(!value)return '';const d=new Date(value);return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)}
const purposeLabel=(purpose:string)=>purpose==='ORDER_REQUEST'?'Atención de pedidos':purpose
async function api<T>(path:string,method='GET',data?:unknown,signal?:AbortSignal):Promise<T>{
 const response=await fetch(path,{method,credentials:'include',cache:'no-store',signal,headers:data===undefined?undefined:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data)})
 const result=await response.json().catch(()=>({error:'Respuesta inesperada'}))
 if(!response.ok)throw Error(result.error||'No se pudo guardar la conexión')
 return result as T
}
export default function TuVersoIntegrations({tenantId,tenantName}:{tenantId:string;tenantName:string}){
 const root=`/api/admin/tenants/${tenantId}/integrations`
 const [items,setItems]=useState<Integration[]>([]),[stores,setStores]=useState<Store[]>([]),[selectedId,setSelectedId]=useState(''),[detail,setDetail]=useState<Integration|null>(null)
 const [busy,setBusy]=useState(false),[loading,setLoading]=useState(true),[loadingDetail,setLoadingDetail]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[mode,setMode]=useState('DISABLED')
 const [binding,setBinding]=useState({storeId:'',purpose:'',externalLocationId:'',authorizationConfirmed:false}),[customPurpose,setCustomPurpose]=useState(false)
 const [bindingId,setBindingId]=useState(''),[authorizeCheck,setAuthorizeCheck]=useState(false),[confirmDelete,setConfirmDelete]=useState(false),[confirmDeactivate,setConfirmDeactivate]=useState(false)
 const secretForm=useRef<HTMLFormElement>(null)
 const selectedStore=stores.find(store=>store.id===binding.storeId)
 useEffect(()=>{
  const controller=new AbortController()
  void Promise.all([api<{integrations:Integration[];connectionMode:string}>(root,'GET',undefined,controller.signal),api<{items:Store[]}>(`/api/admin/tenants/${tenantId}/stores`,'GET',undefined,controller.signal)])
   .then(([list,resources])=>{setItems(list.integrations);setMode(list.connectionMode);setStores(resources.items)})
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoading(false)})
  return()=>controller.abort()
 },[root,tenantId])
 useEffect(()=>{
  setDetail(null);setAuthorizeCheck(false);setBindingId('');setConfirmDelete(false);setConfirmDeactivate(false);setBinding({storeId:'',purpose:'',externalLocationId:'',authorizationConfirmed:false});setCustomPurpose(false);secretForm.current?.reset()
  if(!selectedId)return
  const controller=new AbortController();setLoadingDetail(true)
  void api<Integration>(root+'/'+selectedId,'GET',undefined,controller.signal).then(setDetail)
   .catch(e=>{if(!controller.signal.aborted)setError(e.message)}).finally(()=>{if(!controller.signal.aborted)setLoadingDetail(false)})
  return()=>controller.abort()
 },[root,selectedId])
 const refresh=async(id=selectedId)=>{const list=await api<{integrations:Integration[];connectionMode:string}>(root);setItems(list.integrations);setMode(list.connectionMode);if(id)setDetail(await api<Integration>(root+'/'+id))}
 const run=async(work:()=>Promise<void>)=>{setBusy(true);setError('');setNotice('');try{await work()}catch(e){setError(e instanceof Error?e.message:'No se pudo completar la operación')}finally{setBusy(false)}}
 const saveKey=(event:FormEvent<HTMLFormElement>)=>{
  event.preventDefault();const dom=event.currentTarget,data=new FormData(dom),name=String(data.get('name')||'').trim()
  // Keep the secret out of React state and browser storage; clear the input immediately.
  const request={token:String(data.get('token')||'').trim(),expiresAt:data.get('expires')?new Date(String(data.get('expires'))).toISOString():null};dom.reset()
  void run(async()=>{
   let target=selectedId
   try{
    if(!target){const created=await api<Integration>(root,'POST',name?{name}:{});target=created.id}
    else if(name&&name!==detail?.name)await api(root+'/'+target,'PUT',{name})
    await api(root+'/'+target+'/credential','POST',request)
    setSelectedId(target);await refresh(target);setNotice('Clave guardada de forma segura. Ahora selecciona la sede y el propósito autorizados.')
   }finally{request.token='';if(target&&!selectedId)setSelectedId(target)}
  })
 }
 if(loading)return <p className="portal-muted">Consultando conexiones...</p>
 return <section aria-label="Integración TU VERSO">
  <div className="portal-title"><div><h1>Integraciones → TU VERSO</h1><p className="portal-muted">Empresa: <strong>{tenantName}</strong></p></div></div>
  <p className="portal-muted">Consulta si hay atención disponible. Esta conexión no envía mensajes, no crea conversaciones ni confirma pedidos.</p>
  {error&&<p className="portal-error" role="alert">{error}</p>}{notice&&<p className="portal-notice" role="status">{notice}</p>}
  {items.length>0&&<section className="portal-panel"><h2>Conexiones guardadas</h2><div className="portal-company-list">{items.map(item=><div className="portal-company" key={item.id}><div><strong>{item.name}</strong><small>{statuses[item.status]}{item.lastCheck?.simulation?' · prueba simulada':''}</small></div><button className="portal-outline" type="button" disabled={busy||loadingDetail} onClick={()=>{setSelectedId(item.id);setError('');setNotice('')}}>Configurar {item.name}</button></div>)}</div><button className="portal-outline" type="button" disabled={busy||loadingDetail} onClick={()=>{setSelectedId('');setError('');setNotice('');secretForm.current?.reset()}}>Nueva conexión</button></section>}
  {loadingDetail?<p>Consultando conexión...</p>:<>
   <form key={selectedId||'new'} ref={secretForm} className="portal-panel portal-form" onSubmit={saveKey}>
    <h2>{detail?.hasCredential?'1. Sustituir clave de conexión':'1. Clave de integración'}</h2>
    <p className="portal-muted">Pega la clave tal como la emitió TU VERSO (por ejemplo, tuverso_… o un formato anterior). No la renombres ni agregues Bearer. Se guarda cifrada y no se vuelve a mostrar.</p>
    <label>Clave de integración<input name="token" type="password" autoComplete="off" required minLength={32} maxLength={1024} spellCheck={false} disabled={busy}/></label>
    <details className="integration-details"><summary>Nombre y vencimiento (opcionales)</summary><div className="integration-fields">
     <label>Nombre de la conexión (opcional)<input name="name" defaultValue={detail?.name||''} maxLength={180} disabled={busy}/></label>
     <label>Fecha de vencimiento (si la conoces)<input name="expires" type="datetime-local" defaultValue={localDate(detail?.expiresAt||null)} disabled={busy}/></label>
    </div></details>
    <button className="portal-primary" disabled={busy}>{busy?'Guardando...':detail?.hasCredential?'Guardar nueva clave':'Guardar clave y continuar'}</button>
   </form>
   {detail&&<>
    <section className="portal-panel"><h2>Estado de la conexión</h2><p><strong>{statuses[detail.status]}</strong>{detail.lastCheck?.simulation?' · Resultado simulado, sin conexión real':''}</p>
     <p className="portal-muted">Última comprobación: {date(detail.lastCheck?.checkedAt||null)}{detail.expiresAt?' · La clave vence el '+date(detail.expiresAt):''}</p>
     {detail.status==='AUTH_ERROR'&&detail.lastCheck?.httpStatus===401
       ? <p role="status">TU VERSO rechazó la conexión (HTTP 401). Revisa la clave y los permisos de la integración.</p>
       : detail.lastCheck&&<p>{detail.lastCheck.message}</p>}
     <p className="portal-muted">{detail.suspended
      ? 'Esta conexión está desactivada solo en este administrador. Puedes activarla para volver a comprobarla; no se ha cambiado nada en TU VERSO.'
      : 'Si la desactivas, este administrador dejará de consultar TU VERSO. La clave seguirá guardada y la configuración en TU VERSO no cambiará.'}</p>
     {detail.suspended
      ? <button className="portal-outline" type="button" disabled={busy} onClick={()=>void run(async()=>{
          await api(root+'/'+selectedId+'/suspension','POST',{suspended:false})
          await refresh();setConfirmDeactivate(false)
          setNotice('Conexión activada en este administrador. Comprueba nuevamente la disponibilidad para verificar el acceso.')
         })}>Activar conexión con TU VERSO</button>
      : confirmDeactivate
       ? <div className="integration-details" role="group" aria-label="Confirmar desactivación de conexión">
           <p><strong>¿Desactivar la conexión en este administrador?</strong> Se detendrán las consultas desde aquí; no se revocará la clave ni se desactivará TU VERSO.</p>
           <div className="integration-actions">
            <button className="portal-outline" type="button" disabled={busy} onClick={()=>void run(async()=>{
              await api(root+'/'+selectedId+'/suspension','POST',{suspended:true})
              await refresh();setConfirmDeactivate(false)
              setNotice('Conexión desactivada en este administrador. TU VERSO no se ha modificado.')
             })}>Sí, desactivar conexión</button>
            <button className="portal-outline" type="button" disabled={busy} onClick={()=>setConfirmDeactivate(false)}>Cancelar</button>
           </div>
         </div>
       : <button className="portal-outline" type="button" disabled={busy} onClick={()=>setConfirmDeactivate(true)}>Desactivar conexión con TU VERSO</button>}
    </section>
    <section className="portal-panel"><h2>2. Sede y propósito</h2>
     <p className="portal-muted">Selecciona una sede y un propósito que ya estén autorizados para esta clave en TU VERSO.</p>
     {!detail.bindings?.length&&<p className="portal-muted">Todavía no has asociado una sede.</p>}
     {detail.bindings?.map(b=><div className="portal-company" key={b.id}><div><strong>{b.storeName}</strong><small>{purposeLabel(b.purpose)} · Código de sede: {b.externalLocationId}</small></div><button className="portal-outline" type="button" disabled={busy} onClick={()=>void run(async()=>{await api(root+'/'+selectedId+'/bindings/'+b.id+'/delete','POST',{confirm:true});setBindingId('');setAuthorizeCheck(false);await refresh();setNotice('Sede retirada de esta conexión local.')})}>Retirar sede</button></div>)}
     <form className="portal-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const {externalLocationId,...required}=binding;await api(root+'/'+selectedId+'/bindings','POST',{...required,...(externalLocationId.trim()?{externalLocationId:externalLocationId.trim()}:{})});setBinding({storeId:'',purpose:'',externalLocationId:'',authorizationConfirmed:false});setCustomPurpose(false);await refresh();setNotice('Sede y propósito guardados. Puedes comprobar la conexión.')})}}>
      <div className="integration-fields">
       <label>Sede<select aria-label="Sede" required value={binding.storeId} disabled={busy} onChange={e=>setBinding({...binding,storeId:e.target.value,externalLocationId:'',authorizationConfirmed:false})}><option value="">Selecciona una sede</option>{stores.map(s=><option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label>
       <label>Propósito<select aria-label="Propósito" required value={customPurpose?'OTHER':binding.purpose} disabled={busy} onChange={e=>{setCustomPurpose(e.target.value==='OTHER');setBinding({...binding,purpose:e.target.value==='OTHER'?'':e.target.value,authorizationConfirmed:false})}}><option value="">Selecciona un propósito</option><option value="ORDER_REQUEST">Atención de pedidos</option><option value="OTHER">Otro propósito autorizado</option></select></label>
       {customPurpose&&<label>Propósito indicado por TU VERSO<input required maxLength={80} pattern="[A-Z][A-Z0-9_]*" value={binding.purpose} disabled={busy} onChange={e=>setBinding({...binding,purpose:e.target.value,authorizationConfirmed:false})}/></label>}
      </div>
      {selectedStore&&<p className="portal-muted">Se usará el código de esta sede: <strong>{binding.externalLocationId||selectedStore.code}</strong>. Debe coincidir con el registrado en TU VERSO.</p>}
      {selectedStore&&<details className="integration-details"><summary>¿La sede tiene otro código en TU VERSO?</summary><label>Código de sede indicado por TU VERSO<input maxLength={180} value={binding.externalLocationId} disabled={busy} onChange={e=>setBinding({...binding,externalLocationId:e.target.value,authorizationConfirmed:false})}/></label></details>}
      <label className="integration-check"><input type="checkbox" required checked={binding.authorizationConfirmed} disabled={busy} onChange={e=>setBinding({...binding,authorizationConfirmed:e.target.checked})}/>Confirmo que esta sede y este propósito están autorizados para la clave en TU VERSO.</label>
      <button className="portal-primary" disabled={busy||!binding.authorizationConfirmed}>Guardar sede y propósito</button>
     </form>
    </section>
    <form className="portal-panel portal-form" onSubmit={e=>{e.preventDefault();void run(async()=>{const result=await api<Check>(root+'/'+selectedId+'/test','POST',{bindingId,authorizeCheck});await refresh();setAuthorizeCheck(false);setNotice(result.message)})}}>
     <h2>3. Comprobar conexión</h2>
     {mode==='DISABLED'&&<p className="portal-muted">Las consultas reales todavía no están habilitadas en este entorno. La clave y la sede pueden guardarse sin enviar nada a TU VERSO.</p>}
     {mode==='SIMULATED'&&<p className="portal-muted">Prueba simulada. No comprueba una conexión real.</p>}
     <label>Sede para comprobar<select aria-label="Sede para comprobar" required value={bindingId} onChange={e=>{setBindingId(e.target.value);setAuthorizeCheck(false)}}><option value="">Selecciona una sede y propósito guardados</option>{detail.bindings?.map(b=><option key={b.id} value={b.id}>{b.storeName} · {purposeLabel(b.purpose)}</option>)}</select></label>
     <label className="integration-check"><input type="checkbox" required checked={authorizeCheck} onChange={e=>setAuthorizeCheck(e.target.checked)}/>Autorizo esta consulta de disponibilidad.</label>
     <button className="portal-primary" disabled={busy||mode==='DISABLED'||!detail.hasCredential||detail.suspended||detail.status==='EXPIRED'||!bindingId||!authorizeCheck}>{detail.lastCheck?'Probar nuevamente':'Probar conexión'}</button>
     <p className="portal-muted">Solo comprueba si hay atención disponible. No reserva agentes ni activa mensajes o conversaciones.</p>
     {detail.lastCheck&&<details className="integration-details"><summary>Detalle de la última comprobación</summary><p>HTTP {detail.lastCheck.httpStatus??'sin respuesta'} · {detail.lastCheck.result||detail.lastCheck.errorCode}</p></details>}
    </form>
    {detail.hasCredential&&<details className="portal-panel"><summary>Eliminar clave guardada</summary><p className="portal-muted">Solo elimina la copia de este administrador; no revoca la clave en TU VERSO.</p><label className="integration-check"><input type="checkbox" checked={confirmDelete} onChange={e=>setConfirmDelete(e.target.checked)}/>Confirmo que quiero eliminar la clave guardada.</label><button className="portal-outline" type="button" disabled={busy||!confirmDelete} onClick={()=>void run(async()=>{await api(root+'/'+selectedId+'/credential-delete','POST',{confirm:true});setConfirmDelete(false);await refresh();setNotice('Clave eliminada de este administrador.')})}>Eliminar clave</button></details>}
   </>}
  </>}
 </section>
}