# APIs móviles separadas — Disponibilidad y solicitudes TU VERSO

**Sistema:** Administrador Web INTEGRA B2G (no TU VERSO ni aplicación móvil)  
**Estado:** implementación en rama de desarrollo, pendiente de validación en el servidor Windows local.  
**Alcance:** solamente nuevas rutas del backend del Administrador; no sustituye ni modifica las APIs anteriores.

## 1. Secuencia operativa

1. La app descarga el catálogo publicado desde `GET /api/v1/mobile/config?appId=...`.
2. La app selecciona una sede considerando su horario, cobertura y entrega. El backend vuelve a validar que esa sede pertenece al mismo tenant, está activa, tiene delivery habilitado y está abierta en el horario real.
3. La app consulta la capacidad de la cola autorizada para **esa sede**, mediante la nueva API independiente `GET /api/v1/mobile/stores/{storeId}/agent-availability?appId=...`. **No crea conversación ni pedido.**
4. Si hay capacidad, la app calcula la tarifa con la API existente `POST /api/v1/mobile/fulfillment/resolve`. **La ruta de cotización existente puede seleccionar automáticamente la sede más cercana para delivery; el consumidor debe comprobar que `storeId` de la cotización coincide con la sede elegida antes de continuar.** No se cambia su comportamiento en esta tarea.
5. La app envía `POST /api/v1/mobile/interactions` para crear una solicitud en TU VERSO. El backend revalida la sede y vuelve a comprobar la capacidad antes de crearla. `AVAILABLE` no implica reserva de un asesor.
6. La respuesta `PENDING` confirma creación de una interacción pendiente de decisión, **no aprobación, cobro ni pedido final**. La lectura posterior de la decisión sigue siendo un flujo distinto y no se añade una ruta pública nueva de lectura en esta entrega.

Las operaciones S2S a TU VERSO las realiza únicamente el backend, con credenciales privadas cifradas y con su sede autorizada. Nunca introducir credenciales TU VERSO en una APK, JavaScript, URL, logs o documentación.

## 2. Configuración en el Administrador Web

- Tenant activo, aplicación con el **mismo `appId`** que consume la app y catálogo publicado.
- Sede activa, delivery habilitado, horario configurado y abierta para la operación.
- **Locales y horarios → sede → Consultar disponibilidad del pedido** activado y publicado.
- **Conexiones externas → TU VERSO:** credencial vigente y una sola vinculación activa para la combinación tenant, aplicación, sede y propósito `ORDER_REQUEST`.
- Permisos declarados: `queue.availability.read` para consulta, más `interactions.create` para envío.
- En el backend de **Administrador Web**: `TUVERSO_LIVE_CHECKS_ENABLED=true` para consultas y `TUVERSO_LIVE_REQUESTS_ENABLED=true` para creación. Habilitar en entorno local **solo con autorización para enviar solicitudes de prueba al tenant y cola previstos**.
- La clave `INTEGRATION_MASTER_KEY` que cifra las credenciales debe permanecer estable; no sustituirla ni copiarla al móvil.
- La base del Administrador requiere las migraciones históricas de integración; estas rutas nuevas **no requieren migración nueva**.

## 3. GET — Consultar disponibilidad de una sede

```http
GET /api/v1/mobile/stores/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/agent-availability?appId=com.integrab2g.pollosb3
Accept: application/json
```

Respuesta `200` ilustrativa:

```json
{
  "storeId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "status": "AVAILABLE",
  "available": true,
  "checkedAt": "2026-11-20T16:00:00Z",
  "reservation": false
}
```

Si TU VERSO contesta `UNAVAILABLE`, se mantiene HTTP `200`, con `"status":"UNAVAILABLE"` y `"available":false`. La consulta no revela asesores concretos, colas, datos de tenant ni credenciales. La sede solicitada se valida dentro del catálogo publicado del `appId`; no se admiten identificadores de otro tenant.

Error común: `409` sede cerrada/no vinculada/no autorizada, `400` identificador incorrecto, `503` servicio remoto/flag no disponible, `429` limitación de solicitudes.

## 4. POST — Crear interacción tras cotizar delivery

```http
POST /api/v1/mobile/interactions
Content-Type: application/json
Idempotency-Key: 0bfbbeb7-e5d9-496e-80e9-5a910f500331
```

Ejemplo de cuerpo:

```json
{
  "appId": "com.integrab2g.pollosb3",
  "storeId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "quoteRevision": 18,
  "customerExternalId": "cliente-seudonimo-123",
  "items": [
    {"productId":"cccccccc-cccc-4ccc-8ccc-cccccccccccc","quantity":2}
  ]
}
```

