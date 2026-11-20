# API de validación de pedidos por disponibilidad

**Sistema:** Administrador Comercial INTEGRA B2G  
**Consumidores:** aplicaciones móviles registradas por tenant  
**Estado:** contrato implementado en la rama del PR; requiere migración 006 y despliegue para estar disponible en un servidor. No está conectado a una app móvil ni certificado E2E.

## 1. Arquitectura y límites

Hay dos contratos distintos:

| Interfaz | Consumidor | Responsabilidad |
| --- | --- | --- |
| APIs móviles del Administrador | App móvil registrada | Iniciar la validación y consultar su estado. |
| APIs S2S de TU VERSO | Backend del Administrador | Consultar capacidad y crear/leer una interacción del asesor. |

La app móvil nunca llama directamente a TU VERSO ni recibe sus credenciales. El backend deriva el tenant desde `appId`, consulta el catálogo publicado y busca una integración vinculada a la misma combinación de tenant, aplicación y sede. No acepta `tenantId`, sede o ubicación externa como autoridad enviados por el cliente.

El alcance de esta API es comprobar capacidad de atención humana para una solicitud de productos. No consulta inventario, no reserva productos, no crea el pedido definitivo y no procesa pagos. Una aceptación del asesor solo permite continuar al paso de pago en la app.

## 2. Configuración por tenant

1. Registrar una aplicación en el tenant desde el administrador y publicar su catálogo.
2. Configurar en el administrador la credencial TU VERSO del tenant.
3. En **Integraciones → TU VERSO → Sedes vinculadas**, elegir la aplicación y sede de ese tenant, asociar su ubicación autorizada y confirmar el propósito `ORDER_REQUEST`.
4. En **Operaciones móviles → Locales y modalidades**, activar **Consultar disponibilidad del pedido con TU VERSO** para cada sede que deba esperar una decisión humana.
5. Publicar el catálogo de la aplicación.

La opción está desactivada por defecto, incluso para tenants existentes. Una vinculación antigua sin `app_id` no se usa para esta función. Los selectores del administrador obtienen aplicaciones y sedes de la empresa que se está configurando.

La zona horaria del tenant se conserva por compatibilidad en `America/Lima` hasta que el administrador la configure. El nuevo ajuste administrativo es:

```http
GET /api/admin/tenants/{tenantId}/settings
PUT /api/admin/tenants/{tenantId}/settings
Content-Type: application/json
```

`PUT` requiere sesión administrativa, pertenencia al tenant (o rol `SUPER_ADMIN`) y un nombre IANA reconocido:

```json
{ "timeZone": "America/Bogota" }
```

La zona se usa al validar horarios y se publica al catálogo cuando se vuelve a publicar la app.

## 3. Reglas comunes de las APIs móviles

- Base URL: en local, `http://localhost:4000` cuando Node sirve la interfaz compilada; en un servidor accesible fuera del equipo, usar la URL HTTPS del backend del Administrador.
- Content-Type para solicitudes con cuerpo: `application/json`.
- `appId`: identificador exacto registrado en el Administrador.
- `validationToken`: 256 bits aleatorios como mínimo, generado con CSPRNG por cada validación; formato `ordv1_` más 43 caracteres base64url sin `=`. La app lo guarda en almacenamiento privado de sesión y nunca en logs. El backend almacena solo su SHA-256.
- `Idempotency-Key`: UUID aleatorio creado por la app para la solicitud. Un reintento idéntico reutiliza la misma clave.
- La app calcula y muestra su carrito, pero los IDs, disponibilidad, precios y subtotal los valida el servidor usando el catálogo publicado.
- No enviar `tenantId`, `storeId`, `externalLocationId`, cola, subtotal, tarifa ni total.
- `customerExternalId` es una referencia seudónima estable del comprador, de hasta 180 caracteres; no debe contener datos sensibles.
- Cuerpo máximo aceptado por el servidor: 64 KiB. Productos: de 1 a 50 líneas; cantidad por línea: de 1 a 99.

La lectura de catálogo actual sigue siendo `GET /api/v1/mobile/config?appId={appId}`. La función de validación no altera esa ruta ni `POST /api/v1/mobile/fulfillment/resolve`.

## 4. Iniciar o recuperar una validación

```http
POST /api/v1/mobile/orders/availability
Content-Type: application/json
Idempotency-Key: 6d040b4a-5bde-4b63-92fb-27035e316781
```

Ejemplo de dirección. Los campos de ubicación permiten geocodificar sin asumir una ciudad o país:

