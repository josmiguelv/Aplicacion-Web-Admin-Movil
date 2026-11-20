import { useEffect, useState, type FormEvent } from 'react'
import { Building2, KeyRound, LogOut, Plus, Settings2, ShieldCheck } from 'lucide-react'
import MobileOperations from './MobileOperations'
import TuVersoIntegrations from './TuVersoIntegrations'
import ServiceApiKeys from './ServiceApiKeys'
import './AdminPortal.css'

type Session = { role: 'SUPER_ADMIN' | 'TENANT_ADMIN'; tenantId: string | null }
type Tenant = { id: string; name: string; active: boolean }
type Section = 'companies' | 'operations' | 'integrations' | 'api-keys'

async function api<T>(path: string, method: 'GET' | 'POST' = 'GET', data?: unknown): Promise<T> {
  const response = await fetch(path, {
    method, credentials: 'include', cache: 'no-store',
    headers: data === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const result = await response.json().catch(() => ({ error: 'Respuesta inesperada del servidor' }))
  if (!response.ok) throw new Error(result.error || 'Error HTTP ' + response.status)
  return result as T
}

export default function AdminPortal() {
  const [checking, setChecking] = useState(true)
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [section, setSection] = useState<Section>('companies')
  const [tenants, setTenants] = useState<Tenant[]>([])
  const [loadingTenants, setLoadingTenants] = useState(false)
  const [tenantId, setTenantId] = useState('')
  const [companyName, setCompanyName] = useState('')
  const [adminEmail, setAdminEmail] = useState('')
  const [adminPassword, setAdminPassword] = useState('')

  useEffect(() => {
    let active = true
    void api<Session>('/api/admin/me')
      .then(value => { if (active) { setSession(value); setSection(value.role === 'SUPER_ADMIN' ? 'companies' : 'operations'); setTenantId(value.tenantId || '') } })
      .catch(() => { if (active) setSession(null) })
      .finally(() => { if (active) setChecking(false) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (session?.role !== 'SUPER_ADMIN') { setTenants([]); return }
    let active = true
    setLoadingTenants(true)
    void api<{ tenants: Tenant[] }>('/api/admin/tenants')
      .then(result => { if (active) setTenants(result.tenants) })
      .catch(cause => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudieron consultar las empresas') })
      .finally(() => { if (active) setLoadingTenants(false) })
    return () => { active = false }
  }, [session?.role])

  const execute = async (work: () => Promise<void>) => {
    setBusy(true); setError(''); setNotice('')
    try { await work() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Error inesperado') }
    finally { setBusy(false) }
  }

  const login = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void execute(async () => {
      const result = await api<Session>('/api/admin/login', 'POST', { email: email.trim(), password })
      setPassword('')
      setSession(result)
      setTenantId(result.tenantId || '')
      setSection(result.role === 'SUPER_ADMIN' ? 'companies' : 'operations')
    })
  }

  const logout = () => void execute(async () => {
    await api('/api/admin/logout', 'POST')
    setSession(null); setTenants([]); setTenantId(''); setAdminEmail(''); setAdminPassword('')
    setSection('companies')
  })

  const selectTenant = (id: string, goToOperations = false) => {
    setTenantId(id); setAdminEmail(''); setAdminPassword(''); setError(''); setNotice('')
    if (goToOperations) setSection('operations')
  }

  const createTenant = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void execute(async () => {
      const created = await api<Tenant>('/api/admin/tenants', 'POST', { name: companyName.trim() })
      setTenants(items => [...items, created])
      setCompanyName('')
      selectTenant(created.id)
      setNotice('Empresa creada y guardada. Puedes asignarle un administrador o configurar sus aplicaciones.')
    })
  }

  const createTenantAdmin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!tenantId) return
    void execute(async () => {
      await api('/api/admin/tenants/' + tenantId + '/users', 'POST', { email: adminEmail.trim(), password: adminPassword })
      setAdminEmail(''); setAdminPassword('')
      setNotice('Administrador registrado para la empresa seleccionada.')
    })
  }

  if (checking) return <main className="portal-auth"><p className="portal-muted">Comprobando sesión...</p></main>
  if (!session) return <main className="portal-auth">
    <section className="portal-login" aria-label="Inicio de sesión">
      <div className="portal-brand">INTEGRA <span>B2G</span></div>
      <h1>Administración empresarial</h1>
      <p className="portal-muted">Ingresa con tu cuenta autorizada.</p>
      <form onSubmit={login} className="portal-form">
        <label>Correo electrónico<input type="email" autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} required /></label>
        <label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} required /></label>
        {error && <p className="portal-error" role="alert">{error}</p>}
        <button className="portal-primary" type="submit" disabled={busy}>{busy ? 'Validando...' : 'Iniciar sesión'}</button>
      </form>
      <p className="portal-footnote">Acceso exclusivo a empresas y administradores registrados.</p>
    </section>
  </main>

  const superAdmin = session.role === 'SUPER_ADMIN'
  const selectedTenant = tenants.find(tenant => tenant.id === tenantId)
  return <div className="portal-shell">
    <header className="portal-header">
      <div><div className="portal-brand">INTEGRA <span>B2G</span></div><small>Plataforma administrativa multitenant</small></div>
      <div className="portal-header-right"><span className="portal-role">{superAdmin ? 'Super Administrador' : 'Administrador de empresa'}</span><button className="portal-link" type="button" onClick={logout} disabled={busy}><LogOut size={16} /> Cerrar sesión</button></div>
    </header>
    <div className="portal-body">
      <nav className="portal-nav" aria-label="Administración">
        {superAdmin && <button className={section === 'companies' ? 'portal-tab active' : 'portal-tab'} type="button" onClick={() => { setSection('companies'); setError(''); setNotice('') }}><Building2 size={17} /> Empresas</button>}
        <button className={section === 'operations' ? 'portal-tab active' : 'portal-tab'} type="button" disabled={superAdmin && !tenantId} onClick={() => { setSection('operations'); setError(''); setNotice('') }}><Settings2 size={17} /> Mi negocio</button>
        {superAdmin && <div className="portal-technical-links" role="group" aria-label="Herramientas técnicas">
          <button className={section === 'integrations' ? 'portal-tab active' : 'portal-tab'} type="button" disabled={!tenantId} onClick={() => { setSection('integrations'); setError(''); setNotice('') }}>Conexiones externas</button>
          <button className={section === 'api-keys' ? 'portal-tab active' : 'portal-tab'} type="button" disabled={!tenantId} onClick={() => { setSection('api-keys'); setError(''); setNotice('') }}><KeyRound size={17}/> Claves de acceso</button>
        </div>}
      </nav>
      {error && <p className="portal-error" role="alert">{error}</p>}
      {notice && <p className="portal-notice" role="status">{notice}</p>}
      {superAdmin && section === 'companies' && <main className="portal-content">
        <div className="portal-title"><div><h1>Empresas</h1><p className="portal-muted">Cada empresa administra sus propios locales, productos, precios y aplicaciones. No hay empresas creadas por defecto.</p></div><span className="portal-count">{tenants.length} registradas</span></div>
        <section className="portal-panel">
          <h2><Plus size={18} /> Crear empresa</h2>
          <form className="portal-inline" onSubmit={createTenant}>
            <label>Nombre de la empresa<input placeholder="Ej. Pollos B3" minLength={2} maxLength={180} value={companyName} onChange={event => setCompanyName(event.target.value)} required /></label>
            <button className="portal-primary" type="submit" disabled={busy || companyName.trim().length < 2}>Crear empresa</button>
          </form>
        </section>
        <section className="portal-panel">
          <h2><Building2 size={18} /> Empresas registradas</h2>
          {loadingTenants ? <p className="portal-muted">Consultando empresas...</p> : tenants.length === 0 ? <p className="portal-muted">Todavía no hay empresas. Registra la primera para comenzar.</p> :
            <div className="portal-company-list">{tenants.map(tenant => <div className="portal-company" key={tenant.id}>
              <div><strong>{tenant.name}</strong><small>{tenant.active ? 'Activa' : 'Inactiva'} · Identificador {tenant.id}</small></div>
              <button className="portal-outline" type="button" onClick={() => selectTenant(tenant.id, true)} disabled={!tenant.active}>Administrar</button>
              <button className="portal-outline" type="button" onClick={() => selectTenant(tenant.id)}>Accesos</button>
            </div>)}</div>}
        </section>
        {selectedTenant && <section className="portal-panel">
          <h2><ShieldCheck size={18} /> Administrador de {selectedTenant.name}</h2>
          <p className="portal-muted">La cuenta creada tendrá acceso únicamente a esta empresa. La contraseña debe contener al menos 14 caracteres.</p>
          <form className="portal-inline portal-admin-form" onSubmit={createTenantAdmin}>
            <label>Correo del administrador<input type="email" autoComplete="off" value={adminEmail} onChange={event => setAdminEmail(event.target.value)} required /></label>
            <label>Contraseña inicial<input type="password" autoComplete="new-password" minLength={14} value={adminPassword} onChange={event => setAdminPassword(event.target.value)} required /></label>
            <button className="portal-primary" type="submit" disabled={busy || adminPassword.length < 14}>Crear administrador</button>
          </form>
        </section>}
      </main>}
      {superAdmin && section === 'integrations' && <main className="portal-content">
        <div className="portal-context"><label>Empresa seleccionada<select value={tenantId} onChange={event => selectTenant(event.target.value)}><option value="">Selecciona una empresa</option>{tenants.filter(tenant => tenant.active).map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label></div>
        {selectedTenant ? <TuVersoIntegrations key={tenantId} tenantId={tenantId} tenantName={selectedTenant.name} /> : <div className="portal-panel">Selecciona una empresa registrada para configurar sus integraciones.</div>}
      </main>}
      {superAdmin && section === 'api-keys' && <main className="portal-content">
        <div className="portal-context"><label>Empresa seleccionada<select value={tenantId} onChange={event => selectTenant(event.target.value)}><option value="">Selecciona una empresa</option>{tenants.filter(tenant => tenant.active).map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label></div>
        {selectedTenant ? <ServiceApiKeys key={tenantId} tenantId={tenantId} tenantName={selectedTenant.name} /> : <div className="portal-panel">Selecciona una empresa registrada para gestionar API Keys.</div>}
      </main>}
      {section === 'operations' && <main className="portal-content">
        {superAdmin && <div className="portal-context"><label>Empresa seleccionada<select value={tenantId} onChange={event => selectTenant(event.target.value)}><option value="">Selecciona una empresa</option>{tenants.filter(tenant => tenant.active).map(tenant => <option key={tenant.id} value={tenant.id}>{tenant.name}</option>)}</select></label></div>}
        {tenantId ? <MobileOperations key={tenantId} embeddedSession={session} scopedTenantId={tenantId} /> :
          <div className="portal-panel"><p className="portal-muted">Selecciona una empresa autorizada para administrar sus recursos.</p></div>}
      </main>}
    </div>
  </div>
}
