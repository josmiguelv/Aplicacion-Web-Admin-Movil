# TODO — INTEGRA B2G

Los criterios siguientes distinguen lo que corresponde a este prototipo frontend de capacidades que solo podrán considerarse terminadas cuando se autorice e implemente un backend real. Ningún estado, cifra o integración simulada debe presentarse como dato real del negocio.

## 1. Sistema visual, navegación superior y experiencia adaptable — En curso (interfaz implementada; revisión WCAG pendiente)
- [x] La interfaz debe transmitir una experiencia comercial profesional, sobria, precisa, elegante y reconocible, con escala tipográfica coherente, paleta neutra, un color primario moderado, espaciado consistente, bordes sutiles, sombras discretas solo cuando aporten profundidad, radios moderados e iconografía uniforme.
- [x] No debe utilizar navegación lateral como principal ni una barra lateral permanente en tablets; tampoco dashboard genérico, tarjetas KPI decorativas, degradados morados/azules/multicolor sin justificación, glow, glassmorphism decorativo, radios excesivos, sombras exageradas, íconos enormes, emojis, exceso de badges, colores sin jerarquía, espacio vacío artificial, tablas comprimidas, texto de plantilla, gráficos sin utilidad o animación innecesaria.
- [x] La navegación principal será horizontal superior y adaptativa: marca INTEGRA; selector de empresa solo para usuarios autorizados; Inicio, Catálogo, Promociones, Publicación, Aplicaciones, Integraciones y Configuración, filtrados según el rol; estado de publicación, perfil y menú de usuario. En móvil deberá existir menú compacto o desplegable superior.
- [x] La aplicación debe componerse apropiadamente para escritorio, laptop, tablet, Android e iPhone, sin desplazamiento horizontal accidental; los formularios se reorganizarán a una columna, los controles serán táctiles, las tablas pasarán a listas cuando corresponda y habrá edición rápida de precios y selección de imágenes desde galería/cámara cuando el navegador lo permita.
- [ ] La interfaz debe perseguir WCAG 2.2 AA: contraste adecuado, foco visible, controles etiquetados, estados hover/focus/loading/disabled/error y soporte para movimiento reducido.
- [x] Todas las vistas mantendrán consistencia visual. El prototipo debe identificar claramente que aún no está conectado a datos o publicación reales.

## 2. Administración del catálogo y contenido comercial — En curso
- [ ] El módulo Catálogo debe presentar categorías y productos, permitir búsqueda/navegación, alta y edición demostrativa, cambio rápido del precio en S/, nombres y descripciones, imagen principal y fotos secundarias, orden, visibilidad, disponibilidad, duplicación y archivo.
- [ ] El flujo de demostración incluirá selección/preview local de imágenes y secciones visibles para combos y complementos. La experiencia de imágenes está prevista para admitir carga múltiple, vista previa, recorte, optimización, eliminación, reordenamiento, selección de imagen principal y validación de tipo/tamaño; mientras no exista almacenamiento real, deberá declararse como preview local y no persistirse en Base64 ni en el backend.
- [x] El catálogo permitirá guardar cambios únicamente como estado local temporal del prototipo; deberá quedar explícito que no hay persistencia y no se consumen estos datos desde una web pública o app real.
- [ ] El módulo Promociones debe mostrar formularios para descuentos porcentuales, descuentos fijos, precios especiales, promoción por producto/categoría, combos promocionales, cupones si están habilitados, banners y productos destacados. Cada promoción debe admitir ID, nombre, descripción, condiciones, participantes, inicio, término, canales, estado de publicación y política de acumulación.
- [ ] No se crearán promociones ficticias como datos reales de Pollos B3; la lista parte vacía y las promociones expiradas solo podrán dejar de aplicarse automáticamente cuando exista el servicio backend real.

## 3. Tiendas, horarios y configuración comercial — En curso
- [ ] Los ajustes deben contemplar horarios por día, horarios especiales, suspensión temporal, disponibilidad de delivery y recojo, mensajes de cierre y horarios diferenciados por modalidad cuando corresponda.
- [ ] Para Pollos B3, si se muestra zona horaria, usar America/Lima. No inventar dirección, establecimientos ni sucursales.
- [ ] Pagos deberá representar selección futura de proveedor y entorno sandbox/producción, IDs públicos, métodos compatibles, verificación, webhooks y eventos/errores técnicos sin pedir, exponer ni almacenar credenciales privadas en el navegador.
- [ ] No se integrará una pasarela específica antes de seleccionar y verificar documentación oficial; no almacenar números completos de tarjeta ni CVV; no permitir que móvil confirme unilateralmente pagos; no desarrollar caja ni contabilidad.

## 4. Publicación multicanal, vistas previas e historial — Interfaz de simulación implementada; conexión real pendiente
- [ ] El catálogo centralizado debe mostrarse preparado para web, Android, iOS y canales futuros. Cada producto/promoción podrá indicar canales habilitados; por defecto se prevén todos los canales autorizados.
- [x] El flujo de interfaz debe conservar esta secuencia explícita: Editar → Guardar borrador → Vista previa → Publicar. La publicación deberá mostrarse como simulación local y no podrá afirmar que cambió un canal externo o que el contenido está disponible al público.
- [x] Las vistas deben incluir previews web/móvil, selector de canal, versión identificable e historial de publicaciones; sin backend quedará explícito que la vista previa y el guardado no tienen efecto real.
- [ ] En la arquitectura futura, web/apps consumirán exclusivamente datos publicados; cambios de precios, fotos y promociones no requerirán recompilar el APK; caché e invalidación deberán reflejar actualizaciones oportunamente.

