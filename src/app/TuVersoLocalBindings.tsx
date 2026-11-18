import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { CheckCircle2, Link2, Pencil, Trash2, X } from 'lucide-react'

type Store = { id: string; name: string; code: string; active: boolean }
type Binding = {
  id: string; storeId: string; storeName: string; externalLocationId: string
  channelType: 'MOBILE_APP' | 'WEB'; instanceKey: string
  purpose: string; queueId: string; syncStatus: 'LOCAL_DRAFT'
}
type Draft = { storeId: string; channelType: 'MOBILE_APP' | 'WEB'; instanceKey: string; purpose: string; queueId: string }
const empty: Draft = { storeId: '', channelType: 'MOBILE_APP', instanceKey: '', purpose: 'ORDER_REQUEST', queueId: '' }

async function request<T>(url: string, method = 'GET', payload?: unknown): Promise<T> {
  const response = await fetch(url, {
    method, credentials: 'include', cache: 'no-store',
    headers: payload === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const data = await response.json().catch(() => ({ error: 'Respuesta inesperada' }))
  if (!response.ok) throw new Error(data.error || 'HTTP ' + response.status)
  return data as T
}

export default function TuVersoLocalBindings({ tenantId }: { tenantId: string }) {
  const base = '/api/admin/tenants/' + tenantId
  const [stores, setStores] = useState<Store[]>([])
  const [items, setItems] = useState<Binding[]>([])
  const [draft, setDraft] = useState<Draft>({ ...empty })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const chosen = useMemo(() => stores.find(store => store.id === draft.storeId), [stores, draft.storeId])

  const reload = async () => {
    const [storeResult, bindingResult] = await Promise.all([
      request<{ items: Store[] }>(base + '/stores'),
      request<{ items: Binding[] }>(base + '/tuverso-bindings'),
    ])
    setStores(storeResult.items)
    setItems(bindingResult.items)
  }
  useEffect(() => {
    let current = true
    setLoading(true)
    setError('')
    void Promise.all([
      request<{ items: Store[] }>(base + '/stores'),
      request<{ items: Binding[] }>(base + '/tuverso-bindings'),
    ]).then(([s, b]) => {
      if (current) { setStores(s.items); setItems(b.items) }
    }).catch(reason => {
      if (current) setError(reason instanceof Error ? reason.message : 'No se pudo consultar la configuración')
    }).finally(() => { if (current) setLoading(false) })
    return () => { current = false }
  }, [base])

  const reset = () => {
    setDraft({ ...empty }); setEditingId(null); setRemoveId(null)
  }
  const beginEdit = (item: Binding) => {
    setDraft({
      storeId: item.storeId, channelType: item.channelType,
      instanceKey: item.instanceKey, purpose: item.purpose, queueId: item.queueId,
    })
    setEditingId(item.id); setRemoveId(null); setError(''); setNotice('')
  }
  const save = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!chosen || busy) return
    setBusy(true); setError(''); setNotice('')
    void request(base + '/tuverso-bindings' + (editingId ? '/' + editingId : ''), editingId ? 'PATCH' : 'POST', draft)
      .then(async () => {
        await reload()
        setNotice(editingId ? 'Vínculo local corregido. TU VERSO todavía no se ha actualizado.' : 'Vínculo local preparado. Pendiente de registrar en TU VERSO.')
        reset()
      }).catch(reason => setError(reason instanceof Error ? reason.message : 'No fue posible guardar'))
      .finally(() => setBusy(false))
  }
  const remove = (id: string) => {
    setBusy(true); setError(''); setNotice('')
    void request(base + '/tuverso-bindings/' + id, 'DELETE')
      .then(async () => {
        await reload()
        reset()
        setNotice('Configuración local desvinculada. Si también existe en TU VERSO, debe desvincularse allí por separado.')
      }).catch(reason => setError(reason instanceof Error ? reason.message : 'No se pudo desvincular'))
      .finally(() => setBusy(false))
  }

  return <div className="binding-page">
    <div className="portal-title">
      <div>
        <h1>Vínculos de sedes con TU VERSO</h1>
        <p className="portal-muted">Prepara los vínculos de esta empresa sin escribir códigos de sede a mano.</p>
      </div>
    </div>
    <p className="binding-warning" role="status"><strong>Configuración local únicamente.</strong> Esta pantalla no modifica las cuentas, colas ni vínculos registrados en TU VERSO. Su API documentada no contempla todavía editar o eliminar esas asociaciones desde este administrador.</p>
    {error && <p className="portal-error" role="alert">{error}</p>}
    {notice && <p className="portal-notice" role="status">{notice}</p>}
    <section className="portal-panel">
      <h2><Link2 size={18} /> {editingId ? 'Corregir vínculo local' : 'Preparar vínculo local'}</h2>
      <form className="binding-form" onSubmit={save}>
        <label>Sede registrada
          <select required value={draft.storeId} onChange={event => setDraft(old => ({ ...old, storeId: event.target.value }))}>
            <option value="">Selecciona una sede</option>
            {stores.map(store => <option key={store.id} value={store.id}>{store.name} · {store.code}{store.active ? '' : ' (inactiva)'}</option>)}
          </select>
        </label>
        <label>ID de sede externa (automático)
          <input readOnly aria-label="ID de sede externa" value={chosen?.code || ''} placeholder="Selecciona una sede" />
        </label>
        <label>Canal de atención
          <select value={draft.channelType} onChange={event => setDraft(old => ({ ...old, channelType: event.target.value as Draft['channelType'] }))}>
            <option value="MOBILE_APP">Aplicación móvil</option>
            <option value="WEB">Web</option>
          </select>
        </label>
        <label>Identificador de instancia de TU VERSO
          <input required maxLength={180} placeholder="Ej. tienda-android-prod" value={draft.instanceKey}
            onChange={event => setDraft(old => ({ ...old, instanceKey: event.target.value }))} />
        </label>
        <label>Tipo de solicitud
          <select value={draft.purpose} onChange={event => setDraft(old => ({ ...old, purpose: event.target.value }))}>
            <option value="ORDER_REQUEST">Solicitudes de pedidos</option>
          </select>
        </label>
        <label>UUID de cola independiente en TU VERSO
          <input required pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            placeholder="UUID de la cola autorizada" value={draft.queueId}
            onChange={event => setDraft(old => ({ ...old, queueId: event.target.value }))} />
        </label>
        <p className="portal-muted binding-form-note">La cola se introduce como referencia técnica; no se valida remotamente. Debe pertenecer al tenant y a la cuenta de canal correcta en TU VERSO. El código de la sede comercial no se altera.</p>
        <div className="binding-actions">
          <button type="submit" className="portal-primary" disabled={busy || !chosen}>{busy ? 'Guardando...' : editingId ? 'Guardar corrección' : 'Guardar vínculo local'}</button>
          {editingId && <button type="button" className="portal-outline" onClick={reset} disabled={busy}><X size={15} /> Cancelar edición</button>}
        </div>
      </form>
    </section>
    <section className="portal-panel">
      <h2><CheckCircle2 size={18} /> Vínculos locales guardados</h2>
      {loading ? <p className="portal-muted">Cargando...</p> : items.length === 0 ?
        <p className="portal-muted">Todavía no existen vínculos locales para esta empresa.</p> :
        <div className="binding-list">{items.map(item => <article className="binding-item" key={item.id}>
          <div className="binding-item-header"><strong>{item.storeName}</strong><span className="binding-status">Borrador local</span></div>
          <p className="binding-code">Código: {item.externalLocationId}</p>
          <p className="portal-muted">Canal: {item.channelType === 'MOBILE_APP' ? 'Aplicación móvil' : 'Web'} · Instancia: {item.instanceKey}</p>
          <p className="portal-muted">Solicitud: {item.purpose === 'ORDER_REQUEST' ? 'Solicitudes de pedidos' : item.purpose} · Cola: {item.queueId}</p>
          <div className="binding-actions">
            <button type="button" className="portal-outline" disabled={busy} onClick={() => beginEdit(item)}><Pencil size={15} /> Editar</button>
            <button type="button" className="portal-outline binding-danger" disabled={busy} onClick={() => setRemoveId(item.id)}><Trash2 size={15} /> Desvincular</button>
          </div>
          {removeId === item.id && <div className="binding-confirm">
            <strong>¿Eliminar este vínculo del administrador?</strong>
            <p>No elimina la sede ni sus pedidos. Tampoco cambia vínculos existentes en TU VERSO.</p>
            <div className="binding-actions">
              <button type="button" className="portal-primary binding-danger-solid" disabled={busy} onClick={() => remove(item.id)}>Confirmar desvinculación local</button>
              <button type="button" className="portal-outline" disabled={busy} onClick={() => setRemoveId(null)}>Cancelar</button>
            </div>
          </div>}
        </article>)}</div>}
    </section>
  </div>
}
