import { useEffect, useState, type FormEvent } from 'react'
import { Building2, Check, Copy, CreditCard, Package, Send, Store, Smartphone, ChevronRight, Settings2, UsersRound } from 'lucide-react'

type Session = { role: 'SUPER_ADMIN' | 'TENANT_ADMIN'; tenantId: string | null }
type Tenant = { id: string; name: string; active: boolean }
type DayHours = {open:string;close:string}|{closed:true}
type OpeningHours = Partial<Record<'sun'|'mon'|'tue'|'wed'|'thu'|'fri'|'sat',DayHours>>
const weekdays = [{id:'mon',label:'Lunes'},{id:'tue',label:'Martes'},{id:'wed',label:'Miércoles'},{id:'thu',label:'Jueves'},{id:'fri',label:'Viernes'},{id:'sat',label:'Sábado'},{id:'sun',label:'Domingo'}] as const
type StoreRow = { code: string; opening_hours: OpeningHours|null; id: string; name: string; address: string; active: boolean; delivery_enabled: boolean; pickup_enabled: boolean; dine_in_enabled: boolean; latitude: number | null; longitude: number | null; radius_km: number | null; delivery_rate_per_km_pen: number | null; delivery_fee_pen: number | null; delivery_pricing_mode: 'PER_KM'|'FIXED' }
type ProductRow = {id:string;name:string;description:string;category:string;price_pen:number|string;image_url:string|null;active:boolean}
type PaymentRow = {store_id:string;mode:string;method:string;enabled:boolean}
type PromotionRow = {id:string;title:string;starts_at:string|null;ends_at:string|null;active:boolean}
type AppRow = {id:string;app_id:string;enabled:boolean;published_revision:number;complaints_book_url:string|null}
type AdminUserRow = {id:string;email:string;active:boolean;created_at:string}
type VacancyRow = {id:string;title:string;summary:string;description:string;requirements:string;schedule:string;employment_type:string;location_label:string;image_url:string|null;whatsapp_phone:string;active:boolean}
const modes = [{key:'delivery',name:'Delivery'},{key:'pickup',name:'Recojo'},{key:'dine_in',name:'Comer en tienda'}]
const payments = [{key:'yape',name:'Yape'},{key:'plin',name:'Plin'},{key:'card',name:'Tarjeta'},{key:'cash',name:'Efectivo'}]
type OperationsTab = 'stores'|'catalog'|'payments'|'extras'|'publish'|'access'
const operationTabs = [
 {id:'stores',label:'Locales',subtitle:'Sedes y horarios',icon:Store},
 {id:'catalog',label:'Carta',subtitle:'Productos y promociones',icon:Package},
 {id:'payments',label:'Pagos',subtitle:'Por sede',icon:CreditCard},
 {id:'extras',label:'Más opciones',subtitle:'Vacantes y reclamaciones',icon:Settings2},
 {id:'publish',label:'Publicar',subtitle:'Actualizar aplicaciones',icon:Send},
] as const
async function api<T>(path: string, method: 'GET'|'POST'|'PUT'|'DELETE'='GET', data?:unknown): Promise<T> {
 const res=await fetch(path,{method,credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,cache:'no-store'})
 const result=await res.json().catch(()=>({error:'Respuesta inválida'}))
 if(!res.ok)throw new Error(result.error||`HTTP ${res.status}`)
 return result as T
}

