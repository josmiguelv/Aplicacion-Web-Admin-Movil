# Mapa de componentes, cambios y riesgos

## Alcance

Este mapa corresponde únicamente a `Aplicacion-Web-Admin-Movil`. El repositorio contiene el administrador SaaS de INTEGRA B2G y sus APIs. No es el repositorio de TU VERSO ni de una aplicación Android o web consumidora.

## Cambio vigente — API de mensajes MOBILE_APP 22-11-2026

El contrato actualizado está en [API TEXT/FORM del Administrador](ADMIN_MOBILE_APP_TEXT_FORM_API_20261122.md)
y en el [contrato Android](TUVERSO_FORM_ANDROID_CONTRATO_20261122.md).

| Componente / riesgo | Autoridad | Prueba focal |
| --- | --- | --- |
| `type:"TEXT"` vs `type:"FORM"`, validación de 1–5 filas, rechazo de campos cruzados, origen y idempotencia | `server/mobile-tuverso-routes.mjs` → ruta `/api/v1/mobile/interactions/{id}/message`, `validClientForm` | `server/mobile-tuverso-routes.test.mjs` |
| Conversión de pedido estructurado a FORM sin confiar en precios de Android | `server/mobile-tuverso-routes.mjs` → `orderForm`, `calculateOrderCart` | `server/mobile-tuverso-routes.test.mjs` |
| S2S HTTP, bearer privado, relectura de historial y serialización de FORM/TEXT | `server/tuverso-mobile-connector.mjs` → `sendMobileInteractionMessage` | `server/tuverso-mobile-connector.test.mjs` |
| Respuesta del agente y cierre sin decisión: Android no debe esperar indefinidamente | `GET /api/v1/mobile/interactions/{id}/status` transmite `agentMessages` sin traducir; Android interpreta | Prueba E2E focal pendiente |
| Integridad por tenant, sede y capacidades de WhatsApp independientes | `binding()`, `reference()` + TU VERSO S2S MOBILE_APP | Casos cross-tenant de las pruebas de ruta |

**Precaución:** no intentar corregir el envío FORM en `src/app/MobileOperations.tsx`;
esa pantalla administra catálogo, **el contrato HTTP está en backend**.
No mezclar `type`/campos con el flujo de cancelación, que transmite un TEXT
de sistema. Un `messageId` confirmado no equivale a aceptación ni pago.
Código preparado, pruebas 43/43; falta instalar local y validar E2E.
Los mapas históricos posteriores se conservan para otros módulos.

## Mapa rápido: qué archivo revisar

| Necesidad | Punto de entrada principal | Dependencias que también se deben revisar |
| --- | --- | --- |
| Login, sesión, selección/alta de tenant y navegación autenticada | `src/app/AdminPortal.tsx` | `server/index.mjs` — sesión, roles y rutas `/api/admin/*`; tablas `admin_users`, `admin_sessions`, `tenants`. |
| Operación móvil: sedes, horarios, tarifa, productos, promociones, pagos, vacantes, apps y publicación | `src/app/MobileOperations.tsx` | `server/index.mjs` — validación, persistencia y `publish()`; `server/schema.sql`; API `GET /api/v1/mobile/config`. |
| Integraciones TU VERSO por tenant | `src/app/TuVersoIntegrations.tsx` | `server/integrations.mjs`, `server/integration-crypto.mjs`, `server/tuverso-client.mjs`, `server/tuverso-mobile-connector.mjs`; `TUVERSO_INTEGRACIONES.md`. |
| API de validación de disponibilidad de pedidos | `server/mobile-order-availability.mjs` | `server/index.mjs` — carga de contexto, sedes, horario y tarifa; migración 006; `mobile-order-availability.test.mjs`; documento API. |
| APIs S2S de catálogo con API Key | `server/service-api-keys.mjs` | Migración 005, rutas de autenticación y publicación del catálogo; `API_KEYS_INTEGRACIONES.md`. |
| Contratos y tipos compartidos del frontend | `src/domain/types.ts` | DTOs reales en `server/index.mjs`, payload publicado y consumidores externos. |
| Esquema de una base nueva | `server/schema.sql` | Para una base existente, aplicar las migraciones correspondientes; no usar el esquema completo como migración. |
| Sesión, aislamiento por tenant, catálogo, entrega, imágenes y health checks | `server/index.mjs` | SQL parametrizado, tablas relacionadas, variables de entorno, APIs públicas y controles del gateway. |
| Prototipo visual anterior | `src/app/App.tsx` | No es el portal autenticado activo. No implementar aquí administración real sin confirmar primero el punto de entrada. |

