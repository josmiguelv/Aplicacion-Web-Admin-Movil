# Pollos B3 — formulario MOBILE_APP hacia TU VERSO (22/11/2026)

## Alcance y estado
Implementado en la rama `fix/b3-mobile-form-to-tuverso-20261122`. Cambia **solamente** el envío
del detalle del pedido: Administrador Web ahora produce `type:"FORM"` en la API S2S ya existente.
El frontend administrativo, Android, PostgreSQL, la integración con WhatsApp y pagos no se modifican.

Los endpoints públicos de Android y los datos obligatorios **no cambian**.
La API de TU VERSO PRE-F2/07 está publicada; el Administrador no debe exponer el token TU VERSO al móvil.

## Flujo que utiliza Android

### 1. Crear interacción
`POST /api/v1/mobile/interactions`, con cabecera `Idempotency-Key: <UUID>` y JSON:

```json
{
  "appId": "com.integrab2g.pollosb3",
  "storeId": "<UUID de sede publicada>",
  "catalogRevision": 18,
  "customerExternalId": "cliente-123",
  "items": [{"productId":"<UUID de producto>","quantity":1}],
  "customer": {
    "firstName":"Ana","lastName":"Quispe","phone":"912345678",
    "address":"Av. Ejemplo 123","district":"Santa Anita",
    "reference":"Portón lateral","mode":"delivery"
  }
}
```

`catalogRevision` debe ser la revisión que haya publicado el Administrador. `quoteRevision`
sigue siendo compatible en lugar de `catalogRevision`. El Administrador sigue validando
sede, tenant, productos, precios y disponibilidad. Devuelve `interactionId`, `status` y
`externalReference`. Si la creación se reintenta, usar la **misma** clave UUID.

### 2. Enviar FORM (sin que Android construya el formulario)
`POST /api/v1/mobile/interactions/{interactionId}/message`

Cabecera: `X-Order-Access-Key: <mismo UUID de creación>`. El cuerpo es **el mismo JSON
de negocio** del paso 1 (`appId`, `storeId`, `catalogRevision`, `customerExternalId`,
`items`, `customer`), sin `Idempotency-Key` adicional; la URL ya incluye el `interactionId`.

Respuesta de éxito: `{"interactionId":"<UUID>","delivered":true,"messageId":"<UUID>"}`.

El backend construye desde el catálogo un formulario seguro, nunca acepta `type`, `form`,
`title`, botones, texto libre o importes enviados por Android. Envía privadamente:

```http
POST https://api.tuverso.integra-b2g.com/api/v1/conversations/{interactionId}/messages
Authorization: Bearer <CREDENCIAL_SERVIDOR>
Content-Type: application/json
Idempotency-Key: <UUID estable derivado de la interacción>
```

```json
{
  "type":"FORM",
  "form":{
    "title":"POLLOS B3 - SOLICITUD DE VALIDACION",
    "subtitle":"Subtotal productos: S/ 40.00. Delivery pendiente. No preparar ni cobrar antes de la confirmación.",
    "fields":[
      {"variable":"Sede","value":"Nogales"},
      {"variable":"Cliente","value":"Ana Quispe · +51 912345678 (sin verificar)"},
      {"variable":"Entrega","value":"Delivery · Av. Ejemplo 123 · Santa Anita · Ref.: Portón lateral"},
      {"variable":"Productos","value":"2 x Pollo A"}
    ]
  }
}
```

TU VERSO presenta los botones **Aceptar/Rechazar** en el propio chat del agente.
El integrador no envía los botones. Hay hasta 5 campos, cada valor de hasta 500 caracteres;
el backend **rechaza sin truncar** pedidos demasiado extensos para ese contrato.
Conserva la clave de idempotencia en reintentos. Ante un 409 de un texto emitido antes del
corte a FORM, reconoce la copia idéntica del mensaje anterior en el historial autorizado
y no lo duplica.

### 3. Consultar la respuesta del agente
`GET /api/v1/mobile/interactions/{interactionId}/status?appId=<appId>&storeId=<storeId>`

Cabecera: `X-Order-Access-Key: <mismo UUID de creación>`.

Ejemplo de respuesta:
```json
{
  "interactionId":"<UUID>","storeId":"<UUID>",
  "status":"PENDING",
  "agentMessages":[{"id":"<UUID>","text":"aceptar","createdAt":"2026-11-22T17:00:00Z"}],
  "messagesAvailable":true
}
```

El Administrador **no interpreta** los textos de decisión ni transforma `status`;
solo reenvía los mensajes OUTBOUND verificados para la interacción y sede autorizadas.

La aplicación debe ampliar su `interpretAgentDecision()`:
- aceptar **exactamente** `aceptar` como `ACCEPTED`;
- aceptar **exactamente** `rechazar` como `REJECTED`;
- mantener compatibilidad con `acepto`, `aceptado`, `aceptada`, `rechazado`, `rechazada`;
- comparar palabras completas normalizadas, **solo** en `agentMessages` OUTBOUND (nunca en mensajes INBOUND);
- `status:"ACCEPTED"` en TU VERSO significa aceptación operativa/asignación, **no** aprobación del pedido.

Si `operationalConversationStatus` es `CLOSED` o `RESOLVED`, `messagesAvailable===true`
y no existe decisión, tratar la solicitud como **rechazada** (sin volver a esperar indefinidamente).
Con `messagesAvailable:false` no inventar una decisión: reintentar la consulta de historial.
Cuando todas las sedes rechacen, ofrecer cambio de método de entrega, no recrear solicitudes.

### 4. Cancelación
El contrato `POST /api/v1/mobile/interactions/{interactionId}/cancel` y su
`X-Order-Access-Key` permanecen intactos. El aviso de cancelación sigue siendo
un TEXT normal y no un FORM.

## Ejecución local del Administrador Web (sin migraciones)
Desde `C:\Integra-B2G\Administrador Negocios`:

```powershell
git status --short
git fetch origin
git switch --track origin/fix/b3-mobile-form-to-tuverso-20261122
node --check server/tuverso-mobile-connector.mjs
node --check server/mobile-tuverso-routes.mjs
node --test server/tuverso-mobile-connector.test.mjs server/mobile-tuverso-routes.test.mjs
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .local/services.ps1 restart
```

Si la rama ya existe localmente, usar `git switch fix/b3-mobile-form-to-tuverso-20261122`
y `git pull --ff-only`, siempre después de comprobar que no existan cambios locales
sin guardar. El script local se mantiene en `.local/` (no incluido en Git).
No ejecutar migraciones, bootstrap ni reinicializar PostgreSQL.
