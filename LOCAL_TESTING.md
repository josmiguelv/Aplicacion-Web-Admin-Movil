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


## Actualización vigente — disponibilidad según agente de TU VERSO

- La sede conserva su horario físico `opening_hours`, **solo informativo**.
- Los tres servicios configurables por sede son Delivery, Recojo y Reservas.
- El Administrador no define horarios adicionales de Delivery o Recojo.
- La recepción de pedidos exige que la opción comercial esté habilitada y que TU VERSO confirme un agente disponible. El agente aprueba o rechaza la solicitud.
- La reserva conserva su fecha/hora solicitadas y las reglas de programación aplicables; el horario físico del local no decide si hay agente disponible.
- **No aplicar la migración 012:** fue creada para horarios independientes que ahora se han descartado. El código vigente no requiere la columna `service_hours`. Si la columna ya existe, no es necesario revertirla para continuar.
- Las migraciones 008, 009 y 010 ya se ejecutaron anteriormente. La 011 se utiliza únicamente si todavía está pendiente el cambio de reservas sin intervalos ni cupos.
- No ejecutar pruebas ni respaldos de base de datos, ni usar GitHub Actions.

Actualización local del código:

```powershell
cd "C:\Integra-B2G\Administrador Negocios"
git status
git fetch https://github.com/josmiguelv/Aplicacion-Web-Admin-Movil.git refs/heads/feat/b3-admin-reservation-transactional-20261123
git merge --ff-only FETCH_HEAD
pnpm install --frozen-lockfile
pnpm build
```

Ejecutar `pnpm start` (backend) y `pnpm dev` (frontend) en terminales separadas. Validar desde las pantallas existentes de sede; no abrir TU VERSO para modificarlo.

