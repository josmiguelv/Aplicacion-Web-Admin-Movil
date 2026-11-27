# Auditoría de limpieza y preparación MVP — Administrador INTEGRA B2G
**Fecha:** 2026-11-27
**Rama aislada:** `chore/admin-mvp-cleanup-20261127`
**Punto de partida:** `72b214a40197f2237445f9f0dd460dba0a41e3b3` de `consolidate/admin-reservations-payment-api-20261124`.

## Alcance y resguardo
- Cambios limitados al repositorio `josmiguelv/Aplicacion-Web-Admin-Movil`.
- No se alteró el proyecto ni la base de TU VERSO, ni Android ni la infraestructura Railway.
- No se modificaron contratos de endpoints, algoritmos de pedidos o pagos, tablas ni migraciones.
- La rama estable no recibió estos cambios. No hay despliegue ni migración ejecutada en este trabajo.

## Eliminaciones comprobadas por dependencia
| Elemento | Motivo | Verificación estática |
| --- | --- | --- |
| `src/app/App.tsx` | SPA ficticia anterior, con datos efímeros y controles de demostración | `src/main.tsx` monta `AdminPortal`, no importa `App.tsx` |
| `src/domain/types.ts` | DTO de roles/productos ficticios usado por la SPA anterior | Los módulos activos tienen tipos propios y no importan ese archivo |
| `public/manus-routes.json` | Rutas de navegación de la SPA descartada | La UI actual no consume ese recurso |
| `app.config.ts` | Configuración visual externa de la herramienta anterior | No forma parte del punto de entrada ni de la configuración de Vite actual |
| `TODO.md`, `plan.md` | Planes de prototipo no operativos | La documentación técnica activa vive en `docs/` y documentos operativos |
| Reglas de estilo del prototipo en `src/styles/global.css` | Clases de vistas y navegación eliminadas | Se conservaron base/reset, controles compartidos y estilos `ops-*` del portal real |

La reducción aproximada del CSS fuente es de **42 197 bytes**. No implica por sí sola una reducción equivalente del bundle comprimido.

## Componentes conservados deliberadamente
- Portal autenticado `src/app/AdminPortal.tsx` y sus secciones comerciales.
- `server/index.mjs`, los módulos de dominio, API pública móvil y TU VERSO.
- PostgreSQL, esquema y migraciones 001–024. **No ejecutar** migraciones solo por este cambio de limpieza.
- Pruebas `*.test.mjs`, `server/smoke.mjs` y simuladores de Postman **exclusivos de pruebas**; no son contenido publicado para clientes.
- `vite.config.ts` sin cambios para no afectar configuraciones locales de túnel existentes. El host de desarrollo predefinido debe revisarse antes de compartir un entorno nuevo.

## Riesgos que NO se deben confundir con código de demostración
1. La cotización en `server/index.mjs` usa distancia geográfica en línea recta para ciertos presupuestos de Delivery y retorna el campo `routeDistanceKm`. Es comportamiento existente: no cambiar la fórmula silenciosamente durante limpieza; certificar su significado antes de salida comercial.
2. La publicación lee el esquema de promociones ligado a producto (migración 024). Comprobar por separado que esa migración esté aplicada **en la BD correcta** antes de utilizar la funcionalidad; no se aplicó aquí.
3. Los límites por IP en memoria no equivalen a rate limiting distribuido en múltiples réplicas.
4. Confirmar las variables necesarias de producción, permisos de tenant, origen/cookie HTTPS, integración autorizada, observabilidad y contratos Android antes de declarar GO.
5. Los documentos anteriores reflejan etapas históricas; no deben sustituir la verificación del código y despliegue actual.

## Pruebas focales requeridas (no ejecutadas en esta sesión)
En una copia local de la rama, con dependencias instaladas:
```powershell
pnpm build
node --check server/index.mjs
```
Inspecciones manuales estrictamente ligadas a esta limpieza:
- Verificar apertura de login real, acceso al portal por rol y carga de operaciones comerciales.
- Revisar que no aparezca interfaz ficticia ni rutas de prototipo.
- Comprobar visualmente botones, campos y diálogos que usan `global.css`, en escritorio y móvil.
- No ejecutar `server/smoke.mjs` contra datos reales: utiliza registros ficticios y es solamente para una base aislada.

## Criterio de promoción a MVP
**Todavía sin certificar:** esta rama constituye un candidato de limpieza; requiere aprobar el build y la inspección visual focal antes de integrar a la rama estable. No es un despliegue de producción.
