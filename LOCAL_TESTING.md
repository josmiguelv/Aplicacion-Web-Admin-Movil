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


## Notificaciones para el cliente — única tarjeta de empresa debajo de locales

La única tarjeta situada bajo los locales ahora se llama **Notificaciones para el cliente**. En esa misma pantalla están:
1. Avisos comerciales al celular: título, contenido, imagen, vigencia, borradores y publicación.
2. Recordatorios personales de pago: plazo de 5–30 minutos y hasta 2 avisos, conservando los ajustes de la empresa.

Se elimina exclusivamente la tarjeta **Notificaciones** del panel de configuración de cada sede. Productos, Promociones, Empleo, Datos de la empresa y Publicar cambios permanecen en el panel de la sede como tarjetas compartidas.

**Este cambio de navegación y formulario no requiere migración nueva.** La migración 016 continúa siendo necesaria solo si todavía no se aplicó para el módulo de avisos comerciales; no volver a ejecutarla si ya se aplicó. La configuración de recordatorios de pago reutiliza la base de datos existente.

No usar GitHub Actions, no ejecutar respaldos ni pruebas de la base de datos, no cambiar Android ni TU VERSO.

Actualizar en local con `git fetch`, `git merge --ff-only FETCH_HEAD` y `pnpm build`; reiniciar `pnpm start` y `pnpm dev` en sus terminales.


## Productos: catálogo primero, editor bajo demanda

En la tarjeta Productos se muestra inicialmente la lista de productos existentes, con nombre, categoría, precio, disponibilidad y botón **Editar producto**. El formulario permanece oculto por defecto.

- **+ Nuevo producto:** abre el formulario vacío para crear, con opción de Cancelar.
- **Editar producto:** abre el mismo formulario con los datos guardados (nombre, descripción, categoría, precio, imagen y disponibilidad); **Guardar cambios** envía su `id` para actualizar el registro, sin duplicarlo.
- Guardar vuelve al catálogo actualizado y mantiene el paso independiente de **Publicar cambios** para reflejarlo en la aplicación móvil.
- No se necesita migración de base de datos ni cambio de API: el endpoint POST de productos ya soporta actualización por `id`.
- No usar GitHub Actions, no ejecutar backups ni pruebas de BD. Solo validar mediante `pnpm build` y revisión visual local.

Actualizar código local:

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
git status
git fetch https://github.com/josmiguelv/Aplicacion-Web-Admin-Movil.git refs/heads/feat/b3-admin-reservation-transactional-20261123
git merge --ff-only FETCH_HEAD
pnpm build
```


## Frecuencia semanal de «Notificaciones para el cliente» — migración 017

Se conserva la fecha de inicio y fin, ahora como **fechas** sin selector de hora. Se añade un único horario de ejecución local en Perú (UTC−5) y exactamente siete casillas para elegir los días: lunes, martes, miércoles, jueves, viernes, sábado y domingo. Se exige al menos un día.

Un aviso publicado se intenta enviar **como máximo una vez por cada fecha seleccionada** dentro del período, a partir de la hora configurada, cuando esté activo el worker de notificaciones comerciales. El ledger `company_mobile_notification_runs` registra cada día para evitar duplicados por reinicios. La hora fija corresponde a Perú, no a la zona local del navegador ni a la del servidor.

Los avisos en borrador y los publicados se pueden **editar** (texto, fechas, días y hora). Los envíos ya realizados se conservan y no se repiten si se edita el mismo aviso durante el día. Los avisos desactivados son reutilizables como base para un aviso nuevo, no editables in situ.

### Migración 017 obligatoria — solo PostgreSQL local del Administrador

Requiere que la migración `016-company-mobile-notifications.sql` del módulo de avisos comerciales ya esté aplicada. Si la 016 aún está pendiente, aplicarla **una sola vez antes** de 017, con el mismo procedimiento.

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()

Get-Content -Raw "server\migrations\017-company-notification-weekly-frequency.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb

if ($LASTEXITCODE -ne 0) { throw "Falló la migración 017" }
```

Solo hay que ejecutar la 017 una vez. Las notificaciones existentes se conservan con su funcionamiento de envío único hasta que sean editadas con una frecuencia. No se modifica la lógica de recordatorios de pago.

