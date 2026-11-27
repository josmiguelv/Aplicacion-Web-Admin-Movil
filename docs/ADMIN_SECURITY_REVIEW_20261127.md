# Auditoría focal de seguridad — Administrador INTEGRA B2G (MVP)
Fecha: 2026-11-27. Rama: `chore/admin-mvp-cleanup-20261127`.

## Alcance y limitación
Se revisaron el router de administración, credenciales, autenticación, sesiones, rutas de imágenes, exposición del catálogo, integraciones y el frontend comercial. Esto es una **revisión estática focal**, no un pentest, una certificación E2E ni una prueba contra producción. No se examinó la infraestructura Railway en ejecución ni secretos/configuración de su cuenta. No se modificó TU VERSO ni Android.

## Controles observados existentes
- Login con `scrypt`; sesión con token aleatorio y hash SHA-256 persistido; cookie `HttpOnly`, `SameSite=Strict`, `Secure` obligatoria con `NODE_ENV=production` (12 horas).
- Escrituras administrativas protegidas por comparación de `Origin` y `ADMIN_ORIGIN`; `tenantOf` restringe empresa y verifica que esté activa.
- Integraciones TU VERSO: credenciales cifradas AES-256-GCM con AAD por tenant/integración; S2S con scopes, vinculación y autorización específica.
- API keys comerciales: valores opacos aleatorios; almacenamiento de hash; expiración y revocación.

## Correcciones realizadas en rama MVP
| Medida | Motivo |
| --- | --- |
| Encabezados `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Resource-Policy` | Protección por defecto para la interfaz y los endpoints |
| Límite local de login: 8/min por IP+correo y 40/min por IP | Reducir intentos automatizados y rotación de correo (por proceso) |
| Lectura de URL en `try` usando base fija, no `Host` recibido | Evitar que un encabezado Host malformado provoque errores fuera del controlador |
| Recursos públicos de imágenes con excepción `CORP: cross-origin` | Mantener compatibilidad Android/TU VERSO sin abrir todo el panel |
| Carga y visualización de sedes/promociones/apps ligada al tenant | Reducir mezcla temporal de datos entre empresas en navegación |
| Ignorar respuestas de refresco de empresa anterior | Evitar sobrescritura asíncrona del estado al cambiar de tenant |
| Estado de publicación consultable por empresa/app autorizada | Evitar afirmar una publicación a partir de un guardado; ninguna API pública nueva |

## Riesgos abiertos (no alterados sin pruebas de compatibilidad)
**ALTO — imágenes de comprobantes de pago:** `GET /api/v1/mobile/payment-receipts/images/{uuid}` utiliza un identificador aleatorio como URL portadora y no verifica sesión, autorización ni expiración. Cualquier persona que consiga la URL puede abrir el comprobante mientras exista. Definir caducidad/firma o proxy autenticado y validar con TU VERSO antes de cambiar el contrato. Considerar privacidad/retención y acceso en logs.

**MEDIO — rate limiting distribuido:** los contadores de login y varias rutas móviles están en memoria; no protegen de forma global si hay varias réplicas. Definir un límite compartido en gateway/WAF y revisar el IP efectivo detrás de Railway; no confiar sin comprobación en cabeceras IP reenviadas.

**MEDIO — política CSP:** faltan reglas CSP específicas para el portal real; se debe planificar junto con las imágenes externas, fuentes e inline styles para evitar romper formularios o previsualizaciones.

**MEDIO — verificación de imágenes publicadas:** el router de imágenes busca cadenas en el JSON publicado con `LIKE`. Conviene sustituirlo por un índice/relación explícita de recursos o comparación de URL exacta, con pruebas de productos, combos, pagos, promociones y vacantes.

**MEDIO — límites de carga de imágenes:** hay límite de tamaño y detección por cabecera; para una exposición pública amplia, añadir validación/normalización real del archivo y tratamiento de metadatos, en una tarea aislada.

**OPERATIVO — configuración y permisos:** confirmar `ADMIN_ORIGIN` HTTPS, cookies seguras, red privada de PostgreSQL, gestión/rotación de `INTEGRATION_MASTER_KEY`, CORS del público, logs sin secretos y permisos de Railway antes del GO.

## Pruebas focalizadas
- Se añadió `server/mvp-cleanup.test.mjs` para mapping de promociones, headers, límites de login y consulta de publicación ligada a tenant.
- Verificaciones de lógica pura ejecutadas en un evaluador JS aislado: 18 aserciones correctas; **no equivalen al `node --test` del repositorio ni a pruebas HTTP/BD/producción**.
- Pendiente en un checkout local con dependencias instaladas: `node --test server/mvp-cleanup.test.mjs`, `node --check server/index.mjs`, `pnpm install --frozen-lockfile`, `pnpm build` y comprobación visual puntual del panel.
- No ejecutar tests destructivos o el smoke de datos ficticios contra una BD real.

## Estado para MVP
**Candidato, NO-GO de certificación:** compilación e integración no verificadas. Evaluar privacidad de comprobantes y controles de acceso antes de exponerlos comercialmente. No fusionar a la rama estable ni desplegar hasta aprobar las verificaciones focales.
