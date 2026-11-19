# Integraciones TU VERSO por empresa

## Alcance y fuente

Referencia obligatoria revisada: `TU_VERSO_APIs_Globales_Documentacion_Tecnica_v1_18-11-2026.pdf`,
edición 1.0, 21 páginas. Contrato 1A en páginas 7 y 9–10, administración humana
en 10–12, errores en 18 y limitaciones/certificación en 19–20.
El PDF se encontró localmente en Descargas; no se consultó ni modificó producción.
SHA-256 de la referencia revisada:
`F88C12B5B23D337DC3A90907CA63147A3F39823B55F426C24B263C64BB92B734`.

El portal conserva el login y las sesiones existentes. El Super Administrador
entra a Empresas → Integraciones → TU VERSO. Puede registrar varias cuentas o
instancias por empresa. TENANT_ADMIN no tiene acceso a ninguna ruta de este módulo,
incluidas las de su propia empresa. Android, WEB, TU VERSO y Railway no cambian.

El formulario mínimo pide **clave de integración, sede y propósito autorizado**.
La clave está visible desde el inicio y su guardado crea la configuración local,
sin exigir un paso previo de metadatos. Nombre y vencimiento son opcionales.
La sede se selecciona del tenant y su código se toma del servidor; solo si TU VERSO
autorizó un código diferente se introduce ese valor en una opción plegable.
No se piden códigos de empresa/cuenta/instancia, cola, referencia de credencial ni
scopes. La interfaz explica la única función disponible: consultar disponibilidad,
sin mensajes, conversaciones ni confirmación de pedidos. Los metadatos previamente
registrados se conservan y las validaciones de sesión/tenant no cambian.

## Modelo y aislamiento

`tenant_integrations` referencia el tenant local y guarda nombre, proveedor,
tenant externo, cuenta, tipo MOBILE_APP/WEB, instancia, scopes declarados,
vencimiento declarado, credencial cifrada y resultado sanitizado de la última consulta.
La URL base es fija: `https://api.tuverso.integra-b2g.com`; no se admite una URL
arbitraria que pueda recibir el bearer. Una combinación proveedor/tenant externo/
cuenta/instancia no puede asignarse a dos empresas locales distintas.

`integration_bindings` guarda sede, externalLocationId, purpose y referencia UUID
opcional de cola, con confirmación humana, actor y fecha. Las claves foráneas compuestas
impiden cruzar una integración o sede con otro tenant local. La pareja ubicación/
propósito es única dentro de cada integración. El ID visible de sede y su UUID
local se mantienen; externalLocationId es el identificador que TU VERSO autorizó
y puede coincidir con el código legible de la sede si así fue registrado allí.

Los metadatos externos y las colas son **declarados manualmente**, no certificados
por el portal. Antes de registrar una asociación, el Super Administrador confirma
la autorización obtenida del administrador TU VERSO. La respuesta 1A no contiene
la identidad del tenant, cuenta ni cola; no se inventa una verificación de esos datos.
La credencial y los vínculos persistidos en TU VERSO resuelven la autorización real.
Cambiar identidad externa exige eliminar antes credencial y asociaciones locales.

## Credenciales y protección

La credencial se introduce en un input password sin guardarse en el estado de
React, localStorage ni sessionStorage. Se transmite una sola vez a la API privada,
se borra el formulario y no existe un endpoint para recuperarla. En un despliegue
futuro se requiere HTTPS, cookie Secure y origen exacto; HTTP actual es solo local.

AES-256-GCM usa una clave privada de 32 bytes, IV aleatorio de 12 bytes por escritura,
tag de autenticación y AAD que incluye versión, proveedor, tenant e integración.
El sobre cifrado contiene versión, ID no secreto de clave, IV, tag y ciphertext.
Trasplantar el sobre entre tenants/integraciones, alterar el tag o usar otra clave
impide descifrarlo. La clave maestra nunca se almacena en PostgreSQL ni en Git.
La API ofrece como referencia una huella parcial SHA-256 del token, nunca su contenido.

Las escrituras exigen la sesión SUPER_ADMIN existente, Origin igual a ADMIN_ORIGIN
y Content-Type application/json. Las cookies existentes son HttpOnly/SameSite=Strict.
No se cambia el login ni se crea otro mecanismo de identidad. Todas las operaciones
de cambio y las comprobaciones ejecutadas se auditan en `admin_audit`, en la misma
transacción, con actor, tenant, acción e ID; sin secretos ni cuerpos privados.
Los errores de base de datos, cifrado o proveedor no se registran con su contenido.

