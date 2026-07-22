# Integridad de reservas y mesas — Diseño

**Fecha:** 2026-07-22
**Ámbito:** blindar el sistema de reservas y asignación de mesas para que nunca puedan existir reservas incompatibles o solapamientos de una misma mesa, tanto a nivel lógico (solape de horario) como de concurrencia (dos peticiones simultáneas).

## Contexto y decisiones ya tomadas

Este sistema ya pasó por una auditoría de fiabilidad completa el 2026-07-15 (`docs/audits/reservation-reliability-audit.md`) cuyo plan de corrección (`docs/superpowers/plans/2026-07-15-fiabilidad-reservas.md`) ya está implementado en su mayor parte: aislamiento multi-tenant de mesa/cliente, máquina de estados cerrada, capacidad y hora pasada validadas, `DELETE` como borrado real, duplicados y rate-limiting del flujo público, `docker-compose` corregido, fixes de frontend (TZ, criterio de "pendientes", errores de red).

Ese plan anterior **decidió explícitamente NO implementar duración de reserva** ("A5: el solape por hora exacta es el comportamiento deseado"). Esta decisión se revierte ahora: el usuario ha decidido que sí se debe modelar la duración, con **duración configurable por restaurante** (no por reserva individual), valor por defecto 90 minutos, editable desde la pantalla de ajustes del restaurante.

## Auditoría — estado actual confirmado (2026-07-22)

- `Reservation` no tiene duración ni hora de fin — solo `reservationDate` + `reservationTime` puntual (`Reservation.java:41-45`).
- El solape se define hoy como igualdad exacta de fecha+hora en la misma mesa, filtrando solo estados `PENDING`/`CONFIRMED` (`ReservationRepository.findActiveConflicts`, líneas 61-68).
- Esa comprobación está duplicada de forma independiente en `AvailabilityService.checkAvailability` (líneas 38-79) y en `ReservationService` (`isTableAvailableForReservation`, `assertNoOverlap`, `assignAvailableTable`, líneas 383-634). Solo comparten la query de bajo nivel.
- Autoexclusión al editar: correcta (`excludeReservationId` se propaga bien, con test dedicado).
- Confirmación/cancelación/reasignación: todas re-verifican solape correctamente; cancelar libera la mesa de forma consistente.
- Flujo público: nunca asigna mesa (siempre `PENDING` sin mesa); el riesgo de solape se traslada al momento de confirmación por staff, que sí revalida.
- Concurrencia: no hay ningún lock a nivel de aplicación. El único cortafuegos real es el índice único de MySQL `uk_reservations_active_slot` (migración Flyway V4), que solo existe en producción (Flyway desactivado en `dev`/tests con H2) y que solo cubre coincidencia *exacta* de mesa+fecha+hora.
- Plano de sala: no reutiliza ninguna lógica de disponibilidad; se basa en la lista cruda de reservas del día + `DiningTable.status` cacheado.

## Decisión de producto

- **Duración de reserva:** configurable por restaurante (`Restaurant.defaultReservationDurationMinutes`), default 90, editable en el panel. No es un campo de la reserva individual — no cambia el DTO público, el wizard, ni el formulario de edición del panel.

## Diseño

### 1. Modelo de datos

- Nuevo campo `Restaurant.defaultReservationDurationMinutes` (`Integer`, `nullable=false`, valor por defecto en código `90`).
- Validación en `RestaurantRequest`: `@NotNull @Min(15) @Max(480)`.
- Migración Flyway `V6__add_reservation_duration.sql`: añade la columna `NOT NULL DEFAULT 90` — los restaurantes existentes quedan en 90 automáticamente sin script de backfill aparte.
- `RestaurantMapper` propaga el campo en `toEntity`/`updateEntity`/`toResponse`.

### 2. Regla de disponibilidad única

`AvailabilityService` pasa a ser la única autoridad de disponibilidad de mesas (coherente con que ya es su propósito declarado como package):

- Nuevos métodos internos en `AvailabilityService`:
  - `boolean isTableAvailable(DiningTable table, LocalDate date, LocalTime time, Integer partySize, Long excludeReservationId)`
  - `Optional<DiningTable> assignFirstAvailableTable(Restaurant restaurant, LocalDate date, LocalTime time, Integer partySize)`
  - `void assertNoOverlap(DiningTable table, LocalDate date, LocalTime time, Long excludeReservationId)` (lanza `ConflictException`)
- `ReservationService` elimina sus métodos privados equivalentes (`isTableAvailableForReservation`, `assertNoOverlap`, `assignAvailableTable`) y pasa a invocar los de `AvailabilityService`.
- `AvailabilityService.checkAvailability` (endpoint público de disponibilidad) se reescribe como un `filter`/`map` sobre `isTableAvailable` — cero lógica de negocio duplicada.
- `AvailabilityRequest.time` pasa a ser `@NotNull` (hoy, si llega `null`, el JPQL no casa ninguna reserva y todas las mesas aparecen libres ignorando reservas reales — bug real en el mismo archivo que se está tocando).

### 3. Algoritmo de solape por intervalo

Con duración fija `D` por restaurante, dos reservas en la misma mesa solapan si y solo si `|inicioA − inicioB| < D` (donde inicio es fecha+hora combinada). Implementación:

