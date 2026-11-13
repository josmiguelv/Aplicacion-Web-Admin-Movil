# API Pollos B3 — contrato entre administración web y Android

## Alcance probado y límites
- Android consume únicamente la configuración publicada de la aplicación registrada. `appId` **no es una credencial**, sino un identificador público de la empresa/catálogo.
- No se han realizado pruebas PostgreSQL, de sesiones reales ni de checkout en este commit. No desplegar ni vender como terminado.
- El ZIP `AdminCatalog(1).zip` es un prototipo React anterior: contiene roles simulados y cambios que solo duran en memoria; todavía no se ha importado al repositorio y **no es un panel multiempresa seguro**.
- Backend preparado por separado en `server/`; falta vincular la interfaz web original mediante API autenticada.

## Endpoints públicos que consume Android
```http
GET /api/v1/apps/{appId}/catalog
GET /api/v1/apps/{appId}/stores
GET /api/v1/apps/{appId}/payments?storeId={uuid}&mode=DELIVERY|PICKUP|DINE_IN
POST /api/v1/apps/{appId}/delivery/resolve
Content-Type: application/json

{"address":"calle y distrito, Perú","reference":"opcional","latitude":-12.0,"longitude":-77.0}
```

La respuesta a `delivery/resolve` incluye `store`, `deliveryFeeCents` y `paymentMethodIds`. El backend valida tenant activo, app habilitada, publicación, tienda activa y cobertura. Si no hay coordenadas, requiere un adaptador `GEOCODER_URL` configurado en el servidor; de lo contrario responde `422 LOCATION_OR_GEOCODER_REQUIRED`. El cálculo actual es por **radio geográfico**; no corresponde a tiempo real por calles. No se muestra un ETA sin proveedor de rutas.

## Modos
- `DELIVERY`: dirección, referencia y GPS optativo, tienda asignada por servidor si hay cobertura.
- `PICKUP`: selección explícita de tienda habilitada.
- `DINE_IN`: selección explícita de tienda habilitada. Mensaje: "La disponibilidad de mesas depende de la concurrencia del local al momento de tu llegada. Este pedido no reserva una mesa." Sin NFC/QR.
- Los pagos disponibles son intersección de la publicación de cada tienda/modo y el estado activo del método. No existe cobro real ni endpoint de generación de órdenes todavía.
- Cambio de modalidad, tienda, productos, promociones o pago requiere nueva validación del importe y disponibilidad, antes de confirmar la orden.

## Administración (requiere sesión HttpOnly y validación de origen)
```
POST /api/admin/login
GET  /api/admin/me
POST /api/admin/logout
GET,POST /api/admin/tenants (solo superadmin)
POST /api/admin/tenants/{tenantId}/users (solo superadmin)
GET,POST /api/admin/tenants/{tenantId}/apps
GET,POST,PATCH /api/admin/tenants/{tenantId}/stores[/{id}]
GET,POST,PATCH /api/admin/tenants/{tenantId}/products[/{id}]
GET,POST,PATCH /api/admin/tenants/{tenantId}/promotions[/{id}]
GET,POST /api/admin/tenants/{tenantId}/payments
POST /api/admin/tenants/{tenantId}/images (binario JPEG, PNG, WEBP máx. 4 MB)
POST /api/admin/tenants/{tenantId}/publish
```

**Orden de desarrollo:** integrar el React entregado por el usuario sin reemplazar su diseño; pasar el cambio de rol a sesión real; hacer que cada formulario edite su propio tenant; añadir pruebas reales de permisos, galería, publicación, tienda, pagos, productos y geocodificación; completar cotización y creación segura de pedidos antes de activar ventas.

## Configuración Android
En `Aplicacion-Mobil`, pasar propiedades de compilación `B3_API_URL` (base HTTPS) y `B3_APP_ID` (identificador público de aplicación registrado). No alojar claves secretas en el APK.
