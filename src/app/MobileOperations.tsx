import { useEffect, useState, type FormEvent } from 'react'
import { ArrowLeft, ArrowRight, Bike, Building2, CalendarDays, Check, Clock3, Copy, CreditCard, MapPin, Package, Send, ShoppingBag, Store, Smartphone, Tag, Settings2, Bell } from 'lucide-react'

type Session = { role: 'SUPER_ADMIN' | 'TENANT_ADMIN'; tenantId: string | null }
type Tenant = { id: string; name: string; active: boolean }
type DayHours = {open:string;close:string}|{closed:true}
type OpeningHours = Partial<Record<'sun'|'mon'|'tue'|'wed'|'thu'|'fri'|'sat',DayHours>>
const weekdays = [{id:'mon',label:'Lunes'},{id:'tue',label:'Martes'},{id:'wed',label:'Miércoles'},{id:'thu',label:'Jueves'},{id:'fri',label:'Viernes'},{id:'sat',label:'Sábado'},{id:'sun',label:'Domingo'}] as const
type StoreRow = { delivery_preparation_minutes:number|null;pickup_preparation_minutes:number|null;code: string; opening_hours: OpeningHours|null; consult_order_availability: boolean; id: string; name: string; address: string; active: boolean; delivery_enabled: boolean; pickup_enabled: boolean; dine_in_enabled: boolean; latitude: number | null; longitude: number | null; radius_km: number | null; delivery_rate_per_km_pen: number | null; delivery_fee_pen: number | null; delivery_pricing_mode: 'PER_KM'|'FIXED' }
type ReservationSettings = {enabled:boolean;preparationMinutes:number|null}
const blankReservation = ():ReservationSettings => ({enabled:false,preparationMinutes:null})
type ProductRow = {id:string;name:string;description:string;category:string;price_pen:number;image_url:string|null;active:boolean}
type CompanyNotice = {id:string;title:string;message:string;imageUrl:string|null;scheduledAt:string;expiresAt:string;startDate:string;endDate:string;weekdays:number[]|null;runTime:string|null;status:'DRAFT'|'PUBLISHED'|'DISABLED';pushSentAt:string|null;pushError:string|null}
const limaDatetime=(iso:string)=>{const date=new Date(iso);if(Number.isNaN(date.getTime()))return '';const parts=Object.fromEntries(new Intl.DateTimeFormat('en-US',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date).filter(p=>p.type!=='literal').map(p=>[p.type,p.value]));return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`}
type VacancyRow = {id:string;title:string;summary:string;description:string;requirements:string;employment_type:string;location_label:string;store_ids:string[];image_url:string|null;whatsapp_phone:string;active:boolean}
const modes = [{key:'delivery',name:'Delivery'},{key:'reservation',name:'Reservación'},{key:'pickup',name:'Recojo en tienda'}]
const payments = [{key:'yape',name:'Yape'},{key:'plin',name:'Plin'},{key:'card',name:'Tarjeta'},{key:'cash',name:'Efectivo'}] as const
type PaymentMethod = typeof payments[number]['key']
type PaymentSelection = Record<PaymentMethod,boolean>
const blankPaymentSelection=():PaymentSelection=>({yape:false,plin:false,card:false,cash:false})
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
 const [storesLoaded,setStoresLoaded]=useState(false)
 const [moduleWarnings,setModuleWarnings]=useState<string[]>([])
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
 const blankProduct=()=>({id:'',name:'',description:'',category:'',pricePen:'',imageUrl:'',active:false})
 const [product,setProduct]=useState(blankProduct)
 const [productEditorOpen,setProductEditorOpen]=useState(false)
 const emptyVacancy=()=>({id:'',title:'',summary:'',description:'',requirements:'',employmentType:'Tiempo completo',storeIds:[] as string[],imageUrl:'',whatsappPhone:'',active:false})
 const [vacancy,setVacancy]=useState(emptyVacancy)
 const [paymentStore,setPaymentStore]=useState(''),[paymentMode,setPaymentMode]=useState('delivery')
 const [paymentSelection,setPaymentSelection]=useState<PaymentSelection>(blankPaymentSelection)
 const [paymentBaseline,setPaymentBaseline]=useState<PaymentSelection>(blankPaymentSelection)
 const [paymentLoading,setPaymentLoading]=useState(false)
 const [paymentLoadError,setPaymentLoadError]=useState('')
 const [paymentReload,setPaymentReload]=useState(0)
 const paymentDirty=payments.some(p=>paymentSelection[p.key]!==paymentBaseline[p.key])
 const [newTenantEmail,setNewTenantEmail]=useState(''),[newTenantPassword,setNewTenantPassword]=useState('')
 const [promotionTitle,setPromotionTitle]=useState(''),[promotionEnabled,setPromotionEnabled]=useState(false)
 const [promoStartDate,setPromoStartDate]=useState(''),[promoEndDate,setPromoEndDate]=useState('')
 const [promoStartTime,setPromoStartTime]=useState(''),[promoEndTime,setPromoEndTime]=useState('')
 const [promoDays,setPromoDays]=useState<number[]>([])
 const [appId,setAppId]=useState('')
  const [reservationStoreId,setReservationStoreId]=useState('')
 const [selectedStoreId,setSelectedStoreId]=useState('')
 const [storeFocus,setStoreFocus]=useState<'details'|'hours'|'delivery'|'pickup'>('details')
 const [reservationFlags,setReservationFlags]=useState<Record<string,boolean|null>>({})
  const [reservationSettings,setReservationSettings]=useState<ReservationSettings>(blankReservation)
  const [reservationLoading,setReservationLoading]=useState(false)
 const [noticeId,setNoticeId]=useState('')
 const [noticeTitle,setNoticeTitle]=useState('')
 const [noticeMessage,setNoticeMessage]=useState('')
 const [noticeImage,setNoticeImage]=useState('')
 const [noticeStarts,setNoticeStarts]=useState('')
 const [noticeExpires,setNoticeExpires]=useState('')
 const [noticeRunTime,setNoticeRunTime]=useState('')
 const [noticeWeekdays,setNoticeWeekdays]=useState<number[]>([])
 const [noticeEditStatus,setNoticeEditStatus]=useState<'DRAFT'|'PUBLISHED'|'DISABLED'>('DRAFT')
 const [notices,setNotices]=useState<CompanyNotice[]>([])
 const [noticesLoading,setNoticesLoading]=useState(false)
 const [noticesError,setNoticesError]=useState('')
 const [noticesReload,setNoticesReload]=useState(0)
 const [paymentWaitMinutes,setPaymentWaitMinutes]=useState(10)
 const [reminderCount,setReminderCount]=useState(2)
 const [remindersEnabled,setRemindersEnabled]=useState(false)
 const [reminderTitle,setReminderTitle]=useState('Tu compra está pendiente')
 const [reminderMessage,setReminderMessage]=useState('Continúa con el pago o cancela tu solicitud de Pollos B3.')
 const [reminder2Title,setReminder2Title]=useState('⏰ Tu pedido sigue pendiente')
 const [reminder2Message,setReminder2Message]=useState('Aún tienes un pago pendiente en Pollos B3. Entra a la app y completa tu pedido antes de que termine el plazo.')
 const [complaintsBookUrl,setComplaintsBookUrl]=useState('')
 const [loading,setLoading]=useState(false)
 const [savedArea,setSavedArea]=useState<string>('')
 const savedNext=(area:string)=>savedArea===area&&<div className="ops-save-next" role="status"><div className="ops-save-next-heading"><Check size={18}/><strong>Cambios guardados</strong></div><p>Los cambios están guardados. Para que aparezcan en la aplicación, debes publicarlos.</p><div className="ops-save-next-actions"><button type="button" className="button button-secondary" onClick={()=>setSavedArea('')}>Seguir editando</button><button type="button" className="button button-primary" onClick={()=>chooseArea('publish')}><Send size={15}/> Ir a publicar</button></div></div>
 const [activeArea,setActiveArea]=useState<'overview'|'local'|'stores'|'reservations'|'products'|'vacancies'|'promotions'|'payments'|'settings'|'commercial-notifications'|'publish'>('overview')
 const chooseArea=(area:typeof activeArea)=>{
  if(area===activeArea)return
  if(activeArea==='stores'&&hasUnsavedStoreChanges&&!window.confirm('Tienes cambios sin guardar en el local. ¿Quieres salir sin guardarlos?'))return
  setActiveArea(area);setSavedArea('');setStoreSavedNotice(false);setError('');setMessage('')
 }
 const act=async(fn:()=>Promise<void>)=>{setLoading(true);setError('');setMessage('');try{await fn()}catch(e){setError(e instanceof Error?e.message:'Error inesperado')}finally{setLoading(false)}}
 useEffect(()=>{if(embeddedSession){setSession(embeddedSession);setTenantId(scopedTenantId??embeddedSession.tenantId??'');return}void api<Session>('/api/admin/me').then(s=>{setSession(s);setTenantId(s.tenantId||'')}).catch(()=>{})},[embeddedSession,scopedTenantId])
 useEffect(()=>{if(!session)return;if(session.role==='SUPER_ADMIN'&&!embeddedSession)void api<{tenants:Tenant[]}>('/api/admin/tenants').then(r=>setTenants(r.tenants)).catch(e=>setError(e.message))},[session])
 const refresh=async(id=tenantId)=>{
  if(!id)return
  const [st,pr,jobs,apps,checkout]=await Promise.allSettled([
   api<{items:StoreRow[]}>(`/api/admin/tenants/${id}/stores`),
   api<{items:ProductRow[]}>(`/api/admin/tenants/${id}/products`),
   api<{items:VacancyRow[]}>(`/api/admin/tenants/${id}/vacancies`),
   api<{items:{app_id:string;complaints_book_url:string|null}[]}>(`/api/admin/tenants/${id}/apps`),
   api<{paymentWaitMinutes:number;reminderCount:number;remindersEnabled:boolean;reminderTitle:string;reminderMessage:string;reminder2Title:string;reminder2Message:string}>(`/api/admin/tenants/${id}/checkout-settings`)
  ])
  const warnings:string[]=[]
  if(st.status==='fulfilled'){
   setStores(st.value.items);setStoresLoaded(true)
   setReservationStoreId(previous=>st.value.items.some(local=>local.id===previous)?previous:st.value.items[0]?.id||'')
   setSelectedStoreId(previous=>st.value.items.some(local=>local.id===previous)?previous:'')
  }else{
   setStoresLoaded(false)
   setError('No se pudieron cargar los locales. '+(st.reason instanceof Error?st.reason.message:'Revisa el servidor del Administrador.'))
  }
  if(pr.status==='fulfilled')setProducts(pr.value.items)
  else warnings.push('Productos')
  if(jobs.status==='fulfilled')setVacancies(jobs.value.items)
  else warnings.push('Empleo / Vacantes (revisar migración 015)')
  if(apps.status==='fulfilled'){
   const current=apps.value.items.find(x=>x.app_id===appId)??(appId===''&&apps.value.items.length===1?apps.value.items[0]:undefined)
   if(current&&appId==='')setAppId(current.app_id)
   setComplaintsBookUrl(current?.complaints_book_url||'')
  }else warnings.push('Aplicaciones')
  if(checkout.status==='fulfilled'){
   setPaymentWaitMinutes(checkout.value.paymentWaitMinutes)
   setReminderCount(checkout.value.reminderCount)
   setRemindersEnabled(checkout.value.remindersEnabled)
   setReminderTitle(checkout.value.reminderTitle)
   setReminderMessage(checkout.value.reminderMessage)
   setReminder2Title(checkout.value.reminder2Title)
   setReminder2Message(checkout.value.reminder2Message)
  }else warnings.push('Notificaciones / Seguimiento de pago (revisar migración 007)')
  setModuleWarnings(warnings)
 }

 useEffect(()=>{if(session&&tenantId){setStoresLoaded(false);setModuleWarnings([]);setError('');void refresh(tenantId).catch(e=>setError(e.message))}},[tenantId,session])
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
  if(activeArea!=='commercial-notifications'||!tenantId)return
  let live=true;setNoticesLoading(true);setNoticesError('')
  void api<{items:CompanyNotice[]}>(`/api/admin/tenants/${tenantId}/mobile-notifications`)
   .then(result=>{if(live)setNotices(result.items)})
   .catch(e=>{if(live)setNoticesError(e instanceof Error?e.message:'No se pudieron cargar los avisos')})
   .finally(()=>{if(live)setNoticesLoading(false)})
  return ()=>{live=false}
 },[activeArea,tenantId,noticesReload])
 useEffect(()=>{
  if(activeArea!=='payments'||!tenantId||!paymentStore){
   setPaymentLoading(false);setPaymentSelection(blankPaymentSelection());setPaymentBaseline(blankPaymentSelection());setPaymentLoadError('');return
  }
  let active=true
  setPaymentLoading(true);setPaymentLoadError('')
  setPaymentSelection(blankPaymentSelection());setPaymentBaseline(blankPaymentSelection())
  void api<{items:{store_id:string;mode:string;method:string;enabled:boolean}[]}>(`/api/admin/tenants/${tenantId}/payments`)
   .then(response=>{
    if(!active)return
    const next=blankPaymentSelection()
    for(const entry of response.items){
     if(entry.store_id===paymentStore&&entry.mode===paymentMode&&
      payments.some(item=>item.key===entry.method)){
      next[entry.method as PaymentMethod]=entry.enabled===true
     }
    }
    setPaymentSelection(next);setPaymentBaseline({...next})
   })
   .catch(error=>{if(active)setPaymentLoadError(error instanceof Error?error.message:'No se pudieron consultar los medios de pago')})
   .finally(()=>{if(active)setPaymentLoading(false)})
  return ()=>{active=false}
 },[activeArea,tenantId,paymentStore,paymentMode,paymentReload])
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
   {moduleWarnings.length>0&&<p role="status" className="ops-global-note">Algunos módulos no pudieron cargar: {moduleWarnings.join(', ')}. Puedes consultar tus locales mientras se corrige el módulo afectado.</p>}
   <div className="ops-local-grid">{!storesLoaded?<div className="ops-panel" role="status">No se pudo completar la carga de locales. No significa que se hayan eliminado; revisa el error del servidor.</div>:stores.length===0?<div className="ops-panel">Todavía no hay locales registrados.</div>:stores.map(local=><button type="button" className="ops-local-card" key={local.id} onClick={()=>enterLocal(local)}><span className="ops-card-icon"><Store size={23}/></span><span className="ops-card-status" data-enabled={local.active}>{local.active?'Activo':'Inactivo'}</span><strong>{local.name}</strong><span className="ops-card-address"><MapPin size={14}/>{local.address||'Dirección sin configurar'}</span><span className="ops-card-tags"><span data-on={local.delivery_enabled}>Delivery {local.delivery_enabled?'· Sí':'· No'}</span><span data-on={local.pickup_enabled}>Recojo {local.pickup_enabled?'· Sí':'· No'}</span><span data-on={reservationFlags[local.id]===true}>Reserva {reservationFlags[local.id]===undefined?'· Consultando':reservationFlags[local.id]===null?'· Sin datos':reservationFlags[local.id]?'· Sí':'· No'}</span></span><span className="ops-card-link">Configurar local <ArrowRight size={16}/></span></button>)}</div>
  </section>}
  {activeArea==='overview'&&<section className="ops-workspace" aria-label="Notificaciones para el cliente">
   <div className="ops-workspace-head"><div><h2>Notificaciones para el cliente</h2><p>Configuración de avisos al celular y recordatorios personales de pago para todas las sedes de la empresa.</p></div></div>
   <div className="ops-module-grid">
    <button type="button" className="ops-module-card" onClick={()=>chooseArea('commercial-notifications')}>
     <Bell size={24}/><strong>Notificaciones para el cliente</strong>
     <span>Avisos comerciales, contenido para el celular y recordatorios de pago · Todas las sedes</span>
     <ArrowRight className="ops-card-arrow" size={17}/>
    </button>
   </div>
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
     {title:'Formas de pago',focus:'details',subtitle:'Delivery, Reservación y Recojo en tienda',icon:CreditCard,action:'payments',on:true}
    ] as const).map(item=><button type="button" className="ops-module-card" key={item.title} onClick={()=>enterLocalModule(item.action,item.focus)}><item.icon size={24}/><strong>{item.title}</strong><span>{item.subtitle}</span>{!item.on&&<span className="ops-module-state" data-enabled={false}>Deshabilitado</span>}<ArrowRight className="ops-card-arrow" size={17}/></button>)}{([
      {area:'products',title:'Productos',subtitle:'Catálogo maestro de la empresa · compartido',icon:Package},
      {area:'promotions',title:'Promociones',subtitle:'Promociones generales · compartidas',icon:Tag},
      {area:'vacancies',title:'Empleo',subtitle:'Vacantes de la empresa · compartidas',icon:Store},
      {area:'settings',title:'Datos de la empresa',subtitle:'Configuración general · compartida',icon:Settings2},
      {area:'publish',title:'Publicar cambios',subtitle:'Publicación del catálogo de la empresa',icon:Send}
     ] as const).map(item=><button type="button" className="ops-module-card" key={item.area} onClick={()=>chooseArea(item.area)}><item.icon size={24}/><strong>{item.title}</strong><span>{item.subtitle}</span><span className="ops-module-state" data-enabled={false}>Compartida</span><ArrowRight className="ops-card-arrow" size={17}/></button>)}</div>
    <p className="ops-global-note">Las tarjetas marcadas como compartidas abren formularios generales de la empresa; aún no realizan cambios exclusivos en este local. La personalización por sede requiere API y persistencia adicionales.</p>
   </section>}
  {!['overview','local'].includes(activeArea)&&<div className="ops-context-bar"><button type="button" className="ops-back" onClick={()=>chooseArea(selectedStore&&['stores','reservations','payments'].includes(activeArea)?'local':'overview')}><ArrowLeft size={16}/> {selectedStore&&['stores','reservations','payments'].includes(activeArea)?'Volver a '+selectedStore.name:'Volver a empresas y locales'}</button><span>{selectedStore&&['stores','reservations','payments'].includes(activeArea)?'Local: '+selectedStore.name:'Configuración general de la empresa · todas las sedes'}</span></div>}
  {activeArea==='settings'&&session.role==='SUPER_ADMIN'&&!embeddedSession&&<section className="ops-panel"><h2>Acceso del administrador de empresa</h2><p>Solo el superadministrador puede crear credenciales para el tenant seleccionado.</p><div className="ops-inline"><input type="email" placeholder="Correo del administrador" value={newTenantEmail} onChange={e=>setNewTenantEmail(e.target.value)}/><input type="password" placeholder="Contraseña segura (mín. 14)" value={newTenantPassword} onChange={e=>setNewTenantPassword(e.target.value)}/><button className="button button-secondary" disabled={loading} onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/users`,'POST',{email:newTenantEmail,password:newTenantPassword});setNewTenantPassword('');setNewTenantEmail('');setMessage('Administrador creado exclusivamente para esta empresa.')})}>Crear administrador</button></div></section>}
  {activeArea==='stores'&&(selectedStoreId?<section className="ops-panel ops-store-single-panel" aria-label={'Editar '+(selectedStore?.name||'local')}>{renderStoreEditor()}</section>:(<section className="ops-panel"><h2><Store size={19}/> Locales y horarios</h2><p>Configura los datos del local, sus modalidades de atención y horarios.</p><div className="ops-sede-header"><div><h3>Sedes creadas</h3><p className="ops-hint">Consulta rápidamente el estado de tus sedes y selecciona cuál quieres editar.</p></div><button type="button" className="button button-primary" onClick={()=>{setSelectedStoreId('');setStoreFocus('details');selectStoreForEditing(emptyStore())}}>Nueva sede</button></div><div className="ops-sede-list" aria-label="Sedes creadas">{stores.length===0?<p className="ops-hint">Todavía no hay sedes creadas. Selecciona «Nueva sede» para comenzar.</p>:stores.filter(s=>!selectedStoreId||s.id===selectedStoreId).map(s=><div key={s.id} className="ops-sede-card"><div className="ops-sede-info"><strong className="ops-sede-name">{s.name}</strong><div className="ops-sede-states"><span className={s.active?'ops-state ops-state--yes':'ops-state ops-state--no'}>{s.active?'Activa':'Desactivada'}</span><span className="ops-sede-consult">Consulta TU VERSO: <span className={s.consult_order_availability?'ops-state ops-state--yes':'ops-state ops-state--no'}>{s.consult_order_availability?'Sí':'No'}</span></span></div></div><div className="ops-sede-actions"><button type="button" className="button button-primary" onClick={()=>selectStoreForEditing(storeEditorValue(s))} aria-expanded={storeEditorOpen&&store.id===s.id} aria-controls={`sede-editor-${s.id}`}>Editar sede</button><button type="button" className="button button-secondary" aria-label={`Copiar ID de ${s.name}`} onClick={()=>void copyStoreCode(s.code)}><Copy size={15}/>{copiedStoreCode===s.code?'Copiado':'Copiar ID'}</button></div>{storeEditorOpen&&store.id===s.id&&renderStoreEditor()}</div>)}</div>{storeEditorOpen&&!store.id&&renderStoreEditor()}</section>))}
  {activeArea==='reservations'&&(<section className="ops-panel"><h2>Reservas — {selectedStore?.name||stores.find(s=>s.id===reservationStoreId)?.name||'Local'}</h2>
    <p className="ops-hint">Habilita reservas para esta sede y establece su tiempo de preparación. Para solicitar una reserva se requiere también la modalidad de entrega habilitada y un agente disponible en TU VERSO. El horario público del local es informativo.</p>
    {reservationStoreId&&(reservationLoading?<p role="status">Cargando configuración de esta sede...</p>:<>
     <label className="ops-check"><input type="checkbox" checked={reservationSettings.enabled}
      onChange={e=>setReservationSettings({...reservationSettings,enabled:e.target.checked})}/>Habilitar reservas en este local</label>
     <div className="ops-grid">
      <label>Tiempo de preparación (minutos)<input type="number" min="1" max="240" step="1"
       value={reservationSettings.preparationMinutes??''}
       onChange={e=>setReservationSettings({...reservationSettings,preparationMinutes:e.target.value===''?null:Number(e.target.value)})}/></label>
     </div>
     <p className="ops-hint">No se configuran horarios ni anticipaciones de reserva. El cliente propone una fecha y hora futuras; el agente conectado a TU VERSO acepta o rechaza la solicitud. El tiempo de preparación no inicia un temporizador de atención al agente.</p>
     <button className="button button-primary" disabled={loading||reservationLoading||!tenantId}
      onClick={()=>void act(async()=>{const saved=await api<ReservationSettings>(`/api/admin/tenants/${tenantId}/stores/${reservationStoreId}/reservation-settings`,'POST',reservationSettings);setReservationSettings(saved);setReservationFlags(current=>({...current,[reservationStoreId]:saved.enabled}));setSavedArea('reservations')})}>Guardar configuración de reservas</button>
     {savedNext('reservations')}
    </>)}
   </section>)}
  {activeArea==='products'&&(<section className="ops-panel ops-products-panel">
   <p className="ops-global-note" role="status">Catálogo compartido de la empresa. Los cambios afectan a todas las sedes; los precios y la disponibilidad por sede requieren configuración adicional.</p>
   <div className="ops-products-heading">
    <div><h2><Package size={19}/> Catálogo de productos y fotografías</h2>
     <p className="ops-hint">Consulta primero los productos registrados. Abre uno para editarlo o crea uno nuevo cuando lo necesites.</p></div>
    <button type="button" className="button button-primary" disabled={loading}
     onClick={()=>{setProduct(blankProduct());setProductEditorOpen(true);setSavedArea('')}}>
     + Nuevo producto</button>
   </div>
   {!productEditorOpen?<>
    <div className="ops-record-list"><h3>Productos registrados ({products.length})</h3>
     {products.length===0?<p className="ops-hint">Todavía no hay productos registrados. Selecciona «Nuevo producto» para agregar el primero.</p>:
      products.map(item=><div key={item.id} className="ops-record-row ops-product-row">
       <div className="ops-product-info"><strong>{item.name}</strong>
        <small>{item.category||'Sin categoría'}</small></div>
       <span>S/ {Number(item.price_pen).toFixed(2)}</span>
       <span className={item.active?"ops-state ops-state--yes":"ops-state ops-state--no"}>{item.active?"Disponible":"No disponible"}</span>
       <button type="button" className="button button-secondary" disabled={loading} onClick={()=>{
        setProduct({id:item.id,name:item.name,description:item.description||'',category:item.category||'',
         pricePen:String(item.price_pen),imageUrl:item.image_url||'',active:item.active})
        setProductEditorOpen(true);setSavedArea('')
       }}>Editar producto</button>
      </div>)}
    </div>
   </>:<>
    <div className="ops-products-editor-head">
     <h3>{product.id?'Editar producto':'Nuevo producto'}</h3>
     <button type="button" className="button button-secondary" disabled={loading}
      onClick={()=>{setProductEditorOpen(false);setProduct(blankProduct())}}>Volver al catálogo</button>
    </div>
    <div className="ops-grid">
     <label>Nombre<input maxLength={180} value={product.name} onChange={e=>setProduct({...product,name:e.target.value})}/></label>
     <label>Categoría<input value={product.category} onChange={e=>setProduct({...product,category:e.target.value})}/></label>
     <label>Precio S/<input type="number" step="0.01" min="0" value={product.pricePen}
      onChange={e=>setProduct({...product,pricePen:e.target.value})}/></label>
     <label>Descripción<textarea rows={3} value={product.description}
      onChange={e=>setProduct({...product,description:e.target.value})}/></label>
     <label>Imagen (opcional)<input type="file" accept="image/png,image/jpeg,image/webp"
      onChange={e=>{const file=e.target.files?.[0];if(!file)return;void act(async()=>{
       const response=await fetch(`/api/admin/tenants/${tenantId}/images`,{
        method:'POST',credentials:'include',body:file
       })
       const data=await response.json()
       if(!response.ok)throw new Error(data.error||'No se pudo subir la imagen')
       setProduct(previous=>({...previous,imageUrl:data.url}))
       setMessage('Imagen cargada. Guarda y publica el producto para mostrar el cambio en la aplicación.')
      })}}/></label>
    </div>
    {product.imageUrl&&<div className="ops-product-image">
     <img src={product.imageUrl.startsWith('/api/v1/mobile/images/')?
      product.imageUrl.replace('/api/v1/mobile/images/',`/api/admin/tenants/${tenantId}/images/`):
      product.imageUrl} alt={`Imagen de ${product.name||'producto'}`} />
     <button type="button" className="button button-secondary" disabled={loading}
      onClick={()=>setProduct({...product,imageUrl:''})}>Quitar imagen</button>
    </div>}
    <label className="ops-check"><input type="checkbox" checked={product.active}
     onChange={e=>setProduct({...product,active:e.target.checked})}/>Producto disponible</label>
    <div className="ops-inline">
     <button type="button" className="button button-primary" disabled={loading||!product.name.trim()||
      product.pricePen===''||!Number.isFinite(Number(product.pricePen))||Number(product.pricePen)<0}
      onClick={()=>void act(async()=>{
       await api(`/api/admin/tenants/${tenantId}/products`,'POST',{
        ...product,pricePen:Number(product.pricePen)
       })
       await refresh()
       setProduct(blankProduct());setProductEditorOpen(false);setSavedArea('products')
      })}>{product.id?'Guardar cambios':'Crear producto'}</button>
     <button type="button" className="button button-secondary" disabled={loading}
      onClick={()=>{setProduct(blankProduct());setProductEditorOpen(false)}}>Cancelar</button>
    </div>
   </>}
   {!productEditorOpen&&savedNext('products')}
  </section>)}
  {activeArea==='vacancies'&&(<section className="ops-panel ops-vacancy-panel">
   <h2><Store size={19}/> Trabaja con nosotros · Vacantes</h2>
   <p className="ops-hint">Selecciona una o varias sedes activas para esta vacante. La publicación mostrará las sedes seleccionadas; no se podrán asignar locales inactivos.</p>
   <div className="ops-grid">
    <label>Puesto<input maxLength={150} value={vacancy.title} onChange={e=>setVacancy({...vacancy,title:e.target.value})} placeholder="Nombre del puesto"/></label>
    <label>Teléfono WhatsApp para postulaciones<input inputMode="tel" value={vacancy.whatsappPhone} onChange={e=>setVacancy({...vacancy,whatsappPhone:e.target.value})} placeholder="9XXXXXXXX"/></label>
    <label>Modalidad<select value={vacancy.employmentType} onChange={e=>setVacancy({...vacancy,employmentType:e.target.value})}>
     <option value="Tiempo completo">Tiempo completo</option><option value="Medio tiempo">Medio tiempo</option>
    </select></label>
   </div>
   <fieldset className="ops-vacancy-stores"><legend>Sedes donde aplica la vacante</legend>
    <div className="ops-vacancy-store-grid">
     {stores.filter(s=>s.active).map(local=><label key={local.id} className={vacancy.storeIds.includes(local.id)?'ops-vacancy-store is-selected':'ops-vacancy-store'}>
      <input type="checkbox" checked={vacancy.storeIds.includes(local.id)}
       onChange={e=>setVacancy(previous=>({...previous,storeIds:e.target.checked?
        [...previous.storeIds,local.id]:previous.storeIds.filter(id=>id!==local.id)}))}/>
      <span>{local.name}</span>
     </label>)}
    </div>
    {stores.every(s=>!s.active)&&<p className="ops-hint">No hay sedes activas. Habilita al menos una sede para crear una vacante.</p>}
   </fieldset>
   <div className="ops-grid">
    <label>Imagen de la vacante (opcional)<input type="file" accept="image/png,image/jpeg,image/webp" onChange={e=>{const file=e.target.files?.[0];if(!file)return;void act(async()=>{const response=await fetch(`/api/admin/tenants/${tenantId}/images`,{method:'POST',credentials:'include',body:file});const data=await response.json();if(!response.ok)throw new Error(data.error||'No se pudo subir la imagen');setVacancy(v=>({...v,imageUrl:data.url}));setMessage('Imagen cargada. Guarda la vacante y publica el catálogo.')})}}/></label>
    <label>Descripción breve<textarea maxLength={500} value={vacancy.summary} onChange={e=>setVacancy({...vacancy,summary:e.target.value})}/></label>
    <label>Descripción del puesto<textarea maxLength={5000} value={vacancy.description} onChange={e=>setVacancy({...vacancy,description:e.target.value})}/></label>
    <label>Requisitos (uno por línea)<textarea maxLength={5000} value={vacancy.requirements} onChange={e=>setVacancy({...vacancy,requirements:e.target.value})}/></label>
   </div>
   {vacancy.imageUrl&&<img src={vacancy.imageUrl} alt="Vista previa de la vacante" style={{width:150,maxHeight:180,objectFit:'contain',borderRadius:12}}/>}
   <label className="ops-check"><input type="checkbox" checked={vacancy.active} onChange={e=>setVacancy({...vacancy,active:e.target.checked})}/>Vacante activa (visible al publicar)</label>
   <div className="ops-inline">
    <button className="button button-primary" disabled={loading||!vacancy.title.trim()||!vacancy.whatsappPhone.trim()||vacancy.storeIds.length===0}
     onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/vacancies`,'POST',vacancy);await refresh();setSavedArea('vacancies')})}>Guardar vacante</button>
    <button className="button button-secondary" onClick={()=>setVacancy(emptyVacancy())}>Nueva vacante</button>
   </div>
   {savedNext('vacancies')}
   <div className="ops-list">{vacancies.map(job=><button key={job.id} className="ops-row"
    onClick={()=>setVacancy({id:job.id,title:job.title,summary:job.summary,description:job.description,
     requirements:job.requirements,employmentType:job.employment_type==='Medio tiempo'?'Medio tiempo':'Tiempo completo',
     storeIds:job.store_ids||[],imageUrl:job.image_url||'',whatsappPhone:job.whatsapp_phone,active:job.active})}>
    <strong>{job.title}</strong>
    <span className={job.active?'ops-state ops-state--yes':'ops-state ops-state--no'}>{job.active?'Activa':'Desactivada'}</span>
    <small>{(job.store_ids||[]).map(id=>stores.find(s=>s.id===id)?.name).filter(Boolean).join(', ')||'Sin sedes asignadas'}</small>
   </button>)}</div>
  </section>)}
  {activeArea==='promotions'&&(<section className="ops-panel ops-promo-panel">
    <p className="ops-global-note" role="status">Promociones compartidas de la empresa. No se restringen automáticamente a la sede desde la que accediste.</p>
    <h2>Promociones de la aplicación</h2>
    <p className="ops-hint">Elige un periodo de fechas, las horas de actividad y los días de la semana. La promoción no será visible hasta publicar los cambios. Solo se mostrará el título aprobado.</p>
    <div className="ops-promo-fields">
     <label>Nombre de la promoción<input placeholder="Ej. Promoción del fin de semana"
      value={promotionTitle} onChange={e=>setPromotionTitle(e.target.value)}/></label>
     <label>Fecha de inicio<input type="date" value={promoStartDate}
      onChange={e=>setPromoStartDate(e.target.value)}/></label>
     <label>Fecha de fin<input type="date" min={promoStartDate||undefined} value={promoEndDate}
      onChange={e=>setPromoEndDate(e.target.value)}/></label>
    </div>
    <div className="ops-promo-time-fields">
     <label>Hora de inicio<input type="time" value={promoStartTime}
      onChange={e=>setPromoStartTime(e.target.value)}/></label>
     <label>Hora de fin<input type="time" value={promoEndTime}
      onChange={e=>setPromoEndTime(e.target.value)}/></label>
    </div>
    <fieldset className="ops-promo-weekdays"><legend>Días en los que estará activa</legend>
     <div className="ops-promo-days">
      {([{value:1,name:'Lunes'},{value:2,name:'Martes'},{value:3,name:'Miércoles'},
       {value:4,name:'Jueves'},{value:5,name:'Viernes'},{value:6,name:'Sábado'},
       {value:7,name:'Domingo'}] as const).map(day=><label key={day.value} className={promoDays.includes(day.value)?'ops-promo-day is-selected':'ops-promo-day'}>
       <input type="checkbox" checked={promoDays.includes(day.value)}
        onChange={e=>setPromoDays(prev=>e.target.checked?[...prev,day.value].sort((a,b)=>a-b):prev.filter(n=>n!==day.value))}/>
       {day.name}
      </label>)}
     </div>
    </fieldset>
    <div className="ops-promo-actions"><label className="ops-check">
     <input type="checkbox" checked={promotionEnabled} onChange={e=>setPromotionEnabled(e.target.checked)}/>
     Promoción activa</label>
     <button className="button button-primary" disabled={loading||!promotionTitle.trim()||!promoStartDate||
      !promoEndDate||promoStartDate>promoEndDate||!promoStartTime||!promoEndTime||
      promoStartTime>=promoEndTime||promoDays.length===0}
      onClick={()=>void act(async()=>{
       await api(`/api/admin/tenants/${tenantId}/promotions`,'POST',{
        title:promotionTitle.trim(),active:promotionEnabled,startDate:promoStartDate,
        endDate:promoEndDate,startTime:promoStartTime,endTime:promoEndTime,weekdays:promoDays
       })
       setPromotionTitle('');setPromotionEnabled(false);setPromoStartDate('');setPromoEndDate('')
       setPromoStartTime('');setPromoEndTime('');setPromoDays([]);setSavedArea('promotions')
      })}>Guardar promoción</button>
    </div>
    <p className="ops-hint">La franja horaria pertenece a cada día marcado (hora de inicio anterior a la de fin). La aplicación aplica la hora local de la empresa. Una promoción guardada no aparecerá hasta publicarla.</p>
    {savedNext('promotions')}
   </section>)}
  {activeArea==='payments'&&(<section className="ops-panel ops-payment-panel">
    <h2><CreditCard size={19}/> Pagos por local y modalidad</h2>
    <p className="ops-hint">Configura los métodos de pago de {selectedStore?.name||'este local'} para cada modalidad de forma independiente.</p>
    <div className="ops-payment-head"><label>Tipo de atención
     <select value={paymentMode} disabled={loading||paymentLoading} onChange={e=>{setSavedArea('');setPaymentMode(e.target.value)}}>
      {modes.map(m=><option key={m.key} value={m.key}>{m.name}</option>)}
     </select></label></div>
    <h3>Medios de pago habilitados</h3>
    {paymentLoading?<p role="status" className="ops-hint">Cargando medios de pago...</p>:
     paymentLoadError?<div role="alert" className="ops-error">{paymentLoadError} <button type="button" className="button button-secondary" onClick={()=>setPaymentReload(x=>x+1)}>Reintentar</button></div>:
     <div className="ops-payment-method-grid">{payments.map(method=>
      <label className="ops-payment-method" key={method.key}>
       <input type="checkbox" disabled={loading} checked={paymentSelection[method.key]}
        onChange={e=>{setSavedArea('');setPaymentSelection(current=>({...current,[method.key]:e.target.checked}))}}/>
       <span>{method.name}</span>
       <span className="ops-payment-status">{paymentSelection[method.key]?'Habilitado':'Deshabilitado'}</span>
      </label>
     )}</div>}
    <button type="button" className="button button-primary" disabled={!paymentStore||loading||paymentLoading||!!paymentLoadError||!paymentDirty}
     onClick={()=>void act(async()=>{
      await api(`/api/admin/tenants/${tenantId}/payments`,'POST',
       {storeId:paymentStore,mode:paymentMode,methods:paymentSelection})
      setPaymentBaseline({...paymentSelection})
      setSavedArea('payments')
     })}>Guardar métodos de pago</button>
    {savedNext('payments')}
    <p className="ops-hint">Las tres modalidades se pueden configurar aunque aún no estén habilitadas en el local. Habilitar un medio no verifica ni realiza cobros, ni activa el servicio por sí solo.</p>
   </section>)}
  {activeArea==='settings'&&(<section className="ops-panel"><h2>Libro de Reclamaciones · Enlace oficial</h2>
  <p>Ingresa únicamente la URL HTTPS del Libro de Reclamaciones real de la empresa seleccionada. La aplicación mostrará el botón de acceso después de publicar los cambios. Este campo no crea ni recibe reclamaciones.</p>
  <label>Dirección HTTPS del Libro de Reclamaciones<input type="url" value={complaintsBookUrl} placeholder="https://..." onChange={e=>setComplaintsBookUrl(e.target.value)} /></label>
  <button className="button button-secondary" disabled={loading||!tenantId} onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/complaints`,'POST',{appId,url:complaintsBookUrl.trim()});setSavedArea('settings')})}>Guardar enlace</button>{savedNext('settings')}
  <p className="ops-hint">Debe corresponder al Libro auténtico del proveedor y permitir obtener constancia del reclamo. Si está vacío, la aplicación informará que el acceso digital aún no está configurado; no simulará registros.</p>
 </section>)}
 {activeArea==='commercial-notifications'&&(<section className="ops-panel ops-marketing-panel">
  <h2><Bell size={19}/> Notificaciones para el cliente · Avisos al celular</h2>
  <p className="ops-hint">Configura los avisos comerciales para los clientes de todas las sedes. Más abajo encontrarás la configuración de recordatorios personales de pago, dentro de este mismo módulo.</p>
  <div className="ops-marketing-layout">
   <div className="ops-marketing-fields">
    <label>Título de la notificación<input maxLength={120} value={noticeTitle} placeholder="Título que verá el cliente"
     onChange={e=>setNoticeTitle(e.target.value)}/></label>
    <label>Mensaje del aviso<textarea rows={4} maxLength={1000} value={noticeMessage}
     onChange={e=>setNoticeMessage(e.target.value)} placeholder="Descripción que recibirá el celular"/></label>
    <label>Imagen (opcional)<input type="file" accept="image/png,image/jpeg,image/webp"
     onChange={e=>{const file=e.target.files?.[0];if(!file)return;void act(async()=>{
      const response=await fetch(`/api/admin/tenants/${tenantId}/images`,{method:'POST',credentials:'include',body:file})
      const data=await response.json()
      if(!response.ok)throw new Error(data.error||'No se pudo cargar la imagen')
      setNoticeImage(data.url);setMessage('Imagen agregada al aviso.')
     })}}/></label>
    {noticeImage&&<button type="button" className="button button-secondary" onClick={()=>setNoticeImage('')}>Quitar imagen</button>}
    <div className="ops-marketing-time">
     <label>Fecha de inicio<input type="date" value={noticeStarts}
      onChange={e=>setNoticeStarts(e.target.value)}/></label>
     <label>Fecha de fin<input type="date" min={noticeStarts||undefined} value={noticeExpires}
      onChange={e=>setNoticeExpires(e.target.value)}/></label>
    </div>
    <fieldset className="ops-notice-weekdays">
     <legend>Días de ejecución</legend>
     <div className="ops-notice-days">
      {([{day:1,label:'Lunes'},{day:2,label:'Martes'},{day:3,label:'Miércoles'},
       {day:4,label:'Jueves'},{day:5,label:'Viernes'},{day:6,label:'Sábado'},
       {day:7,label:'Domingo'}] as const).map(option=><label key={option.day} className="ops-notice-day">
       <input type="checkbox" checked={noticeWeekdays.includes(option.day)}
        onChange={event=>setNoticeWeekdays(prev=>event.target.checked?
         [...prev,option.day].sort((a,b)=>a-b):prev.filter(n=>n!==option.day))}/>
       {option.label}
      </label>)}
     </div>
    </fieldset>
    <label>Hora de ejecución (Perú UTC−5)<input type="time" value={noticeRunTime}
     onChange={e=>setNoticeRunTime(e.target.value)}/></label>
    <p className="ops-hint">Se intentará un envío por cada día marcado, a la hora indicada, entre las fechas de inicio y fin. No se envían varias notificaciones el mismo día.</p>
    <div className="ops-inline">
     <button type="button" className="button button-primary" disabled={loading||noticesLoading||
      !noticeTitle.trim()||!noticeMessage.trim()||!noticeStarts||!noticeExpires||noticeExpires<noticeStarts||!noticeRunTime||noticeWeekdays.length===0||noticeEditStatus==='DISABLED'}
      onClick={()=>void act(async()=>{
       const saved=await api<CompanyNotice>(`/api/admin/tenants/${tenantId}/mobile-notifications`,'POST',{
        action:'save',...(noticeId?{id:noticeId}:{}),title:noticeTitle,message:noticeMessage,imageUrl:noticeImage,
        startDate:noticeStarts,endDate:noticeExpires,runTime:noticeRunTime,weekdays:noticeWeekdays
       });setNoticeId(saved.id);setNoticesReload(x=>x+1);setMessage(saved.status==='PUBLISHED'?'Frecuencia del aviso publicado actualizada. Los envíos anteriores permanecen registrados.':'Borrador guardado. Revisa la vista previa y luego publícalo.')
      })}>{noticeEditStatus==='PUBLISHED'?'Guardar cambios':'Guardar borrador'}</button>
     <button type="button" className="button button-secondary" onClick={()=>{
      setNoticeId('');setNoticeTitle('');setNoticeMessage('');setNoticeImage('');setNoticeStarts('');setNoticeExpires('');setNoticeRunTime('');setNoticeWeekdays([]);setNoticeEditStatus('DRAFT')
     }}>Nuevo aviso</button>
    </div>
   </div>
   <div className="ops-marketing-preview" aria-label="Vista previa en celular">
    <div className="ops-marketing-phone">
     <div className="ops-marketing-phone-head"><Bell size={15}/> Pollos B3 · Vista previa</div>
     <strong>{noticeTitle||'Título del aviso'}</strong>
     <p>{noticeMessage||'Aquí aparecerá la descripción que recibirá el cliente.'}</p>
     {noticeImage&&<img src={noticeImage.replace("/api/v1/mobile/images/",`/api/admin/tenants/${tenantId}/images/`)} alt="Imagen del aviso"/>}
     <small>Detalle disponible en la aplicación mientras esté vigente</small>
    </div>
    <p className="ops-hint">Esta vista previa no envía notificaciones.</p>
   </div>
  </div>
  <h3>Avisos guardados</h3>
  {noticesLoading?<p role="status">Cargando avisos...</p>:noticesError?<p role="alert">{noticesError}
   <button className="button button-secondary" onClick={()=>setNoticesReload(x=>x+1)}>Reintentar</button></p>:
   notices.length===0?<p className="ops-hint">Aún no hay avisos comerciales de la empresa.</p>:
   <div className="ops-marketing-list">{notices.map(n=><div key={n.id} className="ops-marketing-list-item">
    <div><strong>{n.title}</strong><p>{n.status==='DRAFT'?'Borrador':n.status==='PUBLISHED'?'Publicado':'Desactivado'}
      {n.pushSentAt?' · Último envío aceptado por FCM: '+limaDatetime(n.pushSentAt).replace('T',' '):n.pushError?' · Error de envío FCM':' · Sin envío push confirmado'}</p>
      <small>{n.startDate} — {n.endDate} · {n.runTime||'Ejecución única'} · {(n.weekdays||[]).map(day=>['','Lu','Ma','Mi','Ju','Vi','Sá','Do'][day]).join(', ')||'Programación anterior'}</small></div>
    <div className="ops-inline">
     <button type="button" className="button button-secondary" onClick={()=>{
      setNoticeId(n.status==='DISABLED'?'':n.id);setNoticeTitle(n.title);setNoticeMessage(n.message);
      setNoticeImage(n.imageUrl||'');setNoticeStarts(n.startDate||limaDatetime(n.scheduledAt).slice(0,10));
      setNoticeExpires(n.endDate||limaDatetime(n.expiresAt).slice(0,10));
      setNoticeRunTime(n.runTime||'');setNoticeWeekdays(n.weekdays||[]);setNoticeEditStatus(n.status);
      if(n.status==='DISABLED')setMessage('Aviso desactivado: puedes usar sus datos para preparar uno nuevo.')
     }}>{n.status==='DISABLED'?'Ver y reutilizar':'Editar'}</button>
     {n.status==='DRAFT'&&<button type="button" className="button button-primary" disabled={loading} onClick={()=>void act(async()=>{
      await api(`/api/admin/tenants/${tenantId}/mobile-notifications`,'POST',{action:'publish',id:n.id})
      setNoticesReload(x=>x+1);setMessage('Publicado. El envío push requiere Firebase y consentimiento del cliente.')
     })}>Publicar</button>}
     {n.status==='PUBLISHED'&&<button type="button" className="button button-secondary" disabled={loading} onClick={()=>void act(async()=>{
      await api(`/api/admin/tenants/${tenantId}/mobile-notifications`,'POST',{action:'disable',id:n.id})
      setNoticesReload(x=>x+1);setMessage('Aviso desactivado.')
     })}>Desactivar</button>}
    </div>
   </div>)}</div>}
  <p className="ops-hint">El envío push está desactivado por defecto en el backend. Requiere Firebase configurado y suscripción voluntaria al tema comercial del aplicativo; guardar o publicar no significa que se entregó al celular.</p>
 </section>)}
 {activeArea==='commercial-notifications'&&(<section className="ops-panel ops-notifications-panel">
  <h2><Bell size={19}/> Recordatorios personales de pago</h2>
  <p className="ops-hint">Regla única para Pollos B3 y todas sus sedes. Cada pedido inicia su propio plazo cuando es aceptado y la app pasa al pago. Los avisos se dirigen solo al celular registrado para esa solicitud, las 24 horas.</p>
  <label className="ops-check"><input type="checkbox" checked={remindersEnabled}
   onChange={e=>setRemindersEnabled(e.target.checked)}/>
   Habilitar recordatorios personales automáticos</label>
  <div className="ops-grid">
   <label>Tiempo para continuar con el pago (minutos)
    <input type="number" min="5" max="30" step="1" value={paymentWaitMinutes}
     onChange={e=>setPaymentWaitMinutes(Number(e.target.value))}/>
   </label>
   <label>Cantidad de recordatorios
    <select value={reminderCount} disabled={!remindersEnabled} onChange={e=>setReminderCount(Number(e.target.value))}>
     <option value={0}>Sin recordatorios</option><option value={1}>1 recordatorio</option><option value={2}>2 recordatorios</option>
    </select>
   </label>
  </div>
  {reminderCount>0&&<>
   <h3>Contenido de los recordatorios que recibirá el cliente</h3>
   <p className="ops-hint">Cada aviso tiene su propio título y mensaje. Se envían únicamente al celular vinculado al pedido.</p>
   <div className="ops-reminder-editors">
    <div className="ops-reminder-editor">
     <h4>Recordatorio 1</h4>
     <div className="ops-grid">
      <label>Título del primer aviso<input maxLength={120} value={reminderTitle}
       onChange={e=>setReminderTitle(e.target.value)}/></label>
      <label>Mensaje del primer aviso<textarea rows={3} maxLength={500} value={reminderMessage}
       onChange={e=>setReminderMessage(e.target.value)}/></label>
     </div>
     <div className="ops-marketing-preview"><div className="ops-marketing-phone">
      <div className="ops-marketing-phone-head"><Bell size={15}/> Pollos B3 · Vista previa · Aviso 1</div>
      <strong>{reminderTitle.trim()||'Título del primer aviso'}</strong>
      <p>{reminderMessage.trim()||'Mensaje que recibirá el cliente.'}</p>
      <small>Al tocarlo se abrirá el pedido vinculado en la aplicación.</small>
     </div></div>
    </div>
    {reminderCount===2&&<div className="ops-reminder-editor">
     <h4>Recordatorio 2</h4>
     <div className="ops-grid">
      <label>Título del segundo aviso<input maxLength={120} value={reminder2Title}
       onChange={e=>setReminder2Title(e.target.value)}/></label>
      <label>Mensaje del segundo aviso<textarea rows={3} maxLength={500} value={reminder2Message}
       onChange={e=>setReminder2Message(e.target.value)}/></label>
     </div>
     <div className="ops-marketing-preview"><div className="ops-marketing-phone">
      <div className="ops-marketing-phone-head"><Bell size={15}/> Pollos B3 · Vista previa · Aviso 2</div>
      <strong>{reminder2Title.trim()||'Título del segundo aviso'}</strong>
      <p>{reminder2Message.trim()||'Mensaje que recibirá el cliente.'}</p>
      <small>Al tocarlo se abrirá el pedido vinculado en la aplicación.</small>
     </div></div>
    </div>}
   </div>
  </>}
  <p className="ops-hint">Ejemplo: si el pago empieza a las 12:00, con 10 minutos y 2 recordatorios, los intentos serán aproximadamente a las 12:03:20 y 12:06:40. Si otro pedido inicia a las 23:00, sus recordatorios se calculan independientemente. El envío requiere autorización del dispositivo y Firebase configurado.</p>
  <button type="button" className="button button-primary" disabled={loading||!tenantId||
   !Number.isInteger(paymentWaitMinutes)||paymentWaitMinutes<5||paymentWaitMinutes>30||
   (reminderCount>0&&(!reminderTitle.trim()||reminderTitle.trim().length>120||!reminderMessage.trim()||reminderMessage.trim().length>500))||
   (reminderCount===2&&(!reminder2Title.trim()||reminder2Title.trim().length>120||!reminder2Message.trim()||reminder2Message.trim().length>500))}
   onClick={()=>void act(async()=>{
    const r=await api<{paymentWaitMinutes:number;reminderCount:number;remindersEnabled:boolean;reminderTitle:string;reminderMessage:string}>(`/api/admin/tenants/${tenantId}/checkout-settings`,'POST',
     {paymentWaitMinutes,reminderCount,remindersEnabled,reminderTitle,reminderMessage,reminder2Title,reminder2Message})
    setPaymentWaitMinutes(r.paymentWaitMinutes);setReminderCount(r.reminderCount)
    setRemindersEnabled(r.remindersEnabled);setReminderTitle(r.reminderTitle);setReminderMessage(r.reminderMessage)
    setReminder2Title(r.reminder2Title);setReminder2Message(r.reminder2Message)
    setMessage('Configuración de recordatorios personales guardada para todas las sedes.')
   })}>Guardar recordatorios de pago</button>
  <p className="ops-hint">Guardar no envía avisos inmediatamente. El servicio automático sigue controlado por el backend; nunca se envía una notificación grupal. No se modifica el tiempo de espera de TU VERSO.</p>
 </section>)}
 {activeArea==='publish'&&(<section className="ops-panel"><h2><Smartphone size={19}/> Aplicación y publicación</h2><div className="ops-inline"><input aria-label="Identificador de aplicación" placeholder="Identificador de la aplicación" value={appId} onChange={e=>setAppId(e.target.value)}/><button className="button button-secondary" disabled={loading||!appId.trim()} onClick={()=>void act(async()=>{await api(`/api/admin/tenants/${tenantId}/apps`,'POST',{appId});setMessage('Aplicación registrada para esta empresa.')})}>Registrar aplicación</button><button className="button button-primary" disabled={loading||!appId.trim()} onClick={()=>void act(async()=>{const r=await api<{revision:number}>(`/api/admin/tenants/${tenantId}/publish`,'POST',{appId});setSavedArea('');setMessage(`Cambios publicados correctamente (revisión ${r.revision}). La aplicación ya puede consultar esta versión.`)})}><Send size={15}/> Publicar cambios</button></div><p className="ops-hint">El servidor bloquea la publicación a otra empresa o a una aplicación no registrada. No se envían pedidos ni se cobran pagos hasta completar ese módulo.</p></section>)}
  </>}
 </div>
}