- `storeId` debe coincidir con el de la cotización validada anteriormente.
- `quoteRevision` es `revision` devuelta por `/fulfillment/resolve`; el backend la compara contra la revisión publicada actual.
- El backend **recalcula el resumen y subtotal desde el catálogo publicado**; ignora cualquier precio que pretenda enviar el cliente y rechaza campos extra como `tenantId`, `queueId`, `externalLocationId`, tarifas, tokens y totales.
- `Idempotency-Key` es un UUID estable **por intento lógico**. Si falla la red, reintentar con la misma clave y el mismo cuerpo; no crear otra clave para el mismo intento.
- Se deriva una referencia externa estable desde tenant, app, sede y clave de idempotencia. TU VERSO es responsable de su deduplicación S2S. Esta ruta **no conserva un historial de solicitudes propio**, por lo que la app no debe asumir estado final tras un timeout.
- Si el asesor pierde capacidad entre la consulta preliminar y el POST, responde `409` y **no crea la interacción**.

Ejemplo de respuesta `201`:

```json
{
  "interactionId": "3a122e61-0434-4ec7-8e2e-435524d547a3",
  "status": "PENDING",
  "storeId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "externalReference": "mobile:ref-derivada-por-el-servidor"
}
```

El valor `externalReference` anterior es descriptivo; en una respuesta real será el valor determinístico generado por el backend. Respuesta `409`: catálogo cambió, sede ya no disponible o capacidad perdida. Respuesta `503`: TU VERSO o creación deshabilitados/no comprobables.

## 5. Arranque y prueba LOCAL en Windows PowerShell

Repositorio: `josmiguelv/Aplicacion-Web-Admin-Movil`. Rama `feat/admin-mobile-separated-tuverso-apis-20261120`.

En `C:\Integra-B2G\Administrador Negocios`, **conservar .env, base y credenciales actuales**:

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
git fetch origin
git switch feat/admin-mobile-separated-tuverso-apis-20261120
git pull --ff-only origin feat/admin-mobile-separated-tuverso-apis-20261120
node --check server/index.mjs
node --check server/mobile-tuverso-routes.mjs
node --test server/mobile-tuverso-routes.test.mjs
```

En la terminal donde corre la API actual, pulsar `Ctrl+C` y **reiniciar esa misma instancia** (no abrir otra en puerto 4000):

```powershell
node --env-file=.env server/index.mjs
```

En otra terminal:

```powershell
curl.exe -i http://localhost:4000/health/live
curl.exe -i http://localhost:4000/health/ready
```

**Consulta de sede en modo local**: sustituir UUID de ejemplo por el `id` real que devuelve la configuración pública del tenant. Usar la app registrada actualmente:

```powershell
$appId = "com.integrab2g.pollosb3"
$catalog = Invoke-RestMethod "http://localhost:4000/api/v1/mobile/config?appId=$appId"
$storeId = ($catalog.stores | Where-Object { $_.name -eq "Nogales" } | Select-Object -First 1).id
Invoke-RestMethod "http://localhost:4000/api/v1/mobile/stores/$storeId/agent-availability?appId=$appId"
```

Si el resultado muestra `503`, verificar si `TUVERSO_LIVE_CHECKS_ENABLED` está habilitado, la conexión S2S y credenciales. Un `409` pide revisar el vínculo exacto `appId + sede + ORDER_REQUEST`, el horario vigente y la opción publicada de consulta. `200 UNAVAILABLE` **no es fallo de conexión**: es ausencia de capacidad elegible.

**Para probar la creación**: emplear solo productos y sede de prueba, después de comprobar cotización real y permiso explícito para crear una interacción en el tenant/cola local. No enviar solicitudes reales si el asesor no está preparado. `TUVERSO_LIVE_REQUESTS_ENABLED=true` debe establecerse únicamente en el entorno que se autoriza probar. El ejemplo anterior incluye UUID y datos ficticios, no valores listos para copiar.

## 6. Límites y seguridad

- Estas rutas son públicas para los consumidores móviles y usan `appId` más validaciones estrictas de tenant/sede/operación, **pero no autentican a un cliente final**. No enviar datos personales sensibles en `customerExternalId`.
- El limitador es **por proceso/IP**, no distribuido. Antes de exposición pública a escala, considerar rate limiting centralizado, controles de abuso y verificación de identidad de usuario según la política del producto.
- No se publica un estado por asesor individual; la respuesta es **capacidad elegible**, no mera conexión del agente.
- No se modifica la API anterior `/api/v1/mobile/orders/availability` ni se crea pedido definitivo ni se procesa pago.
- El endpoint actual `/fulfillment/resolve` para delivery puede devolver una sede distinta de la seleccionada inicialmente. La app debe detectar esta condición y no enviar una interacción con otra sede sin revisar la cotización.
- No afirmar despliegue local o llamadas E2E reales sin observar resultados desde el Windows que ejecuta el servicio.

## 7. Archivos y pruebas focalizadas

- `server/mobile-tuverso-routes.mjs`: validación, consulta y creación.
- `server/index.mjs`: montaje de rutas antes de las rutas móviles existentes.
- `server/mobile-tuverso-routes.test.mjs`: respuestas booleanas, tenant cruzado, sede cerrada, flags, permisos, idempotencia y pérdida de capacidad.
- `.github/workflows/web.yml`: pruebas en CI aislado; no son llamadas productivas a TU VERSO.
