import {publishedReservationSettings} from './mobile-reservation-settings.mjs'
import {publicPaymentOptions} from './payment-public-options.mjs'
import {indexedPromotionProducts} from './promotion-product-projection.mjs'

const DEFAULT_TENANT_TZ='America/Lima'
const bad=(code,message)=>Object.assign(new Error(message),{code})

// Read-only snapshot assembly until the final published revision and upsert.
export async function publish(tx,tenantId,appId){const [stores,products,promos,payments,vacancies,appSettings,sharedPaymentImages,checkoutSettings]=await Promise.all([
 tx.query('SELECT s.id,s.name,s.address,s.latitude,s.longitude,s.radius_km,s.delivery_fee_pen,s.delivery_rate_per_km_pen,s.delivery_pricing_mode,s.delivery_preparation_minutes,s.pickup_preparation_minutes,s.active,s.delivery_enabled,s.pickup_enabled,s.dine_in_enabled,s.opening_hours,s.consult_order_availability, r.enabled AS reservation_enabled, r.preparation_minutes AS reservation_preparation_minutes FROM stores s LEFT JOIN store_reservation_settings r ON r.tenant_id=s.tenant_id AND r.store_id=s.id WHERE s.tenant_id=$1 AND s.active=true ORDER BY s.name',[tenantId]),
 tx.query('SELECT id,name,description,category,price_pen,image_url FROM products WHERE tenant_id=$1 AND active=true ORDER BY name',[tenantId]),
 tx.query(`SELECT id,title,product_id AS "productId",starts_at,ends_at,
  to_char(starts_on,'YYYY-MM-DD') AS "startDate",
  to_char(ends_on,'YYYY-MM-DD') AS "endDate",
  to_char(active_from,'HH24:MI') AS "startTime",
  to_char(active_until,'HH24:MI') AS "endTime",
  active_weekdays AS weekdays
 FROM promotions WHERE tenant_id=$1 AND active=true ORDER BY id`,[tenantId]),
 tx.query('SELECT store_id,mode,method,image_url FROM payment_methods WHERE tenant_id=$1 AND enabled=true',[tenantId]),
 tx.query(`SELECT j.id,j.title,j.summary,j.description,j.requirements,
   j.employment_type AS "employmentType",j.image_url AS "imageUrl",j.whatsapp_phone AS "whatsappPhone",
   COALESCE((SELECT array_agg(vs.store_id ORDER BY st.name)
     FROM job_vacancy_stores vs JOIN stores st ON st.id=vs.store_id AND st.tenant_id=vs.tenant_id
     WHERE vs.vacancy_id=j.id AND vs.tenant_id=j.tenant_id AND st.active=true),ARRAY[]::uuid[]) AS "storeIds",
   COALESCE((SELECT string_agg(st.name, ', ' ORDER BY st.name)
     FROM job_vacancy_stores vs JOIN stores st ON st.id=vs.store_id AND st.tenant_id=vs.tenant_id
     WHERE vs.vacancy_id=j.id AND vs.tenant_id=j.tenant_id AND st.active=true),'') AS "locationLabel"
  FROM job_vacancies j WHERE j.tenant_id=$1 AND j.active=true
   AND EXISTS (SELECT 1 FROM job_vacancy_stores vs JOIN stores st
    ON st.id=vs.store_id AND st.tenant_id=vs.tenant_id
    WHERE vs.tenant_id=j.tenant_id AND vs.vacancy_id=j.id AND st.active=true)
   ORDER BY j.updated_at DESC,j.id`,[tenantId]),
 tx.query('SELECT complaints_book_url FROM mobile_apps WHERE tenant_id=$1 AND app_id=$2',[tenantId,appId]),
 tx.query('SELECT method,image_url FROM company_payment_images WHERE tenant_id=$1',[tenantId]),
 tx.query('SELECT payment_wait_minutes,reminder_count FROM mobile_checkout_policies WHERE tenant_id=$1',[tenantId])
 ]);const sharedPaymentImageMap=Object.fromEntries(sharedPaymentImages.rows.filter(p=>p.image_url).map(p=>[p.method,p.image_url]));
 const payload={schemaVersion:1,appId,currency:'PEN',timeZone:DEFAULT_TENANT_TZ,paymentImages:sharedPaymentImageMap,paymentWaitMinutes:checkoutSettings.rows[0]?.payment_wait_minutes??10,reminderCount:checkoutSettings.rows[0]?.reminder_count??2,stores:stores.rows.map(s=>({...s,latitude:s.latitude===null?null:Number(s.latitude),longitude:s.longitude===null?null:Number(s.longitude),radiusKm:s.radius_km===null?null:Number(s.radius_km),deliveryRatePerKmPen:s.delivery_rate_per_km_pen===null?null:Number(s.delivery_rate_per_km_pen),deliveryPricingMode:s.delivery_pricing_mode,deliveryFeePen:s.delivery_fee_pen===null?null:Number(s.delivery_fee_pen),openingHours:s.opening_hours??null,deliveryPreparationMinutes:s.delivery_preparation_minutes??null,pickupPreparationMinutes:s.pickup_preparation_minutes??null,consultOrderAvailability:s.delivery_enabled===true||s.pickup_enabled===true,preparationMinutes:s.reservation_preparation_minutes??null,reservationSettings:publishedReservationSettings({enabled:s.reservation_enabled,preparation_minutes:s.reservation_preparation_minutes}),paymentMethods:payments.rows.filter(p=>p.store_id===s.id).reduce((a,p)=>(a[p.mode].push(p.method),a),{delivery:[],pickup:[],dine_in:[],reservation:[]}),
 paymentMethodImages:{
  delivery:Object.fromEntries(payments.rows.filter(p=>p.store_id===s.id&&p.mode==='delivery'&&p.method!=='cash'&&sharedPaymentImageMap[p.method]).map(p=>[p.method,sharedPaymentImageMap[p.method]])),
  pickup:Object.fromEntries(payments.rows.filter(p=>p.store_id===s.id&&p.mode==='pickup'&&p.method!=='cash'&&sharedPaymentImageMap[p.method]).map(p=>[p.method,sharedPaymentImageMap[p.method]])),
  reservation:Object.fromEntries(payments.rows.filter(p=>p.store_id===s.id&&p.mode==='reservation'&&p.method!=='cash'&&sharedPaymentImageMap[p.method]).map(p=>[p.method,sharedPaymentImageMap[p.method]]))
 },
 paymentOptions:publicPaymentOptions(payments.rows.filter(p=>p.store_id===s.id).reduce((a,p)=>(a[p.mode]?.push(p.method),a),{delivery:[],pickup:[],dine_in:[],reservation:[]}),sharedPaymentImageMap)})),products:products.rows.map(p=>({...p,pricePen:Number(p.price_pen)})),promotions:indexedPromotionProducts(products.rows,promos.rows),vacancies:vacancies.rows,complaintsBookUrl:appSettings.rows[0]?.complaints_book_url||null};
 const v=await tx.query('UPDATE mobile_apps SET published_revision=published_revision+1,enabled=true WHERE tenant_id=$1 AND app_id=$2 RETURNING published_revision',[tenantId,appId]);if(!v.rowCount)throw bad(404,'Aplicación no registrada');const revision=v.rows[0].published_revision;await tx.query(`INSERT INTO published_catalogs(app_id,tenant_id,revision,payload) VALUES($1,$2,$3,$4) ON CONFLICT(app_id) DO UPDATE SET revision=EXCLUDED.revision,payload=EXCLUDED.payload,published_at=now()`,[appId,tenantId,revision,JSON.stringify(payload)]);return{revision,payload}}
