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

## 2. Base de datos — solo migraciones, sin respaldos ni pruebas de BD

El entorno local del Administrador utiliza únicamente `integra-admin-postgres`. No acceder a `calltrace-db` ni a bases de TU VERSO.

Las migraciones 008, 009 y 010 ya están ejecutadas en este entorno y no se repiten.

**Migración 011 (si no se aplicó antes):** retira como obligatorios los intervalos y cupos de reservas, conservando las columnas existentes.

**Migración 012 (nueva):** añade `stores.service_hours` para horarios propios de recepción y cumplimiento en Delivery y Recojo. No reemplaza `opening_hours`.

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
$pgUser = (docker exec integra-admin-postgres printenv POSTGRES_USER).Trim()
$pgDb = (docker exec integra-admin-postgres printenv POSTGRES_DB).Trim()

# Ejecutar SOLO si aún no se había aplicado la 011:
Get-Content -Raw "server\migrations\011-reservations-without-slots-or-capacity.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "Migración 011 fallida" }

# Aplicar la 012 una sola vez:
Get-Content -Raw "server\migrations\012-store-service-hours.sql" |
  docker exec -i integra-admin-postgres psql -X -v ON_ERROR_STOP=1 -U $pgUser -d $pgDb
if ($LASTEXITCODE -ne 0) { throw "Migración 012 fallida" }
```

No ejecutar consultas de prueba ni respaldos de BD. Las pruebas permitidas son compilación de código y comprobaciones visuales del frontend.

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

## 5. Revisión visual del Administrador (sin pruebas de base de datos)

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

## Reglas funcionales para horarios independientes

- Horario físico del local: `opening_hours`.
- Delivery: `service_hours.delivery.orders` permite recibir pedidos; `service_hours.delivery.fulfillment` controla los horarios disponibles para entrega.
- Recojo: `service_hours.pickup.orders` permite recibir pedidos; `service_hours.pickup.fulfillment` controla los horarios de retiro.
- Configuraciones no definidas conservan el horario previo de sede por compatibilidad.
- El agente y la disponibilidad se comprueban por las API existentes del Administrador, sin modificar TU VERSO.
- Cada tarjeta de sede muestra únicamente sus campos; no se vuelve a seleccionar la sede dentro de sus formularios.
