# Pollos B3 — Encuestas de satisfacción (API Administrador)

## Estado
Implementado en la rama consolidada del Administrador Web. **No desplegado.** No modifica Android ni TU VERSO; no altera estados de pedidos, pagos o interacciones. Requiere aplicar únicamente la migración `023-mobile-order-surveys.sql` en PostgreSQL del Administrador, después de comprobar las migraciones previas.

## Envío desde Android
`POST /api/v1/mobile/orders/{interactionId}/survey`

Headers: `Content-Type: application/json`, `X-Order-Access-Key: UUID de acceso al pedido`, `Idempotency-Key: UUID único de esta encuesta`.

```json
{
 "appId":"com.integrab2g.pollosb3",
 "storeId":"UUID_DE_SEDE",
 "rating":5,
 "tags":["Sabor","Temperatura","Atención"],
 "comment":"El pollo estuvo muy rico y llegó caliente."
}
```

`rating`: entero 1–5; `tags`: arreglo de 0–5 etiquetas distintas, únicamente `Sabor`, `Temperatura`, `Tiempo`, `Presentación`, `Atención`; `comment`: texto opcional de hasta 500 caracteres. Para omitir comentarios, no enviar `comment`.

Respuestas:
- 201: `{"surveyId":"UUID","interactionId":"UUID","stored":true,"createdAt":"2026-11-24T18:00:00.000Z"}`.
- 200: mismo `Idempotency-Key`, misma interacción y contenido: devuelve **el mismo registro** y fecha original.
- 400: identificadores o contenido inválidos.
- 403: empresa, sede, binding, clave del pedido o referencia no autorizados.
- 404: aplicación o interacción no encontrada.
- 409: ya existe una encuesta diferente para la interacción o clave.
- 413: JSON mayor al límite de 65536 caracteres del servidor.
- 429: límite por dirección IP.
- 503: dependencia o persistencia temporalmente indisponible.

**Idempotencia:** reutilizar el mismo UUID cuando se reintenta la misma encuesta; no generar otra clave. El índice `UNIQUE(tenant_id,app_id,interaction_id)` impide encuestas adicionales, incluso concurrentes. El índice `UNIQUE(tenant_id,app_id,idempotency_key)` impide reutilizar una clave para otro pedido.

La API valida `appId` y `storeId` con el catálogo publicado y el binding autorizado; contrasta el `externalReference` derivado de la clave de pedido con la interacción leída en TU VERSO. El estado técnico puede haber terminado: Android decide cuándo solicitar la encuesta. Ni el payload ni la respuesta incluyen datos personales adicionales. La API no interpreta «aceptar» ni «rechazar».

## Consulta autenticada en Administrador
`GET /api/admin/mobile/surveys`

Usa cookie de sesión de Administrador Web `b3sid`. Permite filtros opcionales:
`storeId=UUID`, `appId=...`, `rating=1..5`, `from=YYYY-MM-DD`, `to=YYYY-MM-DD` (días UTC, inclusive), `limit=1..100` (20 por defecto), `offset=0..1000000` (0 por defecto).

Un `TENANT_ADMIN` consulta únicamente su empresa. Un `SUPER_ADMIN` debe proporcionar `tenantId=UUID`; no se entregan encuestas cruzadas sin ámbito explícito.

Respuesta:
```json
{
 "items":[{"surveyId":"UUID","appId":"com.integrab2g.pollosb3","storeId":"UUID","interactionId":"UUID","rating":5,"tags":["Sabor"],"comment":"Excelente","createdAt":"2026-11-24T18:00:00.000Z"}],
 "total":1,"limit":20,"offset":0
}
```

La consulta no llama a TU VERSO, por lo que sigue disponible si su servicio está desconectado. La API guarda las calificaciones individuales que permitirán calcular el promedio por sede o empresa en una futura tarjeta de «Encuestas de satisfacción», junto con vistas de detalle y filtros. **Esta entrega no crea el panel, la tarjeta ni estadísticas.**

## Verificación focalizada
```powershell
node --check server/mobile-order-surveys.mjs
node --check server/index.mjs
node --test server/mobile-order-surveys.test.mjs server/mobile-tuverso-routes.test.mjs server/payment-receipt-validation.test.mjs
```
Comprobar integridad SQL antes de aplicar `server/migrations/023-mobile-order-surveys.sql` a la BD local; no aplicar en Railway ni producción sin autorización. Se debe verificar el resultado de las pruebas tras descargar la rama actualizada.
