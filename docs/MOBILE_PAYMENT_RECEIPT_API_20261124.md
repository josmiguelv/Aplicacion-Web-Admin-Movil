# Comprobante de pago MOBILE_APP — solo Administrador Web (24/11/2026)

## API pública preparada

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
El campo `imageUrl` debe referenciar una imagen **HTTPS pública ya alojada**. Este endpoint **no recibe archivo binario, base64 ni sube imágenes**. Ninguna URL de comprobante se registra en el catálogo público. Esta ruta entrega el URL a TU VERSO; verificar que el proveedor lo acepte y renderice antes de habilitar al cliente.

Respuesta `200` después de la confirmación de entrega del mensaje:
```json
{"interactionId":"<UUID>","delivered":true,"messageId":"<UUID>","type":"FORM","paymentStatus":"PENDING_VALIDATION"}
```
`PENDING_VALIDATION` solo indica que el comprobante fue enviado al asesor; **NO es una confirmación ni aprobación de pago**.

## Seguridad y compatibilidad
- Reutiliza el vínculo validado de `appId`, `storeId`, `tenantId`, clave de acceso y referencia exacta de la interacción, más estado de checkout local.
- Solo permite el envío si TU VERSO identifica la interacción como `ACCEPTED`; nunca después de `CANCELLED`, `EXPIRED`, `FINISHED`, `REJECTED`.
- Se rechazan links HTTP, localhost, IP literal, URL con credenciales y dominios internos; no se descarga la imagen desde el Administrador.
- Se exige un UUID de idempotencia independiente del identificador de acceso del pedido; un reintento usa exactamente el mismo UUID.
- `POST /api/v1/mobile/interactions/{id}/message` mantiene TEXT / FORM y ahora permite `form.imageUrl` opcional.
- `POST /api/v1/mobile/interactions/{id}/payment` conserva su semántica anterior, distinta del envío de comprobante.
- No se agrega tabla ni migración SQL. Sin modificaciones TU VERSO, Android, Railway o producción.

## Verificación pendiente antes de instalar
```sh
node --check server/mobile-tuverso-routes.mjs
node --check server/tuverso-mobile-connector.mjs
node --test server/payment-receipt-validation.test.mjs server/mobile-tuverso-routes.test.mjs
```
No marcar como validado en entorno real hasta probar con una interacción de prueba y comprobar que TU VERSO renderiza `imageUrl`.
