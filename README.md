# Plataforma Administrativa Multitenant — INTEGRA B2G

**Producto:** plataforma SaaS de gestión para restaurantes y negocios. El software es de INTEGRA B2G, **no de Pollos B3**. Pollos B3 será una empresa que el Super Administrador podrá crear, igual que cualquier otra; no debe figurar registrada por defecto.

**Inicio real:** login sencillo en la ruta raíz, con sesión de servidor. El Super Administrador accede al listado persistente y creación de empresas; los administradores de empresa acceden a su propia configuración. Se conserva la lógica comercial/Android existente por compatibilidad. Las integraciones TU VERSO y WEB aún no están conectadas.

**Arquitectura:** [docs/ARQUITECTURA_ADMINISTRADOR_SAAS.md](docs/ARQUITECTURA_ADMINISTRADOR_SAAS.md).

**API Keys para servidores externos:** [docs/API_KEYS_INTEGRACIONES.md](docs/API_KEYS_INTEGRACIONES.md). Requiere migración local 005; no modifica el consumo público móvil ni las credenciales TU VERSO.

---

## Antecedentes técnicos: piloto de aplicación Android

## Estado real

Esta entrega incorpora el prototipo frontend entregado por el usuario y un backend nuevo con PostgreSQL para empresas, usuarios, locales, productos, fotos, promociones, configuración de pagos y publicación del catálogo Android. **No está desplegada ni certificada para producción**. El cambio de rol dentro del menú original continúa siendo una maqueta; la ruta **Operación móvil** usa una sesión de servidor real y autorización por tenant. No existen pedidos ni cobros reales.

## Inicialización local

1. Instala Node 22, pnpm, PostgreSQL 17 y una base de datos aislada.
2. Aplica el SQL **sobre una base vacía**: `psql "$DATABASE_URL" -f server/schema.sql`.
3. Copia `.env.example` a `.env` y define variables seguras. No subas el archivo `.env` a GitHub.
4. Ejecuta una sola vez `pnpm bootstrap:admin` con credenciales de superadministración fuertes. Borra las variables `BOOTSTRAP_*` luego.
5. Ejecuta `pnpm install`, `pnpm dev` (interfaz Vite) y, en una terminal aparte, `pnpm start` (API).
6. Abre `http://localhost:3000`, inicia sesión como Super Administrador, crea la empresa que corresponda y entra en **Configuración comercial**.

**Despliegue:** servir `dist/` desde Node, establecer `NODE_ENV=production`, `COOKIE_SECURE=true`, `ADMIN_ORIGIN` HTTPS exacto, `DATABASE_URL` protegida y desactivar el acceso a la base de datos desde Internet.

**Checklist obligatorio al desplegar en Railway (proyecto independiente de TU VERSO):** verificar que la ruta `/` entregue el login HTML, que `/health/ready` responda `ready`, que `/api/v1/mobile/config?appId=...` consulte el catálogo publicado y que los assets de `dist/` carguen sin errores. La validación de rutas estáticas usa semántica compatible con Windows local y Linux/Railway; no volver a introducir comparaciones con `/` fijo. Mantener `ADMIN_ORIGIN` igual al dominio HTTPS de administración y aplicar las migraciones correspondientes solo a la PostgreSQL independiente del administrador. **Este cambio no despliega a Railway.** La plataforma requiere pruebas de penetración, copias de seguridad y revisión operacional antes de recibir clientes.

## API pública Android

- `GET /api/v1/mobile/config?appId=com.integrab2g.pollosb3`: solo publica datos de una app habilitada, enlazada a un tenant activo.
- `POST /api/v1/mobile/fulfillment/resolve`: `{appId,mode:'delivery',address,district}` para delivery (o GPS confirmado con `useGps:true`); `{appId,mode,storeId}` para recojo o comer en tienda. Devuelve sede abierta elegible, kilómetros por carretera, tarifa por kilómetro configurada y cargo calculado.
- `GET /api/v1/mobile/images/{uuid}`: fotografía **publicada** del catálogo.

