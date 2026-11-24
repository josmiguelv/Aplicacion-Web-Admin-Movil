# Comprobante de pago MOBILE_APP — solo Administrador Web (24/11/2026)

## API pública preparada

## 1. Subir la imagen y obtener la URL (paso que faltaba)

`POST /api/v1/mobile/interactions/{interactionId}/payment-receipt/upload?appId=com.integrab2g.pollosb3&storeId={storeId}`

Encabezados:
- `X-Order-Access-Key: <UUID del pedido>`
- `Content-Type: image/jpeg` (o PNG/WebP)
- Cuerpo: **bytes binarios de la imagen**, no JSON ni base64.

La operación comprueba que la interacción siga activa (estado técnico PENDING o ACCEPTED) y que pertenezca a la empresa y sede de la clave del pedido, valida los primeros bytes reales de JPEG/PNG/WebP, aplica el límite de 4 MB, almacena el contenido en `product_images` y registra su propiedad en `mobile_payment_receipt_images`. Devuelve **201**:

```json
{"imageId":"<UUID>","imageUrl":"https://admin.example.com/api/v1/mobile/payment-receipts/images/<UUID>","mime":"image/jpeg"}
```

Luego el cliente toma el campo `imageUrl` y ejecuta el envío del FORM del paso 2, sin ocupar ninguno de los 5 campos.

**Configuración obligatoria** en el servidor: `PUBLIC_API_BASE_URL=https://<dominio-HTTPS-publico-del-Administrador>` sin ruta ni query. Se necesita una URL estable que TU VERSO pueda obtener; `localhost` no sirve. Las imágenes no se incluyen en el catálogo de productos y el endpoint `GET /api/v1/mobile/payment-receipts/images/{imageId}` funciona únicamente para imágenes registradas como comprobantes. La URL contiene un UUID aleatorio que actúa como identificador no adivinable: quien obtenga la URL puede ver la imagen. No publicarla fuera del chat autorizado de TU VERSO.

**Migración necesaria antes de usar la subida:** `server/migrations/022-mobile-payment-receipt-images.sql`, aplicada exclusivamente a la base del Administrador después de la migración 021 y tras confirmar el estado local. Nunca aplicar la migración 008 de la rama antigua.

## 2. Enviar el formulario a TU VERSO

`POST /api/v1/mobile/interactions/{interactionId}/payment-receipt`

Encabezados obligatorios:
- `Content-Type: application/json`
- `X-Order-Access-Key: <UUID del pedido>`
- `Idempotency-Key: <UUID independiente, estable para reintentos del mismo comprobante>`

Ejemplo del JSON:
```json
{
  "appId": "com.integrab2g.pollosb3",
  "storeId": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  "form": {
    "title": "Validación de pago",
    "subtitle": "Comprobante de pago Yape",
    "imageUrl": "https://cdn.example.com/comprobante.jpg",
    "fields": [
      {"variable": "Pedido", "value": "B3-1025"},
      {"variable": "Cliente", "value": "Juan Pérez"},
      {"variable": "Monto", "value": "S/ 85.00"},
      {"variable": "Método", "value": "Yape"}
    ]
  }
}
```
El campo `imageUrl` debe ser la URL devuelta por la operación de subida del paso 1. Este segundo endpoint transmite el FORM; no vuelve a recibir los bytes. Ninguna URL de comprobante se registra en el catálogo público. Esta ruta entrega el URL a TU VERSO; verificar que el proveedor lo acepte y renderice antes de habilitar al cliente.

Respuesta `200` después de la confirmación de entrega del mensaje:
```json
{"interactionId":"<UUID>","delivered":true,"messageId":"<UUID>","type":"FORM","paymentStatus":"PENDING_VALIDATION"}
```
`PENDING_VALIDATION` solo indica que el comprobante fue enviado al asesor; **NO es una confirmación ni aprobación de pago**.

## Seguridad y compatibilidad
- Reutiliza el vínculo validado de `appId`, `storeId`, `tenantId`, clave de acceso y referencia exacta de la interacción, más estado de checkout local.
- Permite el envío con estado técnico `PENDING` o `ACCEPTED` siempre que la interacción siga activa y autorizada. La aprobación comercial ya la procesa Android; el Administrador no interpreta mensajes del agente. Se bloquean estados `CANCELLED`, `EXPIRED`, `FINISHED`, `REJECTED` y conversaciones `CLOSED` o `RESOLVED`.
- Se rechazan links HTTP, localhost, IP literal, URL con credenciales y dominios internos; no se descarga la imagen desde el Administrador.
- Se exige un UUID de idempotencia independiente del identificador de acceso del pedido; un reintento usa exactamente el mismo UUID.
- `POST /api/v1/mobile/interactions/{id}/message` mantiene TEXT / FORM y ahora permite `form.imageUrl` opcional.
- `POST /api/v1/mobile/interactions/{id}/payment` conserva su semántica anterior, distinta del envío de comprobante.
- Se agrega exclusivamente la tabla `mobile_payment_receipt_images` con la migración 022; no altera ninguna tabla histórica. Sin modificaciones TU VERSO, Android, Railway o producción.

## Verificación pendiente antes de instalar
```sh
node --check server/mobile-tuverso-routes.mjs
node --check server/tuverso-mobile-connector.mjs
node --test server/payment-receipt-validation.test.mjs server/mobile-tuverso-routes.test.mjs
```
No marcar como validado en entorno real hasta probar con una interacción de prueba y comprobar que TU VERSO renderiza `imageUrl`.

## Corrección 24/11 — 409 con estado técnico PENDING
Las rutas de subida y de envío de comprobante ya no exigen `remote.data.status === 'ACCEPTED'`: TU VERSO puede mantener `PENDING` aunque Android ya haya procesado «aceptar». Se verifican identidad, binding, sesión local y que la conversación no esté cerrada. No se altera el contrato ni se traslada lógica comercial al Administrador.