El cliente HTTP solo llama al endpoint 1A fijo. No reenvía cookies ni Origin.
Tiene timeout de 6 segundos, límite de respuesta de 16 KB, no sigue redirecciones
y no reintenta automáticamente. Solo conserva campos permitidos; descarta el resto
de la respuesta y cualquier cuerpo de error. Se admiten 20 pruebas por minuto por
integración en cada proceso local, además de los límites propios de TU VERSO.

## Variables privadas

| Variable | Uso |
| --- | --- |
| `INTEGRATION_MASTER_KEY` | Base64 canónico de 32 bytes aleatorios, solo servidor. Sin ella no se guarda ni descifra una credencial. |
| `TUVERSO_LIVE_CHECKS_ENABLED` | `false` por defecto. Habilitar `true` solo con credencial, asociaciones y autorización real explícita. |
| `ADMIN_ORIGIN` | Origen exacto del portal para proteger escrituras sensibles. |
| `TUVERSO_SIMULATION_URL` | Solo en `NODE_ENV=test`: URL HTTP de loopback `127.0.0.1:<puerto>/tuverso`. Si se configura fuera de test, el servidor rechaza iniciar. Nunca usar en producción. |

En este equipo se generó una clave privada en `.env` sin imprimirla. Las consultas
reales permanecen deshabilitadas. No se generaron credenciales TU VERSO reales.
Al aprovisionar otro entorno, generar la clave dentro de su gestor de secretos;
conservar respaldo seguro de la clave junto con la política de recuperación de DB.
No usar variables VITE ni pegar claves en comandos que queden en el historial.

## Migración

La migración aditiva e idempotente `server/migrations/003-tuverso-integrations.sql`
crea únicamente dos tablas e índices/restricciones. El esquema inicial también
incluye estas estructuras. No ejecutarla automáticamente al iniciar la API.
`004-minimal-tuverso-configuration.sql` permite omitir la identificación externa
y la referencia de cola: solo retira NOT NULL de esos metadatos. No elimina ni
inventa datos; conserva el tenant local obligatorio y todas sus relaciones.
El script local aplica ambas migraciones en orden.

Solo sobre la base Docker local autorizada:

```powershell
node --env-file=.env scripts/migrate-integrations-local.mjs
```

Usar Node 22. El script rechaza cualquier destino distinto de
`127.0.0.1:55432/integra_admin`. No hay despliegue o migración productiva en esta tarea.

## API privada del administrador

Prefijo `P = /api/admin/tenants/{tenantId}/integrations`. Todas las rutas requieren
sesión real SUPER_ADMIN y tenant activo. UUID ajeno al tenant devuelve 404.

| Método y ruta | Operación y cuerpo |
| --- | --- |
| `GET P` | Lista sin secretos; incluye connectionMode. |
| `POST P` | Crea configuración local; `{}` es válido, con nombre TU VERSO y permiso de consulta por defecto. Devuelve 201. |
| `GET P/{id}` | Detalle seguro, estado y asociaciones manuales. |
| `PUT P/{id}` | Actualiza metadatos proporcionados, conserva los omitidos e invalida comprobación anterior. |
| `POST P/{id}/credential` | `{token,credentialReference?,expiresAt?}`: cifra y guarda/sustituye; devuelve solo `{ok:true}`. |
| `POST P/{id}/credential-delete` | `{confirm:true}`: elimina únicamente la credencial almacenada localmente. |
| `POST P/{id}/delete` | `{confirm:true}`: elimina la conexión local completa, su clave cifrada y sus asociaciones. Solo SUPER_ADMIN; audita `TUVERSO_CONNECTION_DELETED`. |
| `POST P/{id}/bindings` | `{storeId,purpose,authorizationConfirmed:true}`. externalLocationId y queueReference son opcionales. |
| `POST P/{id}/bindings/{bindingId}/delete` | `{confirm:true}`: elimina la asociación local. |
| `POST P/{id}/test` | `{bindingId,authorizeCheck:true}`: consulta 1A desde backend. |
| `POST P/{id}/suspension` | `{suspended:boolean}`: suspende o retira suspensión local; no cambia TU VERSO. |