El envío push permanece desactivado por defecto (`B3_MARKETING_PUSH_ENABLED`), sin tocar Android ni TU VERSO. El formulario permite configurar y editar, pero el envío físico requiere Firebase configurado y autorización del cliente para recibir avisos. No afirmar entrega a dispositivo por aceptación de FCM.

**Sin GitHub Actions, pruebas de BD ni respaldos.** Compilar localmente con `pnpm build` y reiniciar backend y frontend. La compilación local no se ha ejecutado por esta sesión.


## Notificaciones personales de pago por pedido — migración 018

En «Notificaciones para el cliente» se conserva el bloque de avisos comerciales y se amplía el bloque separado «Recordatorios personales de pago». A nivel empresa ofrece:
- Habilitar o deshabilitar los recordatorios automáticos (por defecto desactivados, no dispara envíos durante desarrollo).
- Tiempo de pago 5–30 minutos y 0–2 recordatorios, relativos al inicio real del pago **por pedido y en cualquier horario**.
- Edición y vista previa del **título** (1–120 caracteres) y **mensaje** (1–500 caracteres) que se envían al token Firebase exclusivo del dispositivo autorizado para la interacción.
- Guardado inmediato por empresa con la API existente `/api/admin/tenants/{tenantId}/checkout-settings`.

El worker de pagos consulta el estado de cada interacción, obtiene su configuración empresarial, verifica el plazo individual y envía exclusivamente a `message.token`, nunca a `message.topic`. Bloquea el registro del pedido durante el envío para evitar que dos procesos envíen simultáneamente el mismo recordatorio. Cancela notificaciones pendientes cuando el estado deja de ser `PAYMENT_PENDING` (por cancelación/vencimiento); el cierre por **pago confirmado** sigue pendiente de un evento de pago efectivamente verificado, y no debe inferirse de la selección de Yape/Plin/tarjeta. No activar mensajes a clientes reales antes de cerrar ese contrato.

**Migración 018 necesaria solo en la base de datos local del Administrador**, después de actualizar el código. Las migraciones 007 y anteriores ya son preexistentes; no ejecutarlas nuevamente.

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
git status
git fetch https://github.com/josmiguelv/Aplicacion-Web-Admin-Movil.git refs/heads/feat/b3-admin-reservation-transactional-20261123
git merge --ff-only FETCH_HEAD

$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
Get-Content -Raw "server\migrations\018-company-personal-payment-reminders.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "La migración 018 falló" }

pnpm install --frozen-lockfile
pnpm build
```

Después reiniciar `pnpm start` y `pnpm dev` en terminales separadas. La habilitación efectiva del trabajador requiere `B3_CHECKOUT_WORKER_ENABLED=true` y `B3_FCM_SERVICE_ACCOUNT_JSON` en el backend; **no habilitar todavía para clientes reales** sin cerrar la confirmación del pago y verificar permisos de notificaciones y token en Android. Las credenciales Firebase nunca deben ir en frontend ni Git.

No GitHub Actions, pruebas ni respaldos de BD, cambios de TU VERSO o cambios de Android.


## Dos recordatorios personales independientes (migración 019)

En `Notificaciones para el cliente → Recordatorios personales de pago`, el número elegido determina los editores visibles:
- 0: se ocultan ambos editores y no se envían recordatorios.
- 1: aparece **Recordatorio 1** con su título, mensaje y vista previa.
- 2: aparecen **Recordatorio 1** y **Recordatorio 2**, cada uno con título, mensaje y vista previa separados.

El backend guarda ambos contenidos por empresa y envía el primer texto al primer recordatorio y el segundo texto al segundo. Las sesiones de pago conservan sus propios plazos y cada aviso se envía solo al token FCM del pedido autorizado. No se modifican Android ni TU VERSO; el trabajador FCM permanece desactivado por defecto.

**Migración 019 requerida una sola vez** después de 018, únicamente en `integra-admin-postgres`:

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
Get-Content -Raw "server\migrations\019-second-private-payment-reminder.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "La migración 019 falló" }
```

## Confirmaciones flotantes globales (solo frontend, sin migración nueva)

Los mensajes de éxito de **Guardar** y **Publicar** de todos los módulos del Administrador pasan a un aviso fijo flotante, con entrada discreta, visible durante 1,5 segundos, transición de salida de 0,35 segundos y eliminación a los 1,9 segundos. No hay avisos persistentes de guardado ni botones flotantes que bloqueen la interfaz. Los errores permanecen legibles en su posición original hasta que se resuelvan. Respeta preferencias de movimiento reducido.

