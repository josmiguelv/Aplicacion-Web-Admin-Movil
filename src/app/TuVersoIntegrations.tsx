import { useEffect, useRef, useState, type FormEvent } from 'react'

type Store = { id: string; name: string; code: string }
type App = { app_id: string }
type Binding = { id: string; appId: string | null; storeId: string; storeName: string; storeCode: string; externalLocationId: string; purpose: string; queueReference: string | null }
type Check = { httpStatus: number | null; result: string | null; errorCode: string | null; message: string; checkedAt: string; simulation: boolean; bindingId: string }
type Integration = { id: string; name: string; scopes: string[]; hasCredential: boolean; credentialHint: string | null; expiresAt: string | null; status: string; suspended: boolean; connectionMode: string; lastCheck: Check | null; bindings?: Binding[] }
const statuses: Record<string, string> = {
 UNCONFIGURED: 'Sin clave registrada',
 CONFIGURED: 'Pendiente de comprobar',
 QUERY_CONNECTED: 'Consulta autorizada',
 AUTH_ERROR: 'TU VERSO rechazó la conexión',
 EXPIRED: 'Clave vencida',
 SUSPENDED: 'Desactivada en este administrador',
}
const date = (value: string | null) => value ? new Date(value).toLocaleString('es-PE') : 'Sin comprobación'
const localDate = (value: string | null) => {
 if (!value) return ''
 const d = new Date(value)
 return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}
