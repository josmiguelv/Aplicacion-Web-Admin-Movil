# Administrador Web — base de consolidación (24/11/2026)

## Decisión de versionado
- Base de trabajo tomada del remoto `feat/b3-admin-reservation-transactional-20261123` (SHA `969e6bfc5b2edcf9087156b538b25a67d1cdf136`).
- Se mantiene intacta la interfaz avanzada de empresa → sedes → tarjetas de configuración, reservas, delivery, recojo, productos y ajustes de pago.
- **No** fusionar automáticamente `fix/admin-public-payment-config-20261123`: procede de una base antigua y contiene la tabla `008-payment-provider-images.sql`, incompatible con la progresión de migraciones `008` a `021` de la base avanzada.
- La versión avanzada **ya contiene**: `server/migrations/020-payment-method-images.sql`, `server/migrations/021-company-shared-payment-images.sql`, interfaz de una imagen Yape/Plin/Izipay y API administrativa `/api/admin/tenants/:tenantId/payment-images`.
- Única adición de esta consolidación: exponer `paymentWaitMinutes`, `reminderCount` y `stores[].paymentOptions` en `GET /api/v1/mobile/config`; exponer `paymentWaitMinutes` y `paymentOptions` en `POST /api/v1/mobile/fulfillment/resolve`, conservando todos los campos anteriores. No se cobran ni se confirman transacciones.

## Protección de trabajo local
El equipo Windows del usuario tenía `vite.config.ts` modificado fuera de Git. No sobrescribir ni hacer `reset --hard`; preservar el stash ya creado y confirmar `git status` antes de actualizar. El SHA remoto de la rama de reservas puede diferir de commits que el usuario tenga únicamente en local: **verificar ese contraste antes de recomendar cambiar a la rama consolidada**. Ningún dato SQL fue migrado ni corregido por este PR.

## Migraciones
No crear tablas de pagos duplicadas; aplicar solo migraciones propias de la rama avanzada y únicamente cuando el usuario confirme el estado local. No ejecutar ninguna migración sobre TU VERSO o Railway.

## Prueba focal
`node --check server/index.mjs`
`node --test server/payment-public-options.test.mjs`

Antes de usarlo localmente: confirmar que la interfaz de reservas no retrocedió y que `GET /api/v1/mobile/config` devuelve las imágenes configuradas al **publicar** el catálogo. No borrar las ramas históricas hasta verificar que todas las mejoras útiles están integradas.
