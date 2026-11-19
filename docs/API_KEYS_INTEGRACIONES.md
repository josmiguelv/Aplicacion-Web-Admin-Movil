# API Keys privadas para integraciones externas — INTEGRA B2G

## Qué resuelve

El Super Administrador crea y revoca una clave **por empresa** para consumir las APIs comerciales desde un backend autorizado (integraciones de terceros, servidores asociados a webs, etc.). Las aplicaciones Android y el JavaScript servido a navegadores **NO deben almacenar la clave secreta**. Un `appId` público no equivale a una clave.

Este mecanismo es **distinto e independiente** de las credenciales `tvi_v1_` de TU VERSO; sus permisos, contratos, bases de datos y flujos no se modifican.

## Seguridad

- Generación criptográfica: 32 bytes aleatorios (256 bits), formato `ib2g_sk_v1_<64 hex>`.
- La clave se muestra **una sola vez** en la respuesta a la creación. Copiarla a las variables privadas del backend autorizado. No se permite recuperar la clave original.
- PostgreSQL almacena **solo SHA-256** de la clave de alta entropía y un prefijo de identificación, nunca el secreto.
- Solo un usuario autenticado como `SUPER_ADMIN` puede listar, crear o revocar claves. Las sesiones de `TENANT_ADMIN` no tienen acceso.
- Unicidad por credencial, permisos restringidos por tenant, scope y expiración; auditoría de emisión y revocación.
- Vencimientos disponibles: 30, 90, 180 y 365 días; máximo 50 claves activas por tenant.
- Tras revocar, el bearer deja de ser válido de forma inmediata en nuevas consultas a la base.
- El endpoint S2S no devuelve CORS `Access-Control-Allow-Origin: *` ni cookies. Solo acepta Authorization Bearer.
- Rate limiting básico de 120 solicitudes/minuto por clave **en cada instancia del proceso**. Para producción agregar controles distribuidos en el gateway y protección de abuso.
- Usar HTTPS en entornos accesibles fuera de la máquina local. No registrar tokens ni exponerlos en frontend/variables `VITE_*`.

## Administración

Ruta visual: `Super Administrador → Empresas → [empresa] → API Keys`.

API administrativa:

- `GET /api/admin/tenants/{tenantId}/api-keys`: listado **sin hashes ni secretos**.
- `POST /api/admin/tenants/{tenantId}/api-keys`: requiere sesión SUPER_ADMIN, Origin permitido y JSON. Ejemplo:
  ```json
  {"name":"Servidor del sitio comercial","expiresInDays":90,"scopes":["catalog.read"]}
  ```
  Responde 201 y el campo `key` una sola vez.
- `POST /api/admin/tenants/{tenantId}/api-keys/{keyId}/revoke`: body `{"confirm":true}`. Revoca sin destruir el registro de auditoría.

No se permiten scopes no implementados, como `orders.write`, `payments.write`, `admin.write` o acceso a TU VERSO.

## Consumo desde un backend de confianza

```http
GET /api/v1/integrations/catalog?appId=com.integrab2g.pollosb3
Authorization: Bearer ib2g_sk_v1_<SECRETO_EMITIDO>
Accept: application/json
```

La API valida que la clave esté vigente y no revocada, que su tenant esté activo, que tenga `catalog.read` y que el `appId` publicado pertenezca **al mismo tenant**. Nunca permite consultar catálogos privados de otra empresa. Requiere que el Super Administrador haya registrado la app y que la empresa publique el catálogo.

Errores esperados: 400 appId incorrecto, 401 clave incorrecta/vencida/revocada, 403 scope, 404 catálogo ajeno o no publicado, 429 límite por proceso.

**La API pública Android existente** `GET /api/v1/mobile/config?appId=...` no cambia y sigue entregando solo información publicada. El secreto S2S no se incrusta ni en la APK ni en JavaScript. Para pedidos o recursos privados de usuario, será necesario un mecanismo de identidad de cliente, no la exposición de esta clave.

## Instalación local y despliegue

1. Conservar el contenedor PostgreSQL y su volumen; no recrear bases de datos ni ejecutar `server/schema.sql` completo sobre una base con datos.
2. Aplicar solamente `server/migrations/005-tenant-api-keys.sql` a la base **del administrador**, después de confirmar `DATABASE_URL` y conectividad local.
3. Reiniciar el backend y recargar el administrador. La aplicación no intenta migrar por sí misma.
4. Generar una clave de pruebas para un tenant de pruebas y validar una consulta S2S sobre catálogo previamente publicado; probar también revocación.
5. Nunca ejecutar la migración en TU VERSO o sistemas Android/WEB.
6. Para rotación: emitir nueva clave, instalarla en el servidor consumidor, verificar y revocar la anterior. El frontend de INTEGRA B2G deja de mostrar el secreto al cerrar el mensaje o cambiar de empresa.
7. En producción, evaluar auditoría operacional, almacenamiento seguro de secretos en el consumidor, rate limiting externo, alertas de vencimiento y controles de abuso antes de habilitar integraciones con terceros.

El esquema para una **base nueva** incluye esta tabla al final de `server/schema.sql`.
