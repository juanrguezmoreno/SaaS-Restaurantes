# Selector visual de franjas horarias para reservas

**Fecha:** 2026-07-30
**Estado:** Diseño aprobado, pendiente de plan de implementación

## Objetivo

Sustituir el `<input type="time">` de los dos flujos de reserva (panel privado y
formulario público) por una rejilla de franjas horarias pulsables, cuya
disponibilidad se calcula en el backend con las reglas de ocupación reales del
sistema.

Como consecuencia necesaria del objetivo, el flujo público pasa a reservar
provisionalmente una mesa al recibir la solicitud: sin eso la rejilla pública
mostraría siempre las mismas franjas libres por muchas solicitudes que se
acumulen.

## Situación de partida

`AvailabilityService` es la autoridad única de disponibilidad y ya la usan
`ReservationService` (crear, editar, confirmar) y el endpoint
`POST /api/v1/availability/tables`. Sus reglas actuales:

- Una reserva ocupa su mesa durante `Restaurant.defaultReservationDurationMinutes`
  (90 por defecto). Dos reservas solapan si sus intervalos `[inicio, fin)` se cruzan.
- Solo bloquean las reservas `PENDING` y `CONFIRMED` no borradas **que tienen mesa
  asignada**; `CANCELLED`, `COMPLETED` y `NO_SHOW` no bloquean.
- Una mesa es válida si `capacity >= partySize` y `status != MAINTENANCE`.
- No existe combinación de mesas: una reserva ocupa como máximo una mesa.
- La concurrencia se serializa con bloqueo pesimista sobre la fila de la mesa
  (`findByIdAndDeletedFalseForUpdate`) más aislamiento `READ_COMMITTED`, y el índice
  único `uk_reservations_active_slot` (migración V4) actúa de última defensa en MySQL.

Puntos de partida relevantes que el diseño cambia o corrige:

1. `PublicReservationService.createReservationRequest` crea la reserva `PENDING`
   **sin mesa y sin comprobar disponibilidad alguna**. Al no tener mesa, es invisible
   para el cálculo de solape.
2. `Restaurant.openingTime` / `closingTime` existen pero **ningún código los valida**.
3. `POST /api/v1/availability/tables` es público (`permitAll` en `SecurityConfig`) y
   revela número, capacidad y ubicación de las mesas de cualquier `restaurantId`.
4. `PublicReservationRequest` valida `@FutureOrPresent` sobre la fecha pero no sobre
   la hora: se acepta hoy a las 09:00 enviado a las 22:00.
5. El frontend no tiene ninguna infraestructura de tests.
6. Flyway está activo en producción con `ddl-auto: validate` (migraciones hasta V6).
   Cualquier columna nueva exige migración. *(El `CLAUDE.md` dice lo contrario y
   está desactualizado.)*

## Decisiones tomadas

| Decisión | Elegido | Motivo |
|---|---|---|
| Solicitudes públicas pendientes | Bloquean mesa de verdad (bloqueo provisional) | Sin esto la rejilla pública miente |
| Caducidad del bloqueo | 12 h (`RESERVATION_HOLD_EXPIRATION_MINUTES=720`), acotada a la hora de la reserva | Ventana amplia para que el restaurante gestione, sin retener huecos indefinidamente |
| Al caducar | Libera mesa, conserva la solicitud en `PENDING`, la marca como "bloqueo caducado" | No se pierde ninguna petición de cliente |
| Ventana de franjas | Última franja que quepa entera antes del cierre | Ninguna reserva se sale del horario |
| Configuración | Propiedades de aplicación con env var | Es el patrón del proyecto; por-restaurante queda preparado |
| Wizard privado | Fecha, comensales y hora en un solo paso (5 → 4 pasos) | La rejilla necesita los comensales antes de poder calcularse |
| Tests de frontend | Instalar Vitest + Testing Library | 8 de los 12 requisitos de prueba son de frontend |

## Arquitectura

### Modelo del bloqueo provisional

Nueva columna `hold_expires_at DATETIME NULL` en `reservations` (migración **V7**)
y campo `holdExpiresAt` en la entidad `Reservation`. El estado del bloqueo se deriva
íntegramente de esa columna, sin ninguna columna adicional:

| `holdExpiresAt` | Estado derivado | Ocupa mesa |
|---|---|---|
| `null` | `NONE` — reserva normal (privada, o ya gestionada) | Sí, sin límite |
| `> now` | `ACTIVE` — bloqueo provisional vivo | Sí |
| `<= now` | `EXPIRED` — bloqueo caducado, "pendiente sin bloqueo" | No |

La fecha caducada **se conserva** deliberadamente: es lo que distingue una solicitud
pública cuyo bloqueo venció de una reserva privada que nunca tuvo bloqueo.

