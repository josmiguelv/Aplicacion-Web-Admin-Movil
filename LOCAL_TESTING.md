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


## Configuración de empresa → Notificaciones

La configuración preexistente de **Seguimiento de pago y recordatorios personales** tiene una tarjeta independiente llamada **Notificaciones** marcada como compartida y aplica a todas las sedes de la empresa seleccionada. Conservar los valores `paymentWaitMinutes` (5–30) y `reminderCount` (0–2), desde el endpoint `/api/admin/tenants/{tenantId}/checkout-settings`.

- No cambiar la regla de destinatarios: los recordatorios son individuales por dispositivo y pedido, no promociones masivas.
- Guardar los ajustes no requiere publicar el catálogo; el proceso automático requiere `B3_CHECKOUT_WORKER_ENABLED=true`, soporte de notificaciones en el dispositivo y la configuración local preexistente (migración 007).
- Este cambio solo reorganiza la navegación. **No requiere migraciones nuevas ni cambios de base de datos**, ni modifica Android o TU VERSO.
- No utilizar GitHub Actions, no hacer respaldos ni pruebas en PostgreSQL.

Para actualizar la copia local, utilizar `git fetch` y `git merge --ff-only FETCH_HEAD` indicados al inicio; compilar con `pnpm build` y ejecutar backend y frontend por separado.


## Corrección de pantalla inicial «Error interno» / locales ausentes

La página inicial carga las sedes independientemente de Productos, Empleo, Aplicaciones y Notificaciones. Un error en un módulo auxiliar **no debe ocultar las tarjetas de sedes** ni mostrar falsamente «Todavía no hay locales registrados». Ahora el Administrador diferencia `storesLoaded` y muestra nombres de los módulos que fallaron.

Este ajuste es **solo frontend**: no requiere migraciones nuevas. Si aparece «Empleo / Vacantes (revisar migración 015)», comprobar que se haya aplicado la migración 015 previamente indicada; si aparece «Notificaciones / Seguimiento de pago (revisar migración 007)», comprobar que se haya aplicado la 007. Estas asociaciones no prueban por sí solas la causa del error.

No ejecutar respaldo, SELECT ni pruebas de base de datos. Para obtener la causa si el error persiste, observar los mensajes de la terminal donde se ejecuta `pnpm start`. No utilizar GitHub Actions.

Actualizar localmente con `git fetch` + `git merge --ff-only FETCH_HEAD`, compilar con `pnpm build`, reiniciar `pnpm start` y `pnpm dev` y recargar la página.


## Módulos generales de empresa debajo de las sedes — avisos comerciales al celular

La pantalla inicial muestra primero las tarjetas de locales reales y, debajo, **Configuración general de la empresa**. Las opciones generales ya no aparecen dentro de la ficha de una sede. Se ofrecen:
- Productos, Promociones, Empleo, Datos de la empresa y Publicación.
- **Avisos al celular**: módulo comercial diferente de los recordatorios personales de pago. El administrador escribe título, mensaje, carga imagen opcional, define inicio/vencimiento en horario fijo de Perú (UTC−5), visualiza la vista previa del celular, guarda borradores, publica y desactiva.
- **Recordatorios de pago**: conserva la política existente 5–30 minutos / 0–2 avisos, por dispositivo y pedido. No se envían al tema comercial.

Los avisos comerciales se guardan por `tenant_id` y no se asignan a sedes individuales. La API del Administrador es `/api/admin/tenants/{tenantId}/mobile-notifications`; la API pública `/api/v1/mobile/notifications?appId=...` y el catálogo publicado incluyen solamente avisos vigentes. Una publicación no equivale a la recepción en el teléfono.

### Migración 016 obligatoria para este módulo (solo Administrador local)

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
Get-Content -Raw "server\migrations\016-company-mobile-notifications.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "La migración 016 falló" }
```

Solo se aplica una vez. **No ejecutar respaldos ni pruebas de base de datos**. La migración 015 de Vacantes ya se aplicó en este entorno según la ejecución confirmada por el usuario; no volver a aplicarla.

### Envío real de push FCM

Por seguridad, el envío comercial se encuentra **deshabilitado por defecto**. Para habilitarlo en un entorno donde Firebase Cloud Messaging y el consentimiento del cliente estén realmente configurados, se requieren las variables `B3_MARKETING_PUSH_ENABLED=true` y `B3_FCM_SERVICE_ACCOUNT_JSON` (cuenta del proyecto Firebase, solo en variables del backend). Se reutiliza la misma cuenta de Firebase que usan las notificaciones personales, pero los envíos comerciales van exclusivamente al tema `pollosb3_promotions` asociado al appId registrado `com.integrab2g.pollosb3`. El cliente debe suscribirse de forma voluntaria. No habilitar este worker en pruebas locales sin autorización; no se modifica Android en esta fase.

Ejecutar `pnpm install --frozen-lockfile`, `pnpm build` y lanzar `pnpm start` / `pnpm dev` en terminales separadas. No utilizar GitHub Actions, no tocar TU VERSO.


## Corrección de navegación: solo «Avisos al celular» debajo de Locales

Se revierte **solo la reorganización equivocada de tarjetas**. La pantalla inicial conserva las tarjetas de sedes y, debajo, muestra únicamente una tarjeta general **Avisos al celular** (notificaciones comerciales para todas las sedes). Los módulos Productos, Promociones, Empleo, Datos de la empresa, Notificaciones (recordatorios personales de pago) y Publicar cambios vuelven a aparecer dentro del panel de configuración de cada sede, con su indicación «Compartida» y sin convertirse en datos exclusivos de la sede.

No se revierten las API, la lógica comercial ni los datos. **Este rollback visual no necesita ninguna migración nueva.** Si la 016 todavía no fue aplicada, sigue siendo necesaria para que funcione el nuevo módulo de avisos comerciales; si ya se aplicó, no repetirla.

No ejecutar GitHub Actions ni operaciones, respaldos o pruebas de BD. Actualizar con `git fetch`, `git merge --ff-only FETCH_HEAD`, compilar `pnpm build` y reiniciar los servicios locales.
