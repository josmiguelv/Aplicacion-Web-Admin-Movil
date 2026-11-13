# Plan de implementación — INTEGRA B2G

## Alcance aprobado

Construir una primera entrega visual e interactiva de la plataforma de administración comercial multitenant descrita en el brief. Esta fase es un **prototipo frontend**: no se conecta a información real ni a servicios de terceros; sus interacciones son temporales en memoria del navegador, no se guardan al recargar. No se habilitarán servicios gestionados, no se ejecutarán migraciones, no se alterará infraestructura ni se desplegará en producción. No se inventarán productos, promociones, sucursales, credenciales, métricas o actividad de Pollos B3. Los estados vacíos reflejarán que la fuente de datos real aún no está conectada. La interfaz no afirmará que la autenticación, autorización, seguridad o aislamiento entre empresas ya estén implementados.

La aplicación debe dejar claros los límites del prototipo y, al mismo tiempo, presentar la estructura modular necesaria para evolucionar a la plataforma completa solicitada. TU VERSO se mantiene como producto separado; no se intentará conectar ni modificarlo.

## Enfoque de implementación

- **Frontend:** React + TypeScript, Vite para el servidor de desarrollo y compilación estática, React Router para rutas de módulos, CSS propio con tokens para el sistema visual y Lucide para iconografía uniforme. Mantener las dependencias ligeras y fijadas en el manifiesto/lockfile.
- **Estructura funcional:** componentes de navegación y controles compartidos; páginas por módulo; formularios con validación básica en cliente; estado de prototipo en memoria; tipos de dominio que separen tenant, rol, canal, catálogo, producto, promoción, tienda/aplicación e integración. No almacenar datos de negocio en localStorage ni credenciales en el cliente.
- **Arquitectura futura, no implementada en esta fase:** backend modular con API REST versionada `/api/v1`, resolución de tenant a partir de sesión/autorización del servidor, PostgreSQL para datos estructurados, almacenamiento de objetos para imágenes y gestor de secretos. El `app_id` y cualquier identificador de cliente no serán considerados credenciales. Pasarelas e integraciones quedan sin conectar y sin asumir capacidades de Bitdish.
- **Ejecución:** iniciar el servidor de desarrollo únicamente después de que la aplicación tenga contenido utilizable; escuchar en el puerto 3000 del entorno y servir `public/manus-routes.json` de manera estática. Validar TypeScript, compilación y el JSON de rutas. No activar publicación de producción.

## Vistas y flujos

La navegación es superior, horizontal y responsive; no habrá sidebar permanente. El selector de empresa solo aparecerá en la vista de superadministración; la navegación visible se adaptará al rol de demostración. Un indicador persistente identificará el entorno como prototipo.

- **Inicio comercial:** orientación hacia tareas de configuración y acceso a módulos, sin KPIs decorativos, eventos ni métricas inventados.
- **Catálogo:** productos (lista/estado vacío, búsqueda, alta y edición rápida de precio), creación/edición, selección de imágenes con vista previa local, categorías, combos y complementos. El modelo inicial está vacío; los cambios introducidos por el usuario duran solo durante la sesión.
- **Promociones y contenido:** descuentos, combos promocionales, banners y destacados mediante pestañas y formularios; no incluir promociones precargadas. Fechas, canales y política de acumulación tendrán campos explícitos.
- **Tiendas y configuración comercial:** horarios por día, America/Lima, disponibilidad y modalidades de entrega/recojo, sin inventar dirección ni sucursales. Secciones de pagos sin campos para credenciales privadas ni conexión de proveedor.
- **Publicación:** representar visiblemente la secuencia «Editar → Guardar borrador → Vista previa → Publicar», selector de canales, vistas previa web/móvil e historial. Las acciones de guardar/publicar se presentarán como simulación local, no como publicación a consumidores reales.
- **Aplicaciones e integraciones:** vistas de registro de aplicación/canales y estado. Bitdish se mostrará como conector previsto no configurado; TU VERSO se describirá como producto separado. No se simulará una conexión verificada.
- **Superadministración:** acceso de demostración a vista general, empresas (lista/crear/detalle sin persistencia), aplicaciones, canales, integraciones, accesos y auditoría. Cambiar de rol será una ayuda de prototipado, no una capacidad de autorización real.

