import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowDownUp, ArrowLeft, ArrowRight, Bell, Blocks, Building2, CalendarDays,
  Check, ChevronDown, ChevronRight, CircleDashed, CircleHelp, Clock3, Cloud, CreditCard,
  FileImage, Globe2, ImagePlus, Info, LayoutDashboard, ListPlus, LockKeyhole,
  Menu, Monitor, MoreHorizontal, Package, Pencil, Plus, Search, Settings2, ShieldCheck,
  ScrollText, Smartphone, Store, Tag, Upload, Users2, WifiOff, X,
} from 'lucide-react'
import MobileOperations from './MobileOperations'
import type { AppRegistration, Product, Promotion, Role, TenantSummary } from '../domain/types'

const navItems = [
  { label: 'Inicio', path: '/', icon: LayoutDashboard },
  { label: 'Catálogo', path: '/catalog', icon: Package },
  { label: 'Promociones', path: '/promotions', icon: Tag },
  { label: 'Publicación', path: '/publication', icon: Cloud },
  { label: 'Aplicaciones', path: '/applications', icon: Smartphone },
  { label: 'Integraciones', path: '/integrations', icon: Blocks },
  { label: 'Configuración', path: '/settings', icon: Settings2 },
  { label: 'Operación móvil', path: '/mobile-operation', icon: Smartphone },
]

const money = (value: number) => new Intl.NumberFormat('es-PE', { style: 'currency', currency: 'PEN' }).format(value)

function BrandMark({ small = false }: { small?: boolean }) {
  return <span className={`brand-mark${small ? ' brand-mark--small' : ''}`} aria-hidden="true"><i /><i /><i /><i /></span>
}

