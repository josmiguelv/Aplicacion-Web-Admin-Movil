import { useEffect, useState, type FormEvent } from 'react'
import { Check, ClipboardCopy, KeyRound, LockKeyhole, ShieldCheck, X } from 'lucide-react'

type ApiKeyInfo = {
 id: string
 name: string
 prefix: string
 scopes: string[]
 expiresAt: string
 revokedAt: string | null
 createdAt: string
 lastUsedAt: string | null
 status: 'ACTIVE' | 'EXPIRED' | 'REVOKED'
}
type Issued = ApiKeyInfo & { key: string; oneTimeDisplay: true }

async function request<T>(url: string, method = 'GET', data?: unknown): Promise<T> {
 const response = await fetch(url, {
  method, credentials: 'include', cache: 'no-store',
  headers: data === undefined ? undefined : {'Content-Type': 'application/json'},
  body: data === undefined ? undefined : JSON.stringify(data),
 })
 const result = await response.json().catch(() => ({error: 'Respuesta inválida del servidor'}))
 if (!response.ok) throw new Error(result.error || 'HTTP ' + response.status)
 return result as T
}
const date = (v: string | null) => v ? new Date(v).toLocaleString('es-PE') : 'Nunca'
const status = (value: ApiKeyInfo['status']) => ({ACTIVE:'Activa',EXPIRED:'Vencida',REVOKED:'Revocada'})[value]

