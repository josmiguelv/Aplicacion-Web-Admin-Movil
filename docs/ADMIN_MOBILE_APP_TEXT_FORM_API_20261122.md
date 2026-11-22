# Administrador Web — API móvil TEXT/FORM hacia TU VERSO

**Corte:** 22-11-2026 · **Repositorio:** `josmiguelv/Aplicacion-Web-Admin-Movil`  
**Código base auditado:** `dd2baea04172b9cfd36f5d350ae5bc3212150d0c`, rama
`fix/b3-mobile-form-to-tuverso-20261122`.  
**Estado:** preparado en GitHub; workflow focal de sintaxis y rutas S2S
**43/43 PASS** (Actions `45050865605`). **No verificado como instalado en el
Windows local ni certificado extremo a extremo con Android/agente.** Este cambio
de documentación no modifica código, PostgreSQL, WhatsApp ni despliegues.

## 1. Arquitectura, autoridad y seguridad

```text
Android
  │ POST /api/v1/mobile/interactions                       ──────┐
  │ POST /api/v1/mobile/interactions/{interactionId}/message     │
  │     {type:"TEXT",text} o {type:"FORM",form}                    ▼
  └─────────────────────────────────────────────► Administrador Web
                                      verifica appId, sede, tenant,
                                      sesión/idempotencia, catálogo y
                                      vínculo de integración autorizado
                                                  │
                                       S2S bearer (solo servidor)
                                                  ▼
                                       TU VERSO /api/v1/interactions
                                       y /api/v1/conversations/{id}/messages
                                                  │
                                   agente MOBILE_APP: Aceptar / Rechazar
                                                  │
                                        mensaje saliente de texto
                                                  ▼
Android ◄── GET /api/v1/mobile/interactions/{id}/status ◄── Administrador
```

- Las cabeceras `X-Order-Access-Key` y `Idempotency-Key` son UUID diferentes
  y tienen papeles distintos. La primera es la capacidad de seguimiento de la
  interacción original, **no** identidad humana verificada. La segunda asegura
  idempotencia de cada mensaje nuevo.
- El Administrador **nunca** entrega a Android el bearer del integrador
  `TUVERSO_...`, la clave maestra ni el ID interno del tenant/cola.
  Las credenciales se custodian cifradas por empresa en
  `tenant_integrations` y la sede se resuelve desde
  `integration_bindings` con propósito `ORDER_REQUEST`.
- No confiar en un `form` de Android para valorar precio, inventario, 
  comprobante, cobro ni aceptación del pedido; es **información para que el
  agente la evalúe**. El contrato comercial authoritative usa catálogo
  publicado y validación backend.
- El tipo lo elige el **emisor Android**: `TEXT` no puede interpretarse como
  `FORM` por sus palabras, y `FORM` no puede contener `text`.
  Ningún mensaje no autorizado se reenvía.
- El Administrador no decide aprobación comercial leyendo `PENDING` o
  `ACCEPTED` de la interacción. Reexpone los mensajes `OUTBOUND` reales
  y Android interpreta el contenido de respuesta.
- No se modifica la API del canal WhatsApp ni se combinan capacidades de canal.

## 2. API pública del Administrador consumida por Android

**Base local orientativa:** `http://localhost:4000` (solo entorno local
configurado). La URL real en Android depende de la configuración de su
instalación; no fijar ni inventar una URL de producción.

| Operación | Ruta | Cabeceras relevantes |
| --- | --- | --- |
| Consulta de capacidad | `GET /api/v1/mobile/stores/{storeId}/agent-availability?appId={appId}` | Sin bearer TU VERSO; respuesta `AVAILABLE`/`UNAVAILABLE` |
| Crear interacción | `POST /api/v1/mobile/interactions` | `Idempotency-Key` = UUID fijo de creación |
| Enviar mensaje | `POST /api/v1/mobile/interactions/{interactionId}/message` | `X-Order-Access-Key` = UUID de creación, y `Idempotency-Key` nuevo si TEXT libre o FORM propio |
| Seguir interacción | `GET /api/v1/mobile/interactions/{interactionId}/status?appId=...&storeId=...` | `X-Order-Access-Key` = UUID de creación |
| Cancelar | `POST /api/v1/mobile/interactions/{interactionId}/cancel` | `X-Order-Access-Key`; cuerpo `{appId,storeId}` y `reason` opcional |

