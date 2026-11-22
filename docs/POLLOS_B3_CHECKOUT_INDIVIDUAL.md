# Pollos B3 — Seguimiento de pedido y pago (fase piloto)

**Alcance:** exclusivamente Administrador Web de Pollos B3 + aplicación Android. No modificar ni desplegar TU VERSO.

## Instalación independiente

1. Aplicar manualmente `server/migrations/007-mobile-checkout-followups.sql` en la base PostgreSQL **del administrador de Pollos B3**, después de respaldar la configuración propia; **jamás** en la base de TU VERSO. No se ejecutan migraciones en el arranque.
2. Desplegar el backend del Administrador con el PR de checkout antes de instalar la nueva APK. Verificar `GET /health/ready`.
3. En **Configuración del negocio → Datos de la empresa**, definir `paymentWaitMinutes` (5–30, inicial 10) y `reminderCount` (0–2, inicial 2).
4. Para avisos push cuando Android está en segundo plano o cerrado, proporcionar `B3_FCM_SERVICE_ACCOUNT_JSON` con el JSON completo de cuenta de servicio del **proyecto Firebase correspondiente a Pollos B3**, únicamente como variable segura en el runtime del administrador. No introducir credenciales en el APK ni en el repositorio.
5. Activar el worker solo **después de migrar** y **en una única instancia** con `B3_CHECKOUT_WORKER_ENABLED=true`. Si no existe servicio Firebase configurado, los recordatorios push no se entregarán; las respuestas y estados seguirán disponibles al abrir Android.
6. Compilar la APK Android con `-PB3_API_BASE=https://<URL-HTTPS-REAL-DEL-ADMINISTRADOR>`; no utilizar URL temporal caducada. Verificar `google-services.json` del proyecto Firebase ya conectado. No poner tokens S2S en Android.

## Contrato individual

- `POST /api/v1/mobile/interactions/:id/device` recibe `appId`, `storeId` y `fcmToken` junto con `X-Order-Access-Key`. Verifica la titularidad de la conversación mediante el contrato actual de TU VERSO y guarda un único destino push. Sin topics de marketing.
- `POST /api/v1/mobile/interactions/:id/payment` recibe `appId` y `storeId` con la misma clave privada. Solo Android lo llama tras interpretar el texto del agente, calcular la tarifa y validar productos publicados. Devuelve `expiresAt`, sin reiniciar el tiempo con cada consulta.
- `GET /api/v1/mobile/interactions/:id/payment?appId=...&storeId=...` consulta `PAYMENT_PENDING` / `EXPIRED` con la clave privada.
- `POST /api/v1/mobile/interactions/:id/cancel` notifica a la sede y, tras confirmación, detiene recordatorios. `reason=CANCEL|MODIFY` permite distinguir cancelar la compra de cambiar productos.

## Responsabilidades y limitaciones

- Mientras el agente revisa: **no hay timeout comercial de espera**; Android vuelve a consultar la misma interacción y presenta un radar animado. Se puede explorar Inicio/Carta/Mi Cuenta sin crear otra solicitud; cancelar es una acción independiente.
- La notificación de respuesta del agente en segundo plano es **genérica**: el administrador no interpreta ni decide aceptación o rechazo. Android obtiene los textos válidos cuando se abre y aplica la decisión.
- Tras aceptación: empieza el plazo del cliente en el backend, se muestra la tarifa y total. Los recordatorios se envían aproximadamente en los puntos 1/(N+1), 2/(N+1) del plazo, según N=0,1,2. Expiración invalida pago y envía aviso informativo de cancelación al agente por la API ya disponible. **La API actual no garantiza el cierre técnico de la conversación en TU VERSO.**
- La estimación de reparto es por **Haversine / distancia en línea recta**, desde coordenadas del destino obtenidas en Android; se aplican las coberturas, tarifas fijas o por km y sedes publicadas, sin llamar a Google Routes. No representa distancia por carretera ni un cobro final.
- No existen pasarela ni cobro real en este piloto. Implementar confirmación de pago del proveedor y estado `FINISHED` antes de producción comercial.
- Los pushes usan FCM HTTP v1, un `message.token` individual. Jamás se usan `topics`, lista de tokens ni los ajustes de consentimiento de promociones. En Android 13+ se requiere permiso de notificaciones. Si se deniega, el usuario puede recuperar su solicitud dentro de la app.
- No se verifican clientes mediante el token FCM; la autorización del estado se realiza con id de interacción, tienda, aplicación y clave privada. Borrar datos de app o cambiar dispositivo sin recuperar su clave impide recuperar esa sesión (no inventar vínculo por teléfono).
- Mantener solo una instancia del worker hasta incorporar reclamación transaccional y locks multiinstancia. Observar métricas de entregas y fallos FCM, limitar tasas e incorporar limpieza de tokens antiguos antes de escalar.

## Pruebas focalizadas

```bash
node --test server/mobile-tuverso-routes.test.mjs server/mobile-checkout-followups.test.mjs
```

Android:

```bash
node --test scripts/order-availability-api.test.mjs scripts/order-availability-flow.test.mjs
./gradlew :app:assembleDebug
```

Pruebas E2E necesarias antes de GO: acceso directo del push correcto, denegación de permisos, token rotado, 503 después de crear sin duplicados, aceptación/rechazo con agente real, cancelar, modificar, vencimiento, 2 recordatorios personales, reinicio Android y cotización sin Google Routes.