**Caducidad efectiva** al crear la solicitud:

```
holdExpiresAt = min(now + resolveHoldMinutes(restaurant),
                    LocalDateTime.of(reservationDate, reservationTime))
```

El segundo término garantiza que el bloqueo nunca sobreviva a la hora de inicio de
la propia reserva. `resolveHoldMinutes(Restaurant)` vive en `PublicReservationService`
y devuelve hoy siempre el valor global; cuando se quiera configurar por restaurante
basta con añadir la columna y un `if` en ese único método.

### Regla de ocupación: un solo cambio

El único punto que consume `findActiveByTableAndDateBetween` es
`AvailabilityService.hasOverlap`, que ya recorre las reservas candidatas una a una.
El descarte del bloqueo caducado se hace ahí, en ese bucle:

```java
// Un bloqueo provisional caducado ya no ocupa la mesa.
if (c.getHoldExpiresAt() != null && !c.getHoldExpiresAt().isAfter(now)) {
    continue;
}
```

Se hace en Java y no en el JPQL para no cambiar la firma del repositorio, que
obligaría a tocar todos los stubs de `AvailabilityServiceTest` sin ganar nada: la
semántica es idéntica y así queda cubierta por tests unitarios con Mockito. Al ser
`hasOverlap` el paso obligatorio de todo cálculo de ocupación, el filtro se aplica
igual a disponibilidad, creación, edición y confirmación.

El resto de la lógica de solape queda intacta. La regla completa,
enunciada de forma explícita:

> **Una franja está completa cuando no existe ninguna mesa del restaurante que
> cumpla a la vez: capacidad suficiente para los comensales, estado distinto de
> `MAINTENANCE`, y ninguna reserva viva cuyo intervalo `[hora, hora + duración)`
> se cruce con el intervalo solicitado. Una reserva está viva si no está borrada,
> su estado es `PENDING` o `CONFIRMED`, tiene mesa asignada, y su bloqueo
> provisional no ha caducado.**

El cambio solo *retira* bloqueo a los holds caducados. Que las solicitudes públicas
pasen a ocupar no es un cambio de esta regla, sino consecuencia de que ahora se les
asigna mesa.

### Creación pública con bloqueo

`PublicReservationService.createReservationRequest` pasa a:

1. Anotarse `@Transactional(isolation = Isolation.READ_COMMITTED)`, igual que
   `ReservationService.create`.
2. Validar que `LocalDateTime.of(fecha, hora)` es futuro (hueco actual nº 4).
3. Recorrer las mesas candidatas **ordenadas por id** y, sobre cada una, llamar a
   `assertNoOverlap`, que ya adquiere `SELECT … FOR UPDATE`. Si otra transacción se
   ha llevado la candidata, se pasa a la siguiente en vez de fallar.
4. Sin candidatas → **409 Conflict**: *"Esa franja acaba de ocuparse. Elige otra hora."*
5. Guardar con la mesa asignada y `holdExpiresAt` calculado.

El orden determinista por id es lo que evita interbloqueos: todas las transacciones
adquieren los cerrojos en la misma secuencia.

`assertNoOverlap` no está anotado como transaccional, así que capturar su
`ConflictException` dentro del bucle no marca la transacción como rollback-only.

### Caducidad y limpieza

- **Autoridad inmediata:** el filtro SQL. Un bloqueo caducado deja de ocupar en el
  mismo instante, sin depender de ningún job.
- **Limpieza:** nuevo `ReservationHoldScheduler`, mismo patrón que
  `TableStatusScheduler`, que cada minuto pone `diningTable = null` en los `PENDING`
  con bloqueo caducado, conservando `holdExpiresAt`. Es solo higiene de datos para
  que el panel no muestre una mesa que ya no está retenida.

Confirmar o cancelar pone `holdExpiresAt = null` en el acto. Rechazar una solicitud
es, en el modelo actual, la transición a `CANCELLED`: no hay un estado `REJECTED` y
no se añade. Al confirmar después de la caducidad, `ReservationService.updateStatus`
ya revalida
transaccionalmente: reasigna mesa si hay alguna libre y falla con mensaje claro si
no. No requiere cambios.

### Endpoints

Un único método de servicio,
`AvailabilityService.getTimeSlots(restaurantId, date, partySize)`, con dos puertas
de entrada. Ambos flujos comparten exactamente el mismo cálculo, de modo que es
imposible que las reglas diverjan.

