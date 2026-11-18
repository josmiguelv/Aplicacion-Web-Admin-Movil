# Vínculos de sedes y colas TU VERSO — borradores del administrador

## Alcance implementado

Esta función es **exclusivamente local** al administrador SaaS de INTEGRA B2G y no crea, edita, elimina ni publica ningún vínculo en TU VERSO. Se muestra en el Super Administrador, tras seleccionar una empresa, bajo **Vínculos TU VERSO**.

La documentación TU VERSO del 18/11/2026 incluye la operación de creación de bindings mediante POST /api/tenants/{tenantId}/external-integrations/{id}/bindings. **No documenta** la API de edición o desvinculación. No debe fingirse que una modificación local cambia un recurso remoto.

## Comportamiento

- Listar las sedes del tenant **desde la API del administrador**. No escribir manualmente un UUID/código de sede. El campo externalLocationId se deriva del código estable y protegido de la sede.
- Registrar un borrador local por empresa, canal (MOBILE_APP/WEB), instancia, propósito y referencia de cola externa.
- Corregir un borrador local seleccionando otra sede o cambiando su instancia, canal, propósito o cola. La sede original, su código inmutable, sus pedidos y las otras integraciones no cambian.
- Desvincular un borrador local con una segunda confirmación. Es una **baja lógica** (`removed_at`), con auditoría; no elimina la sede, sus recursos ni ningún vínculo remoto.
- Mostrar siempre **Borrador local / no sincronizado**. No hay conexión remota ni verificación de que el UUID pertenezca a una cola INDEPENDENT de TU VERSO.
- Solo usuarios autenticados como SUPER_ADMIN acceden a GET, POST, PATCH y DELETE. El servidor valida el tenant y que la sede pertenezca a él. Los administradores de empresa reciben 403.
- La restricción de unicidad impide duplicar un mismo vínculo activo en una misma empresa/instancia/canal/sede/propósito. Se preservan los registros borrados para auditoría y se puede volver a crear una asociación.

## Endpoints privados del administrador

Base: `/api/admin/tenants/{tenantId}/tuverso-bindings`

- `GET /` — lista borradores locales, siempre con `remoteSynchronized: false`.
- `POST /` — crea un borrador local; body exacto: `{storeId,channelType,instanceKey,purpose,queueId}`.
- `PATCH /{id}` — reemplaza esos cinco atributos de un vínculo local vigente. No cambia `stores.code`.
- `DELETE /{id}` — baja lógica del vínculo local, sin operación remota.

`storeId` y `queueId` tienen formato UUID; `instanceKey` no es vacío y tiene hasta 180 caracteres, letras, números, puntos, guiones y guiones bajos; `purpose` es un código en mayúsculas conforme al contrato.

El `externalLocationId` aparece de forma informativa como el código estable de la sede vinculada y se obtiene del servidor, no del body recibido del navegador.

## Instalación en PostgreSQL local

1. Seleccionar **exclusivamente** la base local del administrador, nunca bases de TU VERSO ni Railway.
2. Aplicar una sola vez la migración aditiva `server/migrations/002-local-tuverso-bindings.sql` con el usuario autorizado del esquema.
3. Reiniciar únicamente el backend del administrador.
4. Iniciar sesión como SUPER_ADMIN, elegir una empresa con sedes, verificar el formulario, creación, edición, confirmación y retirada de un borrador.
5. Verificar que TENANT_ADMIN reciba 403 y que una sede de otro tenant no pueda vincularse.

Para nuevas instalaciones el mismo esquema se incluye al final de `server/schema.sql`. Nunca ejecutarlo automáticamente sobre bases existentes con datos sin revisión.

## Para completar la integración real (fuera del alcance)

Se necesita un contrato autorizado de TU VERSO para **consultar listados de colas elegibles, editar/desvincular bindings y comprobar su estado remoto**. La documentación actual solo presenta POST de creación y rutas administrativas protegidas por sesión humana TENANT_ADMIN, MFA/CSRF, no por el bearer S2S. No inventar llamadas ni simular esa sesión desde el administrador. No modificar los repositorios de TU VERSO, Android ni WebPollosB3 desde este proyecto.

La pantalla mostrada en TU VERSO permanece intacta. Las correcciones hechas aquí no cambian automáticamente el vínculo que se vea allí.
