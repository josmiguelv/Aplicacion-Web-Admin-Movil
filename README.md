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
- `POST /api/v1/mobile/fulfillment/resolve`: `{appId,mode,latitude,longitude}` para delivery; `{appId,mode,storeId}` para recojo o comer en tienda. Devuelve tienda elegible, pagos disponibles y tarifa de delivery publicada.
- `GET /api/v1/mobile/images/{uuid}`: fotografía **publicada** del catálogo.

No permite crear pedidos ni procesar pagos. Una cotización de delivery usa **distancia geográfica aproximada por radio**, no rutas reales por calles. Configurar zonas poligonales/tiempos de ruta y validar inventario son futuros incrementos. No asigna delivery si no hay GPS/pin confirmado, tienda habilitada y cobertura configurada.

## API administrativa

- Login `POST /api/admin/login` (cookie HttpOnly y SameSite Strict) / logout / me.
- Superadmin: tenants GET/POST, usuarios tenant POST.
- Admin tenant o superadmin: GET/POST `/api/admin/tenants/{tenantId}/stores`, `products`, `promotions`, `payments`, `apps`, `publish`; carga de imágenes binarias JPEG/PNG/WebP (máximo 4 MB) vía `images`.
- Las modificaciones son borradores; solo la acción `publish` cambia la configuración visible en Android.

Controles: tenant determinado por sesión, filtros tenant en operaciones, consultas parametrizadas, contraseñas scrypt, sesión aleatoria de 256 bits hash en BD, expiración 12 h, origen de escrituras validado, auditoría de cambios, imágenes validadas por firma. Revisión recomendada: rate-limiting/antifuerza bruta del login, RLS de PostgreSQL como defensa adicional, controles CSRF con proxy confiable y despliegue endurecido antes de operar.

## Identidad y datos

Las empresas, direcciones, ofertas, productos y pagos **no se presuponen**. Ningún local está activo por defecto. Las fotografías se cargan únicamente a través del administrador autenticado. Los precios reales serán los publicados por cada empresa. No incluir credenciales secretas dentro del APK.