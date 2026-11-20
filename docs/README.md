# Documentación técnica del Administrador INTEGRA B2G

Este conjunto documenta el repositorio `josmiguelv/Aplicacion-Web-Admin-Movil`. El producto es una plataforma SaaS multitenant de INTEGRA B2G; Pollos B3 es un tenant potencial, no una dependencia ni una configuración inicial fija.

## Índice

| Documento | Consultar para |
| --- | --- |
| [Arquitectura del Administrador](ARQUITECTURA_ADMINISTRADOR_SAAS.md) | Componentes, límites de confianza, roles, flujo de publicación e integración entre backend, PostgreSQL y consumidores. |
| [Mapa de componentes y riesgos](MAPA_COMPONENTES_Y_RIESGOS.md) | Encontrar dónde cambiar una función, qué archivos revisar, qué dependencias pueden romperse y qué validación focal ejecutar. |
| [API Keys de integraciones](API_KEYS_INTEGRACIONES.md) | Emitir, usar o revocar claves S2S del Administrador y consultar catálogos publicados. |
| [Integraciones TU VERSO](TUVERSO_INTEGRACIONES.md) | Configuración por tenant, custodia de credenciales, vínculos a sedes y límites de las llamadas S2S. |
| [API de validación de pedidos](MOBILE_ORDER_AVAILABILITY_API.md) | Contrato móvil, estados, errores, migración 006 y ejecución local de la API. |

## Por dónde empezar

- **Añadir o cambiar una pantalla:** revisar el mapa de componentes, la sesión que la contiene y el endpoint backend correspondiente.
- **Añadir un campo persistente:** revisar el modelo en `server/schema.sql`, preparar migración aditiva para bases existentes, validar tenant y actualizar el catálogo publicado si el campo es consumido por una app.
- **Cambiar un endpoint público:** revisar el contrato API específico, autenticación, CORS, idempotencia, rate limit y los consumidores existentes.
- **Cambiar una integración TU VERSO:** revisar la arquitectura y `TUVERSO_INTEGRACIONES.md`; no exponer tokens al frontend y no habilitar llamadas reales por defecto.
- **Cambiar aislamiento de empresas:** revisar `tenantOf`, consultas SQL, claves foráneas compuestas y pruebas con tenants distintos.
- **Preparar una ejecución local:** seguir la sección de instalación de `MOBILE_ORDER_AVAILABILITY_API.md` y usar solo la base local del Administrador.

## Estado documentado al 20-11-2026

- El portal y el backend están en desarrollo; este repositorio no se considera certificado para producción.
- El contrato de validación de disponibilidad está implementado en la rama `feat/multitenant-mobile-order-availability`. La compilación de CI y las pruebas focalizadas registradas para esa rama aprobaron.
- La migración 006 y el arranque local con PostgreSQL no se han verificado en el equipo del usuario. No hay evidencia de una prueba E2E con TU VERSO ni de integración de una aplicación móvil.
- El módulo TU VERSO del Administrador y las APIs públicas comerciales pertenecen a este repositorio. TU VERSO mantiene su propio repositorio, base y despliegue; este conjunto no describe ni modifica ese proyecto.
- Las claves S2S de catálogo del Administrador (`ib2g_sk_v1_`) son distintas de las credenciales de TU VERSO. Ninguna clave privada debe ir en APK, navegador, logs ni repositorio.

## Cómo mantener esta documentación

Al cambiar código, actualizar el documento del contrato o módulo afectado en el mismo cambio. Dejar explícitos los consumidores, tenant ownership, variables requeridas, migraciones, pruebas focales, limitaciones actuales y si la capacidad está implementada, desplegada o certificada E2E. No describir un despliegue ni una prueba real que no se haya observado.
