# Administrador Web — procedimiento obligatorio de validación local

Este repositorio utiliza **pruebas y compilaciones locales**. No deben incorporarse disparadores de GitHub Actions a esta rama.

## 1. Actualizar el código (PowerShell)

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
git status
git fetch https://github.com/josmiguelv/Aplicacion-Web-Admin-Movil.git refs/heads/feat/b3-admin-reservation-transactional-20261123
git merge --ff-only FETCH_HEAD
git log -1 --oneline
```

Si hay cambios sin confirmar o la actualización no es fast-forward, detenerse y revisar antes de modificar archivos.

## 2. Base de datos

La base local del Administrador usa el contenedor `integra-admin-postgres` (PostgreSQL 17). No usar `calltrace-db` ni ninguna base de TU VERSO.

```powershell
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
docker exec integra-admin-postgres psql -X -U $pgUser -d $pgDb -P pager=off -c "SELECT current_database(), to_regclass('public.store_reservation_settings') AS migration_008, to_regclass('public.mobile_scheduled_orders') AS migration_009;"
docker exec integra-admin-postgres psql -X -U $pgUser -d $pgDb -P pager=off -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='payment_methods_mode_check';"
```

Las migraciones `008`, `009` y `010` se aplicaron previamente a esta base local. **No volver a ejecutarlas**.

### Migración 011 — reservas sin intervalos ni cupos (requiere aplicarse una sola vez)

Esta migración relaja la restricción SQL de configuración completa para que `slot_minutes` y `max_orders_per_slot` no sean obligatorios. Conserva ambas columnas heredadas y sus datos; nunca se ejecuta en TU VERSO.

```powershell
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
Get-Content -Raw "server\migrations\011-reservations-without-slots-or-capacity.sql" |
 docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "Migración 011 falló" }

docker exec integra-admin-postgres psql -X -U $pgUser -d $pgDb -P pager=off -c "SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname='b3_reservation_complete_when_enabled';"
```

La nueva restricción debe exigir anticipación, rango horario y preparación, pero no debe exigir `slot_minutes` ni `max_orders_per_slot`. Una vez verificada, no volver a aplicarla al actualizar solo el frontend.

### Pruebas focalizadas de reservas

```powershell
node --test server/mobile-reservation-settings.test.mjs server/mobile-reservation-slots.test.mjs server/mobile-reservation-domain.test.mjs
```

La prueba PostgreSQL de `mobile-reservation-settings.test.mjs` está protegida para un entorno de pruebas aislado y se omite en ejecución local: nunca se debe forzar `CI=true` contra la base con datos reales.

## 3. Dependencias y compilación

```powershell
pnpm install --frozen-lockfile
pnpm build
```

La raíz del repositorio contiene el único `package.json` utilizado para `pnpm build`; no existe `server/package.json` en esta rama. El comando de compilación ejecuta TypeScript y Vite.

## 4. Ejecutar localmente

En dos terminales separadas desde la raíz del repositorio:

**Backend**
```powershell
pnpm start
```

**Frontend**
```powershell
pnpm dev
```

El backend necesita las variables de entorno locales que ya utiliza el proyecto, incluida su conexión a `integra_admin`. No introducir credenciales de producción en el repositorio.

## 5. Validación funcional mínima

- Abrir el Administrador, autenticar y seleccionar la empresa correcta.
- Confirmar que aparecen **solo** las sedes reales de esa empresa.
- Entrar a una sede y comprobar identidad, dirección, estado y tarjetas.
- Entrar en Datos/Horarios, Delivery, Recojo, Reservas y Formas de pago, y regresar sin cambiar accidentalmente de sede.
- En Formas de pago, la opción Reserva debe estar oculta si la configuración de Reserva de esa sede está desactivada.
- Verificar que las opciones globales de Productos y Promociones siguen identificadas como globales.
- No registrar pagos ni crear reservas reales durante una prueba visual.

## Requisitos de cada entrega

Toda entrega debe informar: commit, archivos modificados, necesidad de migración (sí/no), comandos PowerShell para actualizar, instalar/compilar/ejecutar, pruebas locales y alcance. **No declarar validación PASS sin ejecutar realmente la prueba correspondiente.**


## Migración 012 — horarios independientes de servicios

Solo modifica el PostgreSQL local del Administrador Web. No realiza copias de seguridad, no modifica TU VERSO y no ejecuta pruebas sobre la base de datos. Añade `stores.service_hours` como JSONB con valor inicial vacío (los horarios antiguos permanecen y sirven de alternativa hasta configurar cada servicio).

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
Get-Content -Raw "server\migrations\012-store-service-hours.sql" |
 docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "La migración 012 falló" }
```

Si la 011 todavía no se aplicó, ejecutarla **antes** de la 012 siguiendo su apartado anterior. No repetir las migraciones 008, 009 o 010.

### Compilar e iniciar localmente

```powershell
pnpm install --frozen-lockfile
pnpm build
```

Después ejecutar `pnpm start` y `pnpm dev` en dos terminales distintas. Cada tarjeta de sede abre exclusivamente sus controles: Datos y ubicación, Horario físico, Delivery (recepción, entregas y tarifa), Recojo (recepción y retiro), Reservas y Pagos. El horario de recepción de Delivery puede comenzar antes que el horario de apertura del local.

**No usar GitHub Actions, pruebas ni operaciones de respaldo sobre la base de datos.** Los controles de navegación y compilación no escriben datos en PostgreSQL.
