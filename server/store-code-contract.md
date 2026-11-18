# Identificador visible de sede

`GET /api/admin/tenants/:tenantId/stores` incluye `code`, el ID visible
inmutable, además de `id`, el UUID técnico existente.

`POST /api/admin/tenants/:tenantId/stores` permite `code` al crear:
entre 2 y 80 caracteres, letras ASCII minúsculas y números separados por
guiones simples, por ejemplo `b3-nogales`. Es único dentro de la empresa.
Duplicados devuelven 409 y formatos incorrectos 400. Para clientes históricos
que omiten code, el servidor genera `sede-<UUID>`.

Para editar se conserva el campo `id` UUID. Si se envía `code`, debe coincidir
con el almacenado; cambiarlo devuelve 400. Omitirlo conserva su valor.
Un UUID inválido devuelve 400, nunca crea otra sede. Un UUID ajeno o inexistente
no permite editar y devuelve 404 dentro de un tenant autorizado.
Se mantienen las comprobaciones existentes de sesión y permisos por tenant.

Los contratos públicos móviles mantienen sus IDs UUID sin cambios.
No se publica un catálogo ni se modifica ningún consumidor externo.

Instalaciones existentes deben aplicar `migrations/001-store-code.sql` una vez
antes de arrancar esta versión. El esquema de nuevas instalaciones incorpora
la misma definición. Las sedes existentes reciben `sede-<su UUID actual>`;
se conservan sus nombres, datos y relaciones.
