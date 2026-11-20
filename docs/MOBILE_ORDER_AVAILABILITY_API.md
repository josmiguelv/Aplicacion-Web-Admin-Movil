# Validación de disponibilidad de pedidos desde aplicaciones móviles

## Alcance y arquitectura

Estas rutas pertenecen al backend del Administrador Comercial. Cada aplicación autorizada llama al administrador; el administrador deriva el tenant desde el registro publicado de `appId` y, desde el servidor, consulta TU VERSO con la credencial cifrada de ese tenant. La app nunca recibe una credencial TU VERSO ni envía un `tenantId`, `storeId`, cola o ubicación externa como autoridad.

La función se habilita por sede con `consultOrderAvailability`. Si está desactivada, esa sede no genera llamadas ni interacciones TU VERSO. Las asociaciones de TU VERSO se limitan a la empresa, aplicación y sede que muestra el administrador. Los tenants existentes quedan deshabilitados por defecto.

La API de catálogo ya publica `consultOrderAvailability` por sede. No requiere cambios en consumidores para continuar usando los flujos actuales. Las nuevas rutas son aditivas y están en el backend administrativo; la creación de estas rutas no conecta por sí sola una aplicación móvil.

## Configuración

1. En el administrador, registrar la aplicación en el tenant y publicar su catálogo.
2. Configurar la integración TU VERSO correspondiente al tenant.
3. En **Integraciones → TU VERSO → Sedes vinculadas**, asociar la aplicación registrada, la sede del mismo tenant y el propósito `ORDER_REQUEST`. Confirmar la autorización externa antes de guardar.
4. En **Operaciones móviles → Locales y modalidades**, activar **Consultar disponibilidad del pedido con TU VERSO** solo en las sedes que deban esperar al asesor.
5. Publicar el catálogo de esa aplicación. La consulta solo queda activa cuando la aplicación, tenant, integración, credencial y asociación están vigentes.

No se crean valores iniciales ni excepciones para una empresa específica. Las aplicaciones adicionales de un tenant deben tener una asociación explícita. Una asociación antigua sin `app_id` no se usa para este flujo.

## Identidad y seguridad del consumidor

El catálogo publicado es público como en el contrato existente. Para iniciar una validación, el cliente envía el `appId` registrado y una referencia de comprador estable para correlación. El cliente debe crear `validationToken` con un CSPRNG, al menos 256 bits de entropía, codificación base64url sin padding y prefijo `ordv1_`; conservarlo en almacenamiento seguro de sesión y no registrarlo en logs. Solo se persiste su SHA-256 y se requiere de nuevo para leer el resultado. No se acepta `tenantId` ni selección de sede del cliente.

La API limita el tamaño del cuerpo, valida catálogo/productos/precios en el servidor y aplica límites de solicitudes. La credencial TU VERSO nunca se serializa en la respuesta. No se envían datos de pago. `customerExternalId` debe ser seudónimo y no incluir datos sensibles.

## 1. Iniciar o recuperar una validación

```http
POST /api/v1/mobile/orders/availability
Content-Type: application/json
Idempotency-Key: 6d040b4a-5bde-4b63-92fb-27035e316781
```

```json
{
  "appId": "com.example.store",
  "validationToken": "ordv1_...43-caracteres-base64url...",
  "customerExternalId": "cliente-aleatorio-123",
  "items": [
    { "productId": "2b12a9da-2f2f-4ab1-aaf4-9100bb8f4863", "quantity": 2 }
  ],
  "address": "Av. Ejemplo 123",
  "district": "Distrito",
  "city": "Ciudad",
  "country": "País",
  "useGps": false
}
```

Para una dirección, enviar `address`, `district`, `city` y `country` para que Google Routes ubique la dirección sin asumir una ciudad o país fijo. Para GPS confirmado, enviar `useGps: true`, `latitude` y `longitude`; se puede omitir la dirección. Si la dirección está completa, se usa la dirección. No enviar subtotal, tarifa, total, moneda ni sede como fuente de verdad.

Respuestas `202` indican proceso pendiente; `200` indica estado terminal. Repetir exactamente la misma llamada con la misma `Idempotency-Key` recupera la validación existente. Reutilizar la clave con un carrito, dirección o token distinto produce `409`.

## 2. Consultar y avanzar el estado

```http
GET /api/v1/mobile/orders/availability/{validationId}
Authorization: Bearer ordv1_...
```

La lectura valida el token contra el hash almacenado y avanza de forma segura el trabajo pendiente. Durante `WAITING_APPROVAL`, la app debe volver a consultar con espera incremental. El backend reanuda el proceso con PostgreSQL y una concesión temporal; no depende de memoria del proceso Node. La decisión del asesor no reserva inventario ni crea un pedido.

Estados:

| Estado | Significado |
| --- | --- |
| `CHECKING_STORES` | Evaluando sedes elegibles, en orden de distancia por carretera. |
| `WAITING_APPROVAL` | TU VERSO recibió una interacción y el asesor aún no decide. |
| `CREATE_UNCERTAIN` | Hubo una respuesta de transporte incierta; se recupera con la misma clave idempotente. |
| `READY_FOR_PAYMENT` | Una sede aceptó o no requería consulta. Incluye la cotización provisional final de esa sede. |
| `UNAVAILABLE` | Ninguna sede pudo atender la solicitud. |
| `VALIDATION_ERROR` | La validación no pudo completarse; iniciar una nueva validación tras corregir datos/configuración. |
| `CANCELLED` | Reservado para cancelación del ciclo administrativo. |

Mientras el estado no sea `READY_FOR_PAYMENT`, no se devuelven sede seleccionada, tarifa ni total. Al estar listo, la respuesta contiene `store`, `subtotal`, `deliveryFee`, `total`, `currency`, `routeDistanceKm` y `paymentMethods` de la sede seleccionada. Es una cotización provisional; no procesa pagos ni formaliza el pedido.

## Integración servidor a servidor con TU VERSO

El backend reutiliza el cliente existente y consulta disponibilidad, crea interacciones idempotentes y lee su decisión. Solo usa los contratos existentes:

- `GET /api/v1/queues/availability?externalLocationId=...&purpose=ORDER_REQUEST`
- `POST /api/v1/interactions`
- `GET /api/v1/interactions/{interactionId}`

`externalLocationId` sale de la asociación confirmada del tenant, app y sede. Las claves S2S son privadas del servidor. No se asumió un webhook ni se añadió una API de TU VERSO.

## Compatibilidad y estado de conexión

- No se cambia el contrato existente de `POST /api/v1/mobile/fulfillment/resolve`.
- El comportamiento actual se conserva cuando `consultOrderAvailability` está desactivado.
- Los catálogos agregan un campo booleano por sede, sin campos duplicados.
- No se modificó ninguna aplicación móvil. El equipo móvil deberá integrar estas rutas y generar/mantener el token de validación antes de que el flujo entre en uso.
- La API requiere que la migración `006-mobile-order-availability.sql` se aplique antes del despliegue administrativo. Esta tarea no ejecuta migraciones, no conecta una app cliente y no despliega producción.

## Pruebas focalizadas

Ejecutar `node --test server/mobile-order-availability.test.mjs`. Los casos cubren subtotal desde el catálogo y aislamiento de persistencia entre dos aplicaciones/tenants ficticios cuando la consulta está desactivada. No son una prueba E2E de TU VERSO ni validan carreras reales PostgreSQL, decisiones de asesor, reinicios o errores de red; requieren pruebas adicionales antes de habilitar en producción.
