# Plataforma administrativa multitenant — INTEGRA B2G

## Objetivo

El repositorio es una plataforma SaaS de administración comercial, inicialmente orientada a restaurantes. **No pertenece a Pollos B3**: Pollos B3 será una de las empresas (tenants) que el Super Administrador podrá registrar, igual que otros negocios. No se crea automáticamente ni tiene privilegios especiales.

## Fronteras y perfiles

- **SUPER_ADMIN**: usuario de plataforma autenticado por la API y habilitado para listar y crear empresas, crear administradores de empresa y administrar recursos autorizados. El frontend no permite elegir ni suplantar este rol.
- **TENANT_ADMIN**: usuario asignado a una empresa concreta; el backend determina su tenant y bloquea acceso a los demás.
- **Empresas/tenants**: poseen sus propios locales, catálogo, precios, promociones, métodos de pago, recursos publicados y aplicaciones.
- **Aplicaciones**: móviles, webs comerciales y, cuando se integren, terceros consumen contratos autorizados. Un appId público NO es una credencial para datos privados.
- **TU VERSO**: producto independiente, con sus propios tenants, cuentas de canal, flujos y colas. La futura vinculación será exclusivamente mediante contratos API autorizados servidor-a-servidor. El backend comercial mantiene catálogo, precios, pedidos y logística.

## Estado de interfaz y compatibilidad

El punto de entrada activo es src/app/AdminPortal.tsx, con login real (POST /api/admin/login, GET /api/admin/me, POST /api/admin/logout) y gestión persistente de empresas (GET/POST /api/admin/tenants). Después del acceso, Operación comercial permite administrar los datos del tenant seleccionado.

src/app/App.tsx se conserva temporalmente como **prototipo visual anterior**, sin ser importado por el punto de entrada activo. Su selector de rol y su empresa Pollos B3 de demostración NO son cuentas reales ni participan de la seguridad. No se exponen en el portal autenticado.

El backend mantiene identificadores históricos por compatibilidad, como b3sid y b3_catalog; no restringen el SaaS a una empresa. El contrato existente /api/v1/mobile/config corresponde al piloto de catálogo Android. Este cambio no implementa todavía APIs operativas WEB ni pedidos/pagos reales.

## Alta de una empresa

1. Iniciar sesión con SUPER_ADMIN creado de forma segura usando pnpm bootstrap:admin.
2. Crear empresa en Empresas. El backend devuelve su UUID y almacena el tenant en PostgreSQL.
3. Crear un administrador vinculado exclusivamente a esa empresa, cuando corresponda.
4. Abrir Configuración comercial; registrar su app y configurar su catálogo y locales.
5. Integrar TU VERSO solo cuando la cuenta de canal, Flow, cola, licencia, credencial y habilitación hayan sido certificados.

## Alcance excluido

No se modifica el repositorio Android, la web comercial, el código o producción Railway de TU VERSO ni se crean empresas ficticias en la base de datos. No se emiten credenciales TU VERSO ni se habilitan interacciones externas.

## Estado TU VERSO del documento técnico 18-11-2026

Fase 1A publicada; Fase 1B desplegada pero deshabilitada; transporte end-to-end MOBILE_APP y WEB sin certificación. El estado documentado no sustituye una verificación en producción.
