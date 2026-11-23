# Pollos B3 — Fase 2, consulta de horarios futuros (PR #21)
Base: `feat/b3-admin-reservation-policies-20261123` (PR #20). Solo Administrador, sin modificar TU VERSO.

## GET para Android
`GET /api/v1/mobile/stores/{storeId}/reservation-slots?appId={appId}&date=YYYY-MM-DD&mode=pickup|delivery`

Validaciones: app/catálogo publicado y activo, sede del tenant, modalidad habilitada, configuración publicada y vigente en BD, franja reservable, anticipación y horario comercial a la fecha futura usando zona horaria de la empresa. Sin credenciales S2S en el cliente.

Respuesta: `enabled`, `revision`, `date`, `timeZone`, `storeId`, `mode`, `slots: [{time,scheduledAt}]`, `capacityVerified:false`, `agentAvailable:null`, `acceptingRequests:false`.

**Crítico:** devuelve solamente horarios potenciales, NO cupos confirmados, estado de agente ni un pedido aceptado. No registrar/cobrar una reserva basándose en este GET. La recepción de reservas continúa desactivada. La disponibilidad del agente se comprobará en el flujo transaccional de solicitud antes de crear una interacción, respetando el binding de la sede.

## Cambios de la fase
- Arregla alias SQL de la publicación del catálogo con LEFT JOIN para `store_reservation_settings` de PR #20.
- Agrega motor puro y determinista de franjas futuras. No utiliza `isOpen` calculado para este instante.
- Valida que `pickup` o `delivery` esté habilitado en sede y horario comercial de la fecha.
- No reescribe tarifas, asignación de sede, configuración de pagos ni endpoints actuales.
- CI incluye pruebas de timezone `America/Lima`, pasado/futuro fuera de plazo, horario cerrado, modalidades y aislamiento del catálogo.
- La migración 008 de PR #20 debe aplicarse **solo** en BD independiente del Administrador antes de publicar cualquier versión que consulte la nueva tabla.

## Pendientes que bloquean GO
1. Delivery programado: asignación de sede/cobertura/tarifa para una fecha futura, sin reutilizar `isOpen` de hoy.
2. Admisión y cupos por horario transaccionales con idempotencia y vencimiento.
3. Agente de TU VERSO disponible para la sede al solicitar, aprobación/rechazo de FORM `RESERVA DE PEDIDO`; sin cambiar TU VERSO.
4. Confirmación comercial solo tras pago verificado (Yape/Plin/tarjeta), o compromiso válido de efectivo al recibir, y estado persistente independiente del chat.
5. Android: vincular interacciones y pagos, seguimiento y ETA de preparación/reparto. **Mantener cerrado el envío real de reservas hasta certificar todo el flujo.**
