import type {Dispatch,SetStateAction} from 'react'
import {Info,MapPin,Truck} from 'lucide-react'
import StoreHoursSchedule from './StoreHoursSchedule'
import type {OpeningHours} from './storeHoursUx.mjs'

export type StoreDraft={
 id:string;code:string;name:string;address:string;
 latitude:string;longitude:string;radiusKm:string;deliveryRatePerKmPen:string;
 deliveryFeePen:string;deliveryPricingMode:'PER_KM'|'FIXED';
 active:boolean;delivery_enabled:boolean;pickup_enabled:boolean;dine_in_enabled:boolean;
 consultOrderAvailability:boolean;openingHours:OpeningHours;
}

export default function StoreSetupForm({
 store,setStore,copyCode,copiedCode,copyError,
}:{store:StoreDraft;setStore:Dispatch<SetStateAction<StoreDraft>>;
 copyCode:(code:string)=>Promise<void>;copiedCode:string;copyError:boolean}){
 const patch=(value:Partial<StoreDraft>)=>setStore(prev=>({...prev,...value}))
 const serviceOptions=[
  {key:'active' as const,title:'Local activo',detail:'Solo los locales activos aparecen después de publicar.'},
  {key:'delivery_enabled' as const,title:'Delivery',detail:'Esta sede puede realizar repartos.'},
  {key:'pickup_enabled' as const,title:'Recojo en tienda',detail:'Los clientes pueden recoger pedidos aquí.'},
  {key:'dine_in_enabled' as const,title:'Atención en el local',detail:'Permite consumir directamente en la sede.'},
 ]
 return <>
  <section className="ops-cx-step" aria-label="Datos del local">
   <div className="ops-cx-step-head"><span className="ops-cx-step-number">1</span><div>
    <h4>Datos del local</h4><p>Los datos básicos para identificar la sede.</p>
   </div></div>
   <div className="ops-grid ops-cx-fields">
    <label>Nombre del local <span className="ops-cx-required">Obligatorio</span>
     <input value={store.name} placeholder="Ej. Pollos B3 — Santa Anita" maxLength={180}
      onChange={e=>patch({name:e.target.value})}/></label>
    <label>Dirección <span className="ops-cx-required">Obligatorio</span>
     <input value={store.address} placeholder="Avenida, número y distrito" maxLength={300}
      onChange={e=>patch({address:e.target.value})}/></label>
    <div className="ops-cx-code">
     <label>Código interno <span className="ops-cx-required">Obligatorio</span>
      <input aria-label="Código interno del local" value={store.code} readOnly={!!store.id} maxLength={80}
       placeholder="Ej. b3-santa-anita" onChange={e=>patch({code:e.target.value})}/></label>
     <p>Identificador único, sin espacios ni mayúsculas. No se puede cambiar después de crear el local.</p>
     {store.id&&<button type="button" className="button button-secondary" onClick={()=>void copyCode(store.code)}>{copiedCode===store.code?'Código copiado':'Copiar código'}</button>}
     {copyError&&<small role="alert">No se pudo copiar. Selecciona el código y usa Ctrl+C.</small>}
    </div>
   </div>
  </section>
  <section className="ops-cx-step" aria-label="Servicios y estado del local">
   <div className="ops-cx-step-head"><span className="ops-cx-step-number">2</span><div>
    <h4>Estado y servicios</h4><p>Marca únicamente lo que ofrece esta sede.</p>
   </div></div>
   <div className="ops-cx-options">
    {serviceOptions.map(opt=><label key={opt.key} className="ops-cx-option">
     <input type="checkbox" checked={store[opt.key]} onChange={e=>patch({[opt.key]:e.target.checked})}/>
     <span><strong>{opt.title}</strong><small>{opt.detail}</small></span>
    </label>)}
   </div>
   <label className="ops-cx-option ops-cx-option-focus">
    <input type="checkbox" checked={store.consultOrderAvailability}
     onChange={e=>patch({consultOrderAvailability:e.target.checked})}/>
    <span><strong>Consultar disponibilidad del pedido</strong>
     <small>La API informa si la opción está activada. Cada aplicación decide cómo realizar esa consulta; el administrador solo guarda esta preferencia.</small></span>
   </label>
   {!store.active&&<p className="ops-cx-note"><Info size={16}/> El local está inactivo: no aparecerá en la próxima publicación hasta que lo actives.</p>}
  </section>
  <section className="ops-cx-step" aria-label="Horarios de atención">
   <div className="ops-cx-step-head"><span className="ops-cx-step-number">3</span><div>
    <h4>Horarios de atención</h4><p>Aplica un horario común y ajusta los días que sean diferentes.</p>
   </div></div>
   <StoreHoursSchedule hours={store.openingHours} onChange={openingHours=>patch({openingHours})}/>
  </section>
  <section className="ops-cx-step" aria-label="Cobertura y cobro del delivery">
   <div className="ops-cx-step-head"><span className="ops-cx-step-number">4</span><div>
    <h4>Ubicación y tarifas de delivery</h4>
    <p>{store.delivery_enabled?'Completa los datos que usará la app para el reparto.':'Opcional. Puedes completarlo cuando actives delivery.'}</p>
   </div></div>
   <details className="ops-advanced ops-cx-delivery">
    <summary><Truck size={17}/> {store.delivery_enabled?'Configurar delivery':'Mostrar ajustes de delivery'}</summary>
    <p className="ops-cx-note"><MapPin size={16}/> El administrador solo guarda y expone estos datos. La app o web calcula la distancia y el precio final.</p>
    <div className="ops-grid ops-cx-fields">
     <label>Latitud GPS
      <input inputMode="decimal" placeholder="-12.04" value={store.latitude}
       onChange={e=>patch({latitude:e.target.value})}/></label>
     <label>Longitud GPS
      <input inputMode="decimal" placeholder="-76.97" value={store.longitude}
       onChange={e=>patch({longitude:e.target.value})}/></label>
     <label>Cobertura máxima en km
      <input type="number" min="0.1" max="500" step="0.1" placeholder="Sin límite" value={store.radiusKm}
       onChange={e=>patch({radiusKm:e.target.value})}/>
      <small>Si lo dejas vacío, no hay un límite definido.</small></label>
     <label>Cómo se cobra el delivery
      <select value={store.deliveryPricingMode} onChange={e=>patch({deliveryPricingMode:e.target.value as StoreDraft['deliveryPricingMode']})}>
       <option value="PER_KM">Por kilómetro</option>
       <option value="FIXED">Precio fijo</option>
      </select></label>
     {store.deliveryPricingMode==='FIXED'?<label>Precio fijo (S/)
      <input type="number" min="0" step="0.01" placeholder="Ej. 10.00" value={store.deliveryFeePen}
       onChange={e=>patch({deliveryFeePen:e.target.value})}/></label>:
      <label>Precio por kilómetro (S/)
       <input type="number" min="0" step="0.01" placeholder="Ej. 2.50" value={store.deliveryRatePerKmPen}
        onChange={e=>patch({deliveryRatePerKmPen:e.target.value})}/></label>}
    </div>
   </details>
  </section>
 </>
}