No permite crear pedidos ni procesar pagos. Una cotización de Delivery utiliza **Google Routes API desde el servidor**, con distancia real de conducción. Compara todas las sedes activas, abiertas, con Delivery habilitado, coordenadas y tarifa/km publicada; asigna la más próxima por carretera que cumpla su cobertura. `radiusKm=null` significa cobertura ilimitada; una cobertura configurada es un límite máximo en km de ruta. Cargo = distancia real en km × tarifa/km, redondeado a céntimos. Sin clave/ruta válida se rechaza la cotización; no se utiliza distancia en línea recta para facturar. La tarifa fija histórica se conserva solo por compatibilidad y no se usa para cotizaciones nuevas.

**Activación controlada**: en Google Cloud habilitar Routes API y facturación, crear clave restringida a esta API y a los orígenes de servidor correspondientes, definir cuotas/presupuesto, y establecer `GOOGLE_ROUTES_API_KEY` exclusivamente en el backend. No publicar secretos en la app. La API pública cuenta con un límite básico en memoria de 20 cotizaciones/minuto por IP del socket, además de caché y deduplicación de consultas durante 5 minutos. Para producción se requiere adicionalmente rate limiting en el gateway, controles antiabuso y cuotas reales en Google Cloud.

**PostgreSQL**: el esquema incluye el campo `delivery_rate_per_km_pen` y admite `radius_km NULL`. Aplicar las sentencias `ALTER TABLE` del final de `server/schema.sql` como migración revisada en entornos existentes ANTES de desplegar el backend; no asumir que `CREATE TABLE IF NOT EXISTS` actualiza columnas. No se ejecutaron migraciones ni despliegues en este cambio.

## API administrativa

- Login `POST /api/admin/login` (cookie HttpOnly y SameSite Strict) / logout / me.
- Superadmin: tenants GET/POST, usuarios tenant POST.
- Admin tenant o superadmin: GET/POST `/api/admin/tenants/{tenantId}/stores`, `products`, `promotions`, `payments`, `apps`, `publish`; carga de imágenes binarias JPEG/PNG/WebP (máximo 4 MB) vía `images`.
- Las modificaciones son borradores; solo la acción `publish` cambia la configuración visible en Android.

Controles: tenant determinado por sesión, filtros tenant en operaciones, consultas parametrizadas, contraseñas scrypt, sesión aleatoria de 256 bits hash en BD, expiración 12 h, origen de escrituras validado, auditoría de cambios, imágenes validadas por firma. Revisión recomendada: rate-limiting/antifuerza bruta del login, RLS de PostgreSQL como defensa adicional, controles CSRF con proxy confiable y despliegue endurecido antes de operar.

## Identidad y datos

Las empresas, direcciones, ofertas, productos y pagos **no se presuponen**. Ningún local está activo por defecto. Las fotografías se cargan únicamente a través del administrador autenticado. Los precios reales serán los publicados por cada empresa. No incluir credenciales secretas dentro del APK.
## Tarifa fija o por kilómetro (por sede)

Cada sede puede usar `delivery_pricing_mode='PER_KM'` (cargo = km reales de Google Routes × `delivery_rate_per_km_pen`) o `delivery_pricing_mode='FIXED'` (cargo = `delivery_fee_pen`, sin multiplicar). La modalidad y la tarifa se configuran y publican desde la administración web. La cobertura máxima (`radius_km`) permanece independiente del importe: si se configura, la ruta debe estar dentro del límite, incluso en modalidad fija; `NULL` significa sin límite. Para elegir la sede más cercana por carretera todavía se consultan rutas Google en ambos modos, aunque con tarifa fija esos kilómetros no intervienen en el cargo. Un importe no configurado no autoriza una cotización. Esta función todavía requiere activar Routes API y aplicar la migración de PostgreSQL; no se ha desplegado.


## Vacantes de trabajo y WhatsApp