function App() {
  const [role, setRole] = useState<Role>('company')
  const [profileOpen, setProfileOpen] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [products, setProducts] = useState<Product[]>([])
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [apps, setApps] = useState<AppRegistration[]>([])
  const [toast, setToast] = useState('')
  const location = useLocation()
  const navigate = useNavigate()
  const isSuper = role === 'super'

  const notify = (message: string) => {
    setToast(message)
    window.setTimeout(() => setToast(''), 3200)
  }
  const addProduct = (product: Product) => {
    setProducts((current) => [...current, product])
    notify('Producto añadido a esta sesión de prototipo.')
    navigate('/catalog')
  }
  const updateProduct = (product: Product) => setProducts((current) => current.map((item) => item.id === product.id ? product : item))
  const addPromotion = (promotion: Promotion) => {
    setPromotions((current) => [...current, promotion])
    notify('Promoción guardada como borrador local.')
  }
  const addApp = (app: AppRegistration) => {
    setApps((current) => [...current, app])
    notify('Registro añadido solo a esta sesión.')
  }
  const pageTitle = useMemo(() => {
    const active = navItems.find((item) => item.path === location.pathname)
    if (active) return active.label
    if (location.pathname.startsWith('/catalog/new')) return 'Nuevo producto'
    if (location.pathname === '/companies') return 'Empresas'
    if (location.pathname === '/stores') return 'Horarios y disponibilidad'
    return 'Administración'
  }, [location.pathname])

  return (
    <div className="app-shell">
      <div className="prototype-ribbon"><Info size={13} /> Prototipo · los cambios no se publican en canales reales</div>
      <header className="topbar">
        <div className="topbar-main">
          <Link to="/" className="brand-lockup" aria-label="INTEGRA B2G, inicio">
            <BrandMark />
            <span className="brand-name">INTEGRA<span>B2G</span></span>
          </Link>
          {isSuper ? (
            <button className="tenant-switcher" type="button" aria-label="Empresa seleccionada">
              <span className="tenant-dot" /> <span>Pollos B3</span><ChevronDown size={14} />
            </button>
          ) : <div className="tenant-context"><span className="tenant-dot" />Pollos B3</div>}
          <button className="mobile-menu-button" type="button" aria-label="Abrir navegación" aria-expanded={mobileMenu} onClick={() => setMobileMenu((value) => !value)}>
            {mobileMenu ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
        <nav className={`main-nav${mobileMenu ? ' main-nav--open' : ''}`} aria-label="Navegación principal">
          {navItems.map(({ label, path, icon: Icon }) => (
            <NavLink key={path} to={path} end={path === '/'} onClick={() => setMobileMenu(false)} className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}>
              <Icon size={15} strokeWidth={1.8} /><span>{label}</span>
            </NavLink>
          ))}
          {isSuper && <NavLink to="/companies" onClick={() => setMobileMenu(false)} className={({ isActive }) => `nav-link${isActive ? ' nav-link--active' : ''}`}><Building2 size={15} /><span>Empresas</span></NavLink>}
        </nav>
        <div className="topbar-actions">
          <span className="publish-status"><span className="status-dot status-dot--muted" />Sin publicar</span>
          <button className="icon-button notification-button" aria-label="Notificaciones" type="button" onClick={() => notify('No hay notificaciones en este prototipo.')}><Bell size={17} /></button>
          <div className="profile-wrap">
            <button className="profile-button" type="button" aria-expanded={profileOpen} onClick={() => setProfileOpen((value) => !value)}>
              <span className="avatar">{isSuper ? 'I' : 'B3'}</span><span className="profile-label">{isSuper ? 'INTEGRA' : 'Administración'}</span><ChevronDown size={14} />
            </button>
            {profileOpen && <div className="profile-menu" role="menu">
              <div className="profile-menu-head"><strong>Vista de prototipo</strong><span>El cambio de rol es demostrativo</span></div>
              <button type="button" role="menuitem" onClick={() => { setRole('company'); setProfileOpen(false) }}><Store size={15} /> Administrador de empresa {role === 'company' && <Check size={14} />}</button>
              <button type="button" role="menuitem" onClick={() => { setRole('super'); setProfileOpen(false) }}><ShieldCheck size={15} /> Superadministrador {role === 'super' && <Check size={14} />}</button>
            </div>}
          </div>
        </div>
      </header>

      <main className="page-frame">
        <Routes>
          <Route path="/" element={<Dashboard products={products} promotions={promotions} isSuper={isSuper} />} />
          <Route path="/catalog" element={<Catalog products={products} updateProduct={updateProduct} notify={notify} />} />
          <Route path="/catalog/new" element={<ProductForm onSave={addProduct} />} />
          <Route path="/promotions" element={<Promotions promotions={promotions} onAdd={addPromotion} />} />
          <Route path="/publication" element={<Publication products={products} promotions={promotions} notify={notify} />} />
          <Route path="/applications" element={<Applications apps={apps} onAdd={addApp} />} />
          <Route path="/integrations" element={<Integrations />} />
          <Route path="/settings" element={<Settings notify={notify} />} />
          <Route path="/companies/access" element={isSuper ? <AccessManagement /> : <NoPermission />} />
          <Route path="/companies/audit" element={isSuper ? <AuditLog /> : <NoPermission />} />
          <Route path="/companies" element={isSuper ? <Companies notify={notify} /> : <NoPermission />} />
          <Route path="/stores" element={<StoreSettings notify={notify} />} />
          <Route path="/mobile-operation" element={<MobileOperations />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="app-footer"><span>INTEGRA B2G <span className="footer-separator">·</span> Administración comercial</span><span>Prototipo de interfaz, sin conexión a datos reales.</span></footer>
      {toast && <div className="toast" role="status"><Check size={16} />{toast}</div>}
      {location.pathname !== '/catalog/new' && <span className="sr-only" aria-live="polite">{pageTitle}</span>}
    </div>
  )
}

function PageHeading({ eyebrow, title, description, action }: { eyebrow?: string; title: string; description?: string; action?: ReactNode }) {
  return <div className="page-heading"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1>{description && <p>{description}</p>}</div>{action && <div className="heading-action">{action}</div>}</div>
}

function Dashboard({ products, promotions, isSuper }: { products: Product[]; promotions: Promotion[]; isSuper: boolean }) {
  const setupItems = [
    { icon: Package, title: 'Completa tu catálogo', detail: `${products.length} ${products.length === 1 ? 'producto añadido' : 'productos añadidos'} en esta sesión`, path: '/catalog', action: 'Abrir catálogo' },
    { icon: Clock3, title: 'Define tus horarios', detail: 'Configura los días y modalidades de atención', path: '/stores', action: 'Configurar horarios' },
    { icon: Cloud, title: 'Prepara la publicación', detail: 'Revisa canales y vista previa antes de publicar', path: '/publication', action: 'Ver publicación' },
  ]
  return <>
    <PageHeading eyebrow={isSuper ? 'ESPACIO DE ADMINISTRACIÓN' : 'SANTA ANITA · LIMA'} title={isSuper ? 'Vista general' : 'Tu espacio comercial'} description={isSuper ? 'Administra la estructura multitenant y sus canales.' : 'Organiza el contenido que llegará a tus canales digitales.'} />
    <section className="welcome-strip">
      <div className="welcome-copy"><span className="welcome-overline">{isSuper ? 'INTEGRA B2G' : 'POLLOS B3'}</span><h2>{isSuper ? 'Una plataforma. Cada negocio, su propio espacio.' : 'Un catálogo central para todos tus canales.'}</h2><p>{isSuper ? 'Gestiona empresas, aplicaciones y permisos desde un solo lugar.' : 'Prepara productos, promociones y horarios desde una experiencia sencilla.'}</p><Link className="text-link" to={isSuper ? '/companies' : '/catalog'}>{isSuper ? 'Ver empresas' : 'Ir al catálogo'} <ArrowRight size={15} /></Link></div>
      <div className="welcome-mark"><BrandMark small /><span>Comercio<br />conectado</span></div>
    </section>
    <div className="dashboard-columns">
      <section className="setup-section">
        <div className="section-heading"><div><span className="eyebrow">PARA EMPEZAR</span><h2>Configura tu espacio</h2></div><span className="quiet-pill"><CircleDashed size={13} /> Configuración pendiente</span></div>
        <div className="setup-list">{setupItems.map(({ icon: Icon, title, detail, path, action }, index) => <article className="setup-row" key={title}><span className="row-index">0{index + 1}</span><span className="setup-icon"><Icon size={18} /></span><div className="setup-copy"><h3>{title}</h3><p>{detail}</p></div><Link to={path} className="row-link">{action}<ChevronRight size={15} /></Link></article>)}</div>
        <div className="module-summary"><div className="section-heading section-heading--compact"><div><span className="eyebrow">PLATAFORMA</span><h2>Áreas de trabajo</h2></div><span className="small-note">{promotions.length ? `${promotions.length} borradores locales` : 'Sin actividad registrada'}</span></div><div className="module-list">{[{ name: 'Catálogo', detail: 'Productos, categorías y combos', path: '/catalog', icon: Package }, { name: 'Promociones', detail: 'Ofertas, banners y destacados', path: '/promotions', icon: Tag }, { name: 'Aplicaciones', detail: 'Canales móviles por empresa', path: '/applications', icon: Smartphone }, { name: 'Integraciones', detail: 'Conectores y pagos', path: '/integrations', icon: Blocks }].map(({ name, detail, path, icon: Icon }) => <Link to={path} className="module-row" key={name}><span className="module-icon"><Icon size={16} /></span><span className="module-name"><strong>{name}</strong><small>{detail}</small></span><span className="module-state">Por configurar</span><ChevronRight size={15} /></Link>)}</div></div>
      </section>
      <aside className="dashboard-aside">
        <section className="aside-panel publication-panel"><div className="panel-title-row"><span className="aside-icon"><Cloud size={17} /></span><span className="quiet-pill">Borrador</span></div><h3>Publicación</h3><p>El contenido de este espacio todavía no está conectado a canales reales.</p><div className="aside-divider" /><div className="publish-mini-row"><span>Canales conectados</span><strong>0</strong></div><div className="publish-mini-row"><span>Versión publicada</span><strong>—</strong></div><Link to="/publication" className="button button-secondary button-full">Revisar publicación <ArrowRight size={15} /></Link></section>
        <section className="aside-panel help-panel"><div className="help-heading"><CircleHelp size={16} /><h3>Diseñado para crecer</h3></div><p>Cada empresa gestiona su propio contenido, aplicaciones y canales dentro de la plataforma.</p><Link to="/settings" className="text-link">Explorar configuración <ArrowRight size={14} /></Link></section>
      </aside>
    </div>
  </>
}

function Catalog({ products, updateProduct, notify }: { products: Product[]; updateProduct: (product: Product) => void; notify: (message: string) => void }) {
  const [query, setQuery] = useState('')
  const [editing, setEditing] = useState<Product | null>(null)
  const filtered = products.filter((product) => `${product.name} ${product.category}`.toLowerCase().includes(query.toLowerCase()))
  return <>
    <PageHeading eyebrow="CONTENIDO COMERCIAL" title="Catálogo" description="Administra productos y categorías de este espacio." action={<Link to="/catalog/new" className="button button-primary"><Plus size={16} />Añadir producto</Link>} />
    <div className="content-toolbar"><div className="tab-line"><button type="button" className="tab tab--active">Productos <span>{products.length}</span></button><button type="button" className="tab" onClick={() => notify('La gestión de categorías está preparada para conectarse.')}>Categorías</button><button type="button" className="tab" onClick={() => notify('Combos y complementos se administrarán aquí.')}>Combos y complementos</button></div><label className="search-field"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Buscar productos" aria-label="Buscar productos" />{query && <button type="button" aria-label="Limpiar búsqueda" onClick={() => setQuery('')}><X size={14} /></button>}</label></div>
    {filtered.length ? <div className="product-table-wrap"><table className="product-table"><thead><tr><th>Producto</th><th>Categoría</th><th>Precio</th><th>Disponibilidad</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>{filtered.map((product) => <tr key={product.id}><td><div className="product-name-cell">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span className="product-thumb"><Package size={17} /></span>}<span><strong>{product.name}</strong><small>{product.description || 'Sin descripción'}</small></span></div></td><td>{product.category || 'Sin categoría'}</td><td className="price-cell">{money(product.price)}</td><td><button type="button" className={`availability-toggle${product.available ? ' is-on' : ''}`} aria-pressed={product.available} onClick={() => updateProduct({ ...product, available: !product.available })}><span />{product.available ? 'Disponible' : 'Pausado'}</button></td><td><button className="table-action" type="button" aria-label={`Editar ${product.name}`} onClick={() => setEditing(product)}><Pencil size={15} /></button></td></tr>)}</tbody></table>
      <div className="mobile-product-list">{filtered.map((product) => <article className="mobile-product-card" key={product.id}><div className="product-name-cell">{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span className="product-thumb"><Package size={17} /></span>}<span><strong>{product.name}</strong><small>{product.category || 'Sin categoría'}</small></span></div><div className="mobile-product-meta"><strong>{money(product.price)}</strong><button type="button" className="table-action" aria-label={`Editar ${product.name}`} onClick={() => setEditing(product)}><Pencil size={15} /></button></div></article>)}</div>
      </div> : <div className="empty-state"><span className="empty-icon"><Package size={23} /></span><h2>{query ? 'No encontramos resultados' : 'Tu catálogo empieza aquí'}</h2><p>{query ? 'Prueba con otro nombre o categoría.' : 'Aún no hay productos en este espacio. Añade el primero para organizar el contenido de tus canales.'}</p>{!query && <Link className="button button-primary" to="/catalog/new"><Plus size={16} />Añadir primer producto</Link>}</div>}
    <div className="prototype-note"><Info size={15} /><span>Los productos creados solo permanecen durante esta sesión de prototipo y no se publican en Pollos B3.</span></div>
    {editing && <ProductEditDialog product={editing} onClose={() => setEditing(null)} onSave={(product) => { updateProduct(product); setEditing(null) }} />}
  </>
}