No se exige identificación externa para guardar una clave ni para consultar 1A.
Los campos técnicos siguen siendo compatibles con clientes anteriores: `name`
(1–180, por defecto TU VERSO), `externalTenantId` (texto 1–180), `channelAccountId`
UUID, `channelType` MOBILE_APP/WEB e `instanceKey` (1–180). Se guardan como NULL
si no se proporcionan, sin inventar identificadores de TU VERSO. `scopes` usa por
defecto `queue.availability.read`; si se proporciona debe incluirlo, sin duplicados.
También se admiten `baseUrl` (solo la fija), `credentialReference` (hasta 180) y
`expiresAt` ISO 8601 o null. Solo se admiten los seis scopes del PDF; registrar
scopes 1B no los activa. El token se trata como un valor **opaco emitido por TU VERSO**: no exige
prefijo ni versión fija. Acepta el formato vigente `tvi_v1_`, posibles versiones
futuras y el prefijo `tuverso_` si TU VERSO lo adopta. Solo se eliminan espacios
accidentales al inicio y al final; se rechazan espacios internos, controles,
valores demasiado cortos/largos y claves `ib2g_sk_` de otro sistema.
**El administrador no renombra claves:** hacerlo rompería su autenticación.
Una nueva credencial ya vencida se rechaza.

`externalLocationId`: 1–180, o se toma del código real de la sede cuando se omite;
`purpose`: `[A-Z][A-Z0-9_]*`, hasta 80; `queueReference`: UUID opcional que no se
envía en la consulta. La autorización remota de cola la resuelve TU VERSO a partir
de la clave y sus vínculos. El usuario debe confirmar la autorización previa.
No se admiten campos arbitrarios en las operaciones ni referencias de otras sedes.

La API interna distingue errores propios 400/401/403/404/409/415/429/503 de una
comprobación ejecutada: esta devuelve HTTP interno 200 con `httpStatus` del proveedor
(o null si no respondió), `result`, `errorCode`, mensaje sanitizado, fecha local,
bindingId, indicación de simulación y `phase1BEnabled:false`.
Un HTTP interno 200 no significa que la prueba externa tuvo éxito.

## Estado y comprobación 1A

En **Conexiones guardadas**, **Eliminar conexión** pide una segunda confirmación
y permite cancelar. La eliminación se limita al tenant y conexión seleccionados,
se ejecuta en una transacción y conserva la auditoría. Las sedes comerciales y las
otras conexiones no se eliminan. También permite retirar configuraciones creadas
por error que no tengan clave. No llama a TU VERSO ni revoca allí credenciales.

| Estado visible | Criterio |
| --- | --- |
| SIN CONFIGURAR | Sin credencial registrada. |
| CONFIGURADA | Credencial almacenada, sin comprobación válida vigente para esa configuración. |
| CONECTADA PARA CONSULTAS | Última comprobación válida 1A con AVAILABLE o UNAVAILABLE. Si fue simulada se identifica expresamente. |
| ERROR DE AUTENTICACIÓN | Última prueba rechazó credencial/permisos con 401 o 403. |
| VENCIDA | Fecha de vencimiento registrada pasada. |
| SUSPENDIDA | Suspensión local, con prioridad sobre los otros estados. |

Modificar metadatos, asociaciones o credencial, o retirar suspensión, invalida la
comprobación anterior. Los fallos 409/429/503, timeout, redirección o respuesta
inválida dejan CONFIGURADA y muestran el error, sin mantener una conexión aparente.

Antes de una consulta se exige credencial, vigencia, ausencia de suspensión,
asociación persistida del tenant y consentimiento expreso para ese intento.
El modo operativo del servidor también debe permitir la consulta.
Se envía únicamente:

```text
GET https://api.tuverso.integra-b2g.com/api/v1/queues/availability?externalLocationId=<vinculado>&purpose=<vinculado>
Authorization: Bearer <secreto descifrado solo en backend>
Accept: application/json
```

Se exige `data.externalLocationId` coincidente, `status` AVAILABLE/UNAVAILABLE,
`reservation:false` y `checkedAt` válido. La hora del proveedor se muestra solo
como evidencia de esa consulta. AVAILABLE no confirma pedidos ni reserva agentes;
UNAVAILABLE con HTTP 200 es una consulta autorizada sin capacidad elegible.
401: revisar credencial/licencia/scopes; 403: acceso; 409: configuración;
429: esperar sin evadir límites; 503: servicio/función no habilitada.

## Emisión autorizada y rotación

1. Un **TENANT_ADMIN humano de TU VERSO**, con su propia sesión, CSRF y MFA/
   reautenticación reciente, verifica contrato, licencia, cuenta y cola autorizada.
2. En TU VERSO registra DRAFT, vincula externalLocationId+purpose a su cola propia,
   emite la credencial (validDays 1–90; requestId UUID único) y activa solo 1A.
   El PDF documenta las rutas administrativas en páginas 10–12. **Este portal
   no ejecuta ninguna de esas rutas**, no automatiza cookies ni simula sesiones.