El endpoint de creación conserva `appId`, `storeId`, `catalogRevision`
o `quoteRevision`, `customerExternalId`, `items`, `customer` opcional,
y los controles de tenant, sede y catálogo. No se añade `form` a esta ruta
pública: el siguiente mensaje se envía por separado para evitar volver a
introducir el fallo HTTP 503 en creación.

## 3. Mensajes: selección explícita

### 3.1 TEXT libre (sin botones)

```http
POST /api/v1/mobile/interactions/{interactionId}/message
X-Order-Access-Key: <UUID_CREACION>
Idempotency-Key: <UUID_NUEVO_DEL_MENSAJE>
Content-Type: application/json
```

```json
{
  "type": "TEXT",
  "appId": "com.integrab2g.pollosb3",
  "storeId": "<UUID_SEDE>",
  "text": "El cliente necesita modificar su pedido."
}
```

Los UUID de mensaje deben ser distintos del UUID de creación, y se conservan
cuando se reintenta el mismo envío. No mezclar `items`, `form`,
`customer`, `catalogRevision` con texto libre. `text` requerido, hasta 8.000
caracteres, admite LF y rechaza otros caracteres de control.
El backend transmite `type:"TEXT"` y `text` a TU VERSO.

### 3.2 FORM personalizado por Android (hasta cinco líneas)

```http
POST /api/v1/mobile/interactions/{interactionId}/message
X-Order-Access-Key: <UUID_CREACION>
Idempotency-Key: <UUID_NUEVO_DEL_FORMULARIO>
Content-Type: application/json
```

```json
{
  "type": "FORM",
  "appId": "com.integrab2g.pollosb3",
  "storeId": "<UUID_SEDE>",
  "form": {
    "title": "VALIDACIÓN DE PEDIDO",
    "subtitle": "Confirmar disponibilidad para delivery",
    "fields": [
      {"variable": "Cliente", "value": "Ana Quispe"},
      {"variable": "Teléfono", "value": "912345678"},
      {"variable": "Productos", "value": "2 pollos a la brasa"},
      {"variable": "Subtotal", "value": "S/ 90.00"},
      {"variable": "Dirección", "value": "Av. Principal 123, Santa Anita"}
    ]
  }
}
```

**Contrato exacto de esta ruta del Administrador:**

| Campo | Regla |
| --- | --- |
| `type` | Obligatorio `FORM` para el envío personalizado |
| `form.title` | Obligatorio, 1–180 caracteres |
| `form.subtitle` | Opcional, hasta 350 caracteres |
| `form.fields` | 1–5 elementos; cada elemento representa una fila en TU VERSO |
| `fields[].variable` | Requerida, 1–80 caracteres, etiqueta única sin distinguir mayúsculas |
| `fields[].value` | Requerida, 1–500 caracteres |
| `Idempotency-Key` | UUID distinto al de creación y al UUID reservado para el detalle estructurado del pedido |
| Mezcla de atributos | No acepta `text`, `items`, `customer` ni `catalogRevision` junto a `form` |

El Administrador normaliza espacios de inicio/fin, valida los tipos y
propiedades permitidos y envía `{"type":"FORM","form":{...}}` a TU VERSO.
Los botones Aceptar/Rechazar **no** forman parte del JSON: se renderizan
automáticamente dentro de la conversación del agente.

**Diferencia deliberada:** TU VERSO permite 0–5 campos en su esquema de
formulario S2S; el Administrador exige 1–5 para evitar enviar tarjetas vacías
desde Android.

