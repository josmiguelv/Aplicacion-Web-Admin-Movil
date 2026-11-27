# Pollos B3 · API pública de terminación de comunicación MOBILE_APP
**Estado: candidato sin desplegar**, rama `feat/b3-mobile-public-communication-close-20261127`.

## Objetivo y orden
El cliente Android **primero** envía `INTERACTION_CANCEL` por la API existente del Administrador, que publica el texto de cancelación del pedido al asesor y registra el estado `CANCELLED`. **Después**, Android envía una segunda solicitud pública para terminar la comunicación de transporte de TU VERSO. Esta acción no manda texto ni cierra/desasigna la conversación operativa.

### 1. Cancelar y notificar (API existente)
```http
POST /api/v1/mobile/interactions/{interactionId}/cancel
X-Order-Access-Key: {idempotencyKey}
Content-Type: application/json

{"appId":"com.integrab2g.pollosb3","storeId":"UUID_SEDE","reason":"CANCEL"}
```
Éxito: `200 {"interactionId":"UUID_INTERACCION","status":"CANCELLED"}`.

El mensaje debe quedar confirmado antes del paso 2. Si la conversación ya fue cerrada operativamente por el asesor, el Administrador registra la cancelación sin intentar enviar texto a un chat cerrado.

### 2. Cerrar comunicación por evento (API nueva)
```http
POST /api/v1/mobile/interactions/{interactionId}/communication-close
X-Order-Access-Key: {idempotencyKey}
Content-Type: application/json

{"appId":"com.integrab2g.pollosb3","storeId":"UUID_SEDE","reason":"CLIENT_CANCELLED"}
```
`reason` puede omitirse; para este endpoint únicamente se acepta `CLIENT_CANCELLED`.

Éxito:
```json
{"interactionId":"UUID_INTERACCION","status":"CANCELLED","communicationStatus":"CLOSED","replayed":false}
```
`replayed` puede ser `true` si TU VERSO ya recibió el mismo evento, por ejemplo mediante el cierre automático opcional de `/cancel`.

**Seguridad:** no se envían credenciales TU VERSO al APK; el Administrador valida `appId`, `storeId`, `X-Order-Access-Key`, tenant e identidad remota. La API rechaza el evento con `409` si la solicitud todavía no está `CANCELLED`. Si la funcionalidad está deshabilitada, responde `503`. El `eventId` S2S es un UUID determinista derivado en servidor a partir de la clave de acceso y la interacción; reintentos usan el mismo identificador.

Internamente envía, con Bearer S2S, a TU VERSO:
```http
POST /api/v1/conversations/{interactionId}/close
Authorization: Bearer {TOKEN_PRIVADO_DEL_ADMINISTRADOR}
Content-Type: application/json

{"version":1,"type":"CONVERSATION_CLOSE","eventId":"UUID_DETERMINISTA","interactionId":"UUID_INTERACCION","reason":"CLIENT_CANCELLED"}
```

### Semántica
- **No** interpreta el texto ni crea un segundo mensaje.
- **No** modifica el estado operativo, la asignación, la tipificación ni la capacidad del asesor.
- **No** llama al endpoint de cierre de WhatsApp.
- Tras confirmar la terminación, la comunicación SSE de esta interacción puede notificar `communication.closed`. El stream público es un recurso separado: `GET /api/v1/mobile/interactions/{interactionId}/stream?appId=...&storeId=...`, autenticado por `X-Order-Access-Key`.
- Esta API **no es anónima**: es pública para el cliente móvil pero exige la clave opaca de seguimiento asociada a la interacción.

### Condiciones de activación
- TU VERSO: PR #170, endpoint `/api/v1/conversations/{id}/close` implementado y desplegado, migración `20261213200000_mobile_interaction_transport_close` aplicada con ledger íntegro.
- Administrador: publicar una rama/PR que contenga la nueva ruta, apuntar al backend S2S autorizado y habilitar `TUVERSO_MOBILE_COMM_CLOSE_ENABLED=true`.
- Android: invocar el paso 2 solo después de `200 CANCELLED` del paso 1; preservar la clave y reintentar con la misma interacción hasta recibir `200`.
- No habilitar el cierre automático y el explícito simultáneamente sin considerar que ambos son idempotentes; el candidato actual tolera ambas llamadas.
- No modificar ni activar WhatsApp; pruebas focalizadas y confirmación de despliegue obligatorias.

## Validación focal
```bash
node --check server/mobile-tuverso-routes.mjs
node --test server/mobile-tuverso-routes.test.mjs
```
Estas verificaciones deben ejecutarse en un checkout con dependencias, sin acceder a TU VERSO producción. Ningún E2E productivo ha sido certificado.
