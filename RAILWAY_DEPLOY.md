# Administrador Web INTEGRA B2G — preparación Railway (28-11-2026)

## Estado real y alcance

**Preparado para revisión; NO DESPLEGADO, NO GO-LIVE.** La rama base `feat/b3-admin-mobile-ws-event-notify-20261128` incluye el panel React, la API Node.js, APIs públicas para Android (pedidos, reservas, pagos, encuestas), integración S2S con TU VERSO y un puente de notificaciones WebSocket **opcional**. No afirmar que el WebSocket es tiempo real puro: consulta eventos TU VERSO cada 3 segundos mientras haya suscriptores. Android todavía debe incorporar el cliente WSS y conservar REST/polling como respaldo.

Esta rama de preparación NO modifica TU VERSO, Android, esquema SQL, endpoints comerciales, reglas de pago ni el ciclo de vida del pedido. **No conectar tráfico real antes de integrar y verificar las correcciones de otras ramas**, particularmente `fix/b3-mobile-flow-finished-close-20261127`; los historiales divergen.

## Topología recomendada

- Proyecto Railway **nuevo**, separado de `marvelous-acceptance` (TU VERSO).
- Un servicio Administrador Web (React estático + Node API + WSS en un solo contenedor y puerto), inicialmente **una réplica** para evitar cursores de eventos en memoria repartidos entre instancias.
- PostgreSQL 17 exclusivo del Administrador; base nueva inicia vacía.
- Dominio HTTPS propio, p.ej. `admin.integra-b2g.com` (solo después de confirmar DNS). WSS usa el mismo host y `wss://` sin túneles temporales Cloudflare.
- **Sin acceso público a PostgreSQL**; `DATABASE_URL` debe referenciar la conexión privada del servicio PostgreSQL.
- El Administrador SÍ se conecta a TU VERSO mediante las credenciales S2S autorizadas; no comparte su base, esquema ni migraciones.

## Build y startup

- `Dockerfile`: construcción multietapa Node 22, pnpm con lockfile congelado; `dist/` estático y `server/` Node.
- `railway.json`: builder Dockerfile; `node server/index.mjs`; healthcheck `/health/ready` (hasta 120 s); restart on failure.
- El servidor usa `PORT` asignado por Railway; no forzar el puerto de desarrollo.
- `GET /health/live` confirma proceso; `GET /health/ready` exige `SELECT 1` en PostgreSQL. **Ready no garantiza que todas las tablas/migraciones estén completas.**
- El contenedor no debe crear tablas ni migrar automáticamente en cada arranque.

## Variables — Railway

| Nombre | Política |
| --- | --- |
| `DATABASE_URL` | Obligatoria; referencia privada de PostgreSQL del proyecto nuevo |
| `NODE_ENV` | `production` |
| `ADMIN_ORIGIN` | Origen HTTPS definitivo exacto, sin slash final |
| `COOKIE_SECURE` | `true` |
| `INTEGRATION_MASTER_KEY` | Secreto **nuevo** de 32 bytes base64; fijar y proteger antes de guardar integraciones; cambiarlo sin rotación rompe descifrado de credenciales |
| `B3_MOBILE_WS_ENABLED` | `false` durante primera puesta en marcha; `true` solo después de validar WSS por HTTPS, credenciales y suscripción Android |
| `TUVERSO_LIVE_CHECKS_ENABLED` | `false` hasta configurar y autorizar la integración real |
| `TUVERSO_LIVE_REQUESTS_ENABLED` | `false` hasta revisión de caso de uso y permisos S2S |
| `GOOGLE_ROUTES_API_KEY` | Opcional, solo si se habilita la cotización por carretera; no exponer en frontend |
| `ALLOWED_ORIGINS` | Mantener cerrado/sin valores extra salvo contrato concreto |

No trasladar `.env` local directamente: puede contener URL localhost, claves de desarrollo o credenciales reales. Nunca usar variables `VITE_` para secretos. No almacenar `BOOTSTRAP_ADMIN_PASSWORD` persistentemente en el servicio.

## Base de datos vacía: punto crítico

`server/schema.sql` es un **baseline histórico**, mientras `server/migrations/001-...024-...` incorpora ALTER/constraints y tablas posteriores. El baseline no incluye, por ejemplo, `mobile_order_surveys` (migración 023). **No es suficiente aplicar solo schema.sql.** Tampoco asumir que se pueden ejecutar todas las migraciones a ciegas sobre el baseline (algunas definiciones pueden estar ya incluidas).

**Existe un inicializador de base vacía en `scripts/bootstrap-empty-admin-db.mjs`**: verifica PostgreSQL 17, exige cero tablas existentes, ejecuta `schema.sql` y las 23 migraciones históricas en una sola transacción con bloqueo advisory, graba hashes en `admin_schema_migrations` y valida estructuras obligatorias. En modo normal solo revisa archivos sin tocar bases. **Su ejecución real sobre PostgreSQL 17 sigue pendiente de certificación CI**. No aplicar SQL en TU VERSO. La aplicación no debe publicarse si falta alguna tabla aunque `/health/ready` devuelva 200.