En la administración de cada empresa, `Vacantes` permite guardar un puesto, imagen JPG/PNG/WebP, resumen, descripción, requisitos, horario, modalidad, sede, teléfono de postulación y estado activo/inactivo. Cada cambio queda en borrador hasta pulsar `Publicar` para la app seleccionada. Solo las vacantes activas del tenant se incluyen en `GET /api/v1/mobile/config`, campo `vacancies`. El teléfono requiere formato celular peruano (9 dígitos empezando con 9; el backend normaliza a 51+9 dígitos).

Android ofrece `Mi Cuenta → Trabaja con nosotros` con la lista y los detalles. `Postular por WhatsApp` abre `https://wa.me/<teléfono>?text=<texto>` mediante un puente Android que valida el dominio, teléfono y prefijo del mensaje. Mensaje: `Hola, estoy interesado(a) en trabajar en Pollos B3. Quisiera información sobre la vacante de <PUESTO>.` El envío requiere confirmación manual del solicitante en WhatsApp. No se registran postulaciones ni se transmite información personal al backend.

Antes de desplegar, aplicar `server/schema.sql` en un entorno controlado para crear `job_vacancies`, configurar las imágenes y confirmar los números oficiales de RR. HH. No se han creado vacantes ficticias ni publicado las imágenes de ejemplo como ofertas activas.


## FAQ y Libro de Reclamaciones (Pollos B3 Android)

La app incluye preguntas frecuentes redactadas sin prometer cobros, atención con agentes ni seguimiento de pedidos reales que todavía no están conectados. En `Mi Cuenta → Libro de Reclamaciones`, la aplicación muestra información de derechos del consumidor y abre el enlace HTTPS **del propio proveedor** solo cuando su administrador lo guarda y publica desde `Operación móvil → Libro de Reclamaciones · Enlace oficial` para el `appId` correspondiente. El URL se almacena en `mobile_apps.complaints_book_url` y solo se entrega en el catálogo publicado como `complaintsBookUrl`.

El enlace no es un libro construido por esta app. Debe apuntar a un Libro electrónico real y accesible con identidad del proveedor, hoja numerada, envío/impresión de constancia y procesamiento conforme al reglamento. Si no hay enlace, **no se simula una hoja ni un registro**: se muestra la advertencia y se orienta al consumidor a solicitar el Libro al proveedor. El proveedor debe cumplir además con la exhibición y disponibilidad que exija la normativa vigente. El backend rechaza HTTP, localhost, IP literals y URLs con credenciales. La app abre la URL fuera de su WebView.

La actualización de la columna requiere aplicar el SQL en una base controlada antes de publicar. No se ha desplegado ni configurado un enlace oficial no suministrado por Pollos B3.


### Sedes y horarios en Android (lectura desde API)

Los horarios configurados en **Configuración comercial → Locales y modalidades**
se almacenan como `opening_hours` con claves `mon/tue/wed/thu/fri/sat/sun`.
Solo las sedes **activas** se incluyen en una publicación; los horarios no se
exponen a Android hasta **Aplicación y publicación → Publicar cambios**.

La API existente `GET /api/v1/mobile/config?appId=<id>` devuelve la
configuración publicada de una empresa y calcula `hoursConfigured`, `isOpen`
y `closesAt` en la zona horaria `America/Lima`. Para compatibilidad con
la pantalla de detalle semanal del cliente Android existente, la API de lectura
añade `weeklyHours` con claves completas `monday/tuesday/.../sunday`
a partir de los días publicados, sin alterar `openingHours` ni el esquema
de PostgreSQL. La adaptación también funciona para publicaciones anteriores,
sin cambiar los borradores. Si un día no está configurado se omite; no se
inventan horarios.

La app Android consulta esta API usando el `appId` registrado. Su
`B3_API_BASE` debe apuntar a una URL HTTPS accesible desde el dispositivo;
`localhost:4000` solo sirve para probar la API desde el propio PC, **no desde
Android**. La APK debe compilarse con esa dirección y no debe incluir
API Keys secretas. Ningún repositorio Android o TU VERSO fue modificado.