El backend está concentrado en `server/index.mjs`; la lógica con contratos propios se extrae a módulos. Al tocar una ruta central, verificar el orden de enrutamiento y que las rutas públicas no hereden por accidente cookies/CORS de las rutas administrativas.

## Componentes y responsabilidades

### Frontend

- `AdminPortal.tsx` es el portal activo para acceso, identidad de sesión, contexto de tenant y navegación de operaciones.
- `MobileOperations.tsx` configura datos comerciales por empresa. Los cambios se guardan en PostgreSQL como configuración del tenant; la acción de publicar genera una nueva revisión consumible por `appId`.
- `TuVersoIntegrations.tsx` permite al Super Administrador guardar una integración por empresa y vincular sedes. Las asociaciones externas son configuración manual autorizada, no una certificación automática de datos en TU VERSO.
- `App.tsx` conserva el prototipo anterior. No debe usarse como referencia de autorización o persistencia.
- `src/domain/types.ts` mantiene tipos frontend; no reemplaza validaciones del servidor ni el contrato publicado.

### Backend y rutas

| Prefijo o ruta | Consumidor | Identidad/seguridad | Responsable |
| --- | --- | --- | --- |
| `/api/admin/*` | Portal | Cookie de sesión HttpOnly; `SUPER_ADMIN` o `TENANT_ADMIN`; origen de escritura validado | `server/index.mjs`, `server/integrations.mjs`, `server/service-api-keys.mjs` |
| `/api/v1/mobile/config` | App móvil o consumidor del catálogo | `appId` publicado; solo tenant activo y app habilitada | `server/index.mjs` |
| `/api/v1/mobile/fulfillment/resolve` | App móvil | Configuración publicada, dirección/GPS confirmados y límites de cotización | `server/index.mjs` |
| `/api/v1/mobile/images/{id}` | App móvil | Imagen debe pertenecer al catálogo publicado de tenant/app activa | `server/index.mjs` |
| `/api/v1/mobile/orders/availability` | Aplicación registrada | `appId`, token opaco de validación, idempotencia y datos derivados del catálogo | `server/mobile-order-availability.mjs` |
| `/api/v1/integrations/catalog` | Backend de un tercero | `Authorization: Bearer ib2g_sk_v1_…`, scope actual `catalog.read`, tenant derivado de la clave | `server/service-api-keys.mjs` |
| `/health/live`, `/health/ready` | Supervisión del servicio | Liveness no depende de BD; readiness consulta PostgreSQL | `server/index.mjs` |

Los endpoints de validación de pedidos **no crean el pedido ni procesan el pago**. El estado `READY_FOR_PAYMENT` indica que el asesor aceptó la solicitud de disponibilidad; no confirma inventario ni reserva.

## Modelo de datos y fronteras de tenant