```json
{
  "appId": "com.example.store",
  "validationToken": "ordv1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  "customerExternalId": "cliente-aleatorio-123",
  "items": [
    { "productId": "2b12a9da-2f2f-4ab1-aaf4-9100bb8f4863", "quantity": 2 }
  ],
  "address": "Av. Ejemplo 123",
  "district": "Distrito",
  "city": "Ciudad",
  "country": "País",
  "useGps": false
}
```

Para GPS confirmado, enviar `useGps: true`, `latitude` y `longitude`; `address`, `district`, `city` y `country` pueden omitirse. Si se envía una dirección completa, el backend usa esa dirección. Las coordenadas deben estar entre latitud −90 y 90 y longitud −180 y 180.

El servidor determina sedes activas, Delivery habilitado, horario abierto, cobertura y tarifa. Ordena por distancia geográfica en línea recta (Haversine), calculada localmente sin Google Routes ni costos por solicitud, y evalúa una sede a la vez. Si faltan ambas coordenadas numéricas `latitude` y `longitude` se usa provisionalmente el punto de prueba -12.0506096, -77.1251313, sin costo Google; si solo falta una o son inválidas, HTTP 422. El valor provisional NO refleja necesariamente la ubicación real del cliente y puede dar 0 km. La tarifa por kilómetro usa esta distancia estimada y no kilómetros de carretera. En una sede con consulta desactivada no llama a TU VERSO; con consulta activada verifica disponibilidad y, si está disponible, espera la decisión del asesor. Una falta de capacidad o rechazo permite evaluar la siguiente sede.

### Respuesta pendiente — HTTP 202

```json
{
  "validationId": "3a122e61-0434-4ec7-8e2e-435524d547a3",
  "status": "WAITING_APPROVAL",
  "subtotal": 24.7,
  "currency": "PEN",
  "deliveryFee": null,
  "total": null,
  "store": null,
  "errorCode": null
}
```

La respuesta no revela `interactionId`, credenciales, integración ni sede todavía no seleccionada. Mientras el asesor no decida, la app consulta el endpoint de estado de forma periódica con espera incremental.

### Reintentos

La misma clave, app, token y contenido recuperan la validación previamente creada. Si se reutiliza `Idempotency-Key` con otro token, carrito, dirección o ubicación, la API devuelve `409`. Un timeout de red no se interpreta como rechazo; la app debe reintentar con la misma clave.

## 5. Consultar el resultado

```http
GET /api/v1/mobile/orders/availability/{validationId}
Authorization: Bearer ordv1_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA
```

El UUID no es suficiente para leer el resultado: se comprueba el token asociado y que aplicación y tenant continúen activos. La consulta también reanuda un paso pendiente usando PostgreSQL y una concesión temporal; puede continuar después de reiniciar Node o atenderse desde más de un proceso.

### Aprobado — HTTP 200

```json
{
  "validationId": "3a122e61-0434-4ec7-8e2e-435524d547a3",
  "status": "READY_FOR_PAYMENT",
  "subtotal": 24.7,
  "currency": "PEN",
  "deliveryFee": 4.5,
  "total": 29.2,
  "store": { "id": "a183c31e-31ea-4db0-b34e-fbb0315c8537", "name": "Sede Centro" },
  "routeDistanceKm": 1.8,
  "paymentMethods": ["cash", "yape"],
  "errorCode": null
}
```

La tarifa y el total solo aparecen cuando se determinó la sede. En el modelo actual el administrador publica precios en PEN; no es todavía una solución multimoneda.

### Sin sede disponible — HTTP 200

```json
{
  "validationId": "3a122e61-0434-4ec7-8e2e-435524d547a3",
  "status": "UNAVAILABLE",
  "subtotal": 24.7,
  "currency": "PEN",
  "deliveryFee": null,
  "total": null,
  "store": null,
  "errorCode": null
}
```

## 6. Estados del proceso

| Estado | Comportamiento de la app |
| --- | --- |
| `CHECKING_STORES` | Esperar y volver a consultar. |
| `WAITING_APPROVAL` | Mostrar que el asesor está revisando y consultar periódicamente. |
| `CREATE_UNCERTAIN` | Mostrar que se está verificando la solicitud; reconsultar sin iniciar otra validación. |
| `READY_FOR_PAYMENT` | Mostrar la sede, cotización provisional y formas de pago recibidas. |
| `UNAVAILABLE` | Informar que ninguna sede puede atenderla. |
| `VALIDATION_ERROR` | Informar que no se pudo validar; revisar configuración o solicitud antes de crear una nueva. |
| `CANCELLED` | Reservado para cancelación interna; no hay endpoint móvil de cancelación en esta versión. |

