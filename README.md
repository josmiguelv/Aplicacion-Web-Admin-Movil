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