Crear superadministrador una vez con `node server/bootstrap-admin.mjs` o `pnpm bootstrap:admin`, en ejecución aislada y con `BOOTSTRAP_ADMIN_EMAIL` y `BOOTSTRAP_ADMIN_PASSWORD` efímeras. El bootstrap usa `ON CONFLICT DO NOTHING` y nunca reescribe la contraseña de una cuenta existente.

## Checklist de liberación (sin cambiar nada en TU VERSO)

1. **Congelar la rama candidata:** consolidar WebSocket con fixes de flujo final, reservas y pagos; resolver divergencias antes de hacerla fuente del servicio Railway.
2. **Control de código local focalizado:** `pnpm install --frozen-lockfile`, `pnpm build`, `node --check server/index.mjs`, `node --test server/mobile-interaction-ws.test.mjs` y `docker build -t integra-admin:railway .`.
3. **Base vacía aislada:** preparar/aprobar orden SQL, aplicarlo, comprobar tablas/columnas y generar usuario admin; no usar bases locales ni productivas.
4. **Crear proyecto/servicios y vincular repo:** usar rama consolidada, PostgreSQL privada, una réplica, healthcheck y secretos Railway. No conectar aún Android.
5. **Comprobaciones mínimas externas:** HTTP `/health/live` 200, `/health/ready` 200 con base preparada, login seguro + cookie Secure, carga de UI y catálogo de prueba.
6. **Conexión S2S y WSS:** configurar la integración TU VERSO con permisos mínimos; habilitar pruebas solo del canal MOBILE_APP. Validar WSS en el dominio HTTPS con `X-Order-Access-Key`, interacción correcta y REST de respaldo. No realizar cambios en WhatsApp.
7. **Prueba controlada del caso de uso:** pedido de prueba aislado que confirme aceptación/rechazo, reconexión, pago y cierre; sin pruebas masivas del proyecto.
8. **Operación:** backups PostgreSQL y restauración ensayada, alertas, tasa de requests/WS, escalado y secretos; confirmar que imágenes/comprobantes persisten en PostgreSQL y revisar su crecimiento.

## Bloqueos conocidos / decisiones

- Las dos ramas `feat/b3-admin-mobile-ws-event-notify-20261128` y `fix/b3-mobile-flow-finished-close-20261127` no son equivalentes; **no desplegar ninguna sin consolidar**.
- WebSocket usa un cursor en memoria por integración; reinicios y múltiples réplicas requieren reconciliación REST. Por ahora una réplica; no prometer latencia de 1 segundo.
- Cualquier despliegue del servicio, creación de BD o cambio de DNS/variables de producción requiere aprobación separada.
- No crear dependencias nuevas, colas, Redis ni funcionalidades comerciales durante la preparación.

## Inicialización PostgreSQL 17 aislada y prueba CI focalizada

La rama corrige el SQL base que contenía definiciones duplicadas, un bloque de restricciones de pagos malformado y cierres SQL sobrantes. Se conserva únicamente la primera definición completa de cada tabla; las migraciones siguen en archivos históricos y no se editan.

Comprobación local **sin conexión ni cambios SQL**:

```powershell
node scripts/bootstrap-empty-admin-db.mjs
node scripts/railway-preflight.mjs
```

Aplicación **solo a una nueva base de pruebas Administrador, sin tablas** (no TU VERSO, nunca una BD con datos):

```powershell
$env:DATABASE_URL = '<CONEXION_POSTGRESQL17_DE_PRUEBAS_ADMIN>'
$env:ADMIN_DATABASE_BOOTSTRAP_CONFIRM = 'INIT_EMPTY_ADMIN_DATABASE'
node scripts/bootstrap-empty-admin-db.mjs --apply-empty
Remove-Item Env:ADMIN_DATABASE_BOOTSTRAP_CONFIRM
```

Si falta una tabla, hay SQL inválido o la BD tiene datos, el inicializador falla y revierte la transacción. Registro esperado: **1 baseline + 23 migraciones = 24**. No se ejecuta desde el arranque del servicio.

Workflow `.github/workflows/admin-railway-release-gate.yml`: instancia PostgreSQL 17 efímera con datos ficticios, verifica el bootstrap, bloquea una segunda inicialización, comprueba WebSocket, compila React y construye Docker. **No se considera certificado hasta obtener un workflow PASS**.

## Consolidación de código verificada

La comparación GitHub entre `fix/b3-mobile-flow-finished-close-20261127` y `feat/b3-admin-mobile-ws-event-notify-20261128` confirma **ahead 14, behind 0**: el WebSocket desciende del arreglo de cierre de pedidos. Respecto de `fix/b3-reservations-public-contract-flow-finished-20261127`, **ahead 7, behind 0**. Por tanto, esas dos correcciones no requieren una fusión adicional. Otros cambios divergentes no se absorben sin revisión.
