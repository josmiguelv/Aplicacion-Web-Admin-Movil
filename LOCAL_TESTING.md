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
