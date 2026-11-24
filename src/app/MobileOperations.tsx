import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Bike, Building2, CalendarDays, Check, Clock3, Copy, CreditCard, MapPin, Package, Send, ShoppingBag, Store, Smartphone, Tag, Settings2 } from 'lucide-react'

type Session = { role: 'SUPER_ADMIN' | 'TENANT_ADMIN'; tenantId: string | null }
type Tenant = { id: string; name: string; active: boolean }
type DayHours = {open:string;close:string}|{closed:true}
type OpeningHours = Partial<Record<'sun'|'mon'|'tue'|'wed'|'thu'|'fri'|'sat',DayHours>>
const weekdays = [{id:'mon',label:'Lunes'},{id:'tue',label:'Martes'},{id:'wed',label:'Miércoles'},{id:'thu',label:'Jueves'},{id:'fri',label:'Viernes'},{id:'sat',label:'Sábado'},{id:'sun',label:'Domingo'}] as const
type StoreRow = { delivery_preparation_minutes:number|null;pickup_preparation_minutes:number|null;code: string; opening_hours: OpeningHours|null; consult_order_availability: boolean; id: string; name: string; address: string; active: boolean; delivery_enabled: boolean; pickup_enabled: boolean; dine_in_enabled: boolean; latitude: number | null; longitude: number | null; radius_km: number | null; delivery_rate_per_km_pen: number | null; delivery_fee_pen: number | null; delivery_pricing_mode: 'PER_KM'|'FIXED' }
type ReservationSettings = {enabled:boolean;preparationMinutes:number|null}
const blankReservation = ():ReservationSettings => ({enabled:false,preparationMinutes:null})
type ProductRow = {id:string;name:string;price_pen:number;active:boolean}
type VacancyRow = {id:string;title:string;summary:string;description:string;requirements:string;schedule:string;employment_type:string;location_label:string;image_url:string|null;whatsapp_phone:string;active:boolean}
const modes = [{key:'delivery',name:'Delivery'},{key:'pickup',name:'Recojo en tienda'}]
const payments = [{key:'yape',name:'Yape'},{key:'plin',name:'Plin'},{key:'card',name:'Tarjeta'},{key:'cash',name:'Efectivo'}]
async function api<T>(path: string, method: 'GET'|'POST'|'PUT'='GET', data?:unknown): Promise<T> {
 const res=await fetch(path,{method,credentials:'include',headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined,cache:'no-store'})
 const result=await res.json().catch(()=>({error:'Respuesta inválida'}))
 if(!res.ok)throw new Error(result.error||`HTTP ${res.status}`)
 return result as T
}