const purposeLabel = (purpose: string) => purpose === 'ORDER_REQUEST' ? 'Atención de pedidos' : purpose
async function api<T>(path: string, method = 'GET', data?: unknown, signal?: AbortSignal): Promise<T> {
 const response = await fetch(path, {
  method, credentials: 'include', cache: 'no-store', signal,
  headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
  body: data === undefined ? undefined : JSON.stringify(data),
 })
 const result = await response.json().catch(() => ({ error: 'Respuesta inesperada' }))
 if (!response.ok) throw Error(result.error || 'No se pudo completar la operación')
 return result as T
}
export default function TuVersoIntegrations({ tenantId, tenantName }: { tenantId: string; tenantName: string }) {
 const root = '/api/admin/tenants/' + tenantId + '/integrations'
 const [items, setItems] = useState<Integration[]>([])
 const [stores, setStores] = useState<Store[]>([])
 const [apps, setApps] = useState<App[]>([])
 const [selectedId, setSelectedId] = useState('')
 const [creating, setCreating] = useState(false)
 const [detail, setDetail] = useState<Integration | null>(null)
 const [busy, setBusy] = useState(false)
 const [loading, setLoading] = useState(true)
 const [loadingDetail, setLoadingDetail] = useState(false)
 const [error, setError] = useState('')
 const [notice, setNotice] = useState('')
 const [noticeAt, setNoticeAt] = useState<'connection' | 'overview' | 'key' | 'check' | 'locations' | 'toggle' | 'credential'>('overview')
 const [mode, setMode] = useState('DISABLED')
 const [binding, setBinding] = useState({ appId: '', storeId: '', purpose: '', externalLocationId: '', authorizationConfirmed: false })
 const [customPurpose, setCustomPurpose] = useState(false)
 const [addingBinding, setAddingBinding] = useState(false)
 const [removingBindingId, setRemovingBindingId] = useState('')
 const [bindingId, setBindingId] = useState('')
 const [authorizeCheck, setAuthorizeCheck] = useState(false)
 const [editingKey, setEditingKey] = useState(false)
 const [confirmDelete, setConfirmDelete] = useState(false)
 const [confirmDeactivate, setConfirmDeactivate] = useState(false)
 const [removeId, setRemoveId] = useState('')
 const secretForm = useRef<HTMLFormElement>(null)
 const selectedStore = stores.find(store => store.id === binding.storeId)
 const bindings = detail?.bindings ?? []
 const selectedBinding = bindings.find(value => value.id === bindingId)
 const setup = creating || items.length === 0 || Boolean(detail && !detail.hasCredential)

 useEffect(() => {
  const controller = new AbortController()
  setLoading(true)
  void Promise.all([
   api<{ integrations: Integration[]; connectionMode: string }>(root, 'GET', undefined, controller.signal),
   api<{ items: Store[] }>('/api/admin/tenants/' + tenantId + '/stores', 'GET', undefined, controller.signal),
   api<{ items: App[] }>('/api/admin/tenants/' + tenantId + '/apps', 'GET', undefined, controller.signal),
  ]).then(([list, resources, applicationList]) => {
   setItems(list.integrations)
   setMode(list.connectionMode)
   setStores(resources.items)
   setApps(applicationList.items)
   if (list.integrations.length) setSelectedId(list.integrations[0].id)
  }).catch(e => { if (!controller.signal.aborted) setError(e.message) })
   .finally(() => { if (!controller.signal.aborted) setLoading(false) })
  return () => controller.abort()
 }, [root, tenantId])

 useEffect(() => {
  setDetail(null)
  setBindingId('')
  setAuthorizeCheck(false)
  setRemoveId('')
  setRemovingBindingId('')
  setConfirmDelete(false)
  setConfirmDeactivate(false)
  setEditingKey(false)
  setAddingBinding(false)
  setBinding({ appId: '', storeId: '', purpose: '', externalLocationId: '', authorizationConfirmed: false })
  setCustomPurpose(false)
  secretForm.current?.reset()
  if (!selectedId) return
  const controller = new AbortController()
  setLoadingDetail(true)
  void api<Integration>(root + '/' + selectedId, 'GET', undefined, controller.signal)
   .then(value => { if (!controller.signal.aborted) setDetail(value) })
   .catch(e => { if (!controller.signal.aborted) setError(e.message) })
   .finally(() => { if (!controller.signal.aborted) setLoadingDetail(false) })
  return () => controller.abort()
 }, [root, selectedId])

 useEffect(() => {
  const ids = detail?.bindings?.map(value => value.id) ?? []
  setBindingId(previous => ids.includes(previous) ? previous : ids.length === 1 ? ids[0] : '')
  setAuthorizeCheck(false)
 }, [detail])

 const refresh = async (id = selectedId) => {
  const list = await api<{ integrations: Integration[]; connectionMode: string }>(root)
  setItems(list.integrations)
  setMode(list.connectionMode)
  if (id) setDetail(await api<Integration>(root + '/' + id))
 }
 const notify = (message: string, area: 'connection' | 'overview' | 'key' | 'check' | 'locations' | 'toggle' | 'credential') => {
  setNoticeAt(area); setNotice(message)
 }
 const inlineNotice = (area: 'connection' | 'overview' | 'key' | 'check' | 'locations' | 'toggle' | 'credential') =>
  notice && noticeAt === area ? <p className="portal-notice integration-inline-notice" role="status">{notice}</p> : null
 const run = async (work: () => Promise<void>) => {
  setBusy(true); setError(''); setNotice('')
  try { await work() } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo completar la operación') }
  finally { setBusy(false) }
 }
 const select = (id: string) => {
  setCreating(false); setSelectedId(id); setError(''); setNotice('')
  setRemoveId(''); setEditingKey(false)
 }
 const startNew = () => {
  setCreating(true); setSelectedId(''); setDetail(null)
  setError(''); setNotice(''); setRemoveId(''); setEditingKey(false)
  secretForm.current?.reset()
 }
 const removeConnection = (id: string) => void run(async () => {
  await api(root + '/' + id + '/delete', 'POST', { confirm: true })
  const remaining = items.filter(item => item.id !== id)
  setItems(remaining); setRemoveId('')
  setSelectedId(remaining[0]?.id || '')
  setCreating(false)
  if (!remaining.length) setDetail(null)
  notify('Conexión eliminada de este administrador. No se revocó la clave ni se modificó TU VERSO.', 'connection')
 })
 const saveKey = (event: FormEvent<HTMLFormElement>) => {
  event.preventDefault()
  const dom = event.currentTarget
  const data = new FormData(dom)
  const name = String(data.get('name') || '').trim()
  // El secreto nunca entra en el estado React ni en almacenamiento del navegador.
  const request = {
   token: String(data.get('token') || '').trim(),
   expiresAt: data.get('expires') ? new Date(String(data.get('expires'))).toISOString() : null,
  }
  dom.reset()
  const replacingKey = Boolean(detail?.hasCredential)
  void run(async () => {
   let target = selectedId
   try {
    if (!target) {
     const created = await api<Integration>(root, 'POST', name ? { name } : {})
     target = created.id
    } else if (name && name !== detail?.name) {
     await api(root + '/' + target, 'PUT', { name })
    }
    await api(root + '/' + target + '/credential', 'POST', request)
    setCreating(false); setEditingKey(replacingKey)
    setSelectedId(target)
    await refresh(target)
    notify(replacingKey ? 'Clave actualizada. La credencial anterior ya no se usa en este administrador.' : 'Clave guardada. Ahora vincula una sede autorizada o comprueba la conexión si ya existe una.', replacingKey ? 'key' : 'overview')
   } finally {
    request.token = ''
    if (target && !selectedId) setSelectedId(target)
   }
  })
 }
 const keyForm = (title: string) => (
  <form key={selectedId || 'new'} ref={secretForm} className="portal-form integration-key-form" onSubmit={saveKey}>
   <h3>{title}</h3>
   <p className="portal-muted">Utiliza la clave completa emitida por TU VERSO. No agregues «Bearer» ni cambies su prefijo. Se guarda cifrada y no se vuelve a mostrar.</p>
   <label>Clave de integración
    <input name="token" aria-label="Clave de integración" type="password" autoComplete="off" required minLength={32} maxLength={1024} spellCheck={false} disabled={busy}/>
   </label>
   <details className="integration-details">
    <summary>Nombre y vencimiento (opcionales)</summary>
    <div className="integration-fields">
     <label>Nombre de la conexión<input name="name" defaultValue={detail?.name || ''} maxLength={180} disabled={busy}/></label>
     <label>Vencimiento declarado<input name="expires" type="datetime-local" defaultValue={localDate(detail?.expiresAt || null)} disabled={busy}/></label>
    </div>
   </details>
   <button className="portal-primary" disabled={busy}>{busy ? 'Guardando...' : detail?.hasCredential ? 'Guardar nueva clave' : 'Guardar clave y continuar'}</button>
   {inlineNotice('key')}
  </form>
 )
 if (loading) return <p className="portal-muted">Consultando conexiones...</p>

 return <section aria-label="Integración TU VERSO" className="integration-page">
  <div className="portal-title"><div><h1>Integraciones → TU VERSO</h1>
   <p className="portal-muted">Empresa: <strong>{tenantName}</strong> · TU VERSO autoriza la credencial; este administrador valida empresa, sede y pedido.</p>
  </div></div>
  {error && <p className="portal-error" role="alert">{error}</p>}
 
  {items.length > 0 && <section className="portal-panel integration-selector">
   <div className="integration-heading"><h2>Conexión</h2><button className="portal-outline" type="button" disabled={busy || loadingDetail} onClick={startNew}>Nueva conexión</button></div>
   <label>Selecciona la conexión que quieres administrar
    <select aria-label="Seleccionar conexión" value={creating ? '' : selectedId} disabled={busy || loadingDetail}
     onChange={e => select(e.target.value)}>
     {creating && <option value="">Nueva conexión (sin guardar)</option>}
     {items.map(item => <option value={item.id} key={item.id}>{item.name}</option>)}
    </select>
   </label>
   {inlineNotice('connection')}
  </section>}

  {loadingDetail ? <p className="portal-muted">Cargando configuración...</p> : <>
   {setup && <section className="portal-panel integration-setup">
    <h2>{detail?.hasCredential ? 'Cambiar clave' : '1. Registrar clave de TU VERSO'}</h2>
    {keyForm('Clave para esta conexión')}
    {items.length === 0 && inlineNotice('connection')}
    {inlineNotice('credential')}
   </section>}

   {detail && !detail.hasCredential && !creating && <details className="portal-panel integration-advanced">
    <summary>Eliminar conexión sin configurar</summary>
    <p className="portal-muted">Elimina únicamente esta configuración del administrador. No modifica TU VERSO ni las sedes de la empresa.</p>
    {removeId === selectedId ? <div className="integration-delete-confirm" role="group" aria-label="Confirmar eliminación de conexión">
     <p>¿Eliminar la conexión «{detail.name}»?</p>
     <div className="integration-actions">
      <button className="portal-outline integration-danger" type="button" disabled={busy} onClick={() => removeConnection(selectedId)}>Confirmar eliminación</button>
      <button className="portal-outline" type="button" disabled={busy} onClick={() => setRemoveId('')}>Cancelar</button>
     </div>
    </div> : <button className="portal-outline integration-danger" type="button" disabled={busy} onClick={() => setRemoveId(selectedId)}>Eliminar conexión</button>}
   </details>}

   {detail?.hasCredential && !creating && <>
    <section className="portal-panel integration-overview">
     <div className="integration-heading">
      <h2>Estado de la conexión</h2>
      <span className="integration-status">{statuses[detail.status] || 'Estado desconocido'}</span>
     </div>
     <p className="portal-muted">Última comprobación: {date(detail.lastCheck?.checkedAt || null)}
      {detail.expiresAt ? ' · Vence: ' + date(detail.expiresAt) : ''}</p>
     {detail.status === 'AUTH_ERROR' && <p className="integration-feedback" role="status">TU VERSO rechazó el acceso (HTTP {detail.lastCheck?.httpStatus ?? 'sin respuesta'}). Comprueba que la clave sea válida y que la integración tenga licencia y permisos de consulta. Cambiar el estado local no resolverá este rechazo.</p>}
     {detail.status === 'QUERY_CONNECTED' && <p className="integration-feedback">La última consulta fue autorizada para comprobar disponibilidad. Esto no habilita mensajes ni conversaciones.</p>}
     {detail.status === 'CONFIGURED' && <p className="integration-feedback">La clave está guardada. Comprueba la conexión para confirmar el acceso.</p>}
     {detail.status === 'EXPIRED' && <p className="integration-feedback">El vencimiento registrado ya pasó. Sustituye la credencial vigente antes de consultar.</p>}
     {detail.suspended && <p className="integration-feedback">Esta conexión está desactivada solo en este administrador. TU VERSO no se ha modificado.</p>}
     {detail.lastCheck && !['AUTH_ERROR', 'QUERY_CONNECTED'].includes(detail.status) && <p className="portal-muted">Último intento: {detail.lastCheck.message}</p>}
     {detail.status === 'AUTH_ERROR' && <button className="portal-outline" type="button" disabled={busy} onClick={() => setEditingKey(true)}>Revisar o cambiar clave</button>}
     {detail.lastCheck?.simulation && <p className="portal-muted">El resultado corresponde a una simulación local, no a TU VERSO real.</p>}
     {inlineNotice('overview')}
    </section>

    {editingKey && <section className="portal-panel integration-setup">
     {keyForm('Sustituir clave de esta conexión')}
     <button className="portal-outline" type="button" disabled={busy} onClick={() => setEditingKey(false)}>Cancelar cambio de clave</button>
    </section>}

    <section className="portal-panel integration-scope-panel" aria-label="Autorización de TU VERSO">
     <h2>Autorización de TU VERSO</h2>
     <p className="portal-muted">Los permisos de disponibilidad, solicitudes y mensajes se gestionan en TU VERSO. Aquí solo configuramos la conexión y su sede, sin copiar ni autorizar scopes.</p>
     <p className="portal-muted">Cada operación usa la credencial real. TU VERSO acepta o rechaza el acceso según los permisos vigentes.</p>
    </section>

    <form className="portal-panel portal-form integration-check-panel"
     onSubmit={e => { e.preventDefault(); void run(async () => {
      const result = await api<Check>(root + '/' + selectedId + '/test', 'POST', { bindingId, authorizeCheck })
      await refresh()
      setAuthorizeCheck(false)
      notify(result.message, 'check')
     }) }}>
     <h2>Comprobar disponibilidad</h2>
     {mode === 'DISABLED' && <p className="integration-feedback">Las consultas reales están deshabilitadas en el backend de este entorno. No es un problema de la clave.</p>}
     {mode === 'SIMULATED' && <p className="integration-feedback">Modo de simulación: esta comprobación no se conecta a TU VERSO real.</p>}
     {detail.suspended && <p className="portal-muted">Para volver a comprobar, activa primero esta conexión desde «Acciones avanzadas».</p>}
     {bindings.length === 0 ? <p className="portal-muted">Primero vincula una sede y un propósito autorizados en la sección siguiente.</p> :
      bindings.length === 1 ? <p className="integration-current"><strong>Sede:</strong> {bindings[0].storeName} · {purposeLabel(bindings[0].purpose)}</p> :
      <label>Sede y propósito para consultar
       <select aria-label="Sede para comprobar" required value={bindingId}
        onChange={e => { setBindingId(e.target.value); setAuthorizeCheck(false) }}>
        <option value="">Selecciona una asociación</option>
        {bindings.map(item => <option key={item.id} value={item.id}>{item.storeName} · {purposeLabel(item.purpose)}</option>)}
       </select>
      </label>}
     {bindings.length > 0 && <>
      <label className="integration-check"><input type="checkbox" required checked={authorizeCheck}
       onChange={e => setAuthorizeCheck(e.target.checked)}/>Autorizo una consulta de disponibilidad para esta sede.</label>
      <button className="portal-primary" disabled={busy || mode === 'DISABLED' || detail.suspended || detail.status === 'EXPIRED' || !selectedBinding || !authorizeCheck}>
       {busy ? 'Consultando...' : detail.lastCheck ? 'Probar nuevamente' : 'Probar conexión'}
      </button>
     </>}
     {inlineNotice('check')}
     <p className="portal-muted">La consulta no reserva agentes, crea conversaciones ni confirma pedidos.</p>
     {detail.lastCheck && <details className="integration-details">
      <summary>Ver detalles técnicos de la última consulta</summary>
      <p>HTTP {detail.lastCheck.httpStatus ?? 'sin respuesta'} · {detail.lastCheck.result || detail.lastCheck.errorCode || 'Sin resultado'}</p>
     </details>}
    </form>

    <section className="portal-panel integration-locations">
     <h2>Sedes vinculadas</h2>
     {bindings.length === 0 ? <p className="portal-muted">No hay sedes asociadas a esta conexión. Agrega la primera para poder comprobar disponibilidad.</p> :
      <div className="integration-binding-list">{bindings.map(item => <div className="integration-binding-row" key={item.id}>
       <div><strong>{item.storeName}</strong><small>{item.appId ? 'App: ' + item.appId + ' · ' : 'App sin asignar · '}{purposeLabel(item.purpose)} · Código en TU VERSO: {item.externalLocationId}</small></div>
       {removingBindingId === item.id ?
        <div className="integration-delete-confirm" role="group" aria-label={'Confirmar retirada de ' + item.storeName}>
         <p>¿Retirar esta asociación de este administrador? La sede comercial y TU VERSO no se modificarán.</p>
         <div className="integration-actions">
          <button className="portal-outline" type="button" disabled={busy} onClick={() => void run(async () => {
           await api(root + '/' + selectedId + '/bindings/' + item.id + '/delete', 'POST', { confirm: true })
           setRemovingBindingId(''); await refresh(); notify('Asociación retirada solo de este administrador.', 'locations')
          })}>Sí, retirar asociación</button>
          <button className="portal-outline" type="button" disabled={busy} onClick={() => setRemovingBindingId('')}>Cancelar</button>
         </div>
        </div> :
        <button className="portal-outline" type="button" disabled={busy} onClick={() => setRemovingBindingId(item.id)}>Retirar</button>}
      </div>)}</div>}
     {bindings.length > 0 && !addingBinding && <button className="portal-outline" type="button" disabled={busy} onClick={() => setAddingBinding(true)}>Añadir otra sede</button>}
     {(bindings.length === 0 || addingBinding) && <form className="portal-form integration-bind-form"
      onSubmit={e => { e.preventDefault(); void run(async () => {
       const { externalLocationId, ...required } = binding
       await api(root + '/' + selectedId + '/bindings', 'POST', { ...required, ...(externalLocationId.trim() ? { externalLocationId: externalLocationId.trim() } : {}) })
       setBinding({ appId: '', storeId: '', purpose: '', externalLocationId: '', authorizationConfirmed: false })
       setCustomPurpose(false); setAddingBinding(false)
       await refresh()
       notify('Sede y propósito guardados. Ahora puedes comprobar disponibilidad.', 'locations')
      }) }}>
      <h3>{bindings.length ? 'Añadir asociación' : 'Vincular primera sede'}</h3>
      <div className="integration-fields">
       <label>Aplicación autorizada
        <select aria-label="Aplicación autorizada" required value={binding.appId} disabled={busy}
         onChange={e => setBinding({ ...binding, appId: e.target.value, authorizationConfirmed: false })}>
         <option value="">Selecciona la aplicación</option>
         {apps.map(app => <option key={app.app_id} value={app.app_id}>{app.app_id}</option>)}
        </select>
       </label>
       <label>Sede
        <select aria-label="Sede" required value={binding.storeId} disabled={busy}
         onChange={e => setBinding({ ...binding, storeId: e.target.value, externalLocationId: '', authorizationConfirmed: false })}>
         <option value="">Selecciona una sede</option>
         {stores.map(store => <option key={store.id} value={store.id}>{store.name} · {store.code}</option>)}
        </select>
       </label>
       <label>Tipo de solicitud
        <select aria-label="Propósito" required value={customPurpose ? 'OTHER' : binding.purpose} disabled={busy}
         onChange={e => { setCustomPurpose(e.target.value === 'OTHER'); setBinding({ ...binding, purpose: e.target.value === 'OTHER' ? '' : e.target.value, authorizationConfirmed: false }) }}>
         <option value="">Selecciona un propósito</option>
         <option value="ORDER_REQUEST">Atención de pedidos</option>
         <option value="OTHER">Otro propósito autorizado</option>
        </select>
       </label>
       {customPurpose && <label>Propósito indicado por TU VERSO
        <input required maxLength={80} pattern="[A-Z][A-Z0-9_]*" value={binding.purpose} disabled={busy}
         onChange={e => setBinding({ ...binding, purpose: e.target.value, authorizationConfirmed: false })}/>
       </label>}
      </div>
      {selectedStore && <p className="portal-muted">Código que se utilizará: <strong>{binding.externalLocationId || selectedStore.code}</strong>. Debe coincidir con la sede autorizada en TU VERSO.</p>}
      {selectedStore && <details className="integration-details">
       <summary>Usar un código externo diferente</summary>
       <label>Código de sede registrado en TU VERSO
        <input maxLength={180} value={binding.externalLocationId} disabled={busy}
         onChange={e => setBinding({ ...binding, externalLocationId: e.target.value, authorizationConfirmed: false })}/>
       </label>
      </details>}
      <label className="integration-check"><input type="checkbox" required checked={binding.authorizationConfirmed} disabled={busy}
       onChange={e => setBinding({ ...binding, authorizationConfirmed: e.target.checked })}/>Confirmo que esta sede y propósito ya están autorizados para la clave en TU VERSO.</label>
      <div className="integration-actions">
       <button className="portal-primary" disabled={busy || !binding.authorizationConfirmed || !binding.appId}>Guardar asociación</button>
       {bindings.length > 0 && <button className="portal-outline" type="button" disabled={busy} onClick={() => {
        setAddingBinding(false); setBinding({ appId: '', storeId: '', purpose: '', externalLocationId: '', authorizationConfirmed: false }); setCustomPurpose(false)
       }}>Cancelar</button>}
      </div>
     </form>}
     {inlineNotice('locations')}
    </section>

    <details className="portal-panel integration-advanced">
     <summary>Acciones avanzadas de esta conexión</summary>
     <p className="portal-muted">Estos cambios solo afectan al administrador INTEGRA B2G. No activan ni modifican una cuenta de TU VERSO.</p>
     {!editingKey && <button className="portal-outline" type="button" disabled={busy} onClick={() => setEditingKey(true)}>Cambiar clave guardada</button>}
     {detail.suspended ?
      <div className="integration-action-block"><h3>Conexión desactivada</h3>
       <p className="portal-muted">Activarla permite volver a comprobar disponibilidad. No modifica TU VERSO.</p>
       <button className="portal-outline" type="button" disabled={busy} onClick={() => void run(async () => {
        await api(root + '/' + selectedId + '/suspension', 'POST', { suspended: false })
        await refresh(); setConfirmDeactivate(false)
        notify('Conexión activada en este administrador. Comprueba nuevamente su acceso.', 'toggle')
       })}>Activar conexión con TU VERSO</button>
      </div> :
      <div className="integration-action-block"><h3>Desactivar temporalmente</h3>
       <p className="portal-muted">Dejará de realizar consultas desde este administrador. La clave seguirá guardada y TU VERSO no se desactivará.</p>
       {confirmDeactivate ?
        <div className="integration-delete-confirm" role="group" aria-label="Confirmar desactivación">
         <p>¿Desactivar la conexión únicamente en este administrador?</p>
         <div className="integration-actions">
          <button className="portal-outline" type="button" disabled={busy} onClick={() => void run(async () => {
           await api(root + '/' + selectedId + '/suspension', 'POST', { suspended: true })
           await refresh(); setConfirmDeactivate(false)
           notify('Conexión desactivada en este administrador. TU VERSO no se modificó.', 'toggle')
          })}>Sí, desactivar</button>
          <button className="portal-outline" type="button" disabled={busy} onClick={() => setConfirmDeactivate(false)}>Cancelar</button>
         </div>
        </div> :
        <button className="portal-outline" type="button" disabled={busy} onClick={() => setConfirmDeactivate(true)}>Desactivar conexión con TU VERSO</button>}
       {inlineNotice('toggle')}
      </div>}
     <details className="integration-details integration-action-block">
      <summary>Eliminar solo la clave guardada</summary>
      <p className="portal-muted">La conexión y sus sedes se conservan. Esto no revoca la clave emitida por TU VERSO.</p>
      <label className="integration-check"><input type="checkbox" checked={confirmDelete}
       onChange={e => setConfirmDelete(e.target.checked)}/>Confirmo que quiero eliminar la clave guardada.</label>
      <button className="portal-outline" type="button" disabled={busy || !confirmDelete} onClick={() => void run(async () => {
       await api(root + '/' + selectedId + '/credential-delete', 'POST', { confirm: true })
       setConfirmDelete(false); await refresh()
       notify('Clave eliminada únicamente de este administrador.', 'credential')
      })}>Eliminar clave</button>
      {inlineNotice('credential')}
     </details>
     <div className="integration-action-block">
      <h3>Eliminar esta conexión</h3>
      <p className="portal-muted">Elimina esta configuración local, la clave guardada y sus asociaciones. No borra las sedes comerciales ni revoca claves en TU VERSO.</p>
      {removeId === selectedId ?
       <div className="integration-delete-confirm" role="group" aria-label="Confirmar eliminación de conexión">
        <p>¿Eliminar la conexión «{detail.name}» de este administrador?</p>
        <div className="integration-actions">
         <button className="portal-outline integration-danger" type="button" disabled={busy} onClick={() => removeConnection(selectedId)}>Confirmar eliminación</button>
         <button className="portal-outline" type="button" disabled={busy} onClick={() => setRemoveId('')}>Cancelar</button>
        </div>
       </div> :
       <button className="portal-outline integration-danger" type="button" disabled={busy} onClick={() => setRemoveId(selectedId)}>Eliminar conexión</button>}
     </div>
    </details>
   </>}
  </>}
 </section>
}