function ProductForm({ onSave }: { onSave: (product: Product) => void }) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('')
  const [price, setPrice] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [error, setError] = useState('')
  const readImage = (file?: File) => {
    if (!file) return
    if (!file.type.startsWith('image/')) { setError('Elige un archivo de imagen compatible.'); return }
    if (file.size > 6 * 1024 * 1024) { setError('La imagen no puede superar 6 MB.'); return }
    setError('')
    setImageUrl(URL.createObjectURL(file))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) { setError('Escribe el nombre del producto.'); return }
    const parsedPrice = Number(price.replace(',', '.'))
    if (!price || !Number.isFinite(parsedPrice) || parsedPrice < 0) { setError('Ingresa un precio válido en soles.'); return }
    onSave({ id: crypto.randomUUID(), name: name.trim(), description: description.trim(), category: category.trim(), price: parsedPrice, available: true, imageUrl: imageUrl || undefined })
  }
  return <>
    <button type="button" className="back-link" onClick={() => navigate('/catalog')}><ArrowLeft size={16} />Volver al catálogo</button>
    <PageHeading eyebrow="CATÁLOGO · PRODUCTOS" title="Añadir producto" description="Completa la información que verán tus clientes en los canales publicados." />
    <form className="product-form-layout" onSubmit={submit}>
      <div className="form-main-column">
        <section className="form-section"><div className="form-section-heading"><div><h2>Información del producto</h2><p>Los campos marcados con * son necesarios.</p></div><span className="step-marker">01</span></div>
          <label className="form-field"><span>Nombre del producto <b>*</b></span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Ej. Nombre del producto" maxLength={80} required /><small>Usa un nombre corto y fácil de reconocer.</small></label>
          <label className="form-field"><span>Descripción</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Describe ingredientes, tamaño o características importantes" rows={4} maxLength={400} /><small>{description.length}/400 caracteres</small></label>
          <label className="form-field"><span>Categoría</span><input value={category} onChange={(event) => setCategory(event.target.value)} placeholder="Escribe una categoría" maxLength={60} /></label>
        </section>
        <section className="form-section"><div className="form-section-heading"><div><h2>Precio y disponibilidad</h2><p>El precio se muestra en soles peruanos.</p></div><span className="step-marker">02</span></div>
          <label className="form-field price-input-field"><span>Precio <b>*</b></span><div className="currency-input"><span>S/</span><input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="0.00" aria-label="Precio en soles" required /></div><small>Utiliza el precio vigente para este producto.</small></label>
          <div className="availability-info"><span className="status-dot status-dot--green" /><span><strong>Disponible</strong><small>El producto estará visible cuando se publique el catálogo.</small></span></div>
        </section>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="form-footer"><button type="button" className="button button-quiet" onClick={() => navigate('/catalog')}>Cancelar</button><button className="button button-primary" type="submit"><Check size={16} />Guardar en esta sesión</button></div>
      </div>
      <aside className="image-aside"><div className="form-section-heading"><div><h2>Imagen principal</h2><p>Una buena foto facilita que tus clientes elijan.</p></div><span className="step-marker">03</span></div>
        {imageUrl ? <div className="image-preview"><img src={imageUrl} alt="Vista previa de la imagen del producto" /><button type="button" className="image-remove" aria-label="Quitar imagen" onClick={() => setImageUrl('')}><X size={15} /></button></div> : <label className="upload-zone"><input type="file" accept="image/*" capture="environment" onChange={(event) => readImage(event.target.files?.[0])} /><span className="upload-icon"><ImagePlus size={20} /></span><strong>Sube una fotografía</strong><span>o abre la cámara de tu dispositivo</span><small>JPG, PNG o WebP · hasta 6 MB</small><span className="button button-secondary button-small"><Upload size={14} />Elegir imagen</span></label>}
        <div className="image-guidance"><FileImage size={16} /><p>La imagen es solo una vista previa local. El almacenamiento de archivos se habilitará al conectar la plataforma.</p></div>
      </aside>
    </form>
  </>
}