`READY_FOR_PAYMENT` no crea ni reserva un pedido. La app debe aplicar el flujo de pago/pedido que tenga implementado por separado.

## 7. Errores HTTP

El cuerpo de error es `{ "error": "..." }`. Los errores internos se sanitizan y no incluyen datos del proveedor.

| HTTP | Casos comunes |
| --- | --- |
| `400` | JSON o campos inválidos, token/claves con formato incorrecto o coordenadas no válidas. |
| `401` | Falta el token Bearer al consultar el estado. |
| `404` | Validación inexistente, token incorrecto o app/tenant inactivos para esa lectura. |
| `409` | Clave idempotente reutilizada con contenido distinto; catálogo no publicado; productos o sedes ya no elegibles. |
| `422` | Dirección incompleta y sin GPS confirmado. |
| `429` | Límite de solicitudes alcanzado; esperar antes de reintentar. |
| `500` | Error interno genérico, sin información del proveedor. |
| `503` | Cotización no disponible, por ejemplo si excede el límite de sedes en una operación. La falta de coordenadas del destino devuelve 422; no se consulta Google Routes. |

El limitador actual es por proceso y dirección IP (10 POST/minuto, 60 GET/minuto). No sustituye a un limitador distribuido/WAF para producción con varias réplicas; este detalle debe revisarse antes de exposición pública amplia.

## 8. APIs de TU VERSO usadas por el backend

Estas son APIs distintas de las anteriores. Solo el backend del Administrador las consume con la credencial S2S cifrada asociada al tenant:

```http
GET /api/v1/queues/availability?externalLocationId={externalLocationId}&purpose=ORDER_REQUEST
Authorization: Bearer {credencial privada}
```

El cliente existente espera `data.status` igual a `AVAILABLE` o `UNAVAILABLE`, `data.reservation: false`, `data.checkedAt` válido y la misma ubicación consultada.

```http
POST /api/v1/interactions
Authorization: Bearer {credencial privada}
Content-Type: application/json
Idempotency-Key: {UUID del intento}
```

El backend genera el `externalReference`, deriva `externalLocationId`/`purpose` de la vinculación autorizada y envía identidad externa seudónima y un resumen breve del pedido. No envía información de pagos.

```http
GET /api/v1/interactions/{interactionId}
Authorization: Bearer {credencial privada}
```

Se leen los estados de TU VERSO `PENDING`, `ACCEPTED`, `REJECTED` o `EXPIRED`. No se asume webhook ni se crea una API nueva en TU VERSO. Un timeout incierto conserva la clave y referencia del mismo intento para recuperarse con idempotencia.

## 9. Compatibilidad y pruebas

- `consultOrderAvailability` es un booleano por sede, publicado en el catálogo sin cambiar los demás campos existentes.
- Si está desactivado, no se consulta TU VERSO y se conserva la cotización de la sede elegible.
- `POST /api/v1/mobile/fulfillment/resolve` conserva su comportamiento actual.
- La migración `server/migrations/006-mobile-order-availability.sql` es aditiva para la base del Administrador. No ejecutarla contra la base de TU VERSO.
- Prueba focalizada: `node --test server/mobile-order-availability.test.mjs`. Los escenarios sintéticos cubren el subtotal del catálogo, aislamiento de dos tenants y rechazo del asesor con avance a la siguiente sede.
- La migración no se ha ejecutado y la API no se ha desplegado en un servidor. No hubo llamadas E2E a TU VERSO. Ninguna app móvil se modificó; cada aplicación debe integrar estas rutas para usar la función.

## 10. Instalación y ejecución local

Esta guía es exclusivamente para el repositorio del Administrador; no requiere Railway ni modifica la base de TU VERSO.

**Repositorio:** `josmiguelv/Aplicacion-Web-Admin-Movil`  
**Rama de la funcionalidad:** `feat/multitenant-mobile-order-availability`

### Requisitos

- Node.js 22, pnpm y PostgreSQL 17 instalados localmente.
- Una base de datos local exclusiva del Administrador. No configurar aquí la URL de PostgreSQL de TU VERSO.
- Ejecutar los comandos desde la raíz del repositorio, en PowerShell.

### Obtener el código

Si ya existe una rama local con la funcionalidad:

```powershell
git fetch origin
git switch feat/multitenant-mobile-order-availability
git pull --ff-only origin feat/multitenant-mobile-order-availability
```

Si aún no existe la rama local, después de `git fetch origin`:

```powershell
git switch --track -c feat/multitenant-mobile-order-availability origin/feat/multitenant-mobile-order-availability
```

### Configurar variables locales

Crear `.env` sin sobrescribir un archivo existente y editarlo localmente:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

Configurar `DATABASE_URL` para la base local del Administrador y, al servir la compilación en el puerto 4000, establecer:

```text
PORT=4000
NODE_ENV=development
ADMIN_ORIGIN=http://localhost:4000
COOKIE_SECURE=false
TUVERSO_LIVE_CHECKS_ENABLED=false
```

No subir `.env` al repositorio. La clave `INTEGRATION_MASTER_KEY` debe permanecer estable mientras existan credenciales TU VERSO cifradas con ella. Las llamadas reales a TU VERSO permanecen desactivadas por defecto; activarlas requiere configuración autorizada por tenant y puede crear interacciones remotas.

### Aplicar esquema o migración

Elegir solo el caso que corresponde a la base del Administrador:

- **Base nueva y vacía:** `server/schema.sql` contiene el esquema actual, incluidos los objetos de la migración 006. Aplicar el esquema completo una sola vez; no ejecutar 006 aparte.
- **Base existente con las migraciones previas 003, 004 y 005:** aplicar únicamente `server/migrations/006-mobile-order-availability.sql`. No ejecutar `server/schema.sql` sobre una base con datos.
- Si la base no tiene las tablas previas de TU VERSO del Administrador (`tenant_integrations` e `integration_bindings`), detenerse y revisar el estado de las migraciones anteriores antes de ejecutar 006.

En PowerShell, cargar la URL desde `.env`, confirmar que identifica la base local del Administrador y aplicar 006:

```powershell
$env:DATABASE_URL = ((Get-Content .env | Where-Object { $_ -match '^DATABASE_URL=' } | Select-Object -First 1) -replace '^DATABASE_URL=', '')
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -c "SELECT current_database() AS database, current_user AS db_user, to_regclass('public.tenants') AS tenants, to_regclass('public.mobile_apps') AS mobile_apps, to_regclass('public.stores') AS stores, to_regclass('public.integration_bindings') AS integration_bindings, to_regclass('public.tenant_integrations') AS tenant_integrations;"
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f server/migrations/006-mobile-order-availability.sql
```

Para una base nueva, reemplazar la última línea por:

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -f server/schema.sql
```

Verificar que la migración esté aplicada:

```powershell
psql $env:DATABASE_URL -v ON_ERROR_STOP=1 -c "SELECT to_regclass('public.mobile_order_validations') AS validations, to_regclass('public.mobile_order_attempts') AS attempts, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='stores' AND column_name='consult_order_availability') AS store_setting, EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='tenants' AND column_name='time_zone') AS tenant_timezone;"
```

Las tablas deben existir y los dos indicadores deben ser `t` (`true`).

### Compilar e iniciar

```powershell
pnpm install --frozen-lockfile
node --test server/mobile-order-availability.test.mjs server/tuverso-mobile-connector.test.mjs
pnpm build
```

En una base nueva, crear el Super Administrador una sola vez. Omitir este paso si la base ya tiene uno:

```powershell
node --env-file=.env server/bootstrap-admin.mjs
```

Después de verificar el resultado, quitar las variables `BOOTSTRAP_ADMIN_*` de `.env`. Iniciar la interfaz compilada y el backend:

```powershell
node --env-file=.env server/index.mjs
```

La aplicación queda disponible en `http://localhost:4000`. Este arranque valida el servicio local; no certifica por sí mismo llamadas reales a TU VERSO ni la integración de una aplicación móvil.

### Estado de la entrega

| Elemento | Estado |
| --- | --- |
| Código multitenant y rutas del Administrador | Implementados en la rama indicada. |
| Pruebas focalizadas sintéticas y compilación de CI | Aprobadas para el commit del PR revisado. |
| Migración 006 en la base local del usuario | Pendiente de ejecución local. |
| Inicio local del backend con la base migrada | Pendiente de ejecución y verificación en el equipo local. |
| Prueba E2E con TU VERSO | Pendiente; no se hicieron llamadas remotas. |
| Integración de una aplicación móvil | Fuera del alcance de esta entrega; no se modificó ninguna app. |