### 3.3 FORM de pedido B3 construido por el Administrador

Para mantener el checkout anterior, Android puede enviar `type:"FORM"` **sin**
`form` y con los datos del pedido estructurado:

```json
{
  "type": "FORM",
  "appId": "com.integrab2g.pollosb3",
  "storeId": "<UUID_SEDE>",
  "catalogRevision": 18,
  "customerExternalId": "cliente-123",
  "items": [{"productId":"<UUID_PRODUCTO>","quantity":2}],
  "customer": {
    "firstName":"Ana","lastName":"Quispe","phone":"912345678",
    "address":"Av. Principal 123","district":"Santa Anita","mode":"delivery"
  }
}
```

El Administrador recalcula el pedido desde el catálogo, valida contacto y
revisión, y construye `form.title`, `subtitle` y `fields` confiables.
Usa una clave de mensaje determinista de la interacción; si detecta un
TEXT idéntico registrado antes del corte a FORM, no lo duplica.
Esta modalidad **no acepta** un `form` enviado junto con `items`.

### 3.4 TEXT de pedido y clientes anteriores

Para conservar comportamiento anterior, el mismo cuerpo estructurado de
pedido puede enviarse con `"type":"TEXT"`; el Administrador genera un texto
de pedido, no botones. Cuando una APK antigua no manda el atributo `type`,
el Administrador trata **solo ese detalle estructurado** como TEXT.
No inferir FORM por detectar palabras como «validación», «aceptar» o «pedido».

## 4. Respuestas y seguimiento hacia Android

Éxito de enviar mensaje: `HTTP 200`, por ejemplo:

```json
{
  "interactionId": "<UUID_INTERACCION>",
  "delivered": true,
  "messageId": "<UUID_MENSAJE>",
  "type": "FORM"
}
```

`delivered:true` solo confirma que TU VERSO registró el mensaje. No
significa que el agente haya aprobado el pedido.

Consulta `GET /api/v1/mobile/interactions/{interactionId}/status?appId=...&storeId=...`:

```json
{
  "interactionId": "<UUID_INTERACCION>",
  "storeId": "<UUID_SEDE>",
  "status": "PENDING",
  "agentMessages": [
    {"id":"<UUID_SALIENTE>","text":"aceptar","createdAt":"2026-11-22T17:00:00Z"}
  ],
  "messagesAvailable": true
}
```

El Administrador devuelve exclusivamente mensajes verificables
`direction:"OUTBOUND"` de TU VERSO; no traduce ni interpreta la decisión.
Android debe comparar mensajes completos normalizados:
`aceptar`/`acepto`/`aceptado`/`aceptada` => aceptar;
`rechazar`/`rechazado`/`rechazada` => rechazar.
`status:"ACCEPTED"` en el nivel de interacción puede significar solo
admisión/asignación técnica, no aprobación del pedido.

Cierre `CLOSED`/`RESOLVED` sin respuesta y cancelación del consumidor
requieren tratamiento explícito en Android; **no afirmar que este backend
convierte automáticamente un cierre sin botón en un texto "rechazar"**.
Ante caída temporal del historial `messagesAvailable:false`, no inventar
una decisión. El agente puede utilizar Aceptar/Rechazar una vez por FORM.

## 5. Validación, seguridad, errores e idempotencia

- Todas las llamadas de mensaje requieren una interacción ya creada, UUID de
  acceso correcto, sede publicada/autorizada, pertenencia a tenant e integración
  `MOBILE_APP` activa, propósito `ORDER_REQUEST` y referencia externa exacta.
- Los mensajes se rechazan si la sesión está `CANCELLED`, `EXPIRED` o
  `FINISHED` o el intake remoto ya está expirado/rechazado.
- `400`: formato, discriminador, filas, campos, UUID del mensaje o datos
  combinados incorrectos.
