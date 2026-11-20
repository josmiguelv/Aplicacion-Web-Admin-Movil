# Pollos B3 — preparación para Railway

## Estado y límites
Esta rama prepara el empaquetado y los controles básicos de arranque. **No se ha desplegado** ni se ha certificado para clientes. La Web Admin administra el catálogo y la configuración; **no recibe pedidos reales, no procesa pagos y no se integra todavía con TU VERSO**.

Mantener este sistema separado de TU VERSO: proyecto Railway propio y PostgreSQL 17 propio. No reutilizar la base de datos, redes internas con secretos ni variables de TU VERSO. Namecheap puede gestionar el DNS del subdominio que se elija posteriormente.

## Construcción
- Docker multietapa con Node.js 22 y pnpm 11.25.0 (Corepack).
- El builder instala dependencias según `pnpm-lock.yaml` y compila `dist/`.
- El contenedor de ejecución instala dependencias de producción y sirve UI + API con `node server/index.mjs`, escuchando `PORT` de Railway.
- `/health/live`: proceso respondiendo, sin consultar BD.
- `/health/ready`: consulta `SELECT 1` a PostgreSQL; devuelve 503 si no está accesible.
- Railway utiliza la segunda ruta para su healthcheck. No exponer secretos en endpoints de salud.

## Pasos previos a publicar (NO ejecutar hasta aprobar)
1. Crear un **proyecto Railway nuevo**, separado del proyecto de TU VERSO.
2. Crear un **PostgreSQL 17 nuevo** dentro de ese proyecto, privado.
3. Revisar `server/schema.sql` con DBA. En base **vacía** aplicar el esquema; para una base preexistente revisar y planificar las sentencias `ALTER`, sin asumir que `CREATE TABLE IF NOT EXISTS` migra columnas. Evitar automatizar migraciones al iniciar contenedores.
4. Configurar el servicio desde este repositorio/branch. Usar variables de servidor:
   - `DATABASE_URL`: referencia a conexión **privada** del PostgreSQL propio.
   - `NODE_ENV=production`.
   - `ADMIN_ORIGIN=https://<subdominio-elegido>`: origen HTTPS exacto, sin ruta ni slash final.
   - `COOKIE_SECURE=true`.
   - `PORT`: Railway proporciona el puerto; **no es necesario forzarlo**.
   - `GOOGLE_ROUTES_API_KEY`: opcional hasta habilitar cotizaciones delivery reales; restringir la clave y controlar cuotas.
   - `ALLOWED_ORIGINS`: revisar solo si clientes externos requieren CORS. No ampliar accesos administrativos.
5. Crear el Super Administrador **una sola vez** con `pnpm bootstrap:admin` desde un proceso seguro conectado a la BD privada. Nunca almacenar claves de bootstrap en GitHub ni persistir `BOOTSTRAP_ADMIN_PASSWORD` en el servicio web.
6. Verificar arranque, `/health/live`, `/health/ready`, sesión de administrador, publicación de un catálogo de prueba, separación entre tenants e imágenes.
7. Configurar dominio/HTTPS en Railway y registro DNS en Namecheap. Confirmar el origen HTTPS definitivo **antes** de habilitar login porque `ADMIN_ORIGIN` limita escrituras y cookies.
8. Aplicar controles de producción pendientes: rate limiting distribuido ante ataques a login/API, revisión de seguridad del proxy/CSRF, políticas y pruebas de restauración de backups, supervisión y alertas, cuotas Google Routes, revisión de seguridad y cumplimiento legal.

## No-GO explícitos
- No utilizar la Web Admin como gestor de pedidos/pagos reales: endpoints inexistentes.
- No exponer PostgreSQL a Internet público.
- No conectar datos de otras empresas ni datos reales hasta revisar controles multitenant.
- No conectarla al proyecto productivo `marvelous-acceptance` de TU VERSO.
- No publicar mientras no se hayan completado las validaciones pendientes.

## Verificación local (sin despliegue)
```bash
pnpm install --frozen-lockfile
pnpm build
node --check server/index.mjs
docker build -t pollos-b3-admin:prep .
```
Con una base de pruebas poblada, `GET /health/ready` debe devolver HTTP 200; sin base disponible debe devolver 503.