function ProductEditDialog({ product, onClose, onSave }: { product: Product; onClose: () => void; onSave: (product: Product) => void }) {
  const [name, setName] = useState(product.name)
  const [price, setPrice] = useState(String(product.price))
  const [category, setCategory] = useState(product.category)
  const submit = (event: FormEvent) => { event.preventDefault(); const value = Number(price.replace(',', '.')); if (name.trim() && Number.isFinite(value) && value >= 0) onSave({ ...product, name: name.trim(), price: value, category }) }
  return <Modal title="Editar producto" onClose={onClose}><form className="dialog-form" onSubmit={submit}><label className="form-field"><span>Nombre</span><input value={name} onChange={(event) => setName(event.target.value)} required /></label><label className="form-field"><span>Precio · S/</span><input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} required /></label><label className="form-field"><span>Categoría</span><input value={category} onChange={(event) => setCategory(event.target.value)} /></label><div className="dialog-actions"><button className="button button-quiet" type="button" onClick={onClose}>Cancelar</button><button className="button button-primary" type="submit">Guardar cambios</button></div></form></Modal>
}

function Promotions({ promotions, onAdd }: { promotions: Promotion[]; onAdd: (promotion: Promotion) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [kind, setKind] = useState('Porcentaje de descuento')
  const [error, setError] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); if (!name.trim()) { setError('Escribe un nombre para la promoción.'); return } onAdd({ id: crypto.randomUUID(), name: name.trim(), kind, startsAt: 'Por definir', endsAt: 'Por definir', channels: [], status: 'Borrador' }); setName(''); setError(''); setShowForm(false) }
  return <>
    <PageHeading eyebrow="CONTENIDO COMERCIAL" title="Promociones" description="Prepara descuentos, combos y contenido destacado para tus canales." action={<button className="button button-primary" type="button" onClick={() => setShowForm(true)}><Plus size={16} />Crear promoción</button>} />
    <div className="segmented-tabs"><button className="segment-active" type="button">Todas <span>{promotions.length}</span></button><button type="button">Borradores</button><button type="button">Programadas</button></div>
    {promotions.length ? <div className="promotion-list">{promotions.map((item) => <article className="promotion-row" key={item.id}><span className="promo-icon"><Tag size={18} /></span><div className="promotion-main"><strong>{item.name}</strong><span>{item.kind} <i>·</i> {item.status}</span></div><div className="promotion-dates"><small>Vigencia</small><strong>Por definir</strong></div><span className="quiet-pill">Borrador local</span><button className="table-action" type="button" aria-label={`Más acciones para ${item.name}`}><MoreHorizontal size={17} /></button></article>)}</div> : <div className="empty-state empty-state--compact"><span className="empty-icon"><Tag size={22} /></span><h2>Aún no hay promociones</h2><p>Cuando tengas una oferta lista, podrás definir condiciones, vigencia y canales de publicación.</p><button type="button" className="button button-secondary" onClick={() => setShowForm(true)}><Plus size={15} />Crear primera promoción</button></div>}
    <div className="promotion-types"><div className="section-heading section-heading--compact"><div><span className="eyebrow">TIPOS DE PROMOCIÓN</span><h2>Un formato para cada oferta</h2></div></div><div className="type-list">{[{ icon: Tag, title: 'Descuento', detail: 'Porcentaje o monto fijo' }, { icon: ListPlus, title: 'Combo promocional', detail: 'Productos en una oferta' }, { icon: Globe2, title: 'Contenido destacado', detail: 'Banners y productos destacados' }].map(({ icon: Icon, title, detail }) => <div className="type-item" key={title}><span><Icon size={17} /></span><strong>{title}</strong><small>{detail}</small><ChevronRight size={15} /></div>)}</div></div>
    {showForm && <Modal title="Crear promoción" onClose={() => setShowForm(false)}><form className="dialog-form" onSubmit={submit}><p className="dialog-intro">La promoción quedará como borrador local en esta sesión.</p><label className="form-field"><span>Nombre</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre de la promoción" required /></label><label className="form-field"><span>Tipo</span><select value={kind} onChange={(event) => setKind(event.target.value)}><option>Porcentaje de descuento</option><option>Descuento de importe fijo</option><option>Precio especial</option><option>Combo promocional</option><option>Contenido destacado</option></select></label><div className="date-fields"><label className="form-field"><span>Fecha de inicio</span><input type="date" /></label><label className="form-field"><span>Fecha de término</span><input type="date" /></label></div><label className="form-field"><span>Condiciones</span><textarea rows={2} placeholder="Añade condiciones de la oferta" /></label>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setShowForm(false)}>Cancelar</button><button type="submit" className="button button-primary">Guardar borrador</button></div></form></Modal>}
  </>
}