### Inicio de sesión desde un túnel HTTPS temporal (solo desarrollo)

El origen del navegador al usar Cloudflare Quick Tunnel no coincide con
`ADMIN_ORIGIN=http://localhost:3000`. Por eso el login remoto devolvía
`HTTP 403 Origen no autorizado` incluso con credenciales correctas.

Para permitir **solo un dominio exacto** de túnel, mantener
`ADMIN_ORIGIN=http://localhost:3000` y configurar en el archivo `.env`
local `ALLOWED_ORIGINS=https://<dominio-asignado>.trycloudflare.com`,
sin barra final. Reiniciar backend local. Las sesiones y las acciones
administrativas usarán la lista de orígenes aprobados; todos los demás
se rechazan. **En producción, solo se admite ADMIN_ORIGIN**.

Seguridad: un Quick Tunnel sin protección expone también el login público.
Es adecuado únicamente para pruebas puntuales, no para una administración
pública permanente; cerrar el túnel al finalizar o utilizar un túnel
nombrado con Cloudflare Access (y rate limiting) antes de abrir a usuarios.
Para comprobar sedes desde Android no es necesario abrir el login remoto;
puede administrarse desde localhost y usar HTTPS solo para lectura de API.


## Experiencia de uso: configuración comercial

El menú **Configuración comercial** está organizado por tareas para evitar una
única página extensa: **Locales**, **Carta** (productos y promociones), **Pagos**,
**Más opciones** (vacantes y Libro de Reclamaciones) y **Publicar**.
La administración de usuarios de empresa aparece solo para SUPER_ADMIN en el
modo operativo independiente; la gestión de empresas continúa en el portal
principal de Super Administrador.

En **Locales**, las sedes registradas aparecen antes del formulario de edición.
Se muestra el formulario únicamente al elegir una sede o **Agregar local**;
los horarios semanales y la configuración GPS/delivery son desplegables y
mantienen su estado cuando están ocultos. Ningún campo de la base de datos se
elimina ni se modifica el contrato de la API.

Las confirmaciones y errores de operaciones comerciales aparecen junto al
botón o campo que ejecutó la acción, no en el encabezado de la página.
Guardar mantiene los cambios en borrador: **Publicar cambios** continúa siendo
la única acción que actualiza el catálogo consultado por Android. No hay cambios
en tuverso, Android, WEB ni las reglas de aislamiento por tenant.

Validación focalizada: abrir cada sección en escritorio y móvil; seleccionar
sede existente y verificar que se carguen horarios y tarifa; editar/guardar
sin alterar el ID de sede; crear/guardar producto; cargar imagen; publicar y
confirmar el mensaje junto a **Publicar cambios**. No se requieren migraciones.


### Eliminar locales con confirmación

En **Configuración comercial → Locales**, elegir una sede, pulsar **Eliminar local**
y confirmar. Ruta `DELETE /api/admin/tenants/{tenantId}/stores/{storeId}` con
body `{"confirm":true}`. Requiere sesión autenticada y pertenencia al tenant.
Las asociaciones con TU VERSO bloquean la operación (HTTP 409), sin cambios
en TU VERSO. Los medios de pago propios del local se eliminan mediante
la relación existente. Se registra `STORE_DELETED` en la auditoría.
El catálogo previamente publicado sigue igual hasta **Publicar cambios**.

### Productos guardados: listado, edición y vista previa

**Carta** muestra todos los productos registrados de la empresa, tanto activos
como inactivos, con imagen, nombre, categoría, precio y estado. Seleccionar
**Editar** recupera los valores y envía el mismo `id` al POST de productos;
la operación modifica ese registro y evita crear duplicados.

Se utiliza `GET /api/admin/tenants/{tenantId}/images/{imageId}` para mostrar
fotos de productos todavía en borrador: solo sesiones autorizadas del tenant
pueden verlas. No se modifica la API pública de Android ni se publican
productos automáticamente. La visibilidad móvil exige `active=true`
y publicar una nueva revisión. Ninguna migración de base de datos es necesaria.