export default function MobileOperations({ embeddedSession, scopedTenantId }: { embeddedSession?: Session; scopedTenantId?: string } = {}){
 const [session,setSession]=useState<Session|null>(embeddedSession??null)
 const [email,setEmail]=useState(''),[password,setPassword]=useState(''),[error,setError]=useState(''),[message,setMessage]=useState('')
 const [tenants,setTenants]=useState<Tenant[]>([]),[tenantId,setTenantId]=useState(scopedTenantId??embeddedSession?.tenantId??''),[companyName,setCompanyName]=useState('')
 const [stores,setStores]=useState<StoreRow[]>([]),[products,setProducts]=useState<ProductRow[]>([]),[vacancies,setVacancies]=useState<VacancyRow[]>([])
 const emptyStore=()=>({id:'',code:'',name:'',address:'',latitude:'',longitude:'',radiusKm:'',deliveryRatePerKmPen:'',deliveryFeePen:'',deliveryPreparationMinutes:'',pickupPreparationMinutes:'',deliveryPricingMode:'PER_KM' as 'PER_KM'|'FIXED',active:false,delivery_enabled:false,pickup_enabled:false,dine_in_enabled:false,consultOrderAvailability:false,openingHours:{} as OpeningHours})
 const [store,setStore]=useState(emptyStore)
 const [storeBaseline,setStoreBaseline]=useState(()=>JSON.stringify(emptyStore()))
 const [storeEditorOpen,setStoreEditorOpen]=useState(false)
 const [storeSavedNotice,setStoreSavedNotice]=useState(false)
 const hasUnsavedStoreChanges=JSON.stringify(store)!==storeBaseline
 useEffect(()=>{if(hasUnsavedStoreChanges)setStoreSavedNotice(false)},[hasUnsavedStoreChanges])
 const selectStoreForEditing=(next:ReturnType<typeof emptyStore>)=>{
  if(hasUnsavedStoreChanges&&!window.confirm('Hay cambios sin guardar en esta sede. ¿Quieres descartarlos y continuar?'))return
  setStore(next);setStoreBaseline(JSON.stringify(next));setStoreEditorOpen(true);setStoreSavedNotice(false);setError('');setMessage('')
 }
 const [product,setProduct]=useState({name:'',description:'',category:'',pricePen:'',imageUrl:'',active:false})
 const emptyVacancy=()=>({id:'',title:'',summary:'',description:'',requirements:'',schedule:'',employmentType:'',locationLabel:'',imageUrl:'',whatsappPhone:'',active:false})
 const [vacancy,setVacancy]=useState(emptyVacancy)
 const [paymentStore,setPaymentStore]=useState(''),[paymentMode,setPaymentMode]=useState('delivery'),[paymentMethod,setPaymentMethod]=useState('yape'),[paymentEnabled,setPaymentEnabled]=useState(true)
 const [paymentReservationEnabled,setPaymentReservationEnabled]=useState(false)
 const [newTenantEmail,setNewTenantEmail]=useState(''),[newTenantPassword,setNewTenantPassword]=useState('')
 const [promotionTitle,setPromotionTitle]=useState(''),[promotionEnabled,setPromotionEnabled]=useState(false),[promoStarts,setPromoStarts]=useState(''),[promoEnds,setPromoEnds]=useState('')
 const [appId,setAppId]=useState('')
 const [timeZone,setTimeZone]=useState('America/Lima')
  const [reservationStoreId,setReservationStoreId]=useState('')
 const [selectedStoreId,setSelectedStoreId]=useState('')
 const [storeFocus,setStoreFocus]=useState<'details'|'hours'|'delivery'|'pickup'>('details')
 const [reservationFlags,setReservationFlags]=useState<Record<string,boolean|null>>({})
  const [reservationSettings,setReservationSettings]=useState<ReservationSettings>(blankReservation)
  const [reservationLoading,setReservationLoading]=useState(false)
 const [paymentWaitMinutes,setPaymentWaitMinutes]=useState(10)
 const [reminderCount,setReminderCount]=useState(2)
 const [complaintsBookUrl,setComplaintsBookUrl]=useState('')
 const [loading,setLoading]=useState(false)
 const [savedArea,setSavedArea]=useState<string>('')
 const savedNext=(area:string)=>savedArea===area&&<div className="ops-save-next" role="status"><div className="ops-save-next-heading"><Check size={18}/><strong>Cambios guardados</strong></div><p>Los cambios están guardados. Para que aparezcan en la aplicación, debes publicarlos.</p><div className="ops-save-next-actions"><button type="button" className="button button-secondary" onClick={()=>setSavedArea('')}>Seguir editando</button><button type="button" className="button button-primary" onClick={()=>chooseArea('publish')}><Send size={15}/> Ir a publicar</button></div></div>
 const [activeArea,setActiveArea]=useState<'overview'|'local'|'stores'|'reservations'|'products'|'vacancies'|'promotions'|'payments'|'settings'|'publish'>('overview')
 const chooseArea=(area:typeof activeArea)=>{
  if(area===activeArea)return
  if(activeArea==='stores'&&hasUnsavedStoreChanges&&!window.confirm('Tienes cambios sin guardar en el local. ¿Quieres salir sin guardarlos?'))return
  setActiveArea(area);setSavedArea('');setStoreSavedNotice(false);setError('');setMessage('')
 }
 const act=async(fn:()=>Promise<void>)=>{setLoading(true);setError('');setMessage('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'Error inesperado')}finally{setLoading(false)}}
 useEffect(()=>{if(embeddedSession){setSession(embeddedSession);setTenantId(scopedTenantId??embeddedSession.tenantId??'');return}void api<Session>('/api/admin/me').then(s=>{setSession(s);setTenantId(s.tenantId||'')}).catch(()=>{})},[embeddedSession,scopedTenantId])
 useEffect(()=>{if(!session)return;if(session.role==='SUPER_ADMIN'&&!embeddedSession)void api<{tenants:Tenant[]}>('/api/admin/tenants').then(r=>setTenants(r.tenants)).catch(e=>setError(e.message))},[session])
 const refresh=async(id=tenantId)=>{if(!id)return;const [st,pr,jobs,apps,settings,checkout]=await Promise.all([api<{items:StoreRow[]}>(`/api/admin/tenants/${id}/stores`),api<{items:ProductRow[]}>(`/api/admin/tenants/${id}/products`),api<{items:VacancyRow[]}>(`/api/admin/tenants/${id}/vacancies`),api<{items:{app_id:string;complaints_book_url:string|null}[]}>(`/api/admin/tenants/${id}/apps`),api<{timeZone:string}>(`/api/admin/tenants/${id}/settings`),api<{paymentWaitMinutes:number;reminderCount:number}>(`/api/admin/tenants/${id}/checkout-settings`)]);setPaymentWaitMinutes(checkout.paymentWaitMinutes);setReminderCount(checkout.reminderCount);setStores(st.items);setReservationStoreId(previous=>st.items.some(s=>s.id===previous)?previous:st.items[0]?.id||'');setSelectedStoreId(previous=>st.items.some(s=>s.id===previous)?previous:'');setProducts(pr.items);setVacancies(jobs.items);setTimeZone(settings.timeZone||'America/Lima');const current=apps.items.find(x=>x.app_id===appId)??(appId===''&&apps.items.length===1?apps.items[0]:undefined);if(current&&appId==='')setAppId(current.app_id);setComplaintsBookUrl(current?.complaints_book_url||'')}
 useEffect(()=>{if(session&&tenantId)void refresh(tenantId).catch(e=>setError(e.message))},[tenantId,session])
 useEffect(()=>{
    if(activeArea!=='reservations'||!tenantId||!reservationStoreId)return
    let active=true
    setReservationLoading(true)
    void api<ReservationSettings>(`/api/admin/tenants/${tenantId}/stores/${reservationStoreId}/reservation-settings`)
      .then(value=>{if(active)setReservationSettings(value)})
      .catch(e=>{if(active)setError(e instanceof Error?e.message:'No se pudo consultar la programación')})
      .finally(()=>{if(active)setReservationLoading(false)})
    return ()=>{active=false}
  },[activeArea,tenantId,reservationStoreId])
  useEffect(()=>{
  if(activeArea!=='payments'||!tenantId||!paymentStore){setPaymentReservationEnabled(false);return}
  let current=true;setPaymentReservationEnabled(false)
  void api<ReservationSettings>(`/api/admin/tenants/${tenantId}/stores/${paymentStore}/reservation-settings`)
    .then(settings=>{if(current)setPaymentReservationEnabled(settings.enabled===true)})
    .catch(()=>{if(current)setPaymentReservationEnabled(false)})
  return ()=>{current=false}
 },[activeArea,tenantId,paymentStore])

 useEffect(()=>{
  if(!tenantId||!stores.length){setReservationFlags({});return}
  let alive=true
  setReservationFlags({})
  void Promise.all(stores.map(async local=>{
   try{const config=await api<ReservationSettings>(`/api/admin/tenants/${tenantId}/stores/${local.id}/reservation-settings`);return [local.id,config.enabled===true] as const}
   catch{return [local.id,null] as const}
  })).then(rows=>{if(alive)setReservationFlags(Object.fromEntries(rows))})
  return ()=>{alive=false}
 },[tenantId,stores])
 const selectedStore=stores.find(s=>s.id===selectedStoreId)
 const storeEditorValue=(s:StoreRow)=>({id:s.id,code:s.code,name:s.name,address:s.address,latitude:s.latitude===null?'':String(s.latitude),longitude:s.longitude===null?'':String(s.longitude),radiusKm:s.radius_km===null?'':String(s.radius_km),deliveryRatePerKmPen:s.delivery_rate_per_km_pen===null?'':String(s.delivery_rate_per_km_pen),deliveryFeePen:s.delivery_fee_pen===null?'':String(s.delivery_fee_pen),deliveryPreparationMinutes:s.delivery_preparation_minutes==null?'':String(s.delivery_preparation_minutes),pickupPreparationMinutes:s.pickup_preparation_minutes==null?'':String(s.pickup_preparation_minutes),deliveryPricingMode:s.delivery_pricing_mode||'PER_KM' as 'PER_KM'|'FIXED',active:s.active,delivery_enabled:s.delivery_enabled,pickup_enabled:s.pickup_enabled,dine_in_enabled:s.dine_in_enabled,consultOrderAvailability:s.consult_order_availability===true,openingHours:s.opening_hours||{}})
 const enterLocal=(s:StoreRow)=>{
  if(activeArea==='stores'&&hasUnsavedStoreChanges&&!window.confirm('Hay cambios sin guardar. ¿Quieres salir sin guardarlos?'))return
  setSelectedStoreId(s.id);setReservationStoreId(s.id);setPaymentStore(s.id);setPaymentMode('delivery');chooseArea('local')
 }
 const enterLocalModule=(area:'stores'|'reservations'|'payments',focus:'details'|'hours'|'delivery'|'pickup'='details')=>{
  if(!selectedStore)return
  setReservationStoreId(selectedStore.id);setPaymentStore(selectedStore.id)
  if(area==='stores'){setStoreFocus(focus);selectStoreForEditing(storeEditorValue(selectedStore))}
  chooseArea(area)
 }
 useEffect(()=>{
  if(activeArea==='stores'&&storeEditorOpen){
   const raf=window.requestAnimationFrame(()=>document.getElementById('ops-store-'+storeFocus)?.scrollIntoView({block:'start',behavior:'smooth'}))
   return ()=>window.cancelAnimationFrame(raf)
  }
 },[activeArea,storeEditorOpen,storeFocus])
 const [copiedStoreCode,setCopiedStoreCode]=useState('')
 const copyStoreCode=async(code:string)=>{
  try{await navigator.clipboard.writeText(code);setCopiedStoreCode(code);setError('');setMessage('Código de sede copiado: '+code)}
  catch{setMessage('');setError('No se pudo copiar. Selecciona el código y usa Ctrl+C.')}
 }
 const login=async(e:FormEvent)=>{e.preventDefault();await act(async()=>{const r=await api<{role:Session['role'];tenantId:string|null}>('/api/admin/login','POST',{email,password});setSession(r);setTenantId(r.tenantId||'');setPassword('')})}

 const weeklySchedule=(value:OpeningHours,apply:(next:OpeningHours)=>void,description:string)=><div className="ops-schedule-block">
  <p className="ops-hint">{description}</p>
  <div className="ops-grid">{weekdays.map(day=>{
   const h=value[day.id];const closed=!!h&&'closed' in h
   const setDay=(next:DayHours|undefined)=>{const updated={...value};if(next)updated[day.id]=next;else delete updated[day.id];apply(updated)}
   return <div key={day.id} className="ops-row">
    <strong>{day.label}</strong>
    <label className="ops-check"><input type="checkbox" checked={closed} onChange={e=>setDay(e.target.checked?{closed:true}:undefined)}/>Cerrado</label>
    <label>Desde<input type="time" disabled={closed} value={h&&!closed&&'open' in h?h.open:''}
     onChange={e=>{const v=e.target.value;setDay(v?{open:v,close:h&&!closed&&'close' in h?h.close:''}:undefined)}}/></label>
    <label>Hasta<input type="time" disabled={closed} value={h&&!closed&&'close' in h?h.close:''}
     onChange={e=>{const v=e.target.value;setDay(v?{open:h&&!closed&&'open' in h?h.open:'',close:v}:undefined)}}/></label>
   </div>
  })}</div>
 </div>
 const saveStore=()=>void act(async()=>{
  if(!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(store.code)||store.code.length<2||store.code.length>80)
   throw new Error('Completa el ID de la sede con minúsculas, números y guiones (2 a 80 caracteres)')
  const saved=await api<StoreRow>(`/api/admin/tenants/${tenantId}/stores`,'POST',{
   ...store,
   openingHours:Object.keys(store.openingHours).length?store.openingHours:null,
   latitude:store.latitude?Number(store.latitude):null,
   longitude:store.longitude?Number(store.longitude):null,
   radiusKm:store.radiusKm===''?null:Number(store.radiusKm),
   deliveryRatePerKmPen:store.deliveryPricingMode==='PER_KM'&&store.deliveryRatePerKmPen!==''?Number(store.deliveryRatePerKmPen):null,
   deliveryFeePen:store.deliveryPricingMode==='FIXED'&&store.deliveryFeePen!==''?Number(store.deliveryFeePen):null,
   deliveryPreparationMinutes:store.deliveryPreparationMinutes===''?null:Number(store.deliveryPreparationMinutes),
   pickupPreparationMinutes:store.pickupPreparationMinutes===''?null:Number(store.pickupPreparationMinutes)
  })
  const next={...store,id:saved.id,code:saved.code}
  setStore(next);setStoreBaseline(JSON.stringify(next))
  await refresh();setStoreSavedNotice(true)
 })
 const renderStoreEditor=()=>storeEditorOpen&&<div className="ops-sede-editor" id={store.id?`sede-editor-${store.id}`:'sede-editor-new'}>
  <div className="ops-inline"><h3>{store.id?(
   {details:'Datos y ubicación',hours:'Horario del local',delivery:'Delivery',pickup:'Recojo en tienda'}[storeFocus]
  ):'Nueva sede'}</h3>
   <button type="button" className="button button-secondary" onClick={()=>{
    if(hasUnsavedStoreChanges&&!window.confirm('Hay cambios sin guardar. ¿Quieres cerrar el formulario?'))return
    setStore(emptyStore());setStoreBaseline(JSON.stringify(emptyStore()));setStoreEditorOpen(false);setStoreSavedNotice(false)
   }}>Cerrar</button>
  </div>
  {hasUnsavedStoreChanges&&<p className="ops-unsaved" role="status">Tienes cambios sin guardar en esta sede.</p>}
  {storeFocus==='details'&&<section id="ops-store-details">
   <div className="ops-grid">
    <div className="ops-store-code"><label>ID de sede<input value={store.code} readOnly={!!store.id}
     maxLength={80} onChange={e=>setStore({...store,code:e.target.value})}/></label>
     <button type="button" className="button button-secondary" disabled={!store.code} onClick={()=>void copyStoreCode(store.code)}><Copy size={15}/> Copiar ID</button>
    </div>
    <label>Nombre del local<input value={store.name} onChange={e=>setStore({...store,name:e.target.value})}/></label>
    <label>Dirección<input value={store.address} onChange={e=>setStore({...store,address:e.target.value})}/></label>
    <label>Latitud GPS<input inputMode="decimal" value={store.latitude} onChange={e=>setStore({...store,latitude:e.target.value})}/></label>
    <label>Longitud GPS<input inputMode="decimal" value={store.longitude} onChange={e=>setStore({...store,longitude:e.target.value})}/></label>
   </div>
   <div className="ops-switches">
    <label><input type="checkbox" checked={store.active} onChange={e=>setStore({...store,active:e.target.checked})}/> Local activo</label>
   </div>
   <p className="ops-hint">El horario físico del local es informativo. Delivery, Recojo y Reservas se habilitan desde sus propias tarjetas; la recepción depende del agente disponible en TU VERSO.</p>
  </section>}
  {storeFocus==='hours'&&<section id="ops-store-hours">
   <h3>Horario de apertura al público</h3>
   {weeklySchedule(store.openingHours,next=>setStore(prev=>({...prev,openingHours:next})),
    'Este horario se muestra como información del local. No decide si se pueden recibir pedidos: esa disponibilidad depende de TU VERSO y de los servicios habilitados.')}
  </section>}
  {storeFocus==='delivery'&&<section id="ops-store-delivery">
   <label className="ops-check"><input type="checkbox" checked={store.delivery_enabled}
    onChange={e=>setStore({...store,delivery_enabled:e.target.checked})}/> Habilitar Delivery en este local</label>
   <div className="ops-grid">
    <label>Cobertura máxima (km; vacío = sin límite)<input type="number" min="0.1" max="500" step="0.1"
     value={store.radiusKm} onChange={e=>setStore({...store,radiusKm:e.target.value})}/></label>
    <label>Cálculo de tarifa<select value={store.deliveryPricingMode}
     onChange={e=>setStore({...store,deliveryPricingMode:e.target.value as 'PER_KM'|'FIXED'})}>
     <option value="PER_KM">Por kilómetro</option><option value="FIXED">Costo fijo</option></select></label>
    {store.deliveryPricingMode==='FIXED'?<label>Costo fijo (S/)<input type="number" min="0" step="0.01" value={store.deliveryFeePen}
      onChange={e=>setStore({...store,deliveryFeePen:e.target.value})}/></label>:
     <label>Tarifa por km (S/)<input type="number" min="0" step="0.01" value={store.deliveryRatePerKmPen}
      onChange={e=>setStore({...store,deliveryRatePerKmPen:e.target.value})}/></label>}
   </div>
   <label>Tiempo de preparación (minutos)<input type="number" min="1" max="240" step="1"
    value={store.deliveryPreparationMinutes} onChange={e=>setStore({...store,deliveryPreparationMinutes:e.target.value})}/></label>
   <p className="ops-hint">No hay horarios adicionales de Delivery. Podrá recibir solicitudes cuando esta opción esté habilitada y TU VERSO confirme un agente disponible, incluso fuera del horario físico.</p>
  </section>}
  {storeFocus==='pickup'&&<section id="ops-store-pickup">
   <label className="ops-check"><input type="checkbox" checked={store.pickup_enabled}
    onChange={e=>setStore({...store,pickup_enabled:e.target.checked})}/> Habilitar Recojo en tienda</label>
   <label>Tiempo de preparación (minutos)<input type="number" min="1" max="240" step="1"
    value={store.pickupPreparationMinutes} onChange={e=>setStore({...store,pickupPreparationMinutes:e.target.value})}/></label>
   <p className="ops-hint">No hay horarios adicionales para Recojo. Podrá recibir solicitudes cuando esté habilitado y TU VERSO confirme un agente disponible.</p>
  </section>}
  <button className="button button-primary" disabled={loading||!hasUnsavedStoreChanges} onClick={saveStore}>
   Guardar {store.id?'configuración':'nuevo local'}
  </button>
  {storeSavedNotice&&!hasUnsavedStoreChanges&&<div className="ops-save-next" role="status">
   <div className="ops-save-next-heading"><Check size={18}/><strong>Cambios guardados</strong></div>
   <p>Para que la aplicación reciba la nueva configuración debes publicar los cambios.</p>
   <div className="ops-save-next-actions"><button type="button" className="button button-secondary"
    onClick={()=>setStoreSavedNotice(false)}>Seguir editando</button>
    <button type="button" className="button button-primary" onClick={()=>chooseArea('publish')}>Ir a publicar</button>
   </div>
  </div>}
 </div>
 if(!session)return <main className="ops-wrapper"><h1>Administración comercial</h1><p>Inicia sesión con una cuenta verificada en el servidor. El selector de rol de la maqueta no concede permisos.</p><form className="ops-panel ops-form" onSubmit={login}><label>Correo<input type="email" autoComplete="username" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Contraseña<input type="password" autoComplete="current-password" value={password} onChange={e=>setPassword(e.target.value)} required/></label><button className="button button-primary" disabled={loading}>Iniciar sesión</button>{error&&<p role="alert" className="ops-error">{error}</p>}</form></main>
 return <div className="ops-wrapper">
  <div className="ops-top"><div><p className="eyebrow">ADMINISTRACIÓN DE EMPRESAS Y SEDES</p><h1>{session.role==='SUPER_ADMIN'?tenants.find(t=>t.id===tenantId)?.name||'Administrador de empresas':'Administrador de tu empresa'}</h1><p>Selecciona un local para identificar rápidamente qué configuración estás editando.</p></div>{!embeddedSession&&<button className="button button-secondary" onClick={()=>void act(async()=>{await api('/api/admin/logout','POST');setSession(null);setTenantId('');setTenants([])})}>Cerrar sesión</button>}</div>
  {error&&<div className="ops-error" role="alert">{error}</div>}{message&&<div className="ops-success" role="status"><Check size={15}/>{message}</div>}
  {session.role==='SUPER_ADMIN'&&!embeddedSession&&<section className="ops-panel"><h2><Building2 size={19}/> Empresas</h2><div className="ops-inline"><select value={tenantId} onChange={e=>{setTenantId(e.target.value);setSelectedStoreId('');setActiveArea('overview')}} aria-label="Empresa seleccionada"><option value="">Selecciona una empresa</option>{tenants.map(t=><option value={t.id} key={t.id}>{t.name}</option>)}</select><input placeholder="Nueva empresa" value={companyName} onChange={e=>setCompanyName(e.target.value)}/><button className="button button-secondary" disabled={!companyName.trim()||loading} onClick={()=>void act(async()=>{const created=await api<Tenant>('/api/admin/tenants','POST',{name:companyName});setTenants(v=>[...v,created]);setTenantId(created.id);setSelectedStoreId('');setActiveArea('overview');setCompanyName('');setMessage('Empresa creada. Debes crear sus usuarios y registrar su aplicación.')})}>Crear empresa</button></div><p className="ops-hint">Cada administrador de empresa tiene permisos limitados a su tenant. Las cuentas deben crearse desde el endpoint autorizado de superadministración.</p></section>}
  {tenantId&&<>

  {activeArea==='overview'&&<section className="ops-workspace" aria-label="Locales de la empresa">
   <div className="ops-workspace-head"><div><p className="eyebrow">SELECCIONA UNA SEDE</p><h2>Locales de la empresa</h2><p>Las tarjetas muestran servicios habilitados por el administrador; la recepción real depende del agente disponible en TU VERSO.</p></div><button className="button button-primary" onClick={()=>{setSelectedStoreId('');setStoreFocus('details');selectStoreForEditing(emptyStore());chooseArea('stores')}}>+ Nuevo local</button></div>
   <div className="ops-local-grid">{stores.length===0?<div className="ops-panel">Todavía no hay locales registrados.</div>:stores.map(local=><button type="button" className="ops-local-card" key={local.id} onClick={()=>enterLocal(local)}><span className="ops-card-icon"><Store size={23}/></span><span className="ops-card-status" data-enabled={local.active}>{local.active?'Activo':'Inactivo'}</span><strong>{local.name}</strong><span className="ops-card-address"><MapPin size={14}/>{local.address||'Dirección sin configurar'}</span><span className="ops-card-tags"><span data-on={local.delivery_enabled}>Delivery {local.delivery_enabled?'· Sí':'· No'}</span><span data-on={local.pickup_enabled}>Recojo {local.pickup_enabled?'· Sí':'· No'}</span><span data-on={reservationFlags[local.id]===true}>Reserva {reservationFlags[local.id]===undefined?'· Consultando':reservationFlags[local.id]===null?'· Sin datos':reservationFlags[local.id]?'· Sí':'· No'}</span></span><span className="ops-card-link">Configurar local <ArrowRight size={16}/></span></button>)}</div>
  </section>}
  {activeArea==='local'&&selectedStore&&<section className="ops-workspace" aria-label={'Configuración de '+selectedStore.name}>
    <div className="ops-local-head"><button type="button" className="ops-back" onClick={()=>chooseArea('overview')}><ArrowLeft size={16}/> Todos los locales</button><div className="ops-local-title"><span className="ops-card-icon"><Store size={25}/></span><div><p className="eyebrow">CONFIGURANDO LOCAL</p><h2>{selectedStore.name}</h2><p><MapPin size={14}/> {selectedStore.address||'Dirección sin configurar'}</p></div><span className="ops-card-status" data-enabled={selectedStore.active}>{selectedStore.active?'Activo':'Inactivo'}</span></div></div>
    <div className="ops-workspace-head"><div><h2>Configuración de esta sede</h2><p>Selecciona una tarjeta. Las opciones de sede editan este local; las tarjetas marcadas «Compartida» administran toda la empresa.</p></div></div>
    <div className="ops-module-grid">{([
     {title:'Datos y ubicación',subtitle:'Dirección, GPS y estado del local',icon:MapPin,focus:'details',action:'stores',on:true},
     {title:'Horarios',subtitle:'Apertura y cierre por día',icon:Clock3,focus:'hours',action:'stores',on:true},
     {title:'Delivery',subtitle:selectedStore.delivery_enabled?'Habilitado para pedidos · Cobertura y tarifas':'Servicio deshabilitado',icon:Bike,focus:'delivery',action:'stores',on:selectedStore.delivery_enabled},
     {title:'Recojo en tienda',subtitle:selectedStore.pickup_enabled?'Habilitado para pedidos':'Servicio deshabilitado',icon:ShoppingBag,focus:'pickup',action:'stores',on:selectedStore.pickup_enabled},
     {title:'Reservas',focus:'details',subtitle:reservationFlags[selectedStore.id]===true?'Reserva habilitada · Sujeta a agente disponible':reservationFlags[selectedStore.id]===null?'No se pudo consultar':'Pendiente de habilitar',icon:CalendarDays,action:'reservations',on:reservationFlags[selectedStore.id]===true},
     {title:'Formas de pago',focus:'details',subtitle:'Delivery, Recojo y Reserva si está habilitada',icon:CreditCard,action:'payments',on:true}
    ] as const).map(item=><button type="button" className="ops-module-card" key={item.title} onClick={()=>enterLocalModule(item.action,item.focus)}><item.icon size={24}/><strong>{item.title}</strong><span>{item.subtitle}</span>{!item.on&&<span className="ops-module-state" data-enabled={false}>Deshabilitado</span>}<ArrowRight className="ops-card-arrow" size={17}/></button>)}{([
      {area:'products',title:'Productos',subtitle:'Catálogo maestro de la empresa · compartido',icon:Package},
      {area:'promotions',title:'Promociones',subtitle:'Promociones generales · compartidas',icon:Tag},
      {area:'vacancies',title:'Empleo',subtitle:'Vacantes de la empresa · compartidas',icon:Store},
      {area:'settings',title:'Datos de la empresa',subtitle:'Configuración general · compartida',icon:Settings2},
      {area:'publish',title:'Publicar cambios',subtitle:'Publicación del catálogo de la empresa',icon:Send}
     ] as const).map(item=><button type="button" className="ops-module-card" key={item.area} onClick={()=>chooseArea(item.area)}><item.icon size={24}/><strong>{item.title}</strong><span>{item.subtitle}</span><span className="ops-module-state" data-enabled={false}>Compartida</span><ArrowRight className="ops-card-arrow" size={17}/></button>)}</div>
    <p className="ops-global-note">Las tarjetas marcadas como compartidas abren formularios generales de la empresa; aún no realizan cambios exclusivos en este local. La personalización por sede requiere API y persistencia adicionales.</p>
  </section>}
  {!['overview','local'].includes(activeArea)&&<div className="ops-context-bar"><button type="button" className="ops-back" onClick={()=>chooseArea(selectedStore?'local':'overview')}><ArrowLeft size={16}/> {selectedStore?'Volver a '+selectedStore.name:'Volver a locales'}</button><span>{selectedStore&&['stores','reservations','payments'].includes(activeArea)?'Local: '+selectedStore.name:'Configuración general de la empresa · afecta todas las sedes'}</span></div>}
  {activeArea==='settings'&&(<section className="ops-panel"><h2>Zona horaria de la empresa</h2><p>Se usa para validar horarios comerciales de las sedes de esta empresa. El valor debe ser una zona horaria IANA.</p><div className="ops-inline"><label>Zona horaria<input value={timeZone} maxLength={100} placeholder="America/Lima" onChange={e=>setTimeZone(e.target.value)}/></label><button className="button button-secondary" disabled={loading} onClick={()=>void act(async()=>{const saved=await api<{timeZone:string}>(`/api/admin/tenants/${tenantId}/settings`,'PUT',{timeZone});setTimeZone(saved.timeZone);setMessage('Zona horaria guardada para esta empresa. Publica el catálogo para actualizar la aplicación.')})}>Guardar zona horaria</button></div><p className="ops-hint">Si no se cambia, se conserva America/Lima para mantener el comportamiento actual.</p></section>)}
  {activeArea==='settings'&&session.role==='SUPER_ADMIN'&&!embeddedSession&&<section className="ops-panel"><h2>Acceso del administrador de empresa</h2><p>Solo el superadministrador puede crear credenciales para el tenant seleccionado.</p><div className="ops-inline"><input type="email" placeholder="Correo del administrador" value={newTenantEmail} onChange={e=>setNewTenantEmail(e.target.value)}/><input type="password" placeholder="Contraseña segura (mín. 14)" value={newTenantPassword} onChange={e=>setNewTenantPassword(e.target.value)}/><button className="button button-secondary" disabled={loading} onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/users`,'POST',{email:newTenantEmail,password:newTenantPassword});setNewTenantPassword('');setNewTenantEmail('');setMessage('Administrador creado exclusivamente para esta empresa.')})}>Crear administrador</button></div></section>}
  {activeArea==='stores'&&(selectedStoreId?<section className="ops-panel ops-store-single-panel" aria-label={'Editar '+(selectedStore?.name||'local')}>{renderStoreEditor()}</section>:(<section className="ops-panel"><h2><Store size={19}/> Locales y horarios</h2><p>Configura los datos del local, sus modalidades de atención y horarios.</p><div className="ops-sede-header"><div><h3>Sedes creadas</h3><p className="ops-hint">Consulta rápidamente el estado de tus sedes y selecciona cuál quieres editar.</p></div><button type="button" className="button button-primary" onClick={()=>{setSelectedStoreId('');setStoreFocus('details');selectStoreForEditing(emptyStore())}}>Nueva sede</button></div><div className="ops-sede-list" aria-label="Sedes creadas">{stores.length===0?<p className="ops-hint">Todavía no hay sedes creadas. Selecciona «Nueva sede» para comenzar.</p>:stores.filter(s=>!selectedStoreId||s.id===selectedStoreId).map(s=><div key={s.id} className="ops-sede-card"><div className="ops-sede-info"><strong className="ops-sede-name">{s.name}</strong><div className="ops-sede-states"><span className={s.active?'ops-state ops-state--yes':'ops-state ops-state--no'}>{s.active?'Activa':'Desactivada'}</span><span className="ops-sede-consult">Consulta TU VERSO: <span className={s.consult_order_availability?'ops-state ops-state--yes':'ops-state ops-state--no'}>{s.consult_order_availability?'Sí':'No'}</span></span></div></div><div className="ops-sede-actions"><button type="button" className="button button-primary" onClick={()=>selectStoreForEditing({id:s.id,code:s.code,name:s.name,address:s.address,latitude:s.latitude===null?'':String(s.latitude),longitude:s.longitude===null?'':String(s.longitude),radiusKm:s.radius_km===null?'':String(s.radius_km),deliveryRatePerKmPen:s.delivery_rate_per_km_pen===null?'':String(s.delivery_rate_per_km_pen),deliveryFeePen:s.delivery_fee_pen===null?'':String(s.delivery_fee_pen),deliveryPricingMode:s.delivery_pricing_mode||'PER_KM',active:s.active,delivery_enabled:s.delivery_enabled,pickup_enabled:s.pickup_enabled,dine_in_enabled:s.dine_in_enabled,consultOrderAvailability:s.consult_order_availability===true,openingHours:s.opening_hours||{}})} aria-expanded={storeEditorOpen&&store.id===s.id} aria-controls={`sede-editor-${s.id}`}>Editar sede</button><button type="button" className="button button-secondary" aria-label={`Copiar ID de ${s.name}`} onClick={()=>void copyStoreCode(s.code)}><Copy size={15}/>{copiedStoreCode===s.code?'Copiado':'Copiar ID'}</button></div>{storeEditorOpen&&store.id===s.id&&renderStoreEditor()}</div>)}</div>{storeEditorOpen&&!store.id&&renderStoreEditor()}</section>))}
  {activeArea==='reservations'&&(<section className="ops-panel"><h2>Reservas — {selectedStore?.name||stores.find(s=>s.id===reservationStoreId)?.name||'Local'}</h2>
     <p className="ops-hint">La programación utiliza las modalidades, horarios, sedes, coberturas, tarifas y medios de pago ya configurados. Una sede solo puede recibir una solicitud cuando también tenga un agente disponible en TU VERSO. Configurar no crea reservas ni habilita envíos hasta que se certifique la integración móvil.</p>
     {reservationStoreId&&(reservationLoading?<p role="status">Cargando configuración de esta sede...</p>:<>
      <label className="ops-check"><input type="checkbox" checked={reservationSettings.enabled} onChange={e=>setReservationSettings({...reservationSettings,enabled:e.target.checked})}/>Habilitar reservas en este local</label>
      <p className="ops-hint">Solo se permitirá Delivery si la sede tiene Delivery habilitado y Recojo si tiene Recojo habilitado. Las reglas horarias existentes siguen siendo obligatorias. La opción quedará desactivada hasta que se publiquen estas reglas.</p>
      <div className="ops-grid">
       <label>Reservas desde<input type="time" value={reservationSettings.firstTime||''} onChange={e=>setReservationSettings({...reservationSettings,firstTime:e.target.value||null})}/></label>
       <label>Reservas hasta<input type="time" value={reservationSettings.lastTime||''} onChange={e=>setReservationSettings({...reservationSettings,lastTime:e.target.value||null})}/></label>
       {([{key:'minAdvanceMinutes',label:'Anticipación mínima (minutos)',min:0,max:10080},{key:'maxAdvanceDays',label:'Máxima anticipación (días)',min:1,max:60},{key:'preparationMinutes',label:'Preparación estimada por sede (minutos)',min:1,max:240}] as const).map(field=><label key={field.key}>{field.label}<input type="number" min={field.min} max={field.max} step="1" value={reservationSettings[field.key]??''} onChange={e=>setReservationSettings({...reservationSettings,[field.key]:e.target.value===''?null:Number(e.target.value)})}/></label>)}
      </div>
      <p className="ops-hint">El rango de reservas es independiente de la apertura física. La hora solicitada debe coincidir con el horario de entrega de Delivery o Recojo configurado en esta sede. La preparación estimada no inicia un reloj de espera en TU VERSO.</p>
      <button className="button button-primary" disabled={loading||reservationLoading||!tenantId} onClick={()=>void act(async()=>{const saved=await api<ReservationSettings>(`/api/admin/tenants/${tenantId}/stores/${reservationStoreId}/reservation-settings`,'POST',reservationSettings);setReservationSettings(saved);setReservationFlags(current=>({...current,[reservationStoreId]:saved.enabled}));setSavedArea('reservations')})}>Guardar configuración de reservas</button>
      {savedNext('reservations')}
     </>)}
    </section>)}
  {activeArea==='products'&&(<section className="ops-panel"><p className="ops-global-note" role="status">Catálogo compartido de la empresa. Los productos que guardes aquí todavía afectan a todas las sedes. La disponibilidad y los precios por sede requieren una configuración adicional.</p><h2><Package size={19}/> Catálogo de productos y fotografías</h2><div className="ops-grid"><label>Nombre<input value={product.name} onChange={e=>setProduct({...product,name:e.target.value})}/></label><label>Categoría<input value={product.category} onChange={e=>setProduct({...product,category:e.target.value})}/></label><label>Precio S/<input type="number" step="0.01" min="0" value={product.pricePen} onChange={e=>setProduct({...product,pricePen:e.target.value})}/></label><label>Descripción<input value={product.description} onChange={e=>setProduct({...product,description:e.target.value})}/></label><label>Imagen <input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;void act(async()=>{const res=await fetch(`/api/admin/tenants/${tenantId}/images`,{method:'POST',credentials:'include',body:file});const data=await res.json();if(!res.ok)throw new Error(data.error||'No se pudo subir');setProduct(v=>({...v,imageUrl:data.url}));setMessage('Foto cargada. Guarda y publica el producto para mostrarla en Android.')})}}/></label><label>URL de imagen cargada<input readOnly value={product.imageUrl}/></label></div><label className="ops-check"><input type="checkbox" checked={product.active} onChange={e=>setProduct({...product,active:e.target.checked})}/>Producto disponible</label><button className="button button-primary" disabled={loading} onClick={()=>void act(async()=>{if(!product.name||product.pricePen==='')throw new Error('Completa el nombre y precio');await api(`/api/admin/tenants/${tenantId}/products`,'POST',{...product,pricePen:Number(product.pricePen)});setProduct({name:'',description:'',category:'',pricePen:'',imageUrl:'',active:false});await refresh();setSavedArea('products')})}>Guardar producto</button>{savedNext('products')}<div className="ops-record-list"><h3>Productos registrados ({products.length})</h3>{products.length===0?<p className="ops-hint">Todavía no hay productos registrados.</p>:products.map(item=><div key={item.id} className="ops-record-row"><strong>{item.name}</strong><span>S/ {Number(item.price_pen).toFixed(2)}</span><span className={item.active?"ops-state ops-state--yes":"ops-state ops-state--no"}>{item.active?"Disponible":"No disponible"}</span></div>)}</div></section>)}
  {activeArea==='vacancies'&&(<section className="ops-panel"><p className="ops-global-note" role="status">Vacantes compartidas de la empresa. El campo «Sede o zona» es descriptivo y todavía no limita su publicación a una sede.</p><h2><Store size={19}/> Trabaja con nosotros · Vacantes</h2>
   <p>Administra imágenes, puestos, requisitos y teléfono de postulaciones. Solo las vacantes activas aparecerán en Android después de publicar el catálogo. Desactiva una vacante para retirarla de la aplicación.</p>
   <div className="ops-grid">
    <label>Puesto<input maxLength={150} value={vacancy.title} onChange={e=>setVacancy({...vacancy,title:e.target.value})} placeholder="Ej. Horneros con experiencia"/></label>
    <label>Sede o zona<input maxLength={150} value={vacancy.locationLabel} onChange={e=>setVacancy({...vacancy,locationLabel:e.target.value})} placeholder="Ej. Santa Anita"/></label>
    <label>Teléfono WhatsApp para postulaciones<input inputMode="tel" value={vacancy.whatsappPhone} onChange={e=>setVacancy({...vacancy,whatsappPhone:e.target.value})} placeholder="9XXXXXXXX"/></label>
    <label>Modalidad<input maxLength={150} value={vacancy.employmentType} onChange={e=>setVacancy({...vacancy,employmentType:e.target.value})} placeholder="Ej. Full time"/></label>
    <label>Horario<input maxLength={200} value={vacancy.schedule} onChange={e=>setVacancy({...vacancy,schedule:e.target.value})}/></label>
    <label>Imagen de la vacante<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;void act(async()=>{const response=await fetch(`/api/admin/tenants/${tenantId}/images`,{method:'POST',credentials:'include',body:file});const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo subir la imagen');setVacancy(v=>({...v,imageUrl:data.url}));setMessage('Imagen cargada. Guarda la vacante y publica el catálogo.')})}}/></label>
    <label>Imagen cargada<input value={vacancy.imageUrl} readOnly/></label>
    <label>Descripción breve<textarea maxLength={500} value={vacancy.summary} onChange={e=>setVacancy({...vacancy,summary:e.target.value})}/></label>
    <label>Descripción del puesto<textarea maxLength={5000} value={vacancy.description} onChange={e=>setVacancy({...vacancy,description:e.target.value})}/></label>
    <label>Requisitos (uno por línea)<textarea maxLength={5000} value={vacancy.requirements} onChange={e=>setVacancy({...vacancy,requirements:e.target.value})}/></label>
   </div>
   {vacancy.imageUrl&&<img src={vacancy.imageUrl} alt="Vista previa de la vacante" style={{width:150,maxHeight:180,objectFit:'contain',borderRadius:12}}/>}
   <label className="ops-check"><input type="checkbox" checked={vacancy.active} onChange={e=>setVacancy({...vacancy,active:e.target.checked})}/>Vacante activa (visible al publicar)</label>
   <div className="ops-inline"><button className="button button-primary" disabled={loading||!vacancy.title.trim()||!vacancy.whatsappPhone.trim()} onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/vacancies`,'POST',vacancy);await refresh();setSavedArea('vacancies')})}>Guardar vacante</button>
    <button className="button button-secondary" onClick={()=>setVacancy(emptyVacancy())}>Nueva vacante</button>
   </div>
   {savedNext('vacancies')}<div className="ops-list">{vacancies.map(job=><button key={job.id} className="ops-row" onClick={()=>setVacancy({id:job.id,title:job.title,summary:job.summary,description:job.description,requirements:job.requirements,schedule:job.schedule,employmentType:job.employment_type,locationLabel:job.location_label,imageUrl:job.image_url||'',whatsappPhone:job.whatsapp_phone,active:job.active})}><strong>{job.title}</strong><span className={job.active?'ops-state ops-state--yes':'ops-state ops-state--no'}>{job.active?'Activa':'Desactivada'}</span><small>{job.location_label||'Sin sede definida'}</small></button>)}</div>
  </section>)}
  {activeArea==='promotions'&&(<section className="ops-panel"><p className="ops-global-note" role="status">Promociones compartidas de la empresa. No se restringen automáticamente a la sede desde la que accediste.</p><h2>Promociones de la aplicación</h2><p>La promoción no estará visible hasta publicar. Solo se muestra el título aprobado; no se inventan precios ni descuentos.</p><div className="ops-inline"><label>Nombre de la promoción<input placeholder="Ej. Promoción del fin de semana" value={promotionTitle} onChange={e=>setPromotionTitle(e.target.value)}/></label><label>Desde (opcional)<input type="datetime-local" value={promoStarts} onChange={e=>setPromoStarts(e.target.value)}/></label><label>Hasta (opcional)<input type="datetime-local" value={promoEnds} onChange={e=>setPromoEnds(e.target.value)}/></label><label className="ops-check"><input type="checkbox" checked={promotionEnabled} onChange={e=>setPromotionEnabled(e.target.checked)}/>Activa</label><button className="button button-secondary" disabled={!promotionTitle.trim()||loading} onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/promotions`,'POST',{title:promotionTitle,active:promotionEnabled,startsAt:promoStarts?new Date(promoStarts).toISOString():null,endsAt:promoEnds?new Date(promoEnds).toISOString():null});setPromotionTitle('');setSavedArea('promotions')})}>Guardar promoción</button></div>{savedNext('promotions')}</section>)}
  {activeArea==='payments'&&(<section className="ops-panel"><h2><CreditCard size={19}/> Pagos por local y modalidad</h2><div className="ops-inline"><label>Tipo de atención<select value={paymentMode} onChange={e=>setPaymentMode(e.target.value)}>{modes.map(m=><option key={m.key} value={m.key}>{m.name}</option>)}{paymentReservationEnabled&&<option value="reservation">Reserva</option>}</select></label><label>Medio de pago<select value={paymentMethod} onChange={e=>setPaymentMethod(e.target.value)}>{payments.map(p=><option key={p.key} value={p.key}>{p.name}</option>)}</select></label><label className="ops-check"><input type="checkbox" checked={paymentEnabled} onChange={e=>setPaymentEnabled(e.target.checked)}/>Habilitado</label><button className="button button-secondary" disabled={!paymentStore||loading} onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/payments`,'POST',{storeId:paymentStore,mode:paymentMode,method:paymentMethod,enabled:paymentEnabled});setSavedArea('payments')})}>Guardar</button></div>{savedNext('payments')}<p className="ops-hint">Los métodos de Reserva aparecen únicamente si la sede tiene reservas configuradas y habilitadas. Se aplican a reservas futuras de Delivery o Recojo, independientemente de los pagos inmediatos. Habilitar un medio no verifica ni realiza cobros.</p></section>)}
  {activeArea==='settings'&&(<section className="ops-panel"><h2>Libro de Reclamaciones · Enlace oficial</h2>
  <p>Ingresa únicamente la URL HTTPS del Libro de Reclamaciones real de la empresa seleccionada. La aplicación mostrará el botón de acceso después de publicar los cambios. Este campo no crea ni recibe reclamaciones.</p>
  <label>Dirección HTTPS del Libro de Reclamaciones<input type="url" value={complaintsBookUrl} placeholder="https://..." onChange={e=>setComplaintsBookUrl(e.target.value)} /></label>
  <button className="button button-secondary" disabled={loading||!tenantId} onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/complaints`,'POST',{appId,url:complaintsBookUrl.trim()});setSavedArea('settings')})}>Guardar enlace</button>{savedNext('settings')}
  <p className="ops-hint">Debe corresponder al Libro auténtico del proveedor y permitir obtener constancia del reclamo. Si está vacío, la aplicación informará que el acceso digital aún no está configurado; no simulará registros.</p>
  <div className="ops-divider" style={{margin:'24px 0',borderTop:'1px solid #e5e7eb'}}/>
  <h2>Seguimiento de pago · Notificaciones personales</h2>
  <p className="ops-hint">El plazo inicia cuando el pedido fue aceptado por la sede y la app presenta el total. Los avisos son individuales por dispositivo y solicitud; nunca se envían a un tema de promociones. La espera de respuesta del agente no tiene este plazo.</p>
  <div className="ops-grid">
   <label>Tiempo para continuar con el pago (minutos)
    <input type="number" min="5" max="30" step="1" value={paymentWaitMinutes} onChange={e=>setPaymentWaitMinutes(Number(e.target.value))}/>
   </label>
   <label>Recordatorios al cliente
    <select value={reminderCount} onChange={e=>setReminderCount(Number(e.target.value))}>
     <option value={0}>Sin recordatorios</option><option value={1}>1 recordatorio</option><option value={2}>2 recordatorios</option>
    </select>
   </label>
  </div>
  <p className="ops-hint">Ejemplo: a 10 minutos y 2 avisos, se programa un recordatorio aproximadamente a los minutos 3:20 y 6:40. Al vencimiento el pedido deja de ser pagable y se avisa a la sede. No se inicia otra conversación.</p>
  <button className="button button-primary" disabled={loading||!tenantId||!Number.isInteger(paymentWaitMinutes)||paymentWaitMinutes<5||paymentWaitMinutes>30}
   onClick={()=>void act(async()=>{const r=await api<{paymentWaitMinutes:number;reminderCount:number}>(`/api/admin/tenants/${tenantId}/checkout-settings`,'POST',{paymentWaitMinutes,reminderCount});setPaymentWaitMinutes(r.paymentWaitMinutes);setReminderCount(r.reminderCount);setMessage('Configuración de seguimiento de pago guardada para esta empresa.')})}>Guardar tiempo y recordatorios</button>
 </section>)}
 {activeArea==='publish'&&(<section className="ops-panel"><h2><Smartphone size={19}/> Aplicación y publicación</h2><div className="ops-inline"><input aria-label="Identificador de aplicación" placeholder="Identificador de la aplicación" value={appId} onChange={e=>setAppId(e.target.value)}/><button className="button button-secondary" disabled={loading||!appId.trim()} onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/apps`,'POST',{appId});setMessage('Aplicación registrada para esta empresa.')})}>Registrar aplicación</button><button className="button button-primary" disabled={loading||!appId.trim()} onClick={()=>void act(async()=>{const r=await api<{revision:number}>(`/api/admin/tenants/${tenantId}/publish`,'POST',{appId});setSavedArea('');setMessage(`Cambios publicados correctamente (revisión ${r.revision}). La aplicación ya puede consultar esta versión.`)})}><Send size={15}/> Publicar cambios</button></div><p className="ops-hint">El servidor bloquea la publicación a otra empresa o a una aplicación no registrada. No se envían pedidos ni se cobran pagos hasta completar ese módulo.</p></section>)}
  </>}
 </div>
}