## Sistema de diseño

- **Movimiento:** utilitarismo editorial contemporáneo para software comercial, con una disciplina tipográfica inspirada en el diseño suizo y la claridad de herramientas de comercio de alta gama, sin imitar marcas concretas.
- **Principios:** información antes que decoración; estados y acciones inequívocos; densidad cómoda y útil; misma lógica y accesibilidad en escritorio y móvil.
- **Color:** fondos marfil y blanco cálido para lectura prolongada, tinta carbón para jerarquía, divisores neutros discretos. Verde pino `#28664F` como color propio para acciones primarias y estados positivos, sin usarlo como adorno; los avisos y errores usarán semántica legible y sobria.
- **Paradigma de layout:** cinta de navegación superior y área de trabajo ancha con título editorial, controles de contexto y un área principal funcional. La composición se organiza por encabezados, listas y superficies de trabajo, no por una cuadrícula de tarjetas KPI. En móvil, la navegación se vuelve menú desplegable superior y las tablas se transforman en filas apiladas.
- **Motivos de firma:** marca geométrica INTEGRA de trazos ortogonales; líneas finas de sección que ordenan el contenido; una columna de estado alineada con cada entidad comercial.
- **Interacción y accesibilidad:** foco visible, teclado operativo, etiquetas persistentes, errores junto al campo, objetivos táctiles generosos, contraste adecuado y estados disabled/loading. Respetar `prefers-reduced-motion`; transiciones breves y discretas solo para mostrar apertura/cambio de estado.
- **Tipografía:** Inter para interfaz, con escala contenida y jerarquía diferenciada entre títulos, metadatos y valores; números/precios con cifras tabulares cuando estén disponibles.
- **Esencia:** una consola comercial compartida que ordena el contenido de cada empresa y sus canales; personalidad precisa, confiable y tranquila.
- **Voz:** directa, útil y sin promesas técnicas no realizadas. Ejemplos: «Aún no hay productos en este catálogo.» y «La publicación se simula en este prototipo; no modifica canales reales.»
- **Wordmark:** símbolo de cuatro trazos ortogonales formando una “I” modular, junto al wordmark INTEGRA; B2G en segundo nivel, nunca como emblema grande decorativo.
- **Color distintivo:** verde pino `#28664F`.

## Estructura del proyecto

```text
public/
  manus-routes.json       # rutas visibles de la aplicación
  favicon.svg             # marca compacta
src/
  app/                    # router y composición global
  components/             # navegación, campos, tablas/listas, diálogos y estados
  modules/                # inicio, catálogo, promociones, publicación, apps,
                          # integraciones, configuración y superadministración
  state/                  # estado temporal de prototipo en memoria
  domain/                 # tipos de dominio frontend, sin persistencia ni secretos
  styles/                 # tokens, estilos globales y componentes responsive
plan.md                   # este plan
TODO.md                   # criterios de alcance aprobado
app.config.ts             # metadatos de marca de plataforma antes del checkpoint
```

## Flujo de construcción y entrega

1. Aprobar este plan antes de escribir la aplicación.
2. Mantener las comprobaciones TypeScript de proyecto configuradas y actualizar `TODO.md` con los criterios explícitos del alcance acordado.
3. Inicializar el frontend y el manifiesto de rutas; crear navegación, tokens y páginas responsivas; implementar formularios e interacciones locales claramente rotuladas como simulación.
4. Ejecutar diagnósticos TypeScript, compilación y comprobación HTTP del manifiesto `/manus-routes.json`; iniciar Preview y corregir problemas de diseño o ruta observados.
5. Revisar requisitos y límites del prototipo con una inspección independiente de solo lectura. Preparar un checkpoint de código solo si la configuración confirma que no disparará publicación automática; no ejecutar publicación ni tocar sistemas de producción.