3. Transfiere el token mostrado una sola vez por un canal seguro al Super
   Administrador de INTEGRA, quien lo registra en este formulario junto con
   vencimiento si lo conoce y sede/propósito autorizados. No usar correo/tickets/logs.
4. Con autorización explícita para la prueba real, el operador del entorno habilita
   la variable privada de consultas y reinicia la API; el Super Administrador
   selecciona la asociación, autoriza el intento y pulsa Probar conexión.
5. Para sustituir: emitir otra credencial legítima en TU VERSO, guardarla aquí,
   comprobar 1A autorizada y solicitar la revocación de la anterior al administrador
   TU VERSO. Sustituir/eliminar/suspender localmente **no revoca** el token externo.
6. Si el token se extravía, emitir uno nuevo y revocar el anterior desde TU VERSO;
   este portal no permite revelar de nuevo el token guardado.

Para rotar la **clave maestra local**: detener la API y respaldar DB y clave antigua
con protección independiente; generar la nueva clave en el gestor de secretos;
inyectar temporalmente `INTEGRATION_PREVIOUS_MASTER_KEY` (anterior) y
`INTEGRATION_MASTER_KEY` (nueva) en el entorno privado del proceso; ejecutar:

```powershell
node --env-file=.env scripts/rotate-integration-key.mjs
```

El script solo permite la base local autorizada y recifra todas las credenciales
en una transacción con bloqueo. Si falla alguna autenticación, revierte todo y
no imprime el error privado. No cambia el bearer ni lo revoca en TU VERSO.
Si termina bien, guardar la nueva clave como variable privada persistente,
retirar la variable anterior y reiniciar la API. Ante fallo, restaurar la clave
anterior y mantener la API detenida hasta resolver. Coordinar acceso exclusivo
durante la rotación para evitar escrituras con otra clave.

## Pruebas focalizadas y simulación

La CLI disponible es Postman 1.74.0; no admite `postman status`. No se vinculó
ningún workspace ni se publicaron mocks. Se omitió la búsqueda del mock del
proveedor: se usa exclusivamente un stand-in local derivado del PDF obligatorio.

Terminal 1, con Node 22 disponible:

```powershell
postman simulation run postman/simulations/tuverso/tuverso.sim.yaml --port 4410 --no-history --output ndjson
```

Terminal 2:

```powershell
node --env-file=.env server/integrations.test.mjs
```

La prueba levanta **el mismo backend** en 4400 con NODE_ENV=test y URL de
simulación loopback; no es otra arquitectura ni un servidor de producto distinto.
Usa exclusivamente tenants/usuarios/sedes de prueba que elimina al finalizar.
El mock rechaza query extra, Origin y cookies; sus estadísticas no guardan bearer.
No usar credenciales reales en la simulación ni guardar sus logs en Git.

Se verifican sesiones y aislamiento, FK de tenant, AES-GCM y AAD, no exposición,
rotación/sustitución, eliminación, estados y respuestas 401/403/409/429/503,
AVAILABLE/UNAVAILABLE, JSON inválido, sede distinta, redirección y timeout.
Los eventos `request` de la simulación y `/__stats` confirman las llamadas desde
el backend. Las rutas `/__control` y `/__stats` existen únicamente en el mock local.

También se comprobó en Edge el flujo de escritorio, guardado y recarga, sustitución,
asociación, suspensión/eliminación local, ausencia de secretos en almacenamiento
del navegador y bloqueo de las consultas reales del entorno. Resultados locales
en `.local/integrations-test-results.json` y captura de interfaz en
`.local/tuverso-integrations-desktop.png`.

Para repetir únicamente la comprobación de interfaz con Edge instalado, la
herramienta Playwright de QA se mantiene fuera de las dependencias del producto:

```powershell
npm.cmd install --prefix .local/browser playwright --no-audit --no-fund
node --env-file=.env server/integrations-ui.test.mjs
```

El frontend y backend locales deben estar iniciados, con consultas reales
deshabilitadas. El script usa registros temporales identificados como prueba y
los elimina. `PLAYWRIGHT_MODULE` permite usar otra instalación local de Playwright.
El script de rotación de clave también se ejercitó con tablas temporales de
sesión PostgreSQL, verificando recifrado y rollback sin tocar credenciales reales.

Estas pruebas acreditan el comportamiento del administrador ante simulaciones.
**No acreditan una conexión productiva certificada.** Siguen siendo necesarios
una cuenta/instancia, cola y Flow autorizados, credencial legítima, licencia/scopes
vigentes y autorización explícita de consulta. Fase 1B permanece deshabilitada;
no se implementan interacciones, conversaciones, mensajes, pedidos ni cobros.