## 5. Empresas, aplicaciones, roles y canales — Vistas de superadministración en prototipo; backend no implementado
- [x] Las vistas de superadministrador deben cubrir inicio general, empresas, creación y detalle, aplicaciones registradas, canales de publicación, integraciones habilitadas, accesos/permisos y auditoría. Las acciones presentadas en este prototipo no otorgarán seguridad ni persistencia real.
- [ ] Las vistas del administrador de empresa deben cubrir inicio comercial, productos, creación/edición, biblioteca de imágenes, categorías, combos, complementos, promociones/creación, banners, horarios, disponibilidad, preview web/móvil, publicación e historial, pagos, integraciones externas y configuración de empresa.
- [ ] El modelo futuro debe incluir Tenant, TenantUser, UserRole, Application, PublicationChannel, Catalog, Category, Product, ProductImage, ProductOption, Combo, Promotion, Banner, Store, StoreHours, PaymentConfiguration, ExternalIntegration, ExternalProductReference, CatalogPublication y AuditLog.
- [ ] Cada empresa debe tener identificador interno único; cada app su propio app_id y cada canal un identificador independiente. app_id no es credencial de seguridad.
- [ ] Superadministrador INTEGRA podrá crear/suspender empresas, registrar apps y dominios web autorizados, configurar canales, habilitar integraciones, consultar estados técnicos, administrar administradores/permisos y revisar auditoría. Acceso de soporte autorizado y auditado; no acceso indiscriminado a datos sensibles de clientes.
- [ ] Administrador Pollos B3 solo podrá administrar productos, precios, imágenes, categorías, combos, promociones, banners, horarios, disponibilidad, publicación, métodos de pago e integraciones habilitadas de su empresa; no podrá acceder a otros negocios.
- [ ] El backend deberá autenticar y validar autorización y pertenencia al tenant para toda operación protegida, resolver permisos en servidor y no confiar en IDs del cliente. Debe probarse que un admin de Pollos B3 no pueda leer o cambiar productos de otro tenant manipulando URL/API.

## 6. Aplicaciones, integraciones externas y relación con TU VERSO — En curso (presentación), no implementado (conectividad)
- [ ] El módulo Aplicaciones representará app_id interno, empresa propietaria, nombre público, plataforma Android/iOS, identificador de paquete, estado, versión mínima, canal, identidad visual, configuración pública permitida e integraciones habilitadas; administra la relación app-catálogo. No compilar APK en esta fase.
- [ ] El módulo Integraciones reflejará que Bitdish es un conector previsto cuya API/capacidades aún no se presuponen; mostrar configuración/estado no conectado y preparar importación de productos, precios, categorías, promociones, referencias externas, errores, revisión previa y sincronización autorizada.
- [ ] La conectividad futura deberá soportar datos por API/webhooks o consulta programada, según capacidades verificadas; autenticación, idempotencia, prevención de duplicados, origen, política de conflictos, fuente autorizada por campo, reintentos seguros, auditoría y validación de esquemas. Datos externos no deben sobrescribir cambios locales sin política aprobada.
- [ ] TU VERSO mantiene atención vía chat, agentes, conversaciones, enrutamiento y seguimiento de consultas. No administra el catálogo. La app podrá integrar un canal de atención que deberá desarrollarse y validarse. Ambos productos quedan desacoplados; interrupción de chat no debe impedir consultar catálogo o funciones comerciales. No modificar servicios actuales.

## 7. API pública y persistencia segura — No implementado en backend
- [ ] La futura API REST versionada debe exponer `GET /api/v1/catalog`, `/products`, `/categories`, `/promotions`, `/banners`, `/stores`, `/stores/{id}/hours` y `/catalog/version`, con contrato OpenAPI y resolución de empresa/canal autorizado.
- [ ] Aplicar validación de entrada, paginación, caché controlada, límites de solicitudes, respuestas consistentes, manejo de errores y control de versiones; no exponer datos administrativos ni credenciales en endpoints públicos.
- [ ] Aislamiento estricto por tenant; autenticar/autorizar en cada operación protegida; proteger sesiones, validar pertenencia en servidor y auditar modificaciones críticas. Almacenamiento de objetos para imágenes (no registros Base64 en base de datos); secretos mediante sistema seguro; planes de respaldo y recuperación.
- [ ] Sin ejecución de migraciones, cambios de infraestructura o despliegue a producción sin autorización expresa.

## 8. Validación del prototipo y preparación de entrega — En curso (auditoría WCAG pendiente)
- [x] La web debe compilar y mostrar rutas consistentes en escritorio y móvil; el manifiesto estático `GET /manus-routes.json` debe declarar las páginas reales.
- [ ] Revisar formularios, estados vacíos y transiciones simuladas, y corregir problemas confirmados de tipado, responsive y accesibilidad.
- [x] Realizar revisión independiente de solo lectura de la implementación frente a este TODO y resolver problemas confirmados.
- [ ] No marcar como realizadas las capacidades de backend, aislamiento multitenant, autenticación, almacenamiento durable, API, conectividad de pagos, Bitdish, sincronización, publicación real, caché, APK o TU VERSO.
- [ ] No desplegar en producción ni modificar los servicios actuales de TU VERSO.