function Publication({ products, promotions, notify }: { products: Product[]; promotions: Promotion[]; notify: (message: string) => void }) {
  const [stage, setStage] = useState(0)
  const [preview, setPreview] = useState(false)
  const [previewMode, setPreviewMode] = useState<'web' | 'mobile'>('web')
  const [publicationHistory, setPublicationHistory] = useState<Array<{ id: string; version: string; timestamp: string; products: number; promotions: number }>>([])
  const stages = ['Editar', 'Guardar borrador', 'Vista previa', 'Publicar']
  const [channels, setChannels] = useState({ web: false, android: false, ios: false })
  const toggle = (key: keyof typeof channels) => setChannels((current) => ({ ...current, [key]: !current[key] }))
  const simulatePublish = () => {
    const version = `v${String(publicationHistory.length + 1).padStart(2, '0')}`
    const timestamp = new Date().toLocaleString('es-PE', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Lima' })
    setPublicationHistory((current) => [{ id: crypto.randomUUID(), version, timestamp, products: products.length, promotions: promotions.length }, ...current])
    setStage(3)
    notify('Simulación completada. Ningún canal real fue actualizado.')
  }
  return <>
    <PageHeading eyebrow="DISTRIBUCIÓN MULTICANAL" title="Publicación" description="Revisa el catálogo y prepara una versión para tus canales." />
    <div className="publication-banner"><span className="publication-banner-icon"><Cloud size={19} /></span><div><strong>Publicación no conectada</strong><p>Los cambios de este prototipo no se envían a una web ni a una aplicación móvil.</p></div><span className="quiet-pill"><WifiOff size={13} />Sin canales</span></div>
    <section className="publish-flow"><div className="section-heading"><div><span className="eyebrow">FLUJO DE PUBLICACIÓN</span><h2>De la edición a los canales</h2></div><span className="small-note">Cada paso puede revisarse antes de continuar.</span></div><div className="flow-steps">{stages.map((item, index) => <div className={`flow-step${stage === index ? ' flow-step--active' : ''}${stage > index ? ' flow-step--done' : ''}`} key={item}><span className="flow-number">{stage > index ? <Check size={14} /> : `0${index + 1}`}</span><span>{item}</span>{index < stages.length - 1 && <span className="flow-connector" />}</div>)}</div>
      <div className="publish-workspace"><div className="publish-main"><h3>Versión del catálogo</h3><p>Revisa qué contenido incluirías en la próxima publicación.</p><div className="version-card"><span className="version-icon"><Package size={18} /></span><span><strong>Borrador de catálogo</strong><small>{products.length} productos · {promotions.length} promociones</small></span><span className="quiet-pill">Local</span></div><div className="publish-actions">{stage < 1 && <button className="button button-primary" type="button" onClick={() => setStage(1)}><Check size={15} />Guardar borrador</button>}{stage >= 1 && <button className="button button-secondary" type="button" onClick={() => { setStage(2); setPreview(true) }}><Monitor size={15} />Abrir vista previa</button>}{stage >= 2 && <button className="button button-primary" type="button" onClick={simulatePublish}><Cloud size={15} />Simular publicación</button>}<button type="button" className="button button-quiet" onClick={() => setStage(0)}>Reiniciar flujo</button></div></div>
        <aside className="channel-panel"><h3>Canales de destino</h3><p>Selecciona dónde estaría disponible el catálogo.</p>{[{ key: 'web' as const, icon: Globe2, name: 'Sitio web', detail: 'Catálogo web' }, { key: 'android' as const, icon: Smartphone, name: 'Android', detail: 'Aplicación móvil' }, { key: 'ios' as const, icon: Smartphone, name: 'iOS', detail: 'Aplicación móvil' }].map(({ key, icon: Icon, name, detail }) => <label className="channel-choice" key={key}><input type="checkbox" checked={channels[key]} onChange={() => toggle(key)} /><span className="channel-choice-icon"><Icon size={16} /></span><span><strong>{name}</strong><small>{detail}</small></span><span className="channel-state">No conectado</span></label>)}</aside></div>
      <div className="publish-footnote"><LockKeyhole size={14} /><span>En una conexión real, las aplicaciones consultarían el catálogo publicado mediante la API. La identidad de la app no sustituye la autenticación ni los permisos.</span></div>
    </section>
    <section className="history-section"><div className="section-heading section-heading--compact"><div><span className="eyebrow">VERSIONES</span><h2>Historial de publicaciones</h2></div></div>{publicationHistory.length ? <div className="publication-history">{publicationHistory.map((entry) => <article className="publication-history-row" key={entry.id}><span className="version-icon"><Cloud size={16} /></span><div><strong>{entry.version} · Simulación de publicación</strong><small>{entry.timestamp} · {entry.products} productos · {entry.promotions} promociones</small></div><span className="quiet-pill">Solo prototipo</span></article>)}</div> : <div className="history-empty"><CircleDashed size={17} /><span>Aún no hay publicaciones simuladas.</span><small>Los canales reales no están conectados.</small></div>}</section>
    {preview && <Modal title="Vista previa del catálogo" onClose={() => setPreview(false)} wide><div className="preview-demo"><div className="preview-tools"><span className="preview-mode-label">Previsualizar como</span><div className="preview-mode-tabs" role="tablist" aria-label="Formato de vista previa"><button type="button" role="tab" aria-selected={previewMode === 'web'} className={previewMode === 'web' ? 'is-selected' : ''} onClick={() => setPreviewMode('web')}><Monitor size={14} />Web</button><button type="button" role="tab" aria-selected={previewMode === 'mobile'} className={previewMode === 'mobile' ? 'is-selected' : ''} onClick={() => setPreviewMode('mobile')}><Smartphone size={14} />Móvil</button></div></div><div className={`preview-canvas${previewMode === 'mobile' ? ' preview-canvas--mobile' : ''}`}><div className="preview-store-header"><BrandMark small /><div><strong>{previewMode === 'web' ? 'Vista previa web' : 'Vista previa móvil'}</strong><small>Contenido del catálogo · solo prototipo</small></div></div>{products.length ? <div className="preview-product-grid">{products.map((product) => <article className="preview-product" key={product.id}>{product.imageUrl ? <img src={product.imageUrl} alt="" /> : <span className="preview-placeholder"><Package size={21} /></span>}<strong>{product.name}</strong><small>{product.category}</small><b>{money(product.price)}</b></article>)}</div> : <div className="preview-empty"><Package size={22} /><strong>Sin productos para mostrar</strong><span>Añade productos al catálogo para ver una vista previa.</span></div>}</div><div className="preview-disclaimer">Vista de demostración. No representa una tienda activa.</div></div></Modal>}
  </>
}

function Applications({ apps, onAdd }: { apps: AppRegistration[]; onAdd: (app: AppRegistration) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [platform, setPlatform] = useState<'Android' | 'iOS'>('Android')
  const [packageId, setPackageId] = useState('')
  const [error, setError] = useState('')
  const submit = (event: FormEvent) => { event.preventDefault(); if (!name.trim() || !packageId.trim()) { setError('Completa el nombre y el identificador de paquete.'); return } onAdd({ id: crypto.randomUUID(), name: name.trim(), platform, packageId: packageId.trim(), channel: platform }); setName(''); setPackageId(''); setShowForm(false); setError('') }
  return <>
    <PageHeading eyebrow="CANALES MÓVILES" title="Aplicaciones" description="Administra la relación entre cada aplicación y su catálogo." action={<button type="button" className="button button-primary" onClick={() => setShowForm(true)}><Plus size={16} />Registrar aplicación</button>} />
    <div className="info-banner"><Info size={16} /><p>Esta plataforma administra contenido para apps existentes. <strong>No compila ni distribuye archivos APK.</strong> Cada registro es una referencia, no una credencial de seguridad.</p></div>
    <div className="channel-overview"><div className="channel-overview-item"><span className="overview-icon"><Globe2 size={17} /></span><div><strong>Sitio web</strong><small>Canal de publicación</small></div><span className="quiet-pill">Sin configurar</span></div><div className="channel-overview-item"><span className="overview-icon"><Smartphone size={17} /></span><div><strong>Android</strong><small>Aplicación móvil</small></div><span className="quiet-pill">Sin configurar</span></div><div className="channel-overview-item"><span className="overview-icon"><Smartphone size={17} /></span><div><strong>iOS</strong><small>Aplicación móvil</small></div><span className="quiet-pill">Sin configurar</span></div></div>
    <div className="section-heading application-list-heading"><div><span className="eyebrow">REGISTRO</span><h2>Aplicaciones registradas</h2></div><span className="small-note">{apps.length} en esta sesión</span></div>
    {apps.length ? <div className="application-list">{apps.map((app) => <article className="application-row" key={app.id}><span className="app-platform-icon"><Smartphone size={19} /></span><div><strong>{app.name}</strong><small>{app.packageId}</small></div><span className="platform-tag">{app.platform}</span><span className="quiet-pill">Catálogo sin conectar</span><button className="table-action" type="button" aria-label={`Más opciones para ${app.name}`}><MoreHorizontal size={16} /></button></article>)}</div> : <div className="empty-state empty-state--compact"><span className="empty-icon"><Smartphone size={21} /></span><h2>No hay aplicaciones registradas</h2><p>Registra la aplicación para asociarla a un canal y catálogo.</p><button type="button" className="button button-secondary" onClick={() => setShowForm(true)}><Plus size={15} />Registrar aplicación</button></div>}
    {showForm && <Modal title="Registrar aplicación" onClose={() => setShowForm(false)}><form className="dialog-form" onSubmit={submit}><p className="dialog-intro">El registro es temporal y no vincula una app real.</p><label className="form-field"><span>Nombre público</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre de la aplicación" required /></label><label className="form-field"><span>Plataforma</span><select value={platform} onChange={(event) => setPlatform(event.target.value as 'Android' | 'iOS')}><option>Android</option><option>iOS</option></select></label><label className="form-field"><span>Identificador de paquete</span><input value={packageId} onChange={(event) => setPackageId(event.target.value)} placeholder="com.empresa.aplicacion" required /></label>{error && <p className="form-error">{error}</p>}<div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setShowForm(false)}>Cancelar</button><button type="submit" className="button button-primary">Añadir registro</button></div></form></Modal>}
  </>
}

function Integrations() {
  return <>
    <PageHeading eyebrow="CONECTIVIDAD" title="Integraciones" description="Conectores externos, medios de pago y atención al cliente." />
    <div className="info-banner"><ShieldCheck size={16} /><p>Las conexiones no están habilitadas en este prototipo. No se solicitan ni se almacenan credenciales.</p></div>
    <section className="integration-section"><div className="section-heading section-heading--compact"><div><span className="eyebrow">CONECTORES COMERCIALES</span><h2>Sincronización de catálogo</h2></div></div><article className="integration-card"><span className="integration-brand">B</span><div className="integration-detail"><div className="integration-title"><h3>Bitdish</h3><span className="quiet-pill">Previsto</span></div><p>Conector planificado. Las capacidades y el contrato de su API deberán verificarse antes de implementar la integración.</p><div className="integration-tags"><span><ArrowDownUp size={13} />Importación a revisar</span><span><LockKeyhole size={13} />Sin conexión</span></div></div><button type="button" className="button button-secondary" disabled title="Disponible en una fase posterior">Configurar</button></article></section>
    <section className="integration-section"><div className="section-heading section-heading--compact"><div><span className="eyebrow">PAGOS</span><h2>Proveedores de pago</h2></div></div><article className="integration-card"><span className="integration-icon"><CreditCard size={19} /></span><div className="integration-detail"><div className="integration-title"><h3>Proveedor por seleccionar</h3><span className="quiet-pill">No configurado</span></div><p>La pasarela se definirá tras seleccionar un proveedor y revisar su documentación oficial.</p><div className="integration-tags"><span><LockKeyhole size={13} />Credenciales en gestor seguro</span><span><ShieldCheck size={13} />Verificación desde servidor</span></div></div><button type="button" className="button button-secondary" disabled title="Disponible en una fase posterior">Configurar</button></article></section>
    <section className="integration-section"><div className="section-heading section-heading--compact"><div><span className="eyebrow">ATENCIÓN AL CLIENTE</span><h2>Productos independientes</h2></div></div><article className="verso-card"><div className="verso-monogram">TV</div><div><h3>TU VERSO</h3><p>Atención por chat, conversaciones y gestión de agentes. TU VERSO no administra el catálogo y permanece desacoplado de la plataforma comercial.</p><span className="integration-status"><span className="status-dot status-dot--muted" />Canal no conectado</span></div><span className="quiet-pill">Fuera de alcance</span></article></section>
    <div className="integration-footnote"><Info size={15} /><span>Las futuras sincronizaciones deberán revisar los cambios antes de publicarlos y respetar la fuente autorizada de cada campo.</span></div>
  </>
}

function Settings({ notify }: { notify: (message: string) => void }) {
  return <>
    <PageHeading eyebrow="ESPACIO DE EMPRESA" title="Configuración" description="Identidad comercial, pagos y preferencias de este espacio." />
    <div className="settings-layout"><nav className="settings-menu" aria-label="Secciones de configuración"><a className="settings-menu-item active" href="#empresa"><Building2 size={16} />Empresa</a><a className="settings-menu-item" href="#horarios"><Clock3 size={16} />Horarios</a><a className="settings-menu-item" href="#pagos"><CreditCard size={16} />Pagos</a><a className="settings-menu-item" href="#canales"><Globe2 size={16} />Canales</a></nav>
      <div className="settings-content"><section className="settings-panel" id="empresa"><div className="settings-panel-heading"><div><h2>Identidad de empresa</h2><p>Información visible en tus canales digitales.</p></div><span className="quiet-pill">Sin conectar</span></div><div className="settings-fields"><label className="form-field"><span>Nombre público</span><input value="Pollos B3" readOnly /></label><label className="form-field"><span>Ubicación de referencia</span><input value="Santa Anita, Lima, Perú" readOnly /></label><label className="form-field"><span>Zona horaria</span><input value="America/Lima" readOnly /></label></div><div className="settings-footnote"><Info size={14} />Los datos de identidad se muestran como referencia del brief; no se han verificado ni guardado en un sistema real.</div></section>
        <section className="settings-panel" id="horarios"><div className="settings-panel-heading"><div><h2>Horarios de atención</h2><p>Define tus horarios regulares y excepciones.</p></div><Link to="/stores" className="text-link">Editar horarios <ArrowRight size={14} /></Link></div><div className="setting-summary-row"><span className="setting-summary-icon"><Clock3 size={16} /></span><span><strong>Sin horarios configurados</strong><small>Delivery y recojo sin definir</small></span><span className="quiet-pill">Pendiente</span></div></section>
        <section className="settings-panel" id="pagos"><div className="settings-panel-heading"><div><h2>Métodos de pago</h2><p>Las credenciales privadas no se muestran en esta interfaz.</p></div><span className="quiet-pill">No conectado</span></div><div className="payment-methods"><span className="payment-method"><CreditCard size={16} />Tarjeta <small>Por configurar</small></span><span className="payment-method"><Smartphone size={16} />Pago móvil <small>Por configurar</small></span><span className="payment-method"><Store size={16} />Pago al recoger <small>Por configurar</small></span></div><button type="button" className="button button-secondary button-small" onClick={() => notify('Configurar una pasarela requiere una fase backend aprobada.')}>Ver configuración de pagos</button></section>
        <section className="settings-panel" id="canales"><div className="settings-panel-heading"><div><h2>Canales comerciales</h2><p>Comparte el mismo catálogo cuando los canales estén conectados.</p></div></div><div className="setting-summary-row"><span className="setting-summary-icon"><Globe2 size={16} /></span><span><strong>Ningún canal conectado</strong><small>Sitio web, Android y iOS</small></span><Link to="/applications" className="text-link">Ver canales <ArrowRight size={14} /></Link></div></section>
      </div></div>
  </>
}

function StoreSettings({ notify }: { notify: (message: string) => void }) {
  const days = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo']
  const [activeDays, setActiveDays] = useState<string[]>([])
  return <>
    <PageHeading eyebrow="CONFIGURACIÓN COMERCIAL" title="Horarios y disponibilidad" description="Define días y modalidades de atención de la empresa." action={<button className="button button-primary" type="button" onClick={() => notify('Guardado solo durante esta sesión de prototipo.')}>Guardar cambios</button>} />
    <div className="info-banner"><Info size={16} /><p>Sin establecimiento configurado. No se muestra una dirección o sucursal no verificada. Zona horaria de referencia: <strong>America/Lima</strong>.</p></div>
    <div className="hours-layout"><section className="hours-panel"><div className="settings-panel-heading"><div><h2>Horario regular</h2><p>Activa un día para definir un horario.</p></div><span className="quiet-pill">Sin guardar</span></div><div className="hours-list">{days.map((day) => <div className={`hours-row${activeDays.includes(day) ? ' hours-row--active' : ''}`} key={day}><label className="check-control"><input type="checkbox" checked={activeDays.includes(day)} onChange={() => setActiveDays((current) => current.includes(day) ? current.filter((item) => item !== day) : [...current, day])} /><span className="custom-check">{activeDays.includes(day) && <Check size={12} />}</span><strong>{day}</strong></label>{activeDays.includes(day) ? <div className="hour-inputs"><input type="time" aria-label={`${day}, hora de apertura`} /><span>a</span><input type="time" aria-label={`${day}, hora de cierre`} /><button type="button" className="table-action" aria-label={`Añadir tramo para ${day}`}><Plus size={15} /></button></div> : <span className="closed-label">Cerrado</span>}</div>)}</div><div className="hours-note"><Info size={14} />Los horarios no se han configurado y no están disponibles para pedidos.</div></section>
      <aside className="hours-aside"><div className="settings-panel-heading"><div><h2>Modalidades</h2><p>Activa las formas de atención.</p></div></div><label className="toggle-setting"><span className="setting-summary-icon"><Store size={16} /></span><span><strong>Delivery</strong><small>Entrega a domicilio</small></span><input type="checkbox" aria-label="Activar delivery" /></label><label className="toggle-setting"><span className="setting-summary-icon"><Package size={16} /></span><span><strong>Recojo</strong><small>Recojo en establecimiento</small></span><input type="checkbox" aria-label="Activar recojo" /></label><div className="closure-setting"><strong>Mensaje de cierre</strong><textarea rows={3} placeholder="Escribe un mensaje para clientes cuando la tienda esté cerrada" /></div></aside></div>
    <section className="special-hours"><div className="settings-panel-heading"><div><h2>Horarios especiales</h2><p>Fechas con disponibilidad distinta al horario regular.</p></div><button className="button button-secondary button-small" type="button" onClick={() => notify('Añadir horario especial estará disponible al conectar datos.') }><Plus size={14} />Añadir fecha</button></div><div className="history-empty"><CalendarDays size={17} /><span>No hay horarios especiales.</span><small>Añade una fecha solo cuando la configuración esté confirmada.</small></div></section>
  </>
}

type PrototypeTenant = TenantSummary & { timezone?: string; isReference?: boolean }

function AdminSubnav() {
  const items = [
    { label: 'Empresas', path: '/companies', end: true },
    { label: 'Aplicaciones', path: '/applications' },
    { label: 'Canales', path: '/applications' },
    { label: 'Integraciones', path: '/integrations' },
    { label: 'Accesos', path: '/companies/access' },
    { label: 'Auditoría', path: '/companies/audit' },
  ]
  return <nav className="admin-subnav" aria-label="Administración de plataforma">{items.map((item) => <NavLink key={item.label} to={item.path} end={item.end} className={({ isActive }) => `admin-subnav-link${isActive ? ' is-active' : ''}`}>{item.label}</NavLink>)}</nav>
}

function Companies({ notify }: { notify: (message: string) => void }) {
  const [showForm, setShowForm] = useState(false)
  const [name, setName] = useState('')
  const [location, setLocation] = useState('')
  const [timezone, setTimezone] = useState('')
  const [created, setCreated] = useState<PrototypeTenant[]>([])
  const [selected, setSelected] = useState<PrototypeTenant | null>(null)
  const companies: PrototypeTenant[] = [{ id: 'pollos-b3-reference', name: 'Pollos B3', location: 'Santa Anita, Lima, Perú', timezone: 'America/Lima', isReference: true }, ...created]
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!name.trim()) return
    setCreated((current) => [...current, { id: crypto.randomUUID(), name: name.trim(), location: location.trim() || 'No indicada', timezone: timezone.trim() || undefined }])
    setShowForm(false)
    setName('')
    setLocation('')
    setTimezone('')
    notify('Empresa añadida solo a esta sesión de prototipo.')
  }
  return <>
    <AdminSubnav />
    <PageHeading eyebrow="SUPERADMINISTRACIÓN · INTEGRA B2G" title="Empresas" description="Gestiona los espacios de cada negocio en la plataforma." action={<button className="button button-primary" type="button" onClick={() => setShowForm(true)}><Plus size={16} />Crear empresa</button>} />
    <div className="info-banner"><ShieldCheck size={16} /><p>La vista superadministrador es demostrativa. El cambio de rol no otorga permisos de servidor ni acceso a datos reales; las empresas creadas solo se mantienen en esta sesión.</p></div>
    <div className="tenant-summary"><span className="tenant-summary-mark"><Building2 size={19} /></span><div><strong>Espacios empresariales</strong><small>La plataforma está preparada para incorporar más de una empresa.</small></div><span className="quiet-pill">1 referencia · {created.length} local</span></div>
    <div className="company-table"><div className="company-head"><span>Empresa</span><span>Ubicación</span><span>Estado de acceso</span><span>Canales</span><span>Detalle</span></div>{companies.map((company) => <div className="company-row" key={company.id}><div className="company-name"><span className="company-avatar">{company.name.slice(0, 2).toUpperCase()}</span><span><strong>{company.name}</strong><small>{company.isReference ? 'Empresa indicada en el brief' : 'Registro temporal de esta sesión'}</small></span></div><span>{company.location}</span><span><span className="status-inline"><span className="status-dot status-dot--muted" />{company.isReference ? 'No conectado' : 'Solo sesión'}</span></span><span className="company-channels">Sin canales</span><button className="table-action" type="button" aria-label={`Ver detalle de ${company.name}`} onClick={() => setSelected(company)}><ChevronRight size={15} /></button></div>)}</div>
    <div className="prototype-note"><Info size={15} /><span>Pollos B3 se muestra como referencia del brief, no como registro persistido o verificado. Las nuevas filas son datos locales del prototipo.</span></div>
    {selected && <Modal title={`Detalle · ${selected.name}`} onClose={() => setSelected(null)}><div className="dialog-form tenant-detail"><div className="tenant-detail-row"><span>Empresa</span><strong>{selected.name}</strong></div><div className="tenant-detail-row"><span>Ubicación</span><strong>{selected.location}</strong></div><div className="tenant-detail-row"><span>Zona horaria</span><strong>{selected.timezone || 'No indicada'}</strong></div><div className="tenant-detail-row"><span>Canales vinculados</span><strong>Sin canales</strong></div><p className="dialog-intro">{selected.isReference ? 'Referencia tomada del brief; no se ha consultado una cuenta real.' : 'Registro temporal en memoria del navegador; no crea un tenant ni permisos reales.'}</p><button type="button" className="button button-secondary" onClick={() => setSelected(null)}>Cerrar detalle</button></div></Modal>}
    {showForm && <Modal title="Crear empresa" onClose={() => setShowForm(false)}><form className="dialog-form" onSubmit={submit}><p className="dialog-intro">En el producto final, cada empresa tendrá un identificador propio, usuarios, catálogo y canales aislados. Aquí solo se añade una fila temporal.</p><label className="form-field"><span>Nombre comercial</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Nombre de la empresa" required /></label><label className="form-field"><span>Ubicación</span><input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Ubicación, si está confirmada" /></label><label className="form-field"><span>Zona horaria</span><input value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Zona IANA, por ejemplo America/Lima" /></label><div className="dialog-actions"><button type="button" className="button button-quiet" onClick={() => setShowForm(false)}>Cancelar</button><button type="submit" className="button button-primary">Añadir en esta sesión</button></div></form></Modal>}
  </>
}

function AccessManagement() {
  return <>
    <AdminSubnav />
    <PageHeading eyebrow="SUPERADMINISTRACIÓN · INTEGRA B2G" title="Accesos" description="Roles y permisos para los espacios empresariales." />
    <div className="info-banner"><LockKeyhole size={16} /><p>Este prototipo no autentica usuarios ni concede permisos. El control real debe aplicarse en el servidor y auditar los accesos de soporte.</p></div>
    <div className="access-role-list"><article className="access-role-card"><span className="access-role-icon"><ShieldCheck size={18} /></span><div><span className="eyebrow">PLATAFORMA</span><h2>Superadministrador · INTEGRA B2G</h2><p>Gestiona empresas, aplicaciones, canales, integraciones habilitadas y revisión de auditoría. El soporte requiere autorización y registro.</p></div><span className="quiet-pill">Rol previsto</span></article><article className="access-role-card"><span className="access-role-icon"><Store size={18} /></span><div><span className="eyebrow">EMPRESA</span><h2>Administrador de empresa</h2><p>Administra catálogo, promociones, horarios, publicación, pagos e integraciones de su propia empresa; no accede a otros tenants.</p></div><span className="quiet-pill">Rol previsto</span></article></div>
    <section className="access-users"><div className="section-heading section-heading--compact"><div><span className="eyebrow">USUARIOS</span><h2>Administradores con acceso</h2></div><button className="button button-secondary button-small" type="button" disabled title="Los usuarios se gestionarán al conectar autenticación">Invitar administrador</button></div><div className="history-empty"><Users2 size={17} /><span>No hay usuarios conectados.</span><small>El control de acceso se habilitará con autenticación y pertenencia a tenant en servidor.</small></div></section>
  </>
}

function AuditLog() {
  return <>
    <AdminSubnav />
    <PageHeading eyebrow="SUPERADMINISTRACIÓN · INTEGRA B2G" title="Auditoría" description="Registro de cambios y actividad administrativa por empresa." />
    <div className="info-banner"><ScrollText size={16} /><p>El registro de auditoría requiere almacenamiento y autorización de servidor. No se muestran eventos inventados ni operaciones reales en esta vista.</p></div>
    <div className="audit-summary"><div><span className="overview-icon"><Building2 size={17} /></span><strong>Empresa</strong><small>Tenant identificado en servidor</small></div><div><span className="overview-icon"><Users2 size={17} /></span><strong>Actor</strong><small>Usuario y rol autorizados</small></div><div><span className="overview-icon"><Clock3 size={17} /></span><strong>Fecha y acción</strong><small>Registro técnico verificable</small></div></div>
    <section className="access-users"><div className="section-heading section-heading--compact"><div><span className="eyebrow">EVENTOS</span><h2>Actividad registrada</h2></div><span className="quiet-pill">Sin conexión</span></div><div className="history-empty"><CircleDashed size={17} /><span>Aún no hay eventos de auditoría.</span><small>Los cambios críticos aparecerán aquí cuando el servicio esté habilitado.</small></div></section>
  </>
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  return <div className="modal-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><section className={`modal${wide ? ' modal--wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title"><div className="modal-heading"><h2 id="modal-title">{title}</h2><button className="icon-button" type="button" aria-label="Cerrar" onClick={onClose}><X size={18} /></button></div>{children}</section></div>
}

function NotFound() {
  return <div className="empty-state"><span className="empty-icon"><CircleHelp size={22} /></span><h2>Página no disponible</h2><p>Vuelve a una de las áreas de trabajo.</p><Link to="/" className="button button-primary">Ir al inicio</Link></div>
}

function NoPermission() {
  return <div className="empty-state"><span className="empty-icon"><ShieldCheck size={22} /></span><h2>Vista de superadministración</h2><p>Esta sección solo se muestra en el rol de demostración de superadministrador. La protección de acceso real deberá implementarse en el servidor.</p><Link to="/" className="button button-primary">Volver al inicio</Link></div>
}

export default App