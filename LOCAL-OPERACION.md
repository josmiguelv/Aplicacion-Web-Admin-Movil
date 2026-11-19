# Administrador INTEGRA B2G: entorno local Windows

Repositorio: josmiguelv/Aplicacion-Web-Admin-Movil.
Rama: feat/admin-saas-multitenant-login.
HEAD instalado: 6427f2378b3c4d94172dcc0ce92601c3245a8b93.

## Operación diaria desde la terminal PowerShell de VS Code

Primero iniciar Docker Desktop y esperar a que el motor esté disponible.
Abrir esta carpeta en VS Code. Los siguientes comandos no dependen de que
PowerShell permita scripts globalmente y usan explícitamente Node 22 instalado.

```powershell
Set-Location 'C:\Integra-B2G\Administrador Negocios'

# Iniciar PostgreSQL, backend y frontend en segundo plano:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .local/services.ps1 start

# Consultar estado:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .local/services.ps1 status

# Detener los procesos propios y PostgreSQL, conservando los datos:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .local/services.ps1 stop

# Reiniciar los tres servicios:
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .local/services.ps1 restart
```

Después de reiniciar Windows, ejecutar `start`. No volver a inicializar SQL ni
ejecutar bootstrap. El script solo detiene procesos registrados que conservan
el mismo identificador y fecha de inicio; Docker Compose se limita a este proyecto.
El ciclo `restart` se comprobó realmente con PostgreSQL y ambos servicios.

Administrador: http://localhost:3000
API: http://localhost:4000
Salud: http://localhost:4000/health/live y /health/ready.

## Datos y configuración

PostgreSQL 17.12, contenedor `integra-admin-postgres`, base `integra_admin`,
usuario exclusivo `integra_admin_local`, puerto `127.0.0.1:55432`.
Volumen persistente: `integra-admin-local_postgres-data`.
No eliminar el volumen: contiene las empresas y las cuentas.

`.env` contiene la conexión local y la contraseña generada. Está excluido de Git.
El backend recibe las variables con `node --env-file=.env`.
Las credenciales del Super Administrador se introdujeron mediante un formulario
temporal que escuchaba exclusivamente en loopback y ejecutó
`server/bootstrap-admin.mjs`. El formulario se cerró tras crear la cuenta.
No se almacenaron variables de bootstrap ni la contraseña inicial en archivos.

El directorio `.local/` está excluido de Git y contiene los scripts operativos,
registros sin contraseñas, capturas y resultados de comprobación.
Conservar esta carpeta para utilizar los comandos anteriores.

## Validación ejecutada

Node 22.23.2; Corepack y pnpm 11.25.0. El lockfile original omitía pg y @types/pg;
se corrigió y se verificó una instalación posterior con `--frozen-lockfile`.
Compilación TypeScript/Vite y sintaxis de ambos scripts backend correctas.

En Edge de escritorio se comprobaron login, módulo Empresas, creación de una
empresa temporal, persistencia al recargar y consulta desde otra conexión
PostgreSQL, selección de empresa y configuración comercial, creación de un
TENANT_ADMIN desde la interfaz, su acceso limitado y logout con invalidación
real de sesión. Las peticiones HTTP de lectura y escritura a seis recursos de
otro tenant devolvieron 403. El rol enviado por el cliente no elevó permisos.
No hubo errores JavaScript. Las cuentas y empresas automatizadas se eliminaron
por sus identificadores; las cuentas y empresas creadas por el usuario se conservan.

Resultados: `.local/validation-results.json`, `.local/bootstrap-result.json`,
`.local/final-audit.json`. Capturas: `.local/login-desktop.png`,
`.local/commercial-desktop.png`, `.local/tenant-desktop.png`.

## Alcance

Se mantiene AdminPortal como entrada autenticada. El único ajuste visual es
evitar la superposición de los controles de horarios en escritorio.
Se conservan los identificadores históricos de contratos. No se precargó Pollos B3.
El módulo Integraciones → TU VERSO permite custodiar credenciales por empresa
y comprobar disponibilidad 1A desde backend con autorización explícita. Las
consultas reales permanecen deshabilitadas; no hay conexión productiva certificada.
No se efectuaron llamadas a TU VERSO, despliegues, pushes, migraciones externas
ni modificaciones a los repositorios Android, WEB o Integra-Flow.

## ID visible y edición de sedes

Cada sede admite un ID legible al crearla, por ejemplo `b3-nogales`. Es único
por empresa e inmutable en la interfaz, API y PostgreSQL. Los demás datos se
editan seleccionando la sede del listado; `Nueva sede` inicia otro registro.
El UUID técnico y los contratos móviles se conservan.
La migración aditiva `server/migrations/001-store-code.sql` ya fue aplicada
exclusivamente en esta base local. La sede preexistente se conservó y recibió
un código `sede-<UUID>` para mantener una identificación estable.
Se verificaron creación, edición persistente, rechazo de cambio de ID,
duplicados, formato y aislamiento entre empresas usando sedes temporales.
Resultados: `.local/store-code-results.json`.

## Integraciones TU VERSO

Las migraciones locales `003-tuverso-integrations.sql` y
`004-minimal-tuverso-configuration.sql` ya fueron aplicadas. El formulario pide
solo clave, sede y propósito autorizado; los datos técnicos anteriores se conservan.
La clave
maestra privada se conserva únicamente en `.env`; no perderla ni publicarla.
`TUVERSO_LIVE_CHECKS_ENABLED=false` mantiene bloqueadas las consultas externas.
El acceso es exclusivo de SUPER_ADMIN desde cada empresa. La configuración
completa, contratos, rotación y pruebas están en
[docs/TUVERSO_INTEGRACIONES.md](docs/TUVERSO_INTEGRACIONES.md).