| | Privado | Público |
|---|---|---|
| Ruta | `GET /api/v1/availability/time-slots` | `GET /api/v1/public/restaurants/{restaurantId}/time-slots` |
| Parámetros | `restaurantId`, `date`, `partySize` | `date`, `partySize` (el id va en la ruta) |
| Autorización | JWT + `currentUserService.validateRestaurantAccess()` | Ninguna, pero exige `publicBookingEnabled` |
| Respuesta | `ApiResponse<List<TimeSlotResponse>>` | idéntica |

`TimeSlotResponse` contiene **solo** `time` (`LocalTime`) y `available` (`boolean`).
Ni ids ni números de mesa, ni capacidades, ni ningún dato de reservas ajenas.

Las rutas nuevas se declaran como constantes en `Constants.java`, según la
convención del proyecto.

### Generación de la rejilla

Desde `openingTime`, en saltos de `app.reservations.slot-interval-minutes`, mientras
`hora + defaultReservationDurationMinutes <= closingTime`. Si el restaurante no
tiene horario configurado se usan `app.reservations.default-opening-time` y
`default-closing-time` (12:00–23:00).

Si la fecha solicitada es hoy, las franjas ya pasadas se descartan **en el backend**.
El frontend nunca decide qué horas mostrar.

Si `closingTime <= openingTime` (cierre pasada la medianoche), la ventana termina a
las 23:59 del día seleccionado y las franjas de madrugada **no** se ofertan en esta
iteración: una reserva a las 00:30 se almacenaría con `reservationDate` del día
siguiente, lo que contradiría la fecha que el usuario eligió en el formulario.
Resolverlo bien exige decidir la semántica de "noche del día X", que queda fuera
de alcance.

### Configuración

```yaml
app:
  reservations:
    slot-interval-minutes: ${RESERVATION_SLOT_INTERVAL_MINUTES:30}
    hold-expiration-minutes: ${RESERVATION_HOLD_EXPIRATION_MINUTES:720}
    default-opening-time: "${RESERVATION_DEFAULT_OPENING_TIME:12:00}"
    default-closing-time: "${RESERVATION_DEFAULT_CLOSING_TIME:23:00}"
```

### Corrección de seguridad incluida

`POST /api/v1/availability/tables` deja de ser público: se retira su `permitAll` de
`SecurityConfig` y se le añade `validateRestaurantAccess`. Contradice frontalmente la
regla de aislamiento entre restaurantes, su único consumidor es el wizard privado
—que ya envía JWT— y el nuevo endpoint público no lo necesita.

### Visibilidad del bloqueo en el panel

`ReservationResponse` expone `holdExpiresAt` y `holdStatus` (`NONE` / `ACTIVE` /
`EXPIRED`), calculado en `ReservationMapper`. El listado de reservas muestra un badge
con la hora de caducidad cuando el bloqueo está activo, y "Pendiente sin bloqueo"
cuando ha caducado. Ninguno de los dos campos aparece en respuestas públicas.

## Frontend

### Componente reutilizable

`src/components/TimeSlotSelector.jsx`, con estilos basados en los tokens ya
existentes de `index.css` (`--primary`, `--primary-ring`, `--border`,
`--text-muted`), de modo que hereda el tema claro/oscuro sin trabajo adicional.

Propiedades: `slots`, `value`, `onChange`, `loading`, `error`, `onRetry`, `disabled`.

Cada franja es un `<button type="button">` real:

| Estado | Marcado |
|---|---|
| Disponible | `aria-pressed={false}`, borde suave, hover elevado |
| Seleccionada | `aria-pressed={true}`, relleno `--primary` |
| Completa | **atributo `disabled` real**, no solo CSS, más `aria-disabled`, gris y subtexto "Completo" |

Rejilla `repeat(auto-fill, minmax(88px, 1fr))`: 4–6 columnas en escritorio, 3 en
móvil, altura mínima de 44 px para mantener el objetivo táctil. La navegación por
teclado es la nativa de los botones (los `disabled` se saltan solos) con anillo de
foco visible mediante `--primary-ring`. `role="group"` con
`aria-label="Franjas horarias disponibles"`.

Estados sin franjas: spinner discreto mientras carga; *"No hay horarios disponibles
para la fecha y el número de personas seleccionados."* con la lista vacía; y mensaje
comprensible más botón **Reintentar** si la consulta falla.

### Hook compartido

`src/hooks/useTimeSlots.js`, junto al `useAllTables.js` existente. Concentra la
lógica que de otro modo se duplicaría en las dos páginas: dispara la consulta cuando
cambian restaurante, fecha o comensales; limpia la hora seleccionada en cada cambio;
descarta respuestas obsoletas para que una petición lenta no pise a una posterior; y
expone `{ slots, loading, error, retry }`. Recibe el *fetcher* por parámetro, que es
lo único que difiere entre privado y público.

### Integración privada