## Gestión comercial: registros visibles y editables

Todas las secciones muestran sus registros guardados (borradores) antes del
formulario cuando aplica. Guardar una configuración no reemplaza el catálogo
público; solo **Publicar cambios** actualiza la revisión móvil.

- **Locales:** lista y edición existentes; eliminación con confirmación.
- **Carta:** lista de productos con foto y estado; editar y eliminar con confirmación.
- **Promociones:** lista de promociones activas/inactivas; editar usa el ID del
  registro existente, eliminar requiere confirmación.
- **Pagos por local y modalidad:** `GET /api/admin/tenants/{tenantId}/payments`
  muestra todas las combinaciones guardadas, también las deshabilitadas.
  El `POST` existente es un UPSERT por `storeId + mode + method`, por lo que
  habilitar/deshabilitar actualiza sin duplicar. La combinación se fija al
  editar, para agregar otra se usa **Nuevo medio de pago**.
  Eliminar: `DELETE /api/admin/tenants/{tenantId}/payments/{storeId}/{mode}/{method}`
  con JSON `{"confirm":true}`.
- **Vacantes:** listado de registros activos/inactivos, editar sin duplicar,
  eliminar bajo confirmación y vista previa privada de imágenes.
- **Libro de Reclamaciones:** mostrar URL guardada de la aplicación elegida,
  modificar o quitar enlace de borrador con confirmación.
- **Aplicaciones:** lista, selección y revisión de publicación. Eliminar el
  registro solo cuando nunca fue publicado; después se protege con HTTP 409.
- **Usuarios (SUPER_ADMIN):** lista y edición de correo, estado y contraseña;
  desactivar cierra sesiones y conserva el registro de auditoría.

Eliminaciones en borrador (todas con sesión autorizada y `{"confirm":true}`):
`DELETE .../products/{id}`, `DELETE .../promotions/{id}`,
`DELETE .../vacancies/{id}`. Se auditan y requieren una nueva publicación
para afectar la aplicación. No se tocan los proyectos TU VERSO ni Android.
Sin migraciones de esquema.

## Notificaciones programadas (API de lectura, no push)

Desde **Configuración comercial → Notificaciones** se registra aplicación de
destino, título, texto, imagen y fecha/hora, con vencimiento opcional.
Las notificaciones se guardan en PostgreSQL y se aíslan por empresa.
Los estados son `SCHEDULED`, `AVAILABLE`, `CANCELLED` y `EXPIRED`.
`AVAILABLE` no significa que se haya enviado un push al teléfono.

### API pública
`GET /api/v1/mobile/notifications?appId=com.integrab2g.pollosb3`

Ejemplo de respuesta desde la fecha programada:
```json
{"ready":true,"notifications":[{"id":"UUID","title":"Promoción",
"message":"Mensaje de la empresa","imageUrl":"/api/v1/mobile/notification-images/UUID?appId=com.integrab2g.pollosb3",
"scheduledAt":"2026-11-19T20:30:00.000Z","expiresAt":null}]}
```

El consumidor deduplica por `id`. La API omite notificaciones programadas
para el futuro, canceladas, vencidas o de aplicaciones no habilitadas.
Retorna hasta 100 registros ordenados por fecha; la imagen se libera
únicamente desde la fecha programada y para la aplicación correspondiente.

### API administrativa (requiere sesión y autorización por tenant)
- `GET /api/admin/tenants/{tenantId}/notifications`: listar.
- `POST /api/admin/tenants/{tenantId}/notifications`: crear/editar con
  `appId`, `title`, `message`, `imageId`, `scheduledAt`, `expiresAt` y
  `id` opcional para editar exclusivamente una notificación pendiente.
- `POST /api/admin/tenants/{tenantId}/notifications/{id}/cancel`
  con `{"confirm":true}`: cancelar una notificación todavía pendiente.