- Nueva query en `ReservationRepository`: `findActiveByTableAndDateBetween(tableId, fechaDesde, fechaHasta, excludeId)` — trae las reservas activas (`PENDING`/`CONFIRMED`, `deleted=false`) de esa mesa en el rango `[fecha−1, fecha+1]`, excluyendo la propia reserva si aplica.
- El cálculo de solape se hace en Java, no en JPQL: se combina `reservationDate`+`reservationTime` de cada candidata en un `LocalDateTime`, se calcula su fin (`inicio + D`), y se compara contra el intervalo `[inicio, fin)` de la reserva solicitada con solape estándar de intervalos (`inicioA < finB && inicioB < finA`), evitando funciones de fecha específicas de motor (portable entre H2 y MySQL).
- **Rango ±1 día:** necesario porque una reserva a las 23:30 con 90 min de duración termina a las 01:00 del día siguiente; comparar solo el mismo `reservationDate` dejaría sin detectar solapes que cruzan medianoche.
- Verificación contra los casos de solape requeridos: Caso 1 (20:00 vs 20:30, D=90) → diferencia 30 min < 90 → conflicto. Caso 3 (20:00–21:30 luego 21:30–23:00) → diferencia exactamente 90 min, no es `< 90` → permitido (reservas consecutivas encajan, el límite es exclusivo).

### 4. Concurrencia

- Bloqueo pesimista sobre la fila de `DiningTable`: nuevo método en `DiningTableRepository` con `@Lock(LockModeType.PESSIMISTIC_WRITE)` (ej. `findByIdAndDeletedFalseForUpdate`).
- Se adquiere al principio de cualquier transacción que vaya a comprobar disponibilidad y asignar/reasignar una mesa concreta: crear con mesa, confirmar (`updateStatus` → `CONFIRMED`), reasignar, editar cambiando mesa u horario.
- Efecto: dos transacciones que compitan por la misma mesa se serializan a nivel de fila en MySQL — la segunda espera el `COMMIT`/`ROLLBACK` de la primera antes de leer el estado de solape, eliminando la ventana de *check-then-act*.
- El índice único V4 (`uk_reservations_active_slot`) se mantiene como red de seguridad adicional para el caso de coincidencia exacta, documentando que el lock pesimista es ahora el mecanismo autoritativo (el índice no puede expresar "sin solape de rangos" en MySQL/InnoDB).
- Sin infraestructura nueva (se descarta lock distribuido tipo Redis: complejidad innecesaria para este volumen de escritura).

### 5. API / manejo de errores

- Se mantiene `ConflictException` → 409 en todos los puntos existentes.
- Mensaje actualizado para reflejar el rango horario real, ej.: *"La mesa 5 ya tiene una reserva de 20:00 a 21:30 (solapa con la franja solicitada)."*

### 6. Frontend

- La duración no es un input del usuario en la creación/edición de reservas (no cambia wizard, formulario de edición, ni flujo público).
- Nuevo campo "Duración de reserva (min)" en la pantalla de ajustes de restaurante (`Restaurants.jsx`), mismo patrón de formulario que `openingTime`/`closingTime` (input numérico, validación 15–480, mapeo en el payload de `PUT`/`POST`).
- El resto del frontend ya revalida disponibilidad tras 409 y refresca (comportamiento existente) — no requiere cambios estructurales, solo consume el mensaje de error actualizado del backend.

### 7. Tests

| Caso | Cobertura |
|---|---|
| 1, 2, 3 (solape exacto/no-solape/consecutivas) | `AvailabilityServiceTest` (nuevo): solapa/no solapa según duración, incluida franja consecutiva exacta como límite excluyente |
| 4 (cancelar libera mesa) | Regresión sobre tests existentes, adaptados a la nueva firma de `isTableAvailable`/`assertNoOverlap` |
| 5 (editar sin cambios no se autoconflictúa) | `ReservationServiceTest`: excludeReservationId sigue funcionando con el nuevo algoritmo |
| 6 (editar y mover a hueco ocupado) | `ReservationServiceTest`: 409 |
| 7 (reasignar a mesa ocupada) | `ReservationServiceTest`: 409 |
| 8 (dos intentos concurrentes) | **Nuevo** `ReservationConcurrencyIntegrationTest` (`@SpringBootTest`, perfil test con H2 real, no Mockito): dos hilos/`ExecutorService` disparando `POST /reservations` contra la misma mesa/franja — verificar que exactamente una devuelve 201 y la otra 409 |
| 9 (aislamiento multi-tenant) | Regresión: scoping existente no se toca por este cambio |

Además: tests de `RestaurantMapper`/`RestaurantRequest` para la validación del nuevo campo, y test de migración (arranque con H2/perfil test confirma columna `NOT NULL DEFAULT 90`).

## Fuera de alcance (documentado, no se implementa salvo indicación futura)

- Horario de apertura/cierre del restaurante no se valida contra la hora de la reserva (ya era así antes de este cambio; decisión de producto pendiente, no relacionada con el solape de mesas).
- Duración uniforme por restaurante, no configurable por tipo de mesa/evento — posible iteración futura sobre este mismo mecanismo.

## Archivos afectados (estimado)

**Backend:**
- `restaurant/entity/Restaurant.java`, `restaurant/dto/RestaurantRequest.java`, `restaurant/dto/RestaurantMapper.java`, `restaurant/dto/RestaurantResponse.java`
- `db/migration/V6__add_reservation_duration.sql` (nuevo)
- `availability/service/AvailabilityService.java`
- `availability/dto/AvailabilityRequest.java`
- `reservation/service/ReservationService.java`
- `reservation/repository/ReservationRepository.java`
- `diningtable/repository/DiningTableRepository.java`

**Frontend:**
- `restaurante-frontend/src/pages/Restaurants.jsx`

**Tests:**
- `AvailabilityServiceTest` (ampliado), `ReservationServiceTest` (ampliado), `ReservationConcurrencyIntegrationTest` (nuevo), `RestaurantMapperTest`/`RestaurantRequestValidationTest` (ampliados/nuevos)