| Grupo | Tablas principales | Propietario y uso |
| --- | --- | --- |
| Plataforma y acceso | `tenants`, `admin_users`, `admin_sessions`, `admin_audit` | Roles, tenant activo, sesión y auditoría administrativa. |
| Catálogo | `mobile_apps`, `stores`, `products`, `promotions`, `payment_methods`, `job_vacancies`, `product_images`, `published_catalogs` | Datos de empresa y snapshot publicado por app. |
| Integración TU VERSO | `tenant_integrations`, `integration_bindings` | Credencial cifrada por integración y asociación de sede/tenant. |
| API Keys de terceros | `tenant_api_keys` | Hash, prefijo, scope, vencimiento y revocación; nunca la clave en claro. |
| Validación de disponibilidad | `mobile_order_validations`, `mobile_order_attempts` | Estado e intentos por tenant/app con claves idempotentes y referencias externas. |

Reglas de aislamiento a preservar:

1. El backend obtiene el tenant de la sesión o de una credencial asociada; el cliente no elige un `tenantId` confiable.
2. Cada consulta/mutación de recursos empresariales incluye el tenant derivado y valida la pertenencia del recurso.
3. Las relaciones entre tienda, app, integración, intento y validación usan claves compuestas o comprobaciones explícitas para impedir cruces entre empresas.
4. Los IDs UUID no son una autorización. Devolver `404` para objetos ajenos evita confirmar su existencia.
5. El catálogo móvil es un snapshot publicado; un cambio de borrador no se vuelve público hasta publicar una revisión.

## Flujos que tienen acoplamientos relevantes

### Guardar y publicar catálogo

1. El portal envía cambios al endpoint de tenant correspondiente.
2. `server/index.mjs` valida el cuerpo, el usuario y el tenant, y persiste con SQL parametrizado.
3. La publicación lee stores, products, promotions, payments, vacancies, app settings y zona horaria del mismo tenant.
4. `published_catalogs` guarda una revisión del payload. La API pública lee ese snapshot y comprueba app y tenant activos.

Si un campo nuevo debe llegar a móvil, cambiar solo la forma del formulario no basta: actualizar validación y persistencia, publicar el campo, documentar el DTO y cubrir lectura de la versión publicada.

### Cotización de delivery

- Las sedes se filtran por estado activo, modalidad, horario y cobertura.
- La zona horaria del tenant determina si la sede está abierta.
- Google Routes se llama desde el backend; la clave nunca va a la app. La cotización falla cerrada si la ruta o la clave no están disponibles.
- La tarifa por kilómetro o fija y el límite de cobertura tienen semánticas distintas; no cambiar una sin revisar `README.md`, `MobileOperations.tsx` y el flujo `fulfillment/resolve`.

### Validación de disponibilidad y TU VERSO

- El Administrador identifica tenant/app/sede localmente y usa una vinculación explícita con ubicación externa y propósito `ORDER_REQUEST`.
- La API pública recibe token opaco e idempotencia. El subtotal y los precios se calculan desde el catálogo publicado, no desde datos monetarios que envíe el cliente.
- El backend consulta disponibilidad y, si corresponde, crea/lee una interacción S2S. Las credenciales se descifran solo en backend.
- Las llamadas reales están controladas por flags y credenciales; las pruebas sintéticas no equivalen a E2E.
- No editar ni desplegar código de TU VERSO como parte de cambios a este repositorio.

## Migraciones

`server/schema.sql` representa el esquema de una **base nueva vacía**. En bases existentes, aplicar únicamente migraciones pendientes y en el orden establecido por el historial del entorno:

| Migración | Responsabilidad documentada |
| --- | --- |
| `003-tuverso-integrations.sql` | Configuración de tenant e integración con vínculos locales. |
| `004-minimal-tuverso-configuration.sql` | Permite dejar ciertos metadatos externos opcionales sin borrar valores. |
| `005-tenant-api-keys.sql` | Claves privadas S2S por tenant para lectura de catálogo. |
| `006-mobile-order-availability.sql` | Zona horaria, indicador por sede, asociación app-vínculo, validaciones e intentos idempotentes. |