export default function MobileOperations({ embeddedSession, scopedTenantId }: { embeddedSession?: Session; scopedTenantId?: string } = {}){
 const [session,setSession]=useState<Session|null>(embeddedSession??null)
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [activeTab,setActiveTab]=useState<OperationsTab>('stores')
 const [showStoreEditor,setShowStoreEditor]=useState(false)
 const [confirmDeleteStore,setConfirmDeleteStore]=useState(false)
 const [showProductEditor,setShowProductEditor]=useState(false)
 const [feedbackScope,setFeedbackScope]=useState('general')
 const [tenants,setTenants]=useState<Tenant[]>([]),[tenantId,setTenantId]=useState(scopedTenantId??embeddedSession?.tenantId??''),[companyName,setCompanyName]=useState('')
 const [stores,setStores]=useState<StoreRow[]>([]),[products,setProducts]=useState<ProductRow[]>([]),[vacancies,setVacancies]=useState<VacancyRow[]>([])
 const [savedPayments,setSavedPayments]=useState<PaymentRow[]>([])
 const [promotions,setPromotions]=useState<PromotionRow[]>([])
 const [apps,setApps]=useState<AppRow[]>([])
 const [adminUsers,setAdminUsers]=useState<AdminUserRow[]>([])
 const [pendingDelete,setPendingDelete]=useState('')
 const [editingPayment,setEditingPayment]=useState(false)
 const [editingPromoId,setEditingPromoId]=useState('')
 const [showPromoEditor,setShowPromoEditor]=useState(false)
 const [showVacancyEditor,setShowVacancyEditor]=useState(false)
 const [editingUser,setEditingUser]=useState('')
 const [editUserEmail,setEditUserEmail]=useState('')
 const [editUserPassword,setEditUserPassword]=useState('')
 const [editUserActive,setEditUserActive]=useState(true)
 const emptyStore=()=>({id:'',code:'',name:'',address:'',latitude:'',longitude:'',radiusKm:'',deliveryRatePerKmPen:'',deliveryFeePen:'',deliveryPricingMode:'PER_KM' as 'PER_KM'|'FIXED',active:false,delivery_enabled:false,pickup_enabled:false,dine_in_enabled:false,openingHours:{} as OpeningHours})
 const [store,setStore]=useState(emptyStore)
 const emptyProduct=()=>({id:'',name:'',description:'',category:'',pricePen:'',imageUrl:'',active:false})
 const [product,setProduct]=useState(emptyProduct)
 const emptyVacancy=()=>({id:'',title:'',summary:'',description:'',requirements:'',schedule:'',employmentType:'',locationLabel:'',imageUrl:'',whatsappPhone:'',active:false})
 const [vacancy,setVacancy]=useState(emptyVacancy)
 const [paymentStore,setPaymentStore]=useState(''),[paymentMode,setPaymentMode]=useState('delivery'),[paymentMethod,setPaymentMethod]=useState('yape'),[paymentEnabled,setPaymentEnabled]=useState(true)
 const [newTenantEmail,setNewTenantEmail]=useState(''),[newTenantPassword,setNewTenantPassword]=useState('')
 const [promotionTitle,setPromotionTitle]=useState(''),[promotionEnabled,setPromotionEnabled]=useState(false),[promoStarts,setPromoStarts]=useState(''),[promoEnds,setPromoEnds]=useState('')
 const [appId,setAppId]=useState('')
 const [complaintsBookUrl,setComplaintsBookUrl]=useState('')
 const [loading,setLoading]=useState(false)
 const act=async(fn:()=>Promise<void>,scope='general')=>{setFeedbackScope(scope);setLoading(true);setError('');setMessage('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'Error inesperado')}finally{setLoading(false)}}
 const feedback=(scope:string)=>feedbackScope===scope?<>{error&&<p className="ops-error ops-action-feedback" role="alert">{error}</p>}{message&&<p className="ops-success ops-action-feedback" role="status"><Check size={15}/>{message}</p>}</>:null
 const changeTab=(tab:OperationsTab)=>{setActiveTab(tab);setMessage('');setError('');setFeedbackScope('general')}
 useEffect(()=>{if(embeddedSession){setSession(embeddedSession);setTenantId(scopedTenantId??embeddedSession.tenantId??'');return}void api<Session>('/api/admin/me').then(s=>{setSession(s);setTenantId(s.tenantId||'')}).catch(()=>{})},[embeddedSession,scopedTenantId])
 useEffect(()=>{if(!session)return;if(session.role==='SUPER_ADMIN'&&!embeddedSession)void api<{tenants:Tenant[]}>('/api/admin/tenants').then(r=>setTenants(r.tenants)).catch(e=>setError(e.message))},[session])
 const refresh=async(id=tenantId)=>{
  if(!id)return
  const base='/api/admin/tenants/'+id
  const [st,pr,jobs,pm,promo,registered,users]=await Promise.all([
   api<{items:StoreRow[]}>(base+'/stores'),api<{items:ProductRow[]}>(base+'/products'),
   api<{items:VacancyRow[]}>(base+'/vacancies'),api<{items:PaymentRow[]}>(base+'/payments'),
   api<{items:PromotionRow[]}>(base+'/promotions'),api<{items:AppRow[]}>(base+'/apps'),
   session?.role==='SUPER_ADMIN'&&!embeddedSession?api<{items:AdminUserRow[]}>(base+'/users'):Promise.resolve({items:[] as AdminUserRow[]})
  ])
  setStores(st.items);setProducts(pr.items);setVacancies(jobs.items)
  setSavedPayments(pm.items);setPromotions(promo.items);setApps(registered.items);setAdminUsers(users.items)
  const current=registered.items.find(x=>x.app_id===appId)??(registered.items.length===1?registered.items[0]:undefined)
  if(current&&(!appId||!registered.items.some(x=>x.app_id===appId)))setAppId(current.app_id)
  if(current)setComplaintsBookUrl(current.complaints_book_url||'')
 }
 useEffect(()=>{if(session&&tenantId)void refresh(tenantId).catch(e=>{setFeedbackScope('general');setError(e.message)})},[tenantId,session])
 useEffect(()=>{
  setActiveTab('stores');setShowStoreEditor(false);setShowProductEditor(false);setConfirmDeleteStore(false)
  setProduct(emptyProduct());setPendingDelete('');setEditingPayment(false);setEditingPromoId('')
  setShowPromoEditor(false);setShowVacancyEditor(false);setEditingUser('');setMessage('');setError('');setFeedbackScope('general')
  setAppId('');setComplaintsBookUrl('');setSavedPayments([]);setPromotions([]);setApps([]);setAdminUsers([])
 },[tenantId])
 const [copiedStoreCode,setCopiedStoreCode]=useState('')
 const [copyError,setCopyError]=useState('')
 const productPreview=(imageUrl:string|null|undefined)=>{
  if(!imageUrl)return ''
  const matched=imageUrl.match(/^\/api\/v1\/mobile\/images\/([0-9a-f-]{36})$/i)
  return matched?'/api/admin/tenants/'+tenantId+'/images/'+matched[1]:/^https:\/\//.test(imageUrl)?imageUrl:''
 }
 const selectProduct=(item:ProductRow)=>{
  setProduct({id:item.id,name:item.name,description:item.description||'',category:item.category||'',
   pricePen:String(item.price_pen),imageUrl:item.image_url||'',active:item.active})
  setShowProductEditor(true);setMessage('');setError('')
 }
 const copyStoreCode=async(code:string)=>{
  try{await navigator.clipboard.writeText(code);setCopiedStoreCode(code);setCopyError('')}
  catch{setCopyError(code)}
 }
 const paymentKey=(p:PaymentRow)=>p.store_id+':'+p.mode+':'+p.method
 const paymentLabel=(key:string,items:{key:string;name:string}[])=>items.find(x=>x.key===key)?.name||key
 const storeName=(id:string)=>stores.find(x=>x.id===id)?.name||'Sede no disponible'
 const localTimestamp=(iso:string|null)=>{
  if(!iso)return ''
  const d=new Date(iso)
  if(!Number.isFinite(d.getTime()))return ''
  return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,16)
 }
 const selectApp=(app:AppRow)=>{setAppId(app.app_id);setComplaintsBookUrl(app.complaints_book_url||'');setError('');setMessage('')}
 const login=async(e:FormEvent)=>{e.preventDefault();await act(async()=>{const r=await api<{role:Session['role'];tenantId:string|null}>('/api/admin/login','POST',{email,password});setSession(r);setTenantId(r.tenantId||'');setPassword('')})}
 if(!session)return <main className="ops-wrapper"><h1>Administración comercial</h1><p>Inicia sesión con una cuenta verificada en el servidor. El selector de rol de la maqueta no concede permisos.</p><form className="ops-panel ops-form" onSubmit={login}><label>Correo<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="button button-primary" disabled={loading}>Iniciar sesión</button>{error&&<p role="alert" className="ops-error">{error}</p>}</form></main>
 return <div className="ops-wrapper">
  <div className="ops-top"><div><p className="eyebrow">CONFIGURACIÓN COMERCIAL · API REAL</p><h1>Configuración comercial</h1><p>Actualiza locales, carta, pagos y contenido sin perderte entre formularios.</p></div>{!embeddedSession&&<button className="button button-secondary" onClick={()=>void act(async()=>{await api('/api/admin/logout','POST');setSession(null);setTenantId('');setTenants([])})}>Cerrar sesión</button>}</div>
  {feedbackScope==='general'&&feedback('general')}
  {session.role==='SUPER_ADMIN'&&!embeddedSession&&<section className="ops-panel"><h2><Building2 size={19}/> Empresas</h2><div className="ops-inline"><select value={tenantId} onChange={e=>setTenantId(e.target.value)} aria-label="Empresa seleccionada"><option value="">Selecciona una empresa</option>{tenants.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select><input placeholder="Nueva empresa" value={companyName} onChange={e=>setCompanyName(e.target.value)}/><button className="button button-secondary" disabled={!companyName.trim()||loading} onClick={()=>void act(async()=>{const created=await api<Tenant>('/api/admin/tenants','POST',{name:companyName});setTenants(v=>[...v,created]);setTenantId(created.id);setCompanyName('');setMessage('Empresa creada. Debes crear sus usuarios y registrar su aplicación.')},'company')}>Crear empresa</button>{feedback('company')}</div><p className="ops-hint">Cada administrador de empresa tiene permisos limitados a su tenant. Las cuentas deben crearse desde el endpoint autorizado de superadministración.</p></section>}
  {tenantId&&<>
  <div className="ops-dashboard-head">
    <div><span className="ops-eyebrow">GESTIÓN COMERCIAL</span><h2>¿Qué quieres actualizar?</h2><p>Trabaja por secciones. Guardar no publica los cambios hasta que uses Publicar.</p></div>
    <div className="ops-dashboard-stats"><span><strong>{stores.length}</strong> locales</span><span><strong>{products.length}</strong> productos</span></div>
  </div>
  <nav className="ops-task-nav" aria-label="Secciones de configuración comercial">
   {operationTabs.map(tab=><button key={tab.id} type="button" className={'ops-task-tab'+(activeTab===tab.id?' is-active':'')}
    aria-current={activeTab===tab.id?'page':undefined} onClick={()=>changeTab(tab.id)}>
    <tab.icon size={18} aria-hidden="true"/><span><strong>{tab.label}</strong><small>{tab.subtitle}</small></span>
   </button>)}
   {session.role==='SUPER_ADMIN'&&!embeddedSession&&<button type="button" className={'ops-task-tab'+(activeTab==='access'?' is-active':'')}
    aria-current={activeTab==='access'?'page':undefined} onClick={()=>changeTab('access')}><UsersRound size={18}/><span><strong>Usuarios</strong><small>Accesos de empresa</small></span></button>}
  </nav>
  <div className="ops-current-heading">
   <div><span className="ops-eyebrow">ESTÁS EN</span><h2>{({stores:'Locales y horarios',catalog:'Productos y promociones',payments:'Medios de pago',extras:'Más configuraciones',publish:'Publicación',access:'Usuarios de empresa'} as Record<OperationsTab,string>)[activeTab]}</h2></div>
   {activeTab!=='publish'&&<button type="button" className="ops-publish-shortcut" onClick={()=>changeTab('publish')}>Ir a publicación <ChevronRight size={17}/></button>}
  </div>
  {activeTab==='access'&&session.role==='SUPER_ADMIN'&&!embeddedSession&&<section className="ops-panel ops-record-section">
   <h2><UsersRound size={19}/> Administradores de empresa</h2>
   <p>Se muestran los usuarios registrados y su estado. Desactivar acceso cierra sus sesiones y conserva los registros de auditoría.</p>
   {adminUsers.length===0?<p className="ops-empty">No hay administradores registrados para esta empresa.</p>:
    <div className="ops-record-list">{adminUsers.map(account=><div className="ops-record-row" key={account.id}>
     <div className="ops-record-info"><strong>{account.email}</strong>
      <small>Administrador de empresa</small><span className={'ops-record-status'+(account.active?' enabled':'')}>{account.active?'Acceso activo':'Acceso desactivado'}</span>
     </div>
     <div className="ops-record-actions">
      <button type="button" className="button button-secondary" disabled={loading} onClick={()=>{
       setEditingUser(account.id);setEditUserEmail(account.email);setEditUserPassword('');setEditUserActive(account.active);setPendingDelete('');setMessage('');setError('')
      }}>Editar</button>
      {account.active&&<button type="button" className="button button-secondary ops-delete-trigger" disabled={loading}
       onClick={()=>{setPendingDelete('user:'+account.id);setMessage('');setError('')}}>Desactivar acceso</button>}
     </div>
     {pendingDelete==='user:'+account.id&&<div className="ops-delete-confirm" role="group" aria-label={'Confirmar desactivación de '+account.email}>
      <strong>¿Desactivar el acceso de {account.email}?</strong><p>Cerrará las sesiones vigentes. El usuario y su historial se conservarán por seguridad.</p>
      <div className="ops-record-actions">
       <button type="button" className="button button-secondary ops-delete-trigger" disabled={loading} onClick={()=>void act(async()=>{
        await api('/api/admin/tenants/'+tenantId+'/users/'+account.id,'DELETE',{confirm:true})
        if(editingUser===account.id){setEditingUser('');setEditUserPassword('')}
        setPendingDelete('');await refresh();setMessage('Acceso desactivado y sesiones revocadas.')
       },'userDelete')}>Sí, desactivar</button>
       <button type="button" className="button button-secondary" onClick={()=>setPendingDelete('')}>Cancelar</button>
      </div>
     </div>}
    </div>)}</div>}
   {feedback('userDelete')}
   {editingUser&&<div className="ops-record-editor">
    <h3>Editar administrador</h3>
    <div className="ops-grid">
     <label>Correo electrónico<input type="email" value={editUserEmail} onChange={e=>setEditUserEmail(e.target.value)} /></label>
     <label>Nueva contraseña (opcional, mínimo 14 caracteres)<input type="password" value={editUserPassword} autoComplete="new-password" onChange={e=>setEditUserPassword(e.target.value)}/></label>
    </div>
    <label className="ops-check"><input type="checkbox" checked={editUserActive} onChange={e=>setEditUserActive(e.target.checked)}/>Acceso habilitado</label>
    <div className="ops-record-actions">
     <button type="button" className="button button-primary" disabled={loading||!editUserEmail.trim()} onClick={()=>void act(async()=>{
      await api('/api/admin/tenants/'+tenantId+'/users/'+editingUser,'PUT',
       {email:editUserEmail,active:editUserActive,...(editUserPassword?{password:editUserPassword}:{})})
      setEditUserPassword('');await refresh();setMessage('Administrador actualizado. Los cambios de acceso se aplican de inmediato.')
     },'userEdit')}>Guardar cambios</button>
     <button type="button" className="button button-secondary" onClick={()=>{setEditingUser('');setMessage('');setError('')}}>Cerrar</button>
    </div>
    {feedback('userEdit')}
   </div>}
   <details className="ops-advanced"><summary>Crear nuevo administrador</summary>
    <div className="ops-record-editor">
     <label>Correo del nuevo administrador<input type="email" value={newTenantEmail} onChange={e=>setNewTenantEmail(e.target.value)}/></label>
     <label>Contraseña segura (mínimo 14 caracteres)<input type="password" autoComplete="new-password" value={newTenantPassword} onChange={e=>setNewTenantPassword(e.target.value)}/></label>
     <button type="button" className="button button-primary" disabled={loading||!newTenantEmail.trim()||newTenantPassword.length<14} onClick={()=>void act(async()=>{
      await api('/api/admin/tenants/'+tenantId+'/users','POST',{email:newTenantEmail,password:newTenantPassword})
      setNewTenantEmail('');setNewTenantPassword('');await refresh();setMessage('Administrador creado. Ya aparece en la lista.')
     },'access')}>Crear administrador</button>
     {feedback('access')}
    </div>
   </details>
  </section>}
  {activeTab==='stores'&&<section className="ops-panel ops-store-workspace">
 <div className="ops-store-toolbar"><div><h2><Store size={19}/> Locales registrados</h2><p>Elige una sede para editarla o crea un local nuevo.</p></div>
 <button className="button button-primary" type="button" onClick={()=>{setStore(emptyStore());setShowStoreEditor(true);setConfirmDeleteStore(false);setError('');setMessage('')}}>Agregar local</button></div>
 {stores.length>0?<div className="ops-list">{stores.map(s=><div key={s.id} className="ops-store-entry"><button type="button" className="ops-row" onClick={()=>{setStore({id:s.id,code:s.code,name:s.name,address:s.address,latitude:s.latitude===null?'':String(s.latitude),longitude:s.longitude===null?'':String(s.longitude),radiusKm:s.radius_km===null?'':String(s.radius_km),deliveryRatePerKmPen:s.delivery_rate_per_km_pen===null?'':String(s.delivery_rate_per_km_pen),deliveryFeePen:s.delivery_fee_pen===null?'':String(s.delivery_fee_pen),deliveryPricingMode:s.delivery_pricing_mode||'PER_KM',active:s.active,delivery_enabled:s.delivery_enabled,pickup_enabled:s.pickup_enabled,dine_in_enabled:s.dine_in_enabled,openingHours:s.opening_hours||{}});setShowStoreEditor(true);setConfirmDeleteStore(false);setError('');setMessage('')}}><span>{s.name} · ID: {s.code}</span><span>Editar sede</span><small>{s.active?'Activo':'Desactivado'} · D:{s.delivery_enabled?'Sí':'No'} R:{s.pickup_enabled?'Sí':'No'} M:{s.dine_in_enabled?'Sí':'No'}</small></button><button type="button" className="button button-secondary" aria-label={`Copiar ID de ${s.name}`} onClick={()=>void copyStoreCode(s.code)}><Copy size={15}/>{copiedStoreCode===s.code?'Copiado':'Copiar ID'}</button>{copyError===s.code&&<small className="ops-copy-error" role="alert">No se pudo copiar. Selecciona el código y usa Ctrl+C.</small>}</div>)}</div>:<p className="ops-empty">Todavía no hay locales. Agrega el primero para configurar su dirección y horarios.</p>}
 {feedbackScope==='storeDelete'&&!showStoreEditor&&feedback('storeDelete')}
 {(showStoreEditor||stores.length===0)&&<div className="ops-store-editor"><div className="ops-inline"><h3>{store.id?'Editar sede':'Nueva sede'}</h3></div><div className="ops-grid"><div className="ops-store-code"><label>ID de la sede<input aria-label="ID de la sede" value={store.code} readOnly={!!store.id} maxLength={80} placeholder="Ej. b3-nogales" onChange={e=>setStore({...store,code:e.target.value})}/><small>{store.id?'ID permanente: no se puede editar.':'Se define al crear y no podrá cambiarse. Usa minúsculas, números y guiones.'}</small></label><button type="button" className="button button-secondary" disabled={!store.code} onClick={()=>void copyStoreCode(store.code)}><Copy size={15}/> {copiedStoreCode===store.code?'Copiado':'Copiar código'}</button>{copyError===store.code&&<small className="ops-copy-error" role="alert">No se pudo copiar. Selecciona el código y usa Ctrl+C.</small>}</div><label>Local<input value={store.name} onChange={e=>setStore({...store,name:e.target.value})}/></label><label>Dirección verificada<input value={store.address} onChange={e=>setStore({...store,address:e.target.value})}/></label></div><details className="ops-advanced"><summary>Ubicación GPS, cobertura y tarifa de delivery</summary><div className="ops-grid"><label>Latitud GPS<input inputMode="decimal" value={store.latitude} onChange={e=>setStore({...store,latitude:e.target.value})}/></label><label>Longitud GPS<input inputMode="decimal" value={store.longitude} onChange={e=>setStore({...store,longitude:e.target.value})}/></label><label>Cobertura máxima (km, vacío = sin límite)<input type="number" min="0.1" max="500" step="0.1" placeholder="Sin límite" value={store.radiusKm} onChange={e=>setStore({...store,radiusKm:e.target.value})}/></label><label>Modalidad de tarifa de Delivery<select value={store.deliveryPricingMode} onChange={e=>setStore({...store,deliveryPricingMode:e.target.value as 'PER_KM'|'FIXED'})}><option value="PER_KM">Por kilómetro</option><option value="FIXED">Costo fijo de Delivery</option></select></label>{store.deliveryPricingMode==='FIXED'?<label>Costo fijo de Delivery (S/)<input type="number" min="0" step="0.01" placeholder="Ej. 10.00" value={store.deliveryFeePen} onChange={e=>setStore({...store,deliveryFeePen:e.target.value})}/></label>:<label>Tarifa por km de Delivery (S/)<input type="number" min="0" step="0.01" placeholder="Ej. 2.50" value={store.deliveryRatePerKmPen} onChange={e=>setStore({...store,deliveryRatePerKmPen:e.target.value})}/></label>}</div></details><div className="ops-switches">{(['active','delivery_enabled','pickup_enabled','dine_in_enabled'] as const).map(k=><label key={k}><input type="checkbox" checked={store[k]} onChange={e=>setStore({...store,[k]:e.target.checked})}/>{({active:'Local activo',delivery_enabled:'Delivery',pickup_enabled:'Recojo',dine_in_enabled:'Comer en tienda'})[k]}</label>)}</div><details className="ops-advanced ops-hours"><summary>Horarios de atención {Object.keys(store.openingHours).length?'· Configurados':''}</summary><p>Solo los días que completes se mostrarán en la aplicación. Los campos vacíos no se publican. Marca «Cerrado» cuando el local no atienda ese día.</p><div className="ops-grid">{weekdays.map(day=>{const h=store.openingHours[day.id];const closed=!!h&&'closed' in h;const setHours=(next:DayHours|undefined)=>setStore(prev=>{const hours={...prev.openingHours};if(next)hours[day.id]=next;else delete hours[day.id];return {...prev,openingHours:hours}});return <div key={day.id} className="ops-row"><strong>{day.label}</strong><label className="ops-check"><input type="checkbox" checked={closed} onChange={e=>setHours(e.target.checked?{closed:true}:undefined)}/>Cerrado</label><label>Apertura<input type="time" disabled={closed} value={h&&!closed&&'open' in h?h.open:''} onChange={e=>{const v=e.target.value;if(!v){setHours(undefined);return}setHours({open:v,close:h&&!closed&&'close' in h?h.close:''})}}/></label><label>Cierre<input type="time" disabled={closed} value={h&&!closed&&'close' in h?h.close:''} onChange={e=>{const v=e.target.value;if(!v){setHours(undefined);return}setHours({open:h&&!closed&&'open' in h?h.open:'',close:v})}}/></label></div>})}</div></details><button className="button button-primary" disabled={loading} onClick={()=>void act(async()=>{if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(store.code)||store.code.length<2||store.code.length>80)throw new Error('Completa el ID de la sede con minúsculas, números y guiones (2 a 80 caracteres)');const saved=await api<StoreRow>(`/api/admin/tenants/${tenantId}/stores`,'POST',{...store,openingHours:Object.keys(store.openingHours).length?store.openingHours:null,latitude:store.latitude?Number(store.latitude):null,longitude:store.longitude?Number(store.longitude):null,radiusKm:store.radiusKm===''?null:Number(store.radiusKm),deliveryRatePerKmPen:store.deliveryPricingMode==='PER_KM'&&store.deliveryRatePerKmPen!==''?Number(store.deliveryRatePerKmPen):null,deliveryFeePen:store.deliveryPricingMode==='FIXED'&&store.deliveryFeePen!==''?Number(store.deliveryFeePen):null});setStore(v=>({...v,id:saved.id,code:saved.code}));await refresh();setMessage('Sede guardada. El ID permanece fijo; puedes editar los demás datos.')},'store')}>Guardar local</button>{feedback('store')}
 {store.id&&<div className="ops-store-danger">
  {!confirmDeleteStore?<button className="button button-secondary ops-delete-trigger" type="button" disabled={loading}
    onClick={()=>{setConfirmDeleteStore(true);setError('');setMessage('')}}>Eliminar local</button>
   : <div className="ops-delete-confirm" role="group" aria-label="Confirmar eliminación de local">
      <strong>¿Eliminar «{store.name}» definitivamente?</strong>
      <p>Se eliminarán el local y sus medios de pago configurados. Si tiene asociaciones con TU VERSO, la eliminación se bloqueará. El local seguirá visible en Android hasta que publiques nuevamente.</p>
      <div className="ops-inline">
       <button className="button button-secondary ops-delete-trigger" type="button" disabled={loading}
        onClick={()=>void act(async()=>{
         await api('/api/admin/tenants/'+tenantId+'/stores/'+store.id,'DELETE',{confirm:true})
         setConfirmDeleteStore(false);setShowStoreEditor(false);setStore(emptyStore())
         await refresh();setMessage('Local eliminado. Entra a Publicar cambios para retirarlo de la aplicación.')
        },'storeDelete')}>Sí, eliminar local</button>
       <button className="button button-secondary" type="button" disabled={loading}
        onClick={()=>{setConfirmDeleteStore(false);setError('');setMessage('')}}>Cancelar</button>
      </div>
      {feedbackScope==='storeDelete'&&feedback('storeDelete')}
     </div>}
 </div>}
 </div>}
 </section>}
  {activeTab==='catalog'&&<section className="ops-panel ops-products-workspace">
   <div className="ops-store-toolbar"><div><h2><Package size={19}/> Productos guardados</h2>
    <p>Consulta los productos, revisa sus imágenes y edítalos antes de publicarlos.</p></div>
    <button className="button button-primary" type="button" disabled={loading}
     onClick={()=>{setProduct(emptyProduct());setShowProductEditor(true);setMessage('');setError('')}}>Agregar producto</button>
   </div>
   <div className="ops-product-list">
    {products.length===0?<p className="ops-empty">Todavía no hay productos. Puedes registrar el primero.</p>:
     products.map(item=><article className="ops-product-card" key={item.id}>
      <div className="ops-product-photo">
       {productPreview(item.image_url)?<img src={productPreview(item.image_url)} alt={'Foto de '+item.name} loading="lazy"/>:<span>Sin fotografía</span>}
      </div>
      <div className="ops-product-info">
       <strong>{item.name}</strong><small>{item.category||'Sin categoría'}</small>
       <b>S/ {Number(item.price_pen).toFixed(2)}</b>
       <span className={item.active?'ops-product-status active':'ops-product-status'}>
        {item.active?'Disponible · pendiente de publicación':'No disponible'}
       </span>
      </div>
      <div className="ops-record-actions">
       <button className="button button-secondary" type="button" onClick={()=>selectProduct(item)}>Editar</button>
       <button className="button button-secondary ops-delete-trigger" type="button" disabled={loading}
        onClick={()=>{setPendingDelete('product:'+item.id);setMessage('');setError('')}}>Eliminar</button>
      </div>
      {pendingDelete==='product:'+item.id&&<div className="ops-delete-confirm" role="group" aria-label={'Confirmar eliminación de '+item.name}>
       <strong>¿Eliminar «{item.name}»?</strong><p>Se retira del administrador; la aplicación recibirá el cambio al publicar.</p>
       <div className="ops-record-actions">
        <button type="button" className="button button-secondary ops-delete-trigger" disabled={loading} onClick={()=>void act(async()=>{
         await api('/api/admin/tenants/'+tenantId+'/products/'+item.id,'DELETE',{confirm:true})
         if(product.id===item.id){setProduct(emptyProduct());setShowProductEditor(false)}
         setPendingDelete('');await refresh();setMessage('Producto eliminado. Publica los cambios cuando corresponda.')
        },'productDelete')}>Sí, eliminar</button>
        <button type="button" className="button button-secondary" onClick={()=>setPendingDelete('')}>Cancelar</button>
       </div>
      </div>}
     </article>)}
   </div>
   {feedback('productDelete')}
   {(showProductEditor||products.length===0)&&<div id="ops-product-editor" className="ops-store-editor">
    <div className="ops-section-toolbar"><h3>{product.id?'Editar producto':'Nuevo producto'}</h3>
     {products.length>0&&<button type="button" className="button button-secondary" onClick={()=>{setProduct(emptyProduct());setShowProductEditor(false);setMessage('');setError('')}}>Cerrar edición</button>}
    </div>
    <div className="ops-grid">
     <label>Nombre<input value={product.name} maxLength={180} onChange={e=>setProduct({...product,name:e.target.value})}/></label>
     <label>Categoría<input value={product.category} onChange={e=>setProduct({...product,category:e.target.value})}/></label>
     <label>Precio (S/)<input type="number" step="0.01" min="0" value={product.pricePen}
      onChange={e=>setProduct({...product,pricePen:e.target.value})}/></label>
     <label>Descripción<input value={product.description} onChange={e=>setProduct({...product,description:e.target.value})}/></label>
     <label>Fotografía del producto<input type="file" accept="image/png,image/jpeg,image/webp"
      onChange={e=>{const file=e.target.files?.[0];if(!file)return;void act(async()=>{
       const response=await fetch('/api/admin/tenants/'+tenantId+'/images',{method:'POST',credentials:'include',body:file})
       const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo subir la fotografía')
       setProduct(p=>({...p,imageUrl:data.url}))
       setMessage('Fotografía cargada. Guarda el producto para conservar el cambio.')
      },'productImage')}}/>
      {feedback('productImage')}
     </label>
    </div>
    <div className="ops-product-preview">
     <div className="ops-product-photo">
      {productPreview(product.imageUrl)?<img src={productPreview(product.imageUrl)} alt="Vista previa del producto" />:<span>Sin fotografía</span>}
     </div>
     <div><small>VISTA PREVIA EN EL ADMINISTRADOR</small>
      <strong>{product.name||'Nombre del producto'}</strong>
      <b>{product.pricePen!==''?'S/ '+Number(product.pricePen).toFixed(2):'Precio sin definir'}</b>
      <small>Esta vista previa no publica el producto en Android.</small></div>
    </div>
    <label className="ops-check"><input type="checkbox" checked={product.active}
      onChange={e=>setProduct({...product,active:e.target.checked})}/>Producto disponible al publicar</label>
    <button className="button button-primary" type="button" disabled={loading} onClick={()=>void act(async()=>{
     if(!product.name.trim()||product.pricePen==='')throw new Error('Completa el nombre y precio.')
     const wasEditing=Boolean(product.id)
     const saved=await api<ProductRow>('/api/admin/tenants/'+tenantId+'/products','POST',
      {...product,pricePen:Number(product.pricePen)})
     await refresh()
     setProduct({...product,id:saved.id})
     setMessage(wasEditing?'Producto actualizado. Revisa su tarjeta y publica cuando corresponda.':'Producto guardado. Ya aparece en la lista; publica cuando quieras mostrarlo en Android.')
    },'product')}>{product.id?'Guardar cambios':'Guardar producto'}</button>
    {feedback('product')}
   </div>}
  </section>}
  {activeTab==='extras'&&<section className="ops-panel ops-record-section">
   <div className="ops-store-toolbar"><div><h2><Store size={19}/> Vacantes registradas</h2>
    <p>Consulta las vacantes, cambia sus datos o retíralas antes de publicar.</p></div>
    <button type="button" className="button button-secondary" onClick={()=>{setVacancy(emptyVacancy());setShowVacancyEditor(true);setMessage('');setError('')}}>Agregar vacante</button>
   </div>
   {vacancies.length===0?<p className="ops-empty">No hay vacantes guardadas.</p>:
    <div className="ops-record-list">{vacancies.map(job=><div className="ops-record-row" key={job.id}>
     <div className="ops-record-info"><strong>{job.title}</strong>
      <small>{job.location_label||'Sin sede definida'} · {job.active?'Activa al publicar':'Inactiva'}</small></div>
     <div className="ops-record-actions">
      <button type="button" className="button button-secondary" onClick={()=>{
       setVacancy({id:job.id,title:job.title,summary:job.summary,description:job.description,requirements:job.requirements,
        schedule:job.schedule,employmentType:job.employment_type,locationLabel:job.location_label,
        imageUrl:job.image_url||'',whatsappPhone:job.whatsapp_phone,active:job.active})
       setShowVacancyEditor(true);setMessage('');setError('')
      }}>Editar</button>
      <button type="button" className="button button-secondary ops-delete-trigger" disabled={loading}
       onClick={()=>{setPendingDelete('vacancy:'+job.id);setMessage('');setError('')}}>Eliminar</button>
     </div>
     {pendingDelete==='vacancy:'+job.id&&<div className="ops-delete-confirm" role="group" aria-label={'Confirmar eliminación de vacante '+job.title}>
      <strong>¿Eliminar «{job.title}»?</strong><p>Dejará de estar disponible al publicar los cambios.</p>
      <div className="ops-record-actions">
       <button type="button" className="button button-secondary ops-delete-trigger" disabled={loading} onClick={()=>void act(async()=>{
        await api('/api/admin/tenants/'+tenantId+'/vacancies/'+job.id,'DELETE',{confirm:true})
        if(vacancy.id===job.id){setVacancy(emptyVacancy());setShowVacancyEditor(false)}
        setPendingDelete('');await refresh();setMessage('Vacante eliminada. Publica los cambios cuando corresponda.')
       },'vacancyDelete')}>Sí, eliminar</button>
       <button type="button" className="button button-secondary" onClick={()=>setPendingDelete('')}>Cancelar</button>
      </div>
     </div>}
    </div>)}</div>}
   {feedback('vacancyDelete')}
   {(showVacancyEditor||vacancies.length===0)&&<div className="ops-record-editor">
    <h3>{vacancy.id?'Editar vacante':'Nueva vacante'}</h3>
    <div className="ops-grid">
    <label>Puesto<input maxLength={150} value={vacancy.title} onChange={e=>setVacancy({...vacancy,title:e.target.value})} placeholder="Ej. Horneros con experiencia"/></label>
    <label>Sede o zona<input maxLength={150} value={vacancy.locationLabel} onChange={e=>setVacancy({...vacancy,locationLabel:e.target.value})} placeholder="Ej. Santa Anita"/></label>
    <label>Teléfono WhatsApp para postulaciones<input inputMode="tel" value={vacancy.whatsappPhone} onChange={e=>setVacancy({...vacancy,whatsappPhone:e.target.value})} placeholder="9XXXXXXXX"/></label>
    <label>Modalidad<input maxLength={150} value={vacancy.employmentType} onChange={e=>setVacancy({...vacancy,employmentType:e.target.value})} placeholder="Ej. Full time"/></label>
    <label>Horario<input maxLength={200} value={vacancy.schedule} onChange={e=>setVacancy({...vacancy,schedule:e.target.value})}/></label>
    <label>Imagen de la vacante<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;void act(async()=>{const response=await fetch(`/api/admin/tenants/${tenantId}/images`,{method:'POST',credentials:'include',body:file});const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo subir la imagen');setVacancy(v=>({...v,imageUrl:data.url}));setMessage('Imagen cargada. Guarda la vacante y publica el catálogo.')},'vacancyImage')}}/>{feedback('vacancyImage')}</label>
    <label>Imagen cargada<input value={vacancy.imageUrl} readOnly/></label>
    <label>Descripción breve<textarea maxLength={500} value={vacancy.summary} onChange={e=>setVacancy({...vacancy,summary:e.target.value})}/></label>
    <label>Descripción del puesto<textarea maxLength={5000} value={vacancy.description} onChange={e=>setVacancy({...vacancy,description:e.target.value})}/></label>
    <label>Requisitos (uno por línea)<textarea maxLength={5000} value={vacancy.requirements} onChange={e=>setVacancy({...vacancy,requirements:e.target.value})}/></label>
   </div>
   {vacancy.imageUrl&&<img src={productPreview(vacancy.imageUrl)} alt="Vista previa de la vacante" style={{width:150,maxHeight:180,objectFit:'contain',borderRadius:12}}/>}
   <label className="ops-check"><input type="checkbox" checked={vacancy.active} onChange={e=>setVacancy({...vacancy,active:e.target.checked})}/>Vacante activa (visible al publicar)</label>
   <div className="ops-inline"><button className="button button-primary" disabled={loading||!vacancy.title.trim()||!vacancy.whatsappPhone.trim()} onClick={()=>void act(async()=>{const saved=await api<VacancyRow>(`/api/admin/tenants/${tenantId}/vacancies`,'POST',vacancy);setVacancy(v=>({...v,id:saved.id}));await refresh();setMessage('Vacante guardada. Puedes editarla o publicarla cuando corresponda.')},'vacancy')}>{vacancy.id?'Guardar cambios':'Guardar vacante'}</button>{feedback('vacancy')}
    <button className="button button-secondary" type="button" onClick={()=>{setVacancy(emptyVacancy());setShowVacancyEditor(true);setMessage('');setError('')}}>Nueva vacante</button>
     {vacancies.length>0&&<button className="button button-secondary" type="button" onClick={()=>{setShowVacancyEditor(false);setMessage('');setError('')}}>Cerrar edición</button>}
   </div>

   </div>}
  </section>}
  {activeTab==='catalog'&&<section className="ops-panel ops-record-section">
   <div className="ops-store-toolbar"><div><h2>Promociones</h2><p>Revisa las promociones guardadas. Publica para hacerlas visibles en la aplicación.</p></div>
    <button type="button" className="button button-secondary" disabled={loading}
     onClick={()=>{setEditingPromoId('');setPromotionTitle('');setPromotionEnabled(false);setPromoStarts('');setPromoEnds('');setShowPromoEditor(true);setPendingDelete('');setMessage('');setError('')}}>Agregar promoción</button>
   </div>
   {promotions.length===0?<p className="ops-empty">No hay promociones guardadas.</p>:
    <div className="ops-record-list">{promotions.map(p=><div className="ops-record-row" key={p.id}>
     <div className="ops-record-info"><strong>{p.title}</strong><small>{p.active?'Activa al publicar':'Inactiva'} · {p.starts_at?'Desde '+new Date(p.starts_at).toLocaleDateString('es-PE'):'Sin fecha de inicio'} · {p.ends_at?'Hasta '+new Date(p.ends_at).toLocaleDateString('es-PE'):'Sin vencimiento'}</small></div>
     <div className="ops-record-actions"><button type="button" className="button button-secondary" disabled={loading} onClick={()=>{
      setEditingPromoId(p.id);setPromotionTitle(p.title);setPromotionEnabled(p.active)
      setPromoStarts(localTimestamp(p.starts_at));setPromoEnds(localTimestamp(p.ends_at))
      setShowPromoEditor(true);setPendingDelete('');setMessage('');setError('')
     }}>Editar</button>
     <button type="button" className="button button-secondary ops-delete-trigger" disabled={loading}
      onClick={()=>{setPendingDelete('promo:'+p.id);setMessage('');setError('')}}>Eliminar</button></div>
     {pendingDelete==='promo:'+p.id&&<div className="ops-delete-confirm" role="group" aria-label={'Confirmar eliminación de promoción '+p.title}>
      <strong>¿Eliminar «{p.title}»?</strong><p>Se elimina del administrador. Los cambios se reflejan en Android tras publicar.</p>
      <div className="ops-record-actions">
       <button type="button" className="button button-secondary ops-delete-trigger" disabled={loading} onClick={()=>void act(async()=>{
        await api('/api/admin/tenants/'+tenantId+'/promotions/'+p.id,'DELETE',{confirm:true})
        if(editingPromoId===p.id){setEditingPromoId('');setShowPromoEditor(false)}
        setPendingDelete('');await refresh();setMessage('Promoción eliminada. Publica los cambios cuando corresponda.')
       },'promotionDelete')}>Sí, eliminar</button>
       <button type="button" className="button button-secondary" disabled={loading} onClick={()=>setPendingDelete('')}>Cancelar</button>
      </div>{feedback('promotionDelete')}
     </div>}
    </div>)}</div>}
   {feedback('promotionDelete')}
   {(showPromoEditor||promotions.length===0)&&<div className="ops-record-editor">
    <h3>{editingPromoId?'Editar promoción':'Nueva promoción'}</h3>
    <div className="ops-grid">
     <label>Título<input aria-label="Título de la promoción" maxLength={180} value={promotionTitle} onChange={e=>setPromotionTitle(e.target.value)}/></label>
     <label>Desde (opcional)<input type="datetime-local" value={promoStarts} onChange={e=>setPromoStarts(e.target.value)}/></label>
     <label>Hasta (opcional)<input type="datetime-local" value={promoEnds} onChange={e=>setPromoEnds(e.target.value)}/></label>
    </div>
    <label className="ops-check"><input type="checkbox" checked={promotionEnabled} onChange={e=>setPromotionEnabled(e.target.checked)}/>Activa al publicar</label>
    <div className="ops-record-actions">
     <button type="button" className="button button-primary" disabled={!promotionTitle.trim()||loading} onClick={()=>void act(async()=>{
      const saved=await api<PromotionRow>('/api/admin/tenants/'+tenantId+'/promotions','POST',
       {id:editingPromoId||undefined,title:promotionTitle,active:promotionEnabled,
        startsAt:promoStarts?new Date(promoStarts).toISOString():null,endsAt:promoEnds?new Date(promoEnds).toISOString():null})
      setEditingPromoId(saved.id);setShowPromoEditor(true);await refresh()
      setMessage('Promoción guardada. Puedes volver a editarla o publicarla.')
     },'promotion')}>{editingPromoId?'Guardar cambios':'Guardar promoción'}</button>
     {promotions.length>0&&<button type="button" className="button button-secondary" disabled={loading} onClick={()=>{setShowPromoEditor(false);setMessage('');setError('')}}>Cerrar</button>}
    </div>
    {feedback('promotion')}
   </div>}
  </section>}
  {activeTab==='payments'&&<section className="ops-panel ops-record-section">
   <div className="ops-store-toolbar"><div><h2><CreditCard size={19}/> Pagos por local y modalidad</h2>
    <p>Estos son los medios realmente guardados para cada sede. Actívalos, edítalos o elimínalos.</p></div>
    <button type="button" className="button button-secondary" onClick={()=>{
     setEditingPayment(false);setPaymentStore('');setPaymentMode('delivery');setPaymentMethod('yape')
     setPaymentEnabled(true);setPendingDelete('');setMessage('');setError('')
    }}>Nuevo medio de pago</button>
   </div>
   {savedPayments.length===0?<p className="ops-empty">No hay medios de pago configurados todavía.</p>:
    <div className="ops-record-list">{[...savedPayments].sort((a,b)=>
     (storeName(a.store_id)+a.mode+a.method).localeCompare(storeName(b.store_id)+b.mode+b.method)
    ).map(p=><div className="ops-record-row" key={paymentKey(p)}>
     <div className="ops-record-info"><strong>{storeName(p.store_id)}</strong>
      <small>{paymentLabel(p.mode,modes)} · {paymentLabel(p.method,payments)}</small>
      <span className={'ops-record-status'+(p.enabled?' enabled':'')}>{p.enabled?'Habilitado':'Deshabilitado'}</span>
     </div>
     <div className="ops-record-actions">
      <button type="button" className="button button-secondary" disabled={loading} onClick={()=>{
       setPaymentStore(p.store_id);setPaymentMode(p.mode);setPaymentMethod(p.method)
       setPaymentEnabled(p.enabled);setEditingPayment(true);setPendingDelete('');setMessage('');setError('')
      }}>Editar</button>
      <button type="button" className="button button-secondary ops-delete-trigger" disabled={loading} onClick={()=>{
       setPendingDelete('payment:'+paymentKey(p));setMessage('');setError('')
      }}>Eliminar</button>
     </div>
     {pendingDelete==='payment:'+paymentKey(p)&&<div className="ops-delete-confirm" role="group" aria-label={'Confirmar eliminación de pago '+p.method}>
      <strong>¿Eliminar {paymentLabel(p.method,payments)} para {storeName(p.store_id)}?</strong>
      <p>Esta configuración dejará de incluirse en la siguiente publicación.</p>
      <div className="ops-record-actions">
       <button className="button button-secondary ops-delete-trigger" type="button" disabled={loading} onClick={()=>void act(async()=>{
        await api('/api/admin/tenants/'+tenantId+'/payments/'+p.store_id+'/'+p.mode+'/'+p.method,'DELETE',{confirm:true})
        if(editingPayment&&paymentStore===p.store_id&&paymentMode===p.mode&&paymentMethod===p.method)setEditingPayment(false)
        setPendingDelete('');await refresh();setMessage('Medio de pago eliminado. Publica los cambios cuando corresponda.')
       },'paymentDelete')}>Sí, eliminar</button>
       <button className="button button-secondary" type="button" disabled={loading} onClick={()=>setPendingDelete('')}>Cancelar</button>
      </div>
     </div>}
    </div>)}</div>}
   {feedback('paymentDelete')}
   <div className="ops-record-editor">
    <h3>{editingPayment?'Editar medio de pago':'Configurar medio de pago'}</h3>
    <div className="ops-grid">
     <label>Local<select aria-label="Local de pago" value={paymentStore} disabled={editingPayment||loading} onChange={e=>setPaymentStore(e.target.value)}>
      <option value="">Selecciona local</option>{stores.map(st=><option key={st.id} value={st.id}>{st.name}</option>)}
     </select></label>
     <label>Modalidad<select aria-label="Modalidad de pago" value={paymentMode} disabled={editingPayment||loading} onChange={e=>setPaymentMode(e.target.value)}>
      {modes.map(m=><option key={m.key} value={m.key}>{m.name}</option>)}</select></label>
     <label>Medio<select aria-label="Medio de pago" value={paymentMethod} disabled={editingPayment||loading} onChange={e=>setPaymentMethod(e.target.value)}>
      {payments.map(p=><option key={p.key} value={p.key}>{p.name}</option>)}</select></label>
    </div>
    <label className="ops-check"><input type="checkbox" checked={paymentEnabled} disabled={loading} onChange={e=>setPaymentEnabled(e.target.checked)}/>Medio habilitado</label>
    <div className="ops-record-actions">
     <button className="button button-primary" type="button" disabled={!paymentStore||loading} onClick={()=>void act(async()=>{
      await api('/api/admin/tenants/'+tenantId+'/payments','POST',
       {storeId:paymentStore,mode:paymentMode,method:paymentMethod,enabled:paymentEnabled})
      await refresh();setEditingPayment(true)
      setMessage('Medio de pago guardado. Verifica su estado en la lista y publica cuando corresponda.')
     },'payment')}>{editingPayment?'Guardar cambios':'Guardar medio de pago'}</button>
     {editingPayment&&<button className="button button-secondary" type="button" disabled={loading} onClick={()=>{
      setEditingPayment(false);setPaymentStore('');setPaymentEnabled(true);setMessage('');setError('')
     }}>Cancelar edición</button>}
    </div>
    {feedback('payment')}
   </div>
   <p className="ops-hint">Configurar un medio no activa una pasarela de cobro. El proveedor debe integrarse por separado.</p>
  </section>}
  {activeTab==='extras'&&<section className="ops-panel ops-record-section">
  <h2>Libro de Reclamaciones</h2>
  <p>El enlace debe corresponder al Libro oficial de cada empresa. Puedes modificarlo o quitarlo y publicar el cambio.</p>
  {apps.length>1&&<label>Aplicación que utilizará este enlace
   <select aria-label="Aplicación para reclamaciones" value={apps.some(a=>a.app_id===appId)?appId:''} onChange={e=>{
    const found=apps.find(a=>a.app_id===e.target.value);if(found)selectApp(found)
   }}><option value="">Selecciona aplicación</option>{apps.map(a=><option key={a.app_id} value={a.app_id}>{a.app_id}</option>)}</select>
  </label>}
  {!apps.some(a=>a.app_id===appId)?<p className="ops-empty">Selecciona o registra una aplicación en la sección Publicar antes de configurar el Libro.</p>:
   <div className="ops-record-editor">
    <div className="ops-record-info"><strong>Enlace guardado</strong>
     <small>{apps.find(a=>a.app_id===appId)?.complaints_book_url||'Aún no hay enlace configurado para esta aplicación.'}</small>
    </div>
    <label>URL HTTPS del Libro de Reclamaciones
     <input type="url" value={complaintsBookUrl} placeholder="https://..." onChange={e=>setComplaintsBookUrl(e.target.value)}/>
    </label>
    <div className="ops-record-actions">
     <button className="button button-primary" disabled={loading} onClick={()=>void act(async()=>{
      await api('/api/admin/tenants/'+tenantId+'/complaints','POST',{appId,url:complaintsBookUrl.trim()})
      await refresh();setMessage('Enlace actualizado. Publica los cambios para verlo en la aplicación.')
     },'claims')}>Guardar enlace</button>
     {apps.some(a=>a.app_id===appId&&a.complaints_book_url)&&
      <button className="button button-secondary ops-delete-trigger" disabled={loading} onClick={()=>{setPendingDelete('claims:'+appId);setMessage('');setError('')}}>Quitar enlace</button>}
    </div>
    {feedback('claims')}
    {pendingDelete==='claims:'+appId&&<div className="ops-delete-confirm" role="group" aria-label="Confirmar retirada del Libro">
     <strong>¿Quitar el enlace oficial?</strong><p>La aplicación dejará de mostrar este enlace después de publicar nuevamente.</p>
     <div className="ops-record-actions">
      <button type="button" className="button button-secondary ops-delete-trigger" disabled={loading} onClick={()=>void act(async()=>{
       await api('/api/admin/tenants/'+tenantId+'/complaints','POST',{appId,url:''})
       setComplaintsBookUrl('');setPendingDelete('');await refresh()
       setMessage('Enlace quitado del borrador. Publica los cambios cuando corresponda.')
      },'claims')}>Sí, quitar</button>
      <button type="button" className="button button-secondary" onClick={()=>setPendingDelete('')}>Cancelar</button>
     </div>
    </div>}
   </div>}
 </section>}
 {activeTab==='publish'&&<section className="ops-panel ops-record-section">
  <h2><Smartphone size={19}/> Aplicaciones registradas y publicación</h2>
  <p>Elige la aplicación asociada a esta empresa. Los cambios de locales, productos y pagos solo llegan a Android al publicar.</p>
  {apps.length===0?<p className="ops-empty">Todavía no hay aplicaciones registradas.</p>:
   <div className="ops-record-list">{apps.map(a=><div className="ops-record-row" key={a.app_id}>
    <div className="ops-record-info"><strong>{a.app_id}</strong>
     <small>Última revisión publicada: {a.published_revision||'Ninguna'} · {a.enabled?'Activa':'Sin publicar'}</small></div>
    <div className="ops-record-actions">
     <button type="button" className="button button-secondary" disabled={loading} onClick={()=>selectApp(a)}>{appId===a.app_id?'Seleccionada':'Seleccionar'}</button>
     {a.published_revision===0&&<button type="button" className="button button-secondary ops-delete-trigger" disabled={loading}
      onClick={()=>{setPendingDelete('app:'+a.app_id);setError('');setMessage('')}}>Eliminar registro</button>}
    </div>
    {pendingDelete==='app:'+a.app_id&&<div className="ops-delete-confirm" role="group" aria-label={'Confirmar eliminación de aplicación '+a.app_id}>
     <strong>¿Eliminar registro «{a.app_id}»?</strong>
     <p>Solo es posible antes de su primera publicación; ninguna aplicación ya publicada podrá eliminarse desde aquí.</p>
     <div className="ops-record-actions">
      <button className="button button-secondary ops-delete-trigger" disabled={loading} onClick={()=>void act(async()=>{
       await api('/api/admin/tenants/'+tenantId+'/apps/'+a.app_id,'DELETE',{confirm:true})
       if(appId===a.app_id){setAppId('');setComplaintsBookUrl('')}
       setPendingDelete('');await refresh();setMessage('Registro de aplicación sin publicar eliminado.')
      },'appDelete')}>Sí, eliminar</button>
      <button className="button button-secondary" onClick={()=>setPendingDelete('')}>Cancelar</button>
     </div>
    </div>}
   </div>)}</div>}
  {feedback('appDelete')}
  <div className="ops-record-editor">
   <label>Identificador de aplicación
    <input aria-label="Identificador de aplicación" placeholder="com.empresa.aplicacion" value={appId}
     onChange={e=>setAppId(e.target.value)} />
   </label>
   <div className="ops-record-actions">
    <button className="button button-secondary" type="button" disabled={loading||!appId.trim()||apps.some(a=>a.app_id===appId)}
     onClick={()=>void act(async()=>{
      await api('/api/admin/tenants/'+tenantId+'/apps','POST',{appId})
      await refresh();setMessage('Aplicación registrada. Selecciónala para gestionar su publicación.')
     },'register')}>Registrar aplicación</button>
   </div>
   {feedback('register')}
   <div className="ops-record-actions">
    <button className="button button-primary" type="button" disabled={loading||!apps.some(a=>a.app_id===appId)}
     onClick={()=>void act(async()=>{
      const result=await api<{revision:number}>('/api/admin/tenants/'+tenantId+'/publish','POST',{appId})
      await refresh();setMessage('Cambios publicados en revisión '+result.revision+'. La API pública ya puede consultarlos.')
     },'publish')}><Send size={15}/> Publicar cambios</button>
   </div>
   {feedback('publish')}
   <p className="ops-hint">Por seguridad, un registro de aplicación ya publicado no puede eliminarse. No se envían pedidos ni se activan pagos reales desde este panel.</p>
  </div>
 </section>}
  </>}
 </div>
}