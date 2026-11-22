# Pollos B3 — formulario MOBILE_APP hacia TU VERSO (22/11/2026)

## Alcance y estado
Implementado en la rama `fix/b3-mobile-form-to-tuverso-20261122`. Cambia **solamente** el envío
del detalle del pedido: Android indica `type: "TEXT"` o `type: "FORM"` en `/message` y el Administrador mantiene esa elección en la API S2S.
El frontend administrativo, Android, PostgreSQL, la integración con WhatsApp y pagos no se modifican.

Los endpoints públicos de Android **no cambian**. Se añade un discriminador `type` en el envío de mensajes; los clientes anteriores sin `type` conservan su comportamiento TEXT.
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

### 2. Enviar un mensaje: elegir explícitamente TEXT o FORM

`POST /api/v1/mobile/interactions/{interactionId}/message`

Cabecera común:
```http
X-Order-Access-Key: <mismo UUID usado al crear la interacción>
Content-Type: application/json
```

**Opción FORM** (el agente verá Aceptar/Rechazar). El cuerpo contiene `type:"FORM"`
junto a los mismos datos de pedido que en el paso 1:

```json
{
  "type":"FORM",
  "appId":"com.integrab2g.pollosb3",
  "storeId":"<UUID de sede>",
  "catalogRevision":18,
  "customerExternalId":"cliente-123",
  "items":[{"productId":"<UUID de producto>","quantity":1}],
  "customer":{"firstName":"Ana","lastName":"Quispe","phone":"912345678",
    "address":"Av. Ejemplo 123","district":"Santa Anita","mode":"delivery"}
}
```

El Administrador **calcula el formulario desde el catálogo publicado y el contacto validado**.
Android no envía `form`, `title`, `fields`, `text`, botones ni precios.
Se envía a TU VERSO con `{"type":"FORM","form":{...}}`. El backend conserva
una única clave de idempotencia del pedido para los reintentos, y no duplica un
TEXT histórico idéntico cuando la respuesta previa ya quedó registrada.

**Opción TEXT de pedido estructurado** (sin botones): enviar los mismos campos
del ejemplo anterior, cambiando a `"type":"TEXT"`. El Administrador construye
el resumen de texto a partir del catálogo y lo remite a TU VERSO como
`{"type":"TEXT","text":"..."}`.

**Opción TEXT libre**, para un mensaje de la aplicación dentro de una interacción ya
autorizada. Solo admite estos cuatro campos, y exige un UUID diferente para cada
nuevo mensaje:

```http
Idempotency-Key: <UUID nuevo por cada mensaje; conservar en reintentos>
X-Order-Access-Key: <UUID original de creación>
Content-Type: application/json
```

```json
{
  "type":"TEXT",
  "appId":"com.integrab2g.pollosb3",
  "storeId":"<UUID de sede>",
  "text":"El cliente necesita modificar un producto."
}
```

El Administrador revalida propietario, tenant, integración, sede y estado
de conversación antes de enviar el texto. Prohíbe que un TEXT contenga campos de
pedido o `form` simultáneamente; un FORM con `text` también se rechaza.
`Idempotency-Key` no puede reutilizar la clave de acceso original.
El envío libre permite saltos de línea, pero rechaza caracteres de control.

**Clientes anteriores:** si Android omite `type` pero entrega el cuerpo estructurado
de pedido original, el Administrador lo considera **TEXT**. No lo transforma en FORM
por adivinación. Para obtener botones debe enviar expresamente `type:"FORM"`.

Respuesta `200` cuando TU VERSO confirmó el mensaje:

```json
{"interactionId":"<UUID>","delivered":true,"messageId":"<UUID>","type":"FORM"}
```

El campo `type` confirma cómo se envió realmente el mensaje. `delivered:true`
no representa la decisión del agente. Ningún token de TU VERSO sale del servidor.

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
`X-Order-Access-Key` permanecen intactos. El aviso de cancelación sigue siendo un TEXT de sistema generado por el servidor,
independientemente del tipo elegido en el envío del pedido.

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