Las migraciones no se ejecutan automáticamente al arrancar. La migración 006 corresponde exclusivamente a la base del Administrador; nunca a PostgreSQL de TU VERSO. El documento de la API describe la ejecución local y la diferencia entre base nueva y existente.

## Pruebas focalizadas

| Área | Prueba | Cobertura indicada por el código |
| --- | --- | --- |
| Configuración de integración | `node --test server/integrations.test.mjs` | Validaciones, scopes, datos no autorizados y credenciales simuladas. |
| Cliente de interacción S2S | `node --test server/tuverso-mobile-connector.test.mjs` | Respuestas simuladas, validación de payload y límites del contrato. |
| Validación de pedidos | `node --test server/mobile-order-availability.test.mjs` | Subtotal desde catálogo, aislamiento entre dos tenants y avance tras rechazo. |
| Construcción frontend | `pnpm build` | TypeScript y compilación Vite. |

Ejecutar solo las pruebas relacionadas con el cambio. Las pruebas unitarias simuladas no acreditan conexión real, migración aplicada, rate limiting distribuido ni comportamiento en producción.

## Riesgos actuales que condicionan nuevas funciones

| Riesgo | Impacto | Antes de modificar |
| --- | --- | --- |
| Cambios cruzados de tenant | Exposición o modificación de datos de otra empresa | Añadir tenant en la consulta/relación y prueba explícita con dos tenants. |
| Catálogo publicado distinto del borrador | El consumidor no ve un campo o sigue viendo un dato anterior | Revisar `publish()`, revisión del snapshot, endpoint público y DTO documentado. |
| Migración aplicada a base equivocada | Daño o incompatibilidad entre Administrador y TU VERSO | Confirmar `DATABASE_URL` local del Administrador y tablas precondición; nunca ejecutar `schema.sql` completo sobre datos existentes. |
| Credencial filtrada o pérdida de clave maestra | Acceso no autorizado o imposibilidad de descifrar conexiones existentes | Mantener claves solo servidor, conservar la misma clave maestra y no registrar tokens. |
| Flag global habilitado sin prueba | Llamadas S2S reales para cualquier tenant configurado | Mantener defaults cerrados; validar cuenta, vínculo, scope y autorización antes de una prueba controlada. |
| Rate limit en memoria | Cada proceso/réplica mantiene su propio contador | Agregar limitador distribuido/gateway antes de escalar exposición pública. |
| Moneda y operaciones de negocio limitadas | Total incorrecto para un tenant con otra moneda; la aprobación no equivale a pedido | No prometer multimoneda, reserva, pago o creación de orden. |
| `server/index.mjs` centraliza rutas y negocio | Cambios aparentemente locales pueden afectar catálogo, sesiones y APIs | Revisar el router completo y ejecutar pruebas focalizadas por ruta afectada. |
| `App.tsx` es prototipo legado | Una mejora allí podría no aparecer en el portal activo | Confirmar siempre el entry point desde `src/main.tsx` y `AdminPortal.tsx`. |
| Despliegue no certificado | La rama local/CI no demuestra que el entorno tenga esquema o variables | Informar por separado implementación, migración, arranque y E2E; no llamar “desplegado” al código de una rama. |

## Lista de revisión para cada cambio futuro

- Identificar tenant, rol y consumidor antes de editar.
- Trazar UI → ruta → función de dominio → SQL → payload publicado/API → consumidor.
- Mantener CORS y auth separados entre administración, API móvil pública y API S2S.
- Validar valores en servidor; usar parámetros SQL; no confiar en totals, tenant, sede o ubicación externa enviados por el cliente.
- Preparar migración aditiva para bases existentes y documentar cómo aplicarla localmente.
- Actualizar tipos, contrato, ejemplo y estado de despliegue si el comportamiento cambió.
- Añadir y ejecutar pruebas focalizadas que cubran el riesgo introducido.
- No activar flags live ni hacer llamadas reales a TU VERSO como efecto colateral de una prueba rutinaria.
