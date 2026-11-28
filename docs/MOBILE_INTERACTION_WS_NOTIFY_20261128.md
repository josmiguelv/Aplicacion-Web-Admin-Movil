# Pollos B3 — Notificación WSS de interacciones móviles (2026-11-28)

## Alcance

Implementación **exclusivamente en Administrador Web**, sin cambios en TU VERSO ni Android.
El Administrador **no interpreta** `aceptar`/`rechazar`, no confirma pedidos y no altera ninguna ruta REST existente.
Los eventos son avisos para que Android haga inmediatamente la consulta de estado HTTP que ya utiliza.

## Conexión

Activación de prueba local: `B3_MOBILE_WS_ENABLED=true` en el proceso del Administrador.
En producción debe usarse exclusivamente **wss://** sobre HTTPS mediante el proxy confiable.

```http
GET wss://<host>/api/v1/mobile/interactions/{interactionId}/events/ws?appId=com.integrab2g.pollosb3&storeId={storeId}
X-Order-Access-Key: <clave individual del pedido>
```

La clave **no debe enviarse en el URL, logs, analytics, ni almacenarse como credencial global**.
El cliente nativo Android puede pasar la cabecera en el handshake WebSocket.
No está diseñado para un navegador que no permita esa cabecera.

## Contrato

Al conectarse y reconectarse, se emite:

```json
{"type":"INTERACTION_SYNC_REQUIRED","interactionId":"uuid"}
```

Al aparecer en TU VERSO un evento `MESSAGE_OUTBOUND`, `REQUEST_ACCEPTED` o `REQUEST_REJECTED`
correspondiente a esa interacción:

```json
{"type":"INTERACTION_UPDATED","interactionId":"uuid","eventId":"uuid","occurredAt":"ISO-8601"}
```

**No se envía `ACCEPTED` ni `REJECTED` inferido a partir de textos del formulario.**
Android debe consultar inmediatamente:
`GET /api/v1/mobile/interactions/{interactionId}/status?appId=...&storeId=...`,
con su `X-Order-Access-Key`, y ejecutar su interpretación actual.
El REST y su polling siguen siendo respaldo cuando WSS no esté disponible.

## Seguridad y comportamiento

- Se verifica catálogo de tenant/app/sede, integración S2S vigente, y la referencia externa de la interacción en TU VERSO usando la clave individual.
- Solo se entrega una notificación al socket autorizado cuyo `interactionId` coincida; no se transmiten textos, teléfonos, direcciones o pagos.
- Limita a 40 sockets simultáneos, 3 por IP y 12 integraciones activas por proceso.
- Un solo polling de eventos por integración conectada, cada 3 segundos; no hay polling por pedido.
- Límite de mensajes entrantes 1024 bytes; canal solo lectura, sin compresión; ping/pong y limpieza al desconectar.
- Cursor persistente **solo en memoria** por integración activa; al reconectar se notifica sincronización REST obligatoria.
- Se silencian duplicados por `eventId` por socket (ventana acotada).
- Si TU VERSO falla, las órdenes y REST continúan sin cambios; no hay eventos falsos.
- En varias instancias, cada proceso consulta eventos exclusivamente para sus clientes conectados; no hay bus distribuido ni infraestructura nueva.

## Limitaciones

El origen es la API de consulta `GET /api/v1/interactions/events` de TU VERSO, no una suscripción SSE.
Por lo tanto **no se garantiza una latencia de un segundo**: el periodo de sondeo es 3 segundos más red/procesamiento.
La función no acelera Android hasta que se implemente la suscripción en Android en una tarea separada.
La rama no está desplegada ni ha sido probada sobre TU VERSO productivo.

## Validación focalizada local

```powershell
pnpm install --frozen-lockfile
node --check server/mobile-interaction-ws.mjs
node --test server/mobile-interaction-ws.test.mjs
```

Verificar antes del despliegue la configuración HTTPS/Cloudflare y número de instancias.
No modifica esquema SQL, migraciones, reservas, pagos, WhatsApp ni endpoints REST.