El wizard de `Reservations.jsx` pasa de 5 a 4 pasos:

```
1 Restaurante → 2 Fecha · comensales · hora → 3 Mesa → 4 Confirmar
```

El paso 2 fusiona el date-picker, el contador de comensales existente y la rejilla;
desaparece el `<input type="time">`. El paso 3 sigue usando
`POST /availability/tables` como hoy. `canGoNext` del paso 2 exige fecha, comensales
válidos y hora seleccionada, así que el formulario no avanza sin hora.

El modal clásico se usa solo para editar y mantiene su `<input type="time">`: queda
fuera del alcance de esta tarea.

### Integración pública

En `PublicReservation.jsx` se sustituye el `<input type="time">` por el mismo
componente y el campo de comensales sube por encima de la hora. `validateForm` sigue
exigiendo `reservationTime`. Se añade manejo del 409: mensaje de que la franja acaba
de ocuparse y recarga automática de la rejilla.

### Servicios

`getTimeSlots()` en `reservationService.js` y `fetchPublicTimeSlots()` en
`publicReservationService.js`, siguiendo el estilo de extracción y manejo de errores
ya presente en ambos módulos.

## Pruebas

### Frontend — Vitest + Testing Library + jsdom, script `pnpm test`

| # | Prueba | Ubicación |
|---|---|---|
| 1 | Las horas disponibles se pueden seleccionar | `TimeSlotSelector.test.jsx` |
| 2 | Las horas completas aparecen con `disabled` real | `TimeSlotSelector.test.jsx` |
| 3 | Una hora deshabilitada no dispara `onChange` | `TimeSlotSelector.test.jsx` |
| 4 | Al seleccionar otra hora se desmarca la anterior | `TimeSlotSelector.test.jsx` |
| 5 | Cambiar la fecha limpia la hora seleccionada | `useTimeSlots.test.jsx` |
| 6 | Cambiar los comensales recalcula la disponibilidad | `useTimeSlots.test.jsx` |
| 7 | No se pinta ninguna franja fuera de las que devuelve el backend | `TimeSlotSelector.test.jsx` |
| 8 | El formulario no se envía sin hora válida | tests de ambos formularios |

### Backend — JUnit/Mockito, siguiendo el estilo de los tests existentes

| # | Prueba | Ubicación |
|---|---|---|
| 7 | Con fecha de hoy se excluyen las franjas pasadas | `AvailabilityServiceTest` |
| — | Ventana, intervalo, "cabe entera", horario nulo, cierre tras medianoche | `AvailabilityServiceTest` |
| — | Franja completa cuando ninguna mesa sirve para esos comensales | `AvailabilityServiceTest` |
| 9 | Dos solicitudes públicas simultáneas por la última mesa: solo una | `ReservationConcurrencyIntegrationTest` |
| 10 | Privado y público devuelven lo mismo para la misma entrada | test de integración nuevo |
| 11 | Un restaurante que pide franjas de otro recibe 403 | test de integración nuevo |
| 12 | La respuesta pública solo contiene `time` y `available` | test de integración nuevo |
| — | El bloqueo se corta en la hora de la reserva | `PublicReservationServiceTest` |
| — | Un bloqueo caducado no ocupa la mesa | `PublicReservationServiceTest` |
| — | Solicitud pública sin mesas libres devuelve 409 | `PublicReservationServiceTest` |

## Fuera de alcance

- Combinación de varias mesas para un grupo grande: no existe hoy y el enunciado
  prohíbe cambiar las reglas de asignación sin justificarlo.
- Intervalo y caducidad configurables por restaurante: la implementación queda
  preparada (un único método de resolución), pero no se añade la columna ni el
  formulario.
- El modal de edición de reserva del panel privado conserva su `<input type="time">`.
- Horarios partidos (comida y cena con cierre intermedio): el modelo actual solo
  tiene una apertura y un cierre.
- Franjas de madrugada en restaurantes que cierran pasada la medianoche.

## Casos límite conocidos

- **Días festivos y cierres puntuales** no existen en el modelo: la rejilla ofrecerá
  franjas cualquier día del año.
- **Restaurante sin mesas dadas de alta**: todas las franjas saldrán completas. Es
  correcto, pero el mensaje no explica la causa real.
- **Cambio de duración del restaurante** con reservas ya creadas: los solapes se
  recalculan con la duración nueva, incluso para reservas antiguas. Es el
  comportamiento que ya existe hoy.
- **Bloqueo provisional y grupos grandes**: una solicitud de 2 personas puede
  bloquear la única mesa de 8 si es la única compatible libre, por ser
  `assignFirstAvailableTable` un "primero que quepa" sin optimización de encaje. Es
  el comportamiento actual del panel privado, no se modifica.