Actualizar el código con `git fetch` y `git merge --ff-only FETCH_HEAD`. Compilar localmente con `pnpm install --frozen-lockfile` y `pnpm build`; ejecutar `pnpm start` y `pnpm dev` en terminales separadas. No ejecutar GitHub Actions, backups ni pruebas de BD.


## Pagos por modalidad en filas y tarjetas de producto (migración 020)

En cada local, «Formas de pago» muestra sin desplegables las **tres modalidades**: Delivery, Reservación y Recojo en tienda; cada fila muestra Yape, Plin, Tarjeta y Efectivo con selección independiente. Para Yape/Plin/Tarjeta puede cargarse, sustituirse o quitarse una imagen, guardada por `tenant_id + store_id + mode + method`, reutilizando el endpoint autenticado de imágenes del Administrador. Efectivo no ofrece imagen.

Una sola sección **Tiempo de espera para el pago · General** ajusta `payment_wait_minutes` de la política empresarial existente, compartida con las notificaciones personales y aplicable a las tres modalidades. No se alteran los plazos de aceptación de TU VERSO. El botón guarda las tres selecciones y el plazo. La publicación del catálogo agrega `paymentMethodImages` para consumo futuro de la aplicación; **no modificar Android ni TU VERSO aquí**.

La migración `020-payment-method-images.sql` se aplica **una vez** después de `019`, solo en la base local `integra-admin-postgres`:

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
Get-Content -Raw "server\migrations\020-payment-method-images.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "La migración 020 falló" }
```

En **Productos**, el catálogo muestra tarjetas con fotografía si existe, categoría, nombre, precio, estado visible **Activo/Inactivo** y botón Editar. No se abre formulario hasta pulsar Editar o Nuevo producto. El editor mantiene nombre, precio, categoría, descripción, imagen y activación. Esta vista no requiere migración.

Actualizar con `git fetch` y `git merge --ff-only FETCH_HEAD`, ejecutar `pnpm build`; levantar `pnpm start` y `pnpm dev`. No GitHub Actions ni operaciones, respaldos o pruebas automáticas de BD. No modificar Android ni TU VERSO.


## Pago: una sola imagen de Yape, Plin e Izipay para toda la empresa (migración 021)

Se implementó el diseño aprobado: una única imagen por `tenant_id+method` para Yape, Plin y Tarjeta (rótulo **Izipay**). Efectivo no tiene imagen. El Administrador permite seleccionar/cambiar/quitar estas tres imágenes en un bloque común a la empresa; al seleccionar una sede, debajo aparecen las tres modalidades con los cuatro interruptores de habilitación **independientes por sede**. Se mantiene un único tiempo de espera de pago a nivel empresa.

Para compatibilidad con la app actual, el identificador técnico de Izipay sigue siendo `card`: el cambio de nombre es visual; **no implica integrar una pasarela Izipay, confirmar un pago ni modificar la aplicación móvil**.

La tabla nueva `company_payment_images` guarda exclusivamente las imágenes generales. Los antiguos valores de `payment_methods.image_url` **no se eliminan ni migran automáticamente** porque podrían ser diferentes por sede/modalidad. Una vez cargada la imagen general y publicado, el catálogo expone `paymentImages` global y `paymentMethodImages` derivadas de los métodos habilitados por sede, todos enlazando a la misma imagen general. Esto evita producir imágenes diferentes por modalidad. El módulo de publicación necesita 021 aplicada.

**Migración 021: solo en la base del Administrador** (`integra-admin-postgres`), después de la 020 si ésta aún no se ha aplicado:

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()
Get-Content -Raw "server\migrations\021-company-shared-payment-images.sql" |
 docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "Falló la migración 021" }
```

La migración crea la tabla si no existe; no sobrescribe ni modifica las selecciones anteriores de pago. Tras actualizar Git, compilar con `pnpm build`, reiniciar backend `pnpm start` y frontend `pnpm dev`, y verificar manualmente desde el navegador la vista de una sede. No usar GitHub Actions, ni realizar backups ni pruebas o consultas sobre BD en esta sesión. No modificar TU VERSO ni Android.