- `DELETE /api/admin/tenants/{tenantId}/notifications/{id}`
  con `{"confirm":true}`: eliminar y retirar de la API.
- `POST /api/admin/tenants/{tenantId}/images`: subir JPEG, PNG o WebP
  real de máximo 4 MB; devuelve ID de imagen.
- `GET /api/admin/tenants/{tenantId}/images/{imageId}`: previsualizar
  de forma privada una imagen de la misma empresa.

Las horas del navegador se convierten a UTC (`TIMESTAMPTZ`) antes de guardar.
**BD existente:** aplicar solamente
`server/migrations/006-scheduled-notifications.sql`.
Es una migración aditiva e idempotente; en bases nuevas, `server/schema.sql`
ya incluye la tabla. No reinicializar bases existentes.

**Límite funcional:** no se ejecutan envíos push automáticos ni se integra
Firebase Cloud Messaging o APNs. Android debe consultar la API y
deduplicar avisos por `id`; para mostrar push fuera de la aplicación
se necesitaría una integración adicional de transporte push.
No se modificó Android, TU VERSO ni Railway.


## Envío PUSH FCM desde el administrador (Pollos B3)

El proyecto Firebase de la app Android es `pollosb3-84297`,
el identificador Android es `com.integrab2g.pollosb3` y el tema
de destinatarios es `pollosb3_promotions`. El backend existente puede
consultar `scheduled_notifications` periódicamente y enviar FCM HTTP v1
con OAuth de cuenta de servicio. No se modifica el APK.

### Activación del servidor

1. En Firebase Console → Configuración del proyecto → Cuentas de servicio
   generar una **clave privada de cuenta de servicio** para este proyecto.
   El archivo **`google-services.json` de Android no es una cuenta de servicio**
   y no autoriza el envío. Guardar el JSON privado **fuera del repositorio**
   y no compartirlo por chat ni incorporarlo al APK.
2. Activar **Firebase Cloud Messaging API (HTTP v1)** para `pollosb3-84297`
   y conceder permiso de envío a esa cuenta (`roles/firebase.messagingAdmin`
   cuando sea una cuenta de servicio dedicada).
3. Configurar únicamente en el proceso de Node.js las variables:
   `FCM_PROJECT_ID=pollosb3-84297`,
   `FCM_TARGET_APP_ID=com.integrab2g.pollosb3`,
   `FCM_TOPIC=pollosb3_promotions`,
   `GOOGLE_APPLICATION_CREDENTIALS` con ruta del JSON privado o
   `FCM_SERVICE_ACCOUNT_JSON` como secreto servidor, y
   `FCM_PUBLIC_BASE_URL` como origen **HTTPS estable y público** del
   backend para que Firebase descargue imágenes (máximo 1 MB).
   Ejemplo de dominio: `https://api.tudominio.com` (solo ilustrativo).
4. Aplicar a la base administrativa existente exclusivamente la migración
   `server/migrations/007-fcm-push.sql`, **antes de iniciar este backend**.
   Es aditiva e idempotente y preserva notificaciones existentes.
   Las notificaciones anteriores a esta migración quedan `SKIPPED` y no
   se envían inesperadamente al activar FCM. Para bases nuevas
   `server/schema.sql` ya incluye el cambio.
5. Después de revisar credencial y dominio, establecer `FCM_ENABLED=true`
   solamente en el servidor y reiniciar. Si es `false` (valor inicial),
   el backend no llama a Firebase y la API pública continúa funcionando.

### Estados y seguridad

El servidor revisa trabajos aproximadamente cada 15 segundos.
`PENDING → SENDING → SENT` al recibir un ID válido de Firebase.
`RETRY` ante un 429 o 503 explícito (hasta cuatro intentos);
`FAILED` ante rechazo definitivo; `UNKNOWN` ante resultado ambiguo
(timeout o caída), **sin reintento automático** para evitar duplicados.
`SKIPPED` identifica registros anteriores a la activación.
El estado `SENT` significa únicamente **aceptado por Firebase**,
no entrega confirmada a todos los dispositivos.

