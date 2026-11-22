# Administrador SaaS — INTEGRA B2G

> **Documentación vigente de mensajería MOBILE_APP, 22-11-2026:** 
> [API pública TEXT/FORM del Administrador Web](docs/ADMIN_MOBILE_APP_TEXT_FORM_API_20261122.md)
> y [contrato exacto para Android](docs/TUVERSO_FORM_ANDROID_CONTRATO_20261122.md).
> Android selecciona el tipo; el Administrador valida y retransmite a TU VERSO
> con credencial privada, sin modificar canales ajenos. Los documentos de fases
> previas conservan su contexto histórico.


Repositorio de la plataforma administrativa multitenant y sus APIs comerciales. Cada negocio se registra como tenant; Pollos B3 es un posible consumidor, no el tenant fijo del sistema. El alcance de este repositorio no incluye el código, base de datos ni despliegue de TU VERSO, de las aplicaciones móviles o de la web comercial.

## Empezar por aquí

- [Índice de documentación](docs/README.md): documentos y tareas habituales.
- [Arquitectura SaaS](docs/ARQUITECTURA_ADMINISTRADOR_SAAS.md): componentes, perfiles, aislamiento, datos, flujos y límites actuales.
- [Mapa de componentes y riesgos](docs/MAPA_COMPONENTES_Y_RIESGOS.md): dónde buscar para cambiar una función y qué validar.
- [API Keys S2S](docs/API_KEYS_INTEGRACIONES.md): gestión y consumo de claves privadas para lectura de catálogo.
- [Integraciones TU VERSO](docs/TUVERSO_INTEGRACIONES.md): configuración por empresa, custodia de credenciales y límites.
- [API de disponibilidad](docs/MOBILE_ORDER_AVAILABILITY_API.md): contrato, estados, migración 006 y operación local.
- [APIs móviles TU VERSO separadas](docs/MOBILE_TUVERSO_APIS_SEPARADAS.md): consulta por sede, inicio de interacción y prueba local Windows.

## Componentes activos

- **Portal:** `src/app/AdminPortal.tsx`, con sesión de servidor y contexto de tenant.
- **Operación comercial:** `src/app/MobileOperations.tsx`, configuración por empresa y publicación de catálogo.
- **Integraciones:** `src/app/TuVersoIntegrations.tsx`, configuración reservada a Super Admin.
- **Backend:** `server/index.mjs` y módulos `server/integrations.mjs`, `server/service-api-keys.mjs`, `server/mobile-order-availability.mjs`.
- **Base de datos:** `server/schema.sql` para una base vacía; `server/migrations/` para cambios aditivos en bases existentes.

`src/app/App.tsx` es un prototipo anterior y no es la entrada del portal autenticado. Confirma el mapa de componentes antes de implementar una pantalla para evitar editar el prototipo.

## Estado y límites conocidos

La rama de desarrollo incluye el contrato de disponibilidad multitenant y sus pruebas focalizadas. La presencia de código en una rama no confirma que esté desplegado, que la migración 006 esté aplicada o que una app real se haya conectado. No hay evidencia documentada de pedido, pago o reserva de inventario reales ni de E2E productivo con TU VERSO.

El catálogo actual publica moneda `PEN`; la zona horaria del tenant usa `America/Lima` como fallback. Las llamadas reales S2S a TU VERSO están desactivadas por defecto. Consulta [Arquitectura](docs/ARQUITECTURA_ADMINISTRADOR_SAAS.md) para los riesgos y las limitaciones completos.

## Desarrollo local

Los comandos y prerequisitos están en el documento de [API de disponibilidad](docs/MOBILE_ORDER_AVAILABILITY_API.md), junto con las diferencias entre una base nueva y una base existente. No ejecutes `server/schema.sql` sobre una base que ya tiene datos; identifica la base local del Administrador y aplica solamente las migraciones pendientes que correspondan.

## Regla de mantenimiento

Al modificar una capacidad, actualiza en el mismo cambio su contrato y mapa: consumidor, tenant owner, permisos, variables, migración, pruebas focalizadas, límites y estado (implementado, migrado, desplegado o certificado). No documentes una integración o despliegue como operativo sin evidencia observada.