export default function ServiceApiKeys({tenantId,tenantName}:{tenantId:string;tenantName:string}) {
 const base = '/api/admin/tenants/' + tenantId + '/api-keys'
 const [items,setItems] = useState<ApiKeyInfo[]>([])
 const [name,setName] = useState('')
 const [days,setDays] = useState(90)
 const [issued,setIssued] = useState<Issued|null>(null)
 const [confirmId,setConfirmId] = useState<string|null>(null)
 const [busy,setBusy] = useState(false)
 const [loading,setLoading] = useState(true)
 const [error,setError] = useState('')
 const [message,setMessage] = useState('')
 const [copied,setCopied] = useState(false)

 const reload = async () => {
  const result = await request<{keys:ApiKeyInfo[]}>(base)
  setItems(result.keys)
 }
 useEffect(() => {
  let alive = true
  setItems([]);setIssued(null);setConfirmId(null);setLoading(true);setError('')
  void request<{keys:ApiKeyInfo[]}>(base)
   .then(data => {if(alive)setItems(data.keys)})
   .catch(e => {if(alive)setError(e instanceof Error?e.message:'No se pudieron cargar las claves')})
   .finally(() => {if(alive)setLoading(false)})
  return () => {alive=false}
 },[base])

 const create = (event:FormEvent<HTMLFormElement>) => {
  event.preventDefault()
  if (busy) return
  setError('');setMessage('');setBusy(true);setIssued(null);setCopied(false)
  void request<Issued>(base,'POST',{name:name.trim(),expiresInDays:days,scopes:['catalog.read']})
   .then(async data => {
    setIssued(data)
    setName('')
    await reload()
    setMessage('Clave creada. Cópiala ahora: por seguridad no se podrá consultar nuevamente.')
   }).catch(e => setError(e instanceof Error?e.message:'Error al crear la clave'))
   .finally(() => setBusy(false))
 }
 const revoke = (id:string) => {
  setBusy(true);setError('');setMessage('')
  void request(base+'/'+id+'/revoke','POST',{confirm:true})
   .then(async()=>{
    setConfirmId(null)
    if(issued?.id===id)setIssued(null)
    await reload()
    setMessage('Clave revocada. Desde este momento no autoriza nuevas consultas.')
   }).catch(e=>setError(e instanceof Error?e.message:'No se pudo revocar'))
   .finally(()=>setBusy(false))
 }
 const copy = () => {
  if (!issued?.key)return
  void navigator.clipboard.writeText(issued.key)
   .then(()=>setCopied(true))
   .catch(()=>setError('No se pudo copiar. Selecciona la clave y cópiala manualmente.'))
 }
 return <div className="service-keys">
  <div className="portal-title">
   <div><h1>API Keys de integraciones</h1>
    <p className="portal-muted">Credenciales privadas para servidores autorizados de <strong>{tenantName}</strong>.</p>
   </div>
  </div>
  <p className="service-keys-warning"><LockKeyhole size={17}/>
   Estas claves son exclusivamente para integraciones entre servidores. <strong>No las coloques en Android, JavaScript público ni aplicaciones que distribuyas a clientes.</strong> No reemplazan la clave propia de TU VERSO.</p>
  {error&&<p className="portal-error" role="alert">{error}</p>}
  {message&&<p className="portal-notice" role="status">{message}</p>}
  {issued&&<section className="portal-panel service-issued">
    <h2><KeyRound size={18}/> Clave recién creada · visible una sola vez</h2>
    <p className="portal-muted">Guárdala directamente en las variables privadas del servidor consumidor. Al cerrar esta vista no volverá a mostrarse.</p>
    <div className="service-secret"><input readOnly aria-label="Clave secreta recién emitida" value={issued.key} onFocus={e=>e.currentTarget.select()}/>
      <button className="portal-outline" type="button" onClick={copy}><ClipboardCopy size={16}/>{copied?'Copiada':'Copiar'}</button>
    </div>
    <button className="portal-outline" type="button" onClick={()=>{setIssued(null);setCopied(false)}}><X size={15}/> Ya la guardé</button>
   </section>}
  <section className="portal-panel">
   <h2><KeyRound size={18}/> Generar una API Key</h2>
   <form className="service-key-form" onSubmit={create}>
    <label>Nombre descriptivo
     <input value={name} minLength={3} maxLength={120} onChange={e=>setName(e.target.value)} required placeholder="Ej. Backend del sitio web" />
    </label>
    <label>Vigencia
     <select value={days} onChange={e=>setDays(Number(e.target.value))}>
      <option value={30}>30 días</option>
      <option value={90}>90 días</option>
      <option value={180}>180 días</option>
      <option value={365}>365 días</option>
     </select>
    </label>
    <div><span className="service-label">Permisos autorizados</span><p className="portal-muted"><ShieldCheck size={15}/> <code>catalog.read</code> — lectura de catálogos publicados de esta empresa.</p></div>
    <button className="portal-primary" type="submit" disabled={busy||name.trim().length<3}>{busy?'Procesando...':'Generar clave secreta'}</button>
   </form>
  </section>
  <section className="portal-panel">
   <h2><Check size={18}/> Credenciales registradas</h2>
   {loading?<p className="portal-muted">Consultando credenciales...</p>:items.length===0?<p className="portal-muted">Esta empresa todavía no tiene API Keys.</p>:
    <div className="service-key-list">{items.map(item=><article className="service-key-item" key={item.id}>
     <div className="service-key-head"><strong>{item.name}</strong><span className={'service-badge '+item.status.toLowerCase()}>{status(item.status)}</span></div>
     <div className="service-key-meta">
      <span>Referencia: <code>{item.prefix}…</code></span>
      <span>Vence: {date(item.expiresAt)}</span>
      <span>Último uso: {date(item.lastUsedAt)}</span>
      <span>Permisos: {item.scopes.join(', ')}</span>
     </div>
     {item.status==='ACTIVE'&&<div className="service-key-controls">
      {confirmId!==item.id?<button className="portal-outline service-revoke" type="button" disabled={busy} onClick={()=>setConfirmId(item.id)}>Revocar clave</button>:
       <div className="service-revoke-confirm">
        <p>¿Revocar esta clave? Los sistemas externos que la utilicen perderán el acceso inmediatamente.</p>
        <button className="portal-outline service-revoke" type="button" disabled={busy} onClick={()=>revoke(item.id)}>Confirmar revocación</button>
        <button className="portal-outline" type="button" disabled={busy} onClick={()=>setConfirmId(null)}>Cancelar</button>
       </div>}
      </div>}
    </article>)}</div>}
  </section>
  <p className="portal-muted">Para rotar una clave: crea una nueva, actualiza el servidor autorizado, verifica su funcionamiento y revoca la anterior. El administrador no almacena ni muestra la clave original después de crearla.</p>
 </div>
}
