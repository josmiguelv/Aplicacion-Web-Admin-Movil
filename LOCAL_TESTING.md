# Administrador Web Pollos B3 — desarrollo y pruebas locales

**No usar GitHub Actions. No realizar respaldos ni pruebas de base de datos.** El desarrollo se limita a este repositorio. No modificar Android ni TU VERSO.

## 1. Actualizar código en PowerShell

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
git status
git fetch https://github.com/josmiguelv/Aplicacion-Web-Admin-Movil.git refs/heads/feat/b3-admin-reservation-transactional-20261123
git merge --ff-only FETCH_HEAD
git log -1 --oneline
```

Si hay cambios sin confirmar o un conflicto, no forzar el merge.

## 2. Base de datos del Administrador — migración 013

**Aplicar solo la migración 013 en esta actualización**, una vez, contra el contenedor `integra-admin-postgres`. Las migraciones 008, 009 y 010 ya se aplicaron localmente; 013 reemplaza el requisito de reservas que antes dependía de 011. La migración 012 de horarios separados ya no debe aplicarse. Si se aplicó previamente, se conserva su columna sin utilizarla.

La migración 013 agrega campos opcionales `stores.delivery_preparation_minutes` y `stores.pickup_preparation_minutes` (1–240 minutos) y cambia la restricción de reservas para exigir únicamente `preparation_minutes` cuando estén habilitadas. No elimina pedidos ni modifica TU VERSO.

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()

Get-Content -Raw "server\migrations\013-preparation-by-mode.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb

if ($LASTEXITCODE -ne 0) { throw "La migración 013 falló" }
```

No ejecutar consultas de prueba ni respaldos de base de datos. No ejecutar nuevamente 011 o 012 para este cambio.

## 3. Compilación local

```powershell
pnpm install --frozen-lockfile
pnpm build
```

## 4. Iniciar localmente

En dos terminales PowerShell, dentro del proyecto:

Backend: `pnpm start`

Frontend: `pnpm dev`

El backend requiere la configuración local existente para acceder a `integra_admin`. No copiar credenciales de producción al repositorio.

## 5. Revisión visual

- Entrar a la empresa y seleccionar una sede.
- Verificar que Datos y Horarios solo muestran datos y apertura física informativa.
- Delivery: habilitación, cobertura, tarifa y **Tiempo de preparación (minutos)**.
- Recojo en tienda: habilitación y **Tiempo de preparación (minutos)**.
- Reservas: habilitación y **Tiempo de preparación (minutos)**; no aparecen desde/hasta, anticipación, intervalos ni cupos.
- No cambiar de sede al entrar o volver de cada tarjeta.
- La disponibilidad de pedidos depende de la modalidad habilitada y del agente de TU VERSO, no del horario físico.

No declarar las pruebas como aprobadas sin ver su salida real.


## Medios de pago — cuatro opciones por modalidad

Cada sede configura `Delivery`, `Reservación` y `Recojo en tienda` con cuatro casillas independientes: `Yape`, `Plin`, `Tarjeta` y `Efectivo`. El Administrador lee los valores guardados al entrar/cambiar de modalidad. **Guardar métodos de pago** actualiza las cuatro opciones en una única transacción; no se confunden entre sedes ni modalidades. Habilitar un método de pago no habilita el servicio ni verifica un cobro.

**No hay migración adicional para este cambio visual/de API.** La migración 010, ejecutada anteriormente, ya admite `reservation` en `payment_methods`. La 013 sigue siendo la última migración requerida por los cambios anteriores de preparación; no ejecutarla otra vez si ya está aplicada.

Actualizar y comprobar compilación local con los comandos del apartado 1 y `pnpm install --frozen-lockfile`, `pnpm build`. Ejecutar backend `pnpm start` y frontend `pnpm dev` en terminales separadas. No ejecutar GitHub Actions, pruebas de BD ni respaldos.


## Promociones: fechas, horas y siete días de actividad — migración 014