Los envíos se filtran por aplicación habilitada y tenant activo.
El tema de destino y proyecto provienen exclusivamente de variables
privadas del servidor, nunca de un campo editable por el tenant.
Un `SELECT ... FOR UPDATE SKIP LOCKED` impide reclamar el mismo trabajo
simultáneamente. Los errores almacenados no incluyen las credenciales.
No se envían notificaciones por API desde Android al backend.

**Producción:** requiere hosting permanente del backend con PostgreSQL
y HTTPS público estable. Una sesión local o Cloudflare Quick Tunnel no
garantiza que las notificaciones se envíen a la hora programada.
**Ningún mensaje real fue enviado en las pruebas automatizadas:**
las pruebas usan un simulador de respuesta OAuth/FCM.


### Activación FCM en PC local usando `.env`

El proceso Node carga automáticamente `./.env` de la raíz del administrador
cuando no se ejecuta con `NODE_ENV=production`.
Las variables ya establecidas por el proceso tienen prioridad sobre ese
archivo; en producción no se carga el `.env` y se usan secretos del hosting.

Antes de activar envíos reales, desde la raíz del administrador ejecutar:

```powershell
node server/fcm-preflight.mjs
```

El preflight no imprime el contenido de los secretos ni envía ningún push.
Comprueba la cuenta de servicio de Google, su correspondencia con el proyecto
`pollosb3-84297`, la clave privada, el tema y la respuesta de
`FCM_PUBLIC_BASE_URL/health/live` por HTTPS.
Si devuelve `PREFLIGHT: PASS`, comprobar que la migración
`007-fcm-push.sql` esté aplicada y activar `FCM_ENABLED=true` en el `.env`
local (y reiniciar el backend). Un tema FCM es una difusión colectiva;
no programar una promoción de prueba sin conocer los destinatarios.

En caso de `PREFLIGHT: NO LISTO`, conservar `FCM_ENABLED=false` y corregir
solo el componente que indique el diagnóstico.
El preflight no prueba los permisos remotos de FCM: su validación definitiva
ocurre al enviar un mensaje real autorizado por el operador.


### Producto opcional en notificaciones

Desde **Notificaciones → Programar notificación** se puede elegir **Producto asociado (opcional)**,
o dejar **Sin producto asociado** para novedades informativas.
Solo se pueden vincular productos activos del mismo tenant; el servidor
valida el ID en cada creación y edición. Para enlazar un producto útil
para compra debe estar además publicado en el catálogo de la aplicación.

El campo administrativo `productId` es anulable. La API pública
`GET /api/v1/mobile/notifications?appId=...` devuelve `productId` (UUID o null),
y el envío FCM incluye `data.productId` únicamente si hay un producto activo
asociado. Se conservan `type=marketing`, `screen=notifications` y el
identificador original para compatibilidad con el receptor Android.

Al eliminar un producto, PostgreSQL desvincula el UUID con `ON DELETE SET NULL`
y conserva la notificación. Si el producto se desactiva, la API y FCM omiten
su vínculo para no dirigir al cliente a una ficha inactiva.
Para instalaciones actuales, ejecutar **solo**
`server/migrations/008-notification-product.sql` antes de actualizar el backend.
La migración es aditiva e idempotente y no reenvía notificaciones.

**Apertura en Android:** en la rama Pollos B3
`feat/pollos-b3-v11-webview-fulfillment` se agregó compatibilidad con
`productId`: la pantalla del aviso muestra **Ver producto y pedir** únicamente
si está publicado, existe y está disponible en el catálogo; en avisos sin
producto se mantiene **Explorar la carta**. Reutiliza el flujo normal de
selección de modalidad, ficha y carrito: no realiza compras automáticas.
Es necesario generar e instalar una APK con este cambio para verlo en el
teléfono; una APK previa no se actualiza sola.
