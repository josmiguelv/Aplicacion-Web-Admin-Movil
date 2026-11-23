# Pollos B3 — Configuración de pedidos programados (fase administrativa 1)

Base del trabajo: `fix/b3-conversation-lifecycle-20261123`, commit `93fe08f6`.
Alcance: **solo Administrador Web**, base de datos propia y catálogo Android. TU VERSO y Android no se modifican.

## Reglas del negocio

- El Administrador habilita o deshabilita cada sede para Delivery, Recojo y programación. Una reserva no crea una tercera modalidad comercial.
- Se mantienen las tarifas de delivery, radio/distancia, selección de sede, medios de pago y horarios de atención ya existentes. Los horarios futuros deberán validarse contra `openingHours` de esa fecha.
- Agente conectado y disponible en TU VERSO: requisito obligatorio cuando se solicita y antes de crear una interacción. Configurar una sede NO demuestra que un agente esté disponible.
- La aceptación del agente NO equivale al pago ni a confirmar el pedido. Efectivo al recibir es compromiso de pago, NO cobro verificado.
- La reserva será un pedido con fecha/hora de entrega o recojo. El tiempo de preparación de la sede comienza conforme al evento comercial de pago/compromiso; una reserva futura no inicia el contador inmediatamente.
- Reserva aceptada/confirmada persiste con independencia de si se cierra la conversación.
- La capacidad por horario debe protegerse **transaccionalmente** al implementar la creación de reservas; no se cuenta ni descuenta en esta fase.

## Estado de esta fase

**Solo configuración.** `acceptingRequests:false` se publica expresamente y sigue siendo falso aunque se habilite `enabled:true`. No existen endpoints de creación de reservas ni de disponibilidad de cupos futuros todavía; Android debe mantener bloqueado el envío real.

No migrar ni modificar bases de datos de TU VERSO. No ejecutar migraciones sobre producción sin respaldo/validación de la BD **independiente** del Administrador.

## Migración

`server/migrations/008-store-reservation-settings.sql`, aditiva, crea `store_reservation_settings` con clave y FK compuesta `(tenant_id,store_id)`. Por defecto no hay configuración y la programación está deshabilitada. La misma estructura está en `server/schema.sql` para una base nueva.

**Orden de despliegue en un entorno autorizado:** aplicar migración 008 en la base del Administrador **antes** del backend de esta rama. La consulta de publicación utiliza un LEFT JOIN con la tabla nueva. No publicar esta rama sin migración aplicada.

## Panel administrativo

En `Administración del negocio → Reservas y preparación`, elegir sede y definir:

- `enabled`: permite configurar programación para la sede, deshabilitado por defecto.
- `minAdvanceMinutes`: anticipación mínima, entre 0 y 10080 minutos.
- `maxAdvanceDays`: máxima anticipación, de 1 a 60 días.
- `firstTime` / `lastTime`: primera y última hora de reserva (HH:MM, dentro del mismo día).
- `slotMinutes`: intervalo 15, 30 o 60 minutos.
- `maxOrdersPerSlot`: 1 a 500 por horario.
- `preparationMinutes`: 1 a 240 minutos, también aplicable a pedidos inmediatos.

Los valores no se inventan ni se escriben automáticamente: el administrador los define. Si `enabled=true`, la configuración debe estar completa y ser consistente. Los permisos actuales por tenant siguen vigentes.

## APIs administrativas

Sesión administrativa y control de origen actuales, sin exposición de tokens.

- `GET /api/admin/tenants/{tenantId}/stores/{storeId}/reservation-settings`: consulta de configuración propia.
- `POST /api/admin/tenants/{tenantId}/stores/{storeId}/reservation-settings`: actualización atómica y auditoría; recibe los ocho campos mencionados, sin campos adicionales.

La escritura verifica `tenantId` y `storeId`, bloquea la sede `FOR UPDATE`, guarda con UPSERT y registra `STORE_RESERVATION_SETTINGS_UPDATED`.

## Catálogo Android

Al publicar el catálogo ya existente (`POST /api/admin/tenants/{tenantId}/publish`), cada sede añade:

```json
{
  "preparationMinutes": 40,
  "reservationSettings": {
    "enabled": true,
    "minAdvanceMinutes": 45,
    "maxAdvanceDays": 7,
    "firstTime": "12:00",
    "lastTime": "22:30",
    "slotMinutes": 30,
    "maxOrdersPerSlot": 8,
    "preparationMinutes": 40,
    "acceptingRequests": false
  }
}
```

**Ejemplo de estructura, no valores reales de ninguna sede.** Los clientes actuales pueden ignorar los nuevos campos.

`enabled` es la **preferencia publicada**; `acceptingRequests` solo podrá ser true después de crear y certificar la validación por fecha, cupos, agente, FORM `RESERVA DE PEDIDO`, estados comerciales, pago y cancelación.

## FORM futuro

Reutilizar el tipo `FORM` existente y botones Aceptar/Rechazar, sin modificar TU VERSO.

- Título: `RESERVA DE PEDIDO`
- Subtítulo: `Confirmar pedido programado - Delivery` o `Confirmar pedido programado - Recojo en tienda`.
- Campos visibles: fecha solicitada, hora solicitada, productos, subtotal.
- Sede y destino viajan como metadatos internos para enrutamiento/cálculo, no como campos visibles.
- No crear interacción sin revisar la disponibilidad **real** de un agente asociado a la sede en TU VERSO, aun cuando la política esté habilitada.

## Pendiente antes de GO

1. En backend: validación real de horario futuro por modalidad/sede, cupos, transacciones concurrentes, idempotencia, estado de pedido, pagos y cancelación.
2. Confirmación del agente y FORM único, sin dobles mensajes ni nuevas funciones de TU VERSO.
3. En Android: consumir configuración, seleccionar horario válido, usar endpoints de reserva reales y mostrar tiempo de preparación al pagar/comprometer pago.
4. Pruebas de regresión de pedidos inmediatos Delivery/Recojo, cancelación y contactos.
5. Certificación y despliegue controlado. **No-GO hasta entonces.**