- La edición muestra **Fecha de inicio**, **Fecha de fin**, **Hora de inicio**, **Hora de fin**, y exactamente siete casillas (**Lunes a Domingo**). No configura horarios individuales por día.
- Debe seleccionarse al menos un día. La hora final debe ser mayor que la inicial, dentro del mismo día. El horario siempre se interpreta internamente en la zona fija America/Lima (UTC−5), independientemente de la ubicación del usuario o el servidor. No hay control de zona horaria en la interfaz.
- La publicación almacena las reglas, y la respuesta pública filtra dinámicamente las promociones según fecha, hora y días; así pueden empezar o terminar sin volver a publicar cada día. **No sustituye la publicación inicial**.
- Por ahora las promociones siguen siendo generales de la empresa y no se restringen a una sede.
- Las promociones históricas conservan su comportamiento previo basado en `starts_at` y `ends_at`.

**Migración 014 necesaria en PostgreSQL local del Administrador Web**, después de actualizar la rama y una sola vez:

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
Get-Content -Raw "server\migrations\014-promotion-date-time-weekdays.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "Falló la migración 014" }
```

No volver a ejecutar migraciones anteriores ya aplicadas. **No realizar respaldos ni pruebas sobre la base de datos.** El único control de desarrollo requerido es `pnpm build` y la revisión visual al iniciar `pnpm start` y `pnpm dev`. No usar GitHub Actions.


## Vacantes: elegir una o varias sedes activas — migración 015

El formulario de Empleo muestra todas las sedes activas de la empresa con casillas; exige elegir al menos una. La modalidad solo admite **Tiempo completo** o **Medio tiempo**. Se eliminan del formulario Horario y el campo técnico Imagen cargada; permanece la carga de fotografía opcional y su vista previa.

El backend guarda las asociaciones en `job_vacancy_stores` de forma transaccional, asegura que cada sede sea de esta empresa y esté activa y publica los identificadores y nombres de las sedes elegidas. Las vacantes preexistentes no se borran, pero para publicar una vacante antigua será necesario editarla, elegir su(s) sede(s) y guardarla.

**Migración 015 necesaria una sola vez en PostgreSQL local del Administrador Web:**

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
Get-Content -Raw "server\migrations\015-job-vacancy-stores.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "Falló la migración 015" }
```

La migración 014, referente a promociones, debe aplicarse antes de levantar este código **solo si todavía está pendiente**; se explica en el apartado anterior. No repetir ninguna migración ya ejecutada.

Compilar localmente con `pnpm install --frozen-lockfile` y `pnpm build`, iniciar con `pnpm start` y `pnpm dev`. No utilizar GitHub Actions, respaldos ni pruebas de BD.


## Zona horaria interna UTC−5 — sin campo visible

- Eliminado el formulario «Zona horaria de la empresa» y la consulta innecesaria del frontend.
- El Administrador fija `America/Lima` (UTC−5, sin horario de verano) para horarios físicos, promociones, reservas y catálogos públicos, independientemente de dónde se use la aplicación.
- Las nuevas empresas usan el mismo valor. La API de ajustes devuelve UTC−5 y ya no admite modificar la zona horaria.
- Se preserva la columna histórica `tenants.time_zone` en PostgreSQL, pero el código no la utiliza para calcular horarios. **No se necesita migración de base de datos para este cambio.**
- No modificar Android, TU VERSO ni otros repositorios; no usar GitHub Actions ni ejecutar pruebas o respaldos de BD.

Actualizar localmente:

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
git status
git fetch https://github.com/josmiguelv/Aplicacion-Web-Admin-Movil.git refs/heads/feat/b3-admin-reservation-transactional-20261123
git merge --ff-only FETCH_HEAD
pnpm install --frozen-lockfile
pnpm build
```

Después iniciar `pnpm start` y `pnpm dev` en terminales distintas. No aplicar migraciones nuevas para el ajuste de zona horaria; las migraciones 014/015 de cambios anteriores deben estar aplicadas si aún estaban pendientes.
