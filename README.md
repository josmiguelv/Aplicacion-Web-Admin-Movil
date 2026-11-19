# Pollos B3 — Web de administración y API multitenant

## Estado real

Esta entrega incorpora el prototipo frontend entregado por el usuario y un backend nuevo con PostgreSQL para empresas, usuarios, locales, productos, fotos, promociones, configuración de pagos y publicación del catálogo Android. **No está desplegada ni certificada para producción**. El cambio de rol dentro del menú original continúa siendo una maqueta; la ruta **Operación móvil** usa una sesión de servidor real y autorización por tenant. No existen pedidos ni cobros reales.

## Inicialización local

1. Instala Node 22, pnpm, PostgreSQL 17 y una base de datos aislada.
2. Aplica el SQL **sobre una base vacía**: `psql "$DATABASE_URL" -f server/schema.sql`.
3. Copia `.env.example` a `.env` y define variables seguras. No subas el archivo `.env` a GitHub.
4. Ejecuta una sola vez `pnpm bootstrap:admin` con credenciales de superadministración fuertes. Borra las variables `BOOTSTRAP_*` luego.
5. Ejecuta `pnpm install`, `pnpm dev` (interfaz Vite) y, en una terminal aparte, `pnpm start` (API).
6. Abre `/mobile-operation`, autentícate; crea tenant, administrador, aplicación, locales, productos, métodos y publica.

**Despliegue:** servir `dist/` desde Node, establecer `NODE_ENV=production`, `COOKIE_SECURE=true`, `ADMIN_ORIGIN` HTTPS exacto, `DATABASE_URL` protegida y desactivar el acceso a la base de datos desde Internet. La plataforma requiere pruebas de penetración, copias de seguridad y revisión operacional antes de recibir clientes.

## API pública Android

- `GET /api/v1/mobile/config?appId=com.integrab2g.pollosb3`: solo publica datos de una app habilitada, enlazada a un tenant activo.
- `POST /api/v1/mobile/fulfillment/resolve`: `{appId,mode:'delivery',latitude,longitude,address?,district?}` para delivery con coordenadas explícitas del destino (geocodificadas por el cliente o capturadas por GPS autorizado); `{appId,mode,storeId}` para recojo o comer en tienda. Devuelve sede elegible, `straightDistanceKm`, `distanceSource:'STRAIGHT_LINE'`, modalidad de tarifa y costo.
- `GET /api/v1/mobile/images/{uuid}`: fotografía **publicada** del catálogo.

No permite crear pedidos ni procesar pagos. **Fase temporal sin Google Routes:** el backend utiliza la distancia geográfica en línea recta (fórmula haversine) entre la posición del cliente y cada sede abierta con delivery habilitado. Solo considera sedes dentro de su radio `radiusKm`; `null` implica cobertura ilimitada. Entre las sedes elegibles asigna siempre la más cercana al destino. El cliente no selecciona sede en delivery; se excluyen automáticamente las cerradas, inactivas, no habilitadas o fuera del radio publicado.

La modalidad `PER_KM` usa `deliveryRatePerKmPen × distancia en línea recta` (redondeado a dos decimales); `FIXED` aplica directamente `deliveryFeePen`, pero **sigue comprobando el radio**. No se asignan tarifas si falta la configuración de sede, coordenadas verificables, disponibilidad u horario. Las direcciones escritas deben geocodificarse en el dispositivo; la API no inventa coordenadas a partir del texto. Para esta fase, Android usa el geocodificador del sistema cuando está disponible o permite ubicación GPS expresamente elegida en el destino. El geocodificador del sistema podría necesitar un proveedor de ubicación externo, pero no utiliza la API de pago de Google Routes ni requiere `GOOGLE_ROUTES_API_KEY`.

**Limitación comercial:** la distancia en línea recta es normalmente inferior a la ruta por calles. El costo se identifica como **estimado** y no se debe comercializar como kilómetros de conducción. El límite básico por IP es de 20 cotizaciones/minuto; en producción se necesitan controles antiabuso adicionales. Los errores públicos se devuelven con CORS, manteniendo las rutas administrativas independientes.

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

Cada sede publica `delivery_pricing_mode='PER_KM'` con una tarifa por kilómetro en línea recta o `delivery_pricing_mode='FIXED'` con un único importe para todo destino cubierto. La cobertura por kilómetros es independiente de la modalidad de precio y se valida siempre. Nunca se cobra un reparto inventado si falta el dato. Se mantiene esta solución provisional hasta aprobar explícitamente una modalidad con distancia por ruta. El servidor no necesita clave de Google Routes para cotizar de esta forma.

## Vacantes de trabajo y WhatsApp

En la administración de cada empresa, `Vacantes` permite guardar un puesto, imagen JPG/PNG/WebP, resumen, descripción, requisitos, horario, modalidad, sede, teléfono de postulación y estado activo/inactivo. Cada cambio queda en borrador hasta pulsar `Publicar` para la app seleccionada. Solo las vacantes activas del tenant se incluyen en `GET /api/v1/mobile/config`, campo `vacancies`. El teléfono requiere formato celular peruano (9 dígitos empezando con 9; el backend normaliza a 51+9 dígitos).

Android ofrece `Mi Cuenta → Trabaja con nosotros` con la lista y los detalles. `Postular por WhatsApp` abre `https://wa.me/<teléfono>?text=<texto>` mediante un puente Android que valida el dominio, teléfono y prefijo del mensaje. Mensaje: `Hola, estoy interesado(a) en trabajar en Pollos B3. Quisiera información sobre la vacante de <PUESTO>.` El envío requiere confirmación manual del solicitante en WhatsApp. No se registran postulaciones ni se transmite información personal al backend.

Antes de desplegar, aplicar `server/schema.sql` en un entorno controlado para crear `job_vacancies`, configurar las imágenes y confirmar los números oficiales de RR. HH. No se han creado vacantes ficticias ni publicado las imágenes de ejemplo como ofertas activas.


## FAQ y Libro de Reclamaciones (Pollos B3 Android)

La app incluye preguntas frecuentes redactadas sin prometer cobros, atención con agentes ni seguimiento de pedidos reales que todavía no están conectados. En `Mi Cuenta → Libro de Reclamaciones`, la aplicación muestra información de derechos del consumidor y abre el enlace HTTPS **del propio proveedor** solo cuando su administrador lo guarda y publica desde `Operación móvil → Libro de Reclamaciones · Enlace oficial` para el `appId` correspondiente. El URL se almacena en `mobile_apps.complaints_book_url` y solo se entrega en el catálogo publicado como `complaintsBookUrl`.

El enlace no es un libro construido por esta app. Debe apuntar a un Libro electrónico real y accesible con identidad del proveedor, hoja numerada, envío/impresión de constancia y procesamiento conforme al reglamento. Si no hay enlace, **no se simula una hoja ni un registro**: se muestra la advertencia y se orienta al consumidor a solicitar el Libro al proveedor. El proveedor debe cumplir además con la exhibición y disponibilidad que exija la normativa vigente. El backend rechaza HTTP, localhost, IP literals y URLs con credenciales. La app abre la URL fuera de su WebView.

La actualización de la columna requiere aplicar el SQL en una base controlada antes de publicar. No se ha desplegado ni configurado un enlace oficial no suministrado por Pollos B3.