- `401/403`: acceso/credenciales/permisos efectivos rechazados en TU VERSO;
  `403` también puede indicar vínculo de interacción ajeno.
- `409`: conflicto de sesión, referencia, catálogo cambiado, clave reutilizada
  con contenido distinto o mensaje/formulario no admitido.
- `503`: dependencia/lectura/entrega no confirmada; no afirmar que la
  interacción de creación anterior se deshizo.
- El retorno del backend nunca debe contener bearer TU VERSO, clave maestra,
  secretos cifrados ni referencias a otras empresas.
- No procesar precios ni pagos usando los datos de texto o FORM libres.

## 6. Mapa de código para cambios quirúrgicos

| Necesidad | Archivo/función |
| --- | --- |
| Entrada Android, rutas, tipo, validación y aislamiento | `server/mobile-tuverso-routes.mjs` → `createMobileTuVersoRoutes` |
| Generación del FORM B3 desde catálogo | `server/mobile-tuverso-routes.mjs` → `orderForm`, `calculateOrderCart` importado |
| Validador FORM recibido de Android | `server/mobile-tuverso-routes.mjs` → `validClientForm` |
| Cliente HTTP TU VERSO y contratos de respuesta | `server/tuverso-mobile-connector.mjs` → `sendMobileInteractionMessage`, `readMobileInteractionMessages` |
| Credenciales por tenant y sede | `server/integrations.mjs`, `server/integration-crypto.mjs` y consulta `binding()` |
| Estado/cancelación del pedido | `server/mobile-checkout-followups.mjs` y rutas `status/cancel` |
| Rutas y pruebas de integración simulada | `server/mobile-tuverso-routes.test.mjs`, `server/tuverso-mobile-connector.test.mjs` |
| API receptora en TU VERSO (otro repo) | `server/api/externalConversationS2SRoute.ts`, `server/api/mobileInformationalForm.ts` |
| Tarjeta del agente en TU VERSO (otro repo) | `src/features/conversations/MobileInformationalFormMessage.tsx`, `QueueAttentionInbox.tsx` |

**Regla de pruebas:** para modificaciones de este contrato, ejecutar
`node --check` sobre los dos módulos de rutas y sus tests y
`node --test server/tuverso-mobile-connector.test.mjs server/mobile-tuverso-routes.test.mjs`.
No ejecutar pruebas generales, reconfigurar bases de datos ni automatizar
llamadas productivas en el trabajo exclusivamente documental.

## 7. Estado real de entrega y siguientes verificaciones

- Implementado/documentado en la rama de desarrollo
  `fix/b3-mobile-form-to-tuverso-20261122`; no se asegura que la rama esté
  activada en la instancia Windows del usuario.
- Código de TU VERSO del backend y tarjeta de agente publicado previamente en
  Railway; **no** equivale a un E2E certificado de este consumidor.
- Pruebas focales Administrador: **43/43 PASS** en GitHub Actions
  [ejecución 45050865605](https://github.com/josmiguelv/Aplicacion-Web-Admin-Movil/actions/runs/45050865605)
  sobre el corte de prueba (code+tests). Cambios posteriores de documentación
  no alteran ese código.
- Android todavía debe emitir explícitamente `type:"FORM"` con el JSON válido,
  así como reconocer `aceptar` y `rechazar` en los mensajes del agente.
- El flujo completo con un agente real y la reacción del Android al cierre
  sin respuesta **aún exige validación humana focal**.

[Contrato Android y ejemplos](TUVERSO_FORM_ANDROID_CONTRATO_20261122.md) ·
[APIs móviles relacionadas](MOBILE_TUVERSO_APIS_SEPARADAS.md) ·
[Integraciones y credenciales](TUVERSO_INTEGRACIONES.md) ·
[Mapa de riesgos](MAPA_COMPONENTES_Y_RIESGOS.md) ·
[Índice documental](README.md).
