# Selector de franjas horarias — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el `<input type="time">` de los flujos de reserva privado y público por una rejilla de franjas horarias cuya disponibilidad calcula el backend con las reglas de ocupación reales.

**Architecture:** `AvailabilityService` gana un método `getTimeSlots()` que genera la rejilla desde el horario del restaurante y marca cada franja reutilizando el cálculo de solape existente. Dos controladores finos (uno autenticado, uno público) exponen ese mismo método. El flujo público pasa a asignar una mesa provisional con caducidad (`hold_expires_at`) para que la rejilla refleje la ocupación real. En el frontend, un único componente `TimeSlotSelector` y un hook `useTimeSlots` alimentan los dos formularios.

**Tech Stack:** Spring Boot 3.3 / Java 21 / Maven / Flyway / JUnit 5 + Mockito · React 19 / Vite / Bootstrap 5 / pnpm / Vitest + Testing Library

**Spec:** [`docs/superpowers/specs/2026-07-30-selector-hora-reservas-design.md`](../specs/2026-07-30-selector-hora-reservas-design.md)

## Global Constraints

- **Un commit local por tarea en la rama `JRM-produccion`.** Autorizado expresamente por el usuario el 2026-07-30 para poder ejecutar el flujo subagent-driven (cada revisor necesita el diff aislado de su tarea). **`git push` y abrir Pull Requests siguen PROHIBIDOS.** Donde este plan dice "Checkpoint (NO commit)", léase: ejecutar las verificaciones y hacer el commit de la tarea; nunca `push`.
- Todo el código, comentarios, JavaDoc y texto de cara al usuario va en **español**.
- No modificar código ajeno a esta tarea ni las reglas de asignación de mesas.
- Flyway está activo en producción con `ddl-auto: validate`: **toda columna nueva exige migración**. La siguiente versión libre es `V7`.
- Rutas y nombres de rol se declaran en `common/util/Constants.java`, nunca inline.
- Los DTO usan nombres de campo en inglés (`time`, `available`), como el resto del proyecto.
- Toda consulta con ámbito de restaurante pasa por `CurrentUserService.validateRestaurantAccess()`.
- Las entidades filtran siempre por `deleted = false`.
- `RESERVATION_HOLD_EXPIRATION_MINUTES` = `720` por defecto. `RESERVATION_SLOT_INTERVAL_MINUTES` = `30` por defecto.
- Backend: ejecutar comandos desde `restaurante_manage/`. Frontend: desde `restaurante-frontend/`.
- **Nunca arrancar el backend con el perfil `dev`** para comprobaciones manuales: borra los datos reales del usuario. Los tests sí lo usan (H2 en memoria), y eso es correcto.

---

## Estructura de archivos

### Backend (`restaurante_manage/`)

| Archivo | Responsabilidad |
|---|---|
| `src/main/resources/db/migration/V7__add_reservation_hold.sql` | **Crear.** Columna `hold_expires_at`. |
| `src/main/java/com/restaurante/reservation/entity/Reservation.java` | Modificar. Campo `holdExpiresAt`. |
| `src/main/java/com/restaurante/availability/service/AvailabilityService.java` | Modificar. Descartar holds caducados en `hasOverlap`; nuevo `getTimeSlots()`. |
| `src/main/java/com/restaurante/availability/dto/TimeSlotResponse.java` | **Crear.** `{ time, available }`. |
| `src/main/java/com/restaurante/availability/controller/AvailabilityController.java` | Modificar. `GET /time-slots` autenticado + cerrar `POST /tables`. |
| `src/main/java/com/restaurante/publicapi/controller/PublicReservationController.java` | Modificar. `GET /time-slots` público. |
| `src/main/java/com/restaurante/publicapi/service/PublicReservationService.java` | Modificar. Bloqueo provisional al crear. |
| `src/main/java/com/restaurante/reservation/scheduler/ReservationHoldScheduler.java` | **Crear.** Limpieza de holds caducados. |
| `src/main/java/com/restaurante/reservation/service/ReservationService.java` | Modificar. Limpiar hold al confirmar/cancelar + método de limpieza. |
| `src/main/java/com/restaurante/reservation/dto/ReservationResponse.java` + `ReservationMapper.java` | Modificar. Exponer `holdExpiresAt` y `holdStatus`. |
| `src/main/java/com/restaurante/reservation/repository/ReservationRepository.java` | Modificar. Query de holds caducados. |
| `src/main/java/com/restaurante/security/config/SecurityConfig.java` | Modificar. Quitar `permitAll` de `POST /availability/**`. |
| `src/main/java/com/restaurante/common/util/Constants.java` | Modificar. Constantes de las rutas nuevas. |
| `src/main/resources/application.yml` | Modificar. Bloque `app.reservations`. |

### Frontend (`restaurante-frontend/`)

| Archivo | Responsabilidad |
|---|---|
| `src/components/TimeSlotSelector.jsx` | **Crear.** Rejilla de franjas, sin lógica de red. |
| `src/hooks/useTimeSlots.js` | **Crear.** Carga, limpieza al cambiar dependencias, cancelación. |
| `src/services/reservationService.js` | Modificar. `getTimeSlots()`. |
| `src/services/publicReservationService.js` | Modificar. `fetchPublicTimeSlots()`. |
| `src/pages/PublicReservation.jsx` | Modificar. Integrar la rejilla. |
| `src/pages/Reservations.jsx` | Modificar. Wizard 5 → 4 pasos + badge de bloqueo. |
| `src/index.css` | Modificar. Estilos `.time-slot-*`. |
| `vite.config.js`, `package.json`, `src/test/setup.js` | Modificar/crear. Infraestructura Vitest. |

---

## Task 1: Columna de bloqueo provisional

**Files:**
- Create: `restaurante_manage/src/main/resources/db/migration/V7__add_reservation_hold.sql`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/entity/Reservation.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/availability/service/AvailabilityService.java:117-139`
- Test: `restaurante_manage/src/test/java/com/restaurante/availability/service/AvailabilityServiceTest.java`

**Interfaces:**
- Produces: `Reservation.getHoldExpiresAt()` / `setHoldExpiresAt(LocalDateTime)`. Semántica: `null` = sin bloqueo (ocupa siempre); `> now` = bloqueo vivo (ocupa); `<= now` = caducado (no ocupa, pero la reserva sigue viva).

- [ ] **Step 1: Escribir los tests que fallan**

Añadir al final de `AvailabilityServiceTest`, antes de la llave de cierre de la clase. Reutilizan los helpers `reservaActiva(...)` y `request()` que ya existen en el archivo.

```java
    // ─── Bloqueo provisional (hold) de solicitudes públicas ──────────────

    private Reservation reservaConHold(LocalTime hora, LocalDateTime holdExpiresAt) {
        Reservation r = reservaActiva(DATE, hora, ReservationStatus.PENDING);
        r.setHoldExpiresAt(holdExpiresAt);
        return r;
    }

    @Test
    void isTableAvailable_holdVivoOcupaLaMesa() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaConHold(TIME, LocalDateTime.now().plusHours(6))));

        assertFalse(service.isTableAvailable(table, DATE, TIME, 2, null),
                "Un bloqueo provisional vivo debe ocupar la mesa");
    }

    @Test
    void isTableAvailable_holdCaducadoNoOcupaLaMesa() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaConHold(TIME, LocalDateTime.now().minusMinutes(1))));

        assertTrue(service.isTableAvailable(table, DATE, TIME, 2, null),
                "Un bloqueo provisional caducado debe liberar la mesa");
    }

    @Test
    void isTableAvailable_reservaSinHoldSiempreOcupa() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, TIME, ReservationStatus.PENDING)));

        assertFalse(service.isTableAvailable(table, DATE, TIME, 2, null),
                "Una reserva sin bloqueo (creada desde el panel) ocupa sin límite de tiempo");
    }
```

Añadir el import que falta al bloque de imports del archivo:

```java
import java.time.LocalDateTime;
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante_manage && mvn test -Dtest=AvailabilityServiceTest
```

Esperado: error de **compilación** — `cannot find symbol: method setHoldExpiresAt(LocalDateTime)`.

- [ ] **Step 3: Añadir el campo a la entidad**

En `Reservation.java`, después del campo `notes` (línea 55):

```java
    /**
     * Caducidad del bloqueo provisional de mesa de una solicitud pública.
     *
     * <p>{@code null} = reserva normal, ocupa su mesa sin límite de tiempo.
     * Fecha futura = bloqueo vivo, ocupa. Fecha pasada = bloqueo caducado: la
     * mesa queda libre para otros, pero la solicitud sigue en PENDING para que
     * el restaurante pueda gestionarla. La fecha caducada se conserva a
     * propósito: es lo que distingue una solicitud pública vencida de una
     * reserva privada que nunca tuvo bloqueo.</p>
     */
    @Column(name = "hold_expires_at")
    private LocalDateTime holdExpiresAt;
```

Y el import:

```java
import java.time.LocalDateTime;
```

- [ ] **Step 4: Descartar holds caducados en el cálculo de solape**

En `AvailabilityService.hasOverlap`, sustituir el bucle actual (líneas 131-137) por:

```java
        LocalDateTime ahora = LocalDateTime.now();
        for (Reservation candidata : candidatas) {
            // Un bloqueo provisional caducado ya no ocupa la mesa. Se filtra aquí
            // y no en el JPQL para no cambiar la firma del repositorio: hasOverlap
            // es el paso obligatorio de todo cálculo de ocupación (disponibilidad,
            // creación, edición y confirmación), así que basta con este punto.
            if (candidata.getHoldExpiresAt() != null
                    && !candidata.getHoldExpiresAt().isAfter(ahora)) {
                continue;
            }
            LocalDateTime otroInicio = LocalDateTime.of(candidata.getReservationDate(), candidata.getReservationTime());
            LocalDateTime otroFin = otroInicio.plusMinutes(durationMinutes);
            if (start.isBefore(otroFin) && otroInicio.isBefore(end)) {
                return true;
            }
        }
        return false;
```

Actualizar también el JavaDoc de clase (líneas 30-33) añadiendo al final del párrafo:

```java
 * Una reserva con bloqueo provisional caducado deja de ocupar su mesa de
 * inmediato, sin depender de ningún job de limpieza.
```

- [ ] **Step 5: Crear la migración**

`restaurante_manage/src/main/resources/db/migration/V7__add_reservation_hold.sql`:

```sql
-- V7 — Bloqueo provisional de mesa para solicitudes de reserva públicas.
--
-- Una solicitud pública se crea en PENDING con una mesa compatible asignada y
-- esta caducidad. Mientras no venza, esa mesa no se ofrece a nadie más. Al
-- vencer, la mesa se libera pero la solicitud sigue viva para que el
-- restaurante pueda confirmarla (revalidando disponibilidad en ese momento).
--
-- NULL = reserva sin bloqueo: las creadas desde el panel privado y las que ya
-- se han confirmado, cancelado o completado.
ALTER TABLE `reservations`
  ADD COLUMN `hold_expires_at` DATETIME NULL;
```

- [ ] **Step 6: Verificar que pasan**

```bash
cd restaurante_manage && mvn test -Dtest=AvailabilityServiceTest
```

Esperado: `BUILD SUCCESS`, todos los tests verdes (los 3 nuevos y los que ya existían).

- [ ] **Step 7: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test -Dtest=ReservationRepositoryTest,ReservationServiceTest
```

Esperado: `BUILD SUCCESS`. Confirma que añadir la columna no rompió nada. **No ejecutar `git commit`.**

---

## Task 2: Generación de la rejilla de franjas

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/availability/dto/TimeSlotResponse.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/availability/service/AvailabilityService.java`
- Modify: `restaurante_manage/src/main/resources/application.yml`
- Test: `restaurante_manage/src/test/java/com/restaurante/availability/service/AvailabilityServiceTest.java`

**Interfaces:**
- Consumes: `Reservation.getHoldExpiresAt()` (Task 1).
- Produces:
  - `TimeSlotResponse(LocalTime time, boolean available)` con `getTime()` / `isAvailable()`.
  - `AvailabilityService.getTimeSlots(Long restaurantId, LocalDate date, Integer partySize) → List<TimeSlotResponse>`. **No** comprueba autorización: eso es responsabilidad de cada controlador.

- [ ] **Step 1: Escribir los tests que fallan**

Al final de `AvailabilityServiceTest`:

```java
    // ─── getTimeSlots: generación de la rejilla ──────────────────────────

    private void configurarHorario(LocalTime apertura, LocalTime cierre) {
        restaurant.setOpeningTime(apertura);
        restaurant.setClosingTime(cierre);
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(Optional.of(restaurant));
        when(reservationRepository.findActiveByTableAndDateBetween(any(), any(), any(), any()))
                .thenReturn(List.of());
    }

    @Test
    void getTimeSlots_generaFranjasCada30MinDesdeLaApertura() {
        configurarHorario(LocalTime.of(13, 0), LocalTime.of(16, 0));

        List<TimeSlotResponse> slots = service.getTimeSlots(RESTAURANT_ID, DATE, 2);

        // 13:00-16:00 con 90 min: 14:30 aún cabe (termina justo a las 16:00), 15:00 no.
        assertEquals(
                List.of(LocalTime.of(13, 0), LocalTime.of(13, 30), LocalTime.of(14, 0), LocalTime.of(14, 30)),
                slots.stream().map(TimeSlotResponse::getTime).toList());
    }

    @Test
    void getTimeSlots_ultimaFranjaEsLaQueCabeEnteraAntesDelCierre() {
        // 13:00-16:00 con 90 min de duración: 14:30 terminaría a las 16:00 (cabe,
        // el límite es inclusivo), 15:00 se saldría del cierre.
        configurarHorario(LocalTime.of(13, 0), LocalTime.of(16, 0));

        List<TimeSlotResponse> slots = service.getTimeSlots(RESTAURANT_ID, DATE, 2);

        assertEquals(LocalTime.of(14, 30), slots.get(slots.size() - 1).getTime());
    }

    @Test
    void getTimeSlots_marcaComoNoDisponibleLaFranjaSinMesaValida() {
        configurarHorario(LocalTime.of(13, 0), LocalTime.of(16, 0));
        // La única mesa tiene capacidad 4; se piden 6 comensales.
        List<TimeSlotResponse> slots = service.getTimeSlots(RESTAURANT_ID, DATE, 6);

        assertFalse(slots.isEmpty(), "La rejilla se genera aunque no haya hueco");
        assertTrue(slots.stream().noneMatch(TimeSlotResponse::isAvailable),
                "Sin mesa con capacidad suficiente, ninguna franja está disponible");
    }

    @Test
    void getTimeSlots_marcaComoNoDisponibleLaFranjaConSolape() {
        configurarHorario(LocalTime.of(13, 0), LocalTime.of(16, 0));
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(13, 0), ReservationStatus.CONFIRMED)));

        List<TimeSlotResponse> slots = service.getTimeSlots(RESTAURANT_ID, DATE, 2);

        // 13:00-14:30 ocupada → 13:00, 13:30 y 14:00 solapan; 14:30 ya no.
        assertFalse(slots.get(0).isAvailable(), "13:00 solapa");
        assertFalse(slots.get(2).isAvailable(), "14:00 solapa");
        assertTrue(slots.get(3).isAvailable(), "14:30 arranca justo al terminar la anterior");
    }

    @Test
    void getTimeSlots_usaHorarioPorDefectoSiElRestauranteNoLoTiene() {
        configurarHorario(null, null);

        List<TimeSlotResponse> slots = service.getTimeSlots(RESTAURANT_ID, DATE, 2);

        assertEquals(LocalTime.of(12, 0), slots.get(0).getTime(),
                "Sin horario configurado se usa el rango por defecto 12:00-23:00");
    }

    @Test
    void getTimeSlots_omiteLasFranjasPasadasCuandoLaFechaEsHoy() {
        configurarHorario(LocalTime.of(0, 0), LocalTime.of(23, 59));

        List<TimeSlotResponse> slots = service.getTimeSlots(RESTAURANT_ID, LocalDate.now(), 2);

        LocalTime ahora = LocalTime.now();
        assertTrue(slots.stream().allMatch(s -> s.getTime().isAfter(ahora)),
                "Para hoy no se ofrece ninguna franja ya pasada");
    }

    @Test
    void getTimeSlots_devuelveVacioSiElCierreEsAnteriorALaApertura() {
        // Cierre pasada la medianoche: fuera de alcance en esta iteración.
        configurarHorario(LocalTime.of(20, 0), LocalTime.of(2, 0));

        assertTrue(service.getTimeSlots(RESTAURANT_ID, DATE, 2).isEmpty());
    }
```

Añadir a los imports del test:

```java
import com.restaurante.availability.dto.TimeSlotResponse;
import com.restaurante.restaurant.repository.RestaurantRepository;
```

Y declarar el mock nuevo junto a los otros dos `@Mock` (línea 41):

```java
    @Mock private RestaurantRepository restaurantRepository;
```

Por último, `service` deja de poder construirse con `@InjectMocks` solo por campos: sustituir la línea `@InjectMocks private AvailabilityService service;` por una construcción explícita al final de `setUp()`, porque el servicio pasa a recibir también los valores de configuración:

```java
    private AvailabilityService service;
```

y al final de `setUp()`:

```java
        service = new AvailabilityService(diningTableRepository, reservationRepository,
                restaurantRepository, 30, LocalTime.of(12, 0), LocalTime.of(23, 0));
```

Eliminar el import de `org.mockito.InjectMocks` si deja de usarse.

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante_manage && mvn test -Dtest=AvailabilityServiceTest
```

Esperado: error de compilación — `package com.restaurante.availability.dto.TimeSlotResponse does not exist`.

- [ ] **Step 3: Crear el DTO**

`restaurante_manage/src/main/java/com/restaurante/availability/dto/TimeSlotResponse.java`:

```java
package com.restaurante.availability.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalTime;

/**
 * Una franja horaria de la rejilla de reservas.
 *
 * <p>Contiene exclusivamente la hora y si admite reserva. Nunca lleva ids ni
 * números de mesa, capacidades ni dato alguno de reservas ajenas: es la misma
 * carga que se devuelve al formulario público, que no está autenticado.</p>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TimeSlotResponse {

    @JsonFormat(pattern = "HH:mm:ss")
    private LocalTime time;

    private boolean available;
}
```

- [ ] **Step 4: Añadir la configuración**

En `application.yml`, dentro del bloque `app:`, después de `password-reset:` (línea 85):

```yaml
  reservations:
    # Salto entre franjas de la rejilla de reservas, en minutos.
    slot-interval-minutes: ${RESERVATION_SLOT_INTERVAL_MINUTES:30}
    # Minutos que una solicitud pública retiene provisionalmente su mesa. El
    # bloqueo nunca sobrevive a la hora de inicio de la propia reserva.
    hold-expiration-minutes: ${RESERVATION_HOLD_EXPIRATION_MINUTES:720}
    # Horario usado cuando el restaurante no tiene apertura/cierre configurados.
    default-opening-time: "${RESERVATION_DEFAULT_OPENING_TIME:12:00}"
    default-closing-time: "${RESERVATION_DEFAULT_CLOSING_TIME:23:00}"
```

- [ ] **Step 5: Implementar `getTimeSlots`**

En `AvailabilityService`, sustituir la declaración de dependencias y el `@RequiredArgsConstructor` por un constructor explícito (hace falta para inyectar los `@Value`):

```java
@Service
@Slf4j
public class AvailabilityService {

    private final DiningTableRepository diningTableRepository;
    private final ReservationRepository reservationRepository;
    private final RestaurantRepository restaurantRepository;
    private final int slotIntervalMinutes;
    private final LocalTime defaultOpeningTime;
    private final LocalTime defaultClosingTime;

    public AvailabilityService(
            DiningTableRepository diningTableRepository,
            ReservationRepository reservationRepository,
            RestaurantRepository restaurantRepository,
            @Value("${app.reservations.slot-interval-minutes:30}") int slotIntervalMinutes,
            @Value("${app.reservations.default-opening-time:12:00}") LocalTime defaultOpeningTime,
            @Value("${app.reservations.default-closing-time:23:00}") LocalTime defaultClosingTime) {
        this.diningTableRepository = diningTableRepository;
        this.reservationRepository = reservationRepository;
        this.restaurantRepository = restaurantRepository;
        this.slotIntervalMinutes = slotIntervalMinutes;
        this.defaultOpeningTime = defaultOpeningTime;
        this.defaultClosingTime = defaultClosingTime;
    }
```

Quitar el import de `lombok.RequiredArgsConstructor` y añadir:

```java
import com.restaurante.availability.dto.TimeSlotResponse;
import com.restaurante.restaurant.repository.RestaurantRepository;
import org.springframework.beans.factory.annotation.Value;
import java.util.ArrayList;
```

Añadir el método público, después de `checkAvailability`:

```java
    /**
     * Rejilla de franjas horarias de un restaurante para una fecha y un número
     * de comensales.
     *
     * <p>Las franjas van desde la apertura, en saltos de
     * {@code app.reservations.slot-interval-minutes}, mientras la reserva completa
     * quepa antes del cierre. Si la fecha es hoy, las franjas ya pasadas se omiten
     * aquí: el frontend nunca decide qué horas mostrar.</p>
     *
     * <p>Una franja está disponible cuando existe al menos una mesa que la admita
     * según {@link #isTableAvailable}, es decir: capacidad suficiente, fuera de
     * mantenimiento y sin solape con ninguna reserva viva.</p>
     *
     * <p>Este método NO comprueba autorización. Cada controlador es responsable de
     * validar el acceso al restaurante antes de llamarlo.</p>
     */
    public List<TimeSlotResponse> getTimeSlots(Long restaurantId, LocalDate date, Integer partySize) {
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        List<LocalTime> horas = generarFranjas(restaurant, date);
        if (horas.isEmpty()) {
            log.debug("Sin franjas para restaurante {} el {}", restaurantId, date);
            return List.of();
        }

        List<DiningTable> mesas = diningTableRepository.findByRestaurantIdAndDeletedFalse(restaurantId);

        List<TimeSlotResponse> slots = horas.stream()
                .map(hora -> new TimeSlotResponse(hora, mesas.stream()
                        .anyMatch(mesa -> isTableAvailable(mesa, date, hora, partySize, null))))
                .toList();

        log.info("Rejilla para restaurante {} el {} ({} comensales): {} de {} franjas disponibles",
                restaurantId, date, partySize,
                slots.stream().filter(TimeSlotResponse::isAvailable).count(), slots.size());

        return slots;
    }

    /**
     * Horas candidatas de la rejilla. La última es la que cabe entera: su hora
     * más la duración de la reserva no puede pasar del cierre (límite inclusivo,
     * una reserva puede terminar justo a la hora de cierre).
     *
     * <p>Si el cierre no es posterior a la apertura, el restaurante cierra pasada
     * la medianoche: no se generan franjas, porque una hora de madrugada
     * pertenecería al día siguiente y contradiría la fecha elegida en el
     * formulario. Queda documentado como fuera de alcance en el diseño.</p>
     */
    private List<LocalTime> generarFranjas(Restaurant restaurant, LocalDate date) {
        LocalTime apertura = restaurant.getOpeningTime() != null
                ? restaurant.getOpeningTime() : defaultOpeningTime;
        LocalTime cierre = restaurant.getClosingTime() != null
                ? restaurant.getClosingTime() : defaultClosingTime;

        if (!cierre.isAfter(apertura)) {
            log.debug("Restaurante {} cierra a las {} (no posterior a la apertura {}): sin franjas",
                    restaurant.getId(), cierre, apertura);
            return List.of();
        }

        int duracion = restaurant.getDefaultReservationDurationMinutes();
        boolean esHoy = date.equals(LocalDate.now());
        LocalTime ahora = LocalTime.now();

        List<LocalTime> horas = new ArrayList<>();
        for (LocalTime hora = apertura;
             !hora.plusMinutes(duracion).isAfter(cierre);
             hora = hora.plusMinutes(slotIntervalMinutes)) {
            if (esHoy && !hora.isAfter(ahora)) {
                continue;
            }
            horas.add(hora);
        }
        return horas;
    }
```

**Nota sobre el bucle:** el incremento con `plusMinutes` sobre `LocalTime` da la vuelta a medianoche sin avisar, pero la guarda `!cierre.isAfter(apertura)` de arriba ya garantiza que la ventana no cruza el día, así que la condición de parada siempre se alcanza.

- [ ] **Step 6: Verificar que pasan**

```bash
cd restaurante_manage && mvn test -Dtest=AvailabilityServiceTest
```

Esperado: `BUILD SUCCESS` con los 7 tests nuevos verdes.

- [ ] **Step 7: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test
```

Esperado: `BUILD SUCCESS`. La suite completa debe seguir verde: `AvailabilityService` ha cambiado de constructor y lo consume `ReservationService`. **No ejecutar `git commit`.**

---

## Task 3: Endpoint privado y cierre del endpoint filtrado

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/availability/controller/AvailabilityController.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/security/config/SecurityConfig.java:66-67`
- Test: `restaurante_manage/src/test/java/com/restaurante/availability/controller/TimeSlotEndpointIntegrationTest.java` (crear)

**Interfaces:**
- Consumes: `AvailabilityService.getTimeSlots(...)` (Task 2).
- Produces: `GET /api/v1/availability/time-slots?restaurantId=&date=&partySize=` → `ApiResponse<List<TimeSlotResponse>>`, autenticado.

- [ ] **Step 1: Escribir el test que falla**

Crear `restaurante_manage/src/test/java/com/restaurante/availability/controller/TimeSlotEndpointIntegrationTest.java`. Sigue el patrón de `P0VulnerabilidadesEndpointIntegrationTest`; leerlo antes para copiar la forma exacta de montar el contexto y autenticarse.

```java
package com.restaurante.availability.controller;

import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.time.LocalDate;
import java.time.LocalTime;

import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Rejilla de franjas horarias: aislamiento entre restaurantes en el endpoint
 * privado y ausencia de datos sensibles en el público.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class TimeSlotEndpointIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private DiningTableRepository diningTableRepository;

    private Long restauranteId;
    private String fecha;

    @BeforeEach
    void setUp() {
        Restaurant restaurante = new Restaurant();
        restaurante.setName("Franjas Test");
        restaurante.setOpeningTime(LocalTime.of(13, 0));
        restaurante.setClosingTime(LocalTime.of(16, 0));
        restaurante.setDefaultReservationDurationMinutes(90);
        restaurante.setPublicBookingEnabled(true);
        restauranteId = restaurantRepository.save(restaurante).getId();

        DiningTable mesa = new DiningTable();
        mesa.setRestaurant(restaurante);
        mesa.setTableNumber("T1");
        mesa.setCapacity(4);
        mesa.setStatus(TableStatus.AVAILABLE);
        diningTableRepository.save(mesa);

        fecha = LocalDate.now().plusDays(30).toString();
    }

    @Test
    void endpointPrivado_requiereAutenticacion() throws Exception {
        mockMvc.perform(get("/api/v1/availability/time-slots")
                        .param("restaurantId", String.valueOf(restauranteId))
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithMockUser(username = "super.admin", roles = "SUPER_ADMIN")
    void endpointPrivado_devuelveLaRejilla() throws Exception {
        mockMvc.perform(get("/api/v1/availability/time-slots")
                        .param("restaurantId", String.valueOf(restauranteId))
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].time").value("13:00:00"))
                .andExpect(jsonPath("$.data[0].available").value(true));
    }

    @Test
    void endpointDeMesas_yaNoEsPublico() throws Exception {
        // POST /availability/tables expone número, capacidad y ubicación de las
        // mesas: deja de ser accesible sin autenticación.
        mockMvc.perform(post("/api/v1/availability/tables")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"restaurantId\":" + restauranteId
                                + ",\"date\":\"" + fecha + "\",\"time\":\"13:00:00\",\"partySize\":2}"))
                .andExpect(status().isUnauthorized());
    }
}
```

- [ ] **Step 2: Verificar que falla**

```bash
cd restaurante_manage && mvn test -Dtest=TimeSlotEndpointIntegrationTest
```

Esperado: FAIL — `endpointPrivado_devuelveLaRejilla` da 404 porque la ruta no existe.

- [ ] **Step 3: Añadir la constante de ruta**

En `Constants.java`, junto a `AVAILABILITY_PATH` (línea 47):

```java
    public static final String AVAILABILITY_TIME_SLOTS_SUBPATH = "/time-slots";
```

- [ ] **Step 4: Añadir el endpoint**

En `AvailabilityController`, después de `checkAvailability`:

```java
    @GetMapping(Constants.AVAILABILITY_TIME_SLOTS_SUBPATH)
    @Operation(summary = "Rejilla de franjas horarias",
            description = "Devuelve las franjas horarias del restaurante para una fecha y número de "
                    + "comensales, indicando cuáles admiten reserva. Requiere acceso al restaurante.")
    public ResponseEntity<ApiResponse<List<TimeSlotResponse>>> getTimeSlots(
            @RequestParam Long restaurantId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(defaultValue = "1") @Min(1) @Max(50) Integer partySize) {

        currentUserService.validateRestaurantAccess(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(
                availabilityService.getTimeSlots(restaurantId, date, partySize)));
    }
```

Añadir el campo inyectado a la clase:

```java
    private final CurrentUserService currentUserService;
```

Y los imports:

```java
import com.restaurante.availability.dto.TimeSlotResponse;
import com.restaurante.common.security.CurrentUserService;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.format.annotation.DateTimeFormat;
import java.time.LocalDate;
```

Anotar la clase con `@Validated` (de `org.springframework.validation.annotation.Validated`) para que `@Min`/`@Max` sobre `@RequestParam` se apliquen.

- [ ] **Step 5: Cerrar el endpoint de mesas**

En `SecurityConfig`, borrar estas dos líneas (66-67):

```java
                        // Público: consultar disponibilidad
                        .requestMatchers(HttpMethod.POST, Constants.AVAILABILITY_PATH + "/**").permitAll()
```

En `AvailabilityController.checkAvailability`, añadir como primera línea del cuerpo:

```java
        currentUserService.validateRestaurantAccess(request.getRestaurantId());
```

Y corregir la descripción de la anotación `@Operation`, que decía "(público)":

```java
    @Operation(summary = "Consultar disponibilidad",
            description = "Verifica mesas disponibles en un restaurante para una fecha y número de "
                    + "comensales. Requiere acceso al restaurante: expone número, capacidad y "
                    + "ubicación de las mesas.")
```

- [ ] **Step 6: Verificar que pasan**

```bash
cd restaurante_manage && mvn test -Dtest=TimeSlotEndpointIntegrationTest
```

Esperado: `BUILD SUCCESS`, 3 tests verdes.

- [ ] **Step 7: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test -Dtest=CorsConfigurationIntegrationTest,P0VulnerabilidadesEndpointIntegrationTest
```

Esperado: `BUILD SUCCESS`. Si alguno asumía que `/availability` era público, actualizarlo: el cambio es intencionado. **No ejecutar `git commit`.**

---

## Task 4: Endpoint público de franjas

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/publicapi/controller/PublicReservationController.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/publicapi/service/PublicReservationService.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/availability/controller/TimeSlotEndpointIntegrationTest.java`

**Interfaces:**
- Consumes: `AvailabilityService.getTimeSlots(...)` (Task 2).
- Produces: `GET /api/v1/public/restaurants/{restaurantId}/time-slots?date=&partySize=` → `ApiResponse<List<TimeSlotResponse>>`, sin autenticación; y `PublicReservationService.getPublicTimeSlots(Long, LocalDate, Integer) → List<TimeSlotResponse>`.

- [ ] **Step 1: Escribir los tests que fallan**

Añadir a `TimeSlotEndpointIntegrationTest`:

```java
    @Test
    void endpointPublico_noRequiereAutenticacion() throws Exception {
        mockMvc.perform(get("/api/v1/public/restaurants/" + restauranteId + "/time-slots")
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].time").value("13:00:00"));
    }

    @Test
    void endpointPublico_soloExponeHoraYDisponibilidad() throws Exception {
        mockMvc.perform(get("/api/v1/public/restaurants/" + restauranteId + "/time-slots")
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isOk())
                // Exactamente dos claves por franja: nada de mesas ni de clientes.
                .andExpect(jsonPath("$.data[0].length()").value(2))
                .andExpect(jsonPath("$.data[0].tableId").doesNotExist())
                .andExpect(jsonPath("$.data[0].tableNumber").doesNotExist())
                .andExpect(jsonPath("$.data[0].capacity").doesNotExist())
                .andExpect(jsonPath("$.data[0].customerName").doesNotExist());
    }

    @Test
    @WithMockUser(username = "super.admin", roles = "SUPER_ADMIN")
    void publicoYPrivadoDevuelvenLaMismaRejilla() throws Exception {
        String privado = mockMvc.perform(get("/api/v1/availability/time-slots")
                        .param("restaurantId", String.valueOf(restauranteId))
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andReturn().getResponse().getContentAsString();

        String publico = mockMvc.perform(get("/api/v1/public/restaurants/" + restauranteId + "/time-slots")
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andReturn().getResponse().getContentAsString();

        com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
        org.junit.jupiter.api.Assertions.assertEquals(
                om.readTree(privado).get("data"),
                om.readTree(publico).get("data"),
                "Ambos flujos deben aplicar exactamente las mismas reglas de disponibilidad");
    }

    @Test
    void endpointPublico_rechazaRestauranteConReservasPublicasDesactivadas() throws Exception {
        Restaurant cerrado = new Restaurant();
        cerrado.setName("Sin reservas públicas");
        cerrado.setOpeningTime(LocalTime.of(13, 0));
        cerrado.setClosingTime(LocalTime.of(16, 0));
        cerrado.setDefaultReservationDurationMinutes(90);
        cerrado.setPublicBookingEnabled(false);
        Long cerradoId = restaurantRepository.save(cerrado).getId();

        mockMvc.perform(get("/api/v1/public/restaurants/" + cerradoId + "/time-slots")
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isBadRequest());
    }
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante_manage && mvn test -Dtest=TimeSlotEndpointIntegrationTest
```

Esperado: FAIL con 404 en los cuatro tests nuevos.

- [ ] **Step 3: Añadir el método de servicio**

En `PublicReservationService`, después de `getPublicRestaurant`:

```java
    /**
     * Rejilla de franjas horarias para el formulario público.
     *
     * <p>Delega en {@link AvailabilityService#getTimeSlots}, el mismo método que
     * usa el panel privado: las reglas de disponibilidad no pueden divergir entre
     * ambos flujos. Lo único que añade aquí es exigir que el restaurante acepte
     * reservas públicas.</p>
     */
    public List<TimeSlotResponse> getPublicTimeSlots(Long restaurantId, LocalDate date, Integer partySize) {
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        if (Boolean.FALSE.equals(restaurant.getPublicBookingEnabled())) {
            throw new BadRequestException("Este restaurante no acepta reservas públicas en este momento");
        }

        return availabilityService.getTimeSlots(restaurantId, date, partySize);
    }
```

Añadir la dependencia al constructor generado por `@RequiredArgsConstructor`:

```java
    private final AvailabilityService availabilityService;
```

Y los imports:

```java
import com.restaurante.availability.dto.TimeSlotResponse;
import com.restaurante.availability.service.AvailabilityService;
import java.time.LocalDate;
```

- [ ] **Step 4: Añadir el endpoint**

En `PublicReservationController`, después de `getPublicRestaurant`:

```java
    @GetMapping(Constants.AVAILABILITY_TIME_SLOTS_SUBPATH)
    @Operation(summary = "Franjas horarias disponibles",
            description = "Devuelve las franjas horarias del restaurante para una fecha y número de "
                    + "comensales, indicando cuáles admiten reserva. Solo expone hora y disponibilidad: "
                    + "ningún dato de mesas ni de otras reservas.")
    public ResponseEntity<ApiResponse<List<TimeSlotResponse>>> getPublicTimeSlots(
            @PathVariable Long restaurantId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(defaultValue = "1") @Min(1) @Max(50) Integer partySize) {

        return ResponseEntity.ok(ApiResponse.success(
                publicReservationService.getPublicTimeSlots(restaurantId, date, partySize)));
    }
```

Imports y `@Validated` en la clase, igual que en la Task 3:

```java
import com.restaurante.availability.dto.TimeSlotResponse;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.validation.annotation.Validated;
import java.time.LocalDate;
import java.util.List;
```

- [ ] **Step 5: Verificar que pasan**

```bash
cd restaurante_manage && mvn test -Dtest=TimeSlotEndpointIntegrationTest
```

Esperado: `BUILD SUCCESS`, 7 tests verdes. Cubre los requisitos **10** (mismas reglas), **11** (aislamiento) y **12** (sin datos sensibles).

- [ ] **Step 6: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test
```

Esperado: `BUILD SUCCESS`. **No ejecutar `git commit`.**

---

## Task 5: Bloqueo provisional al crear una solicitud pública

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/publicapi/service/PublicReservationService.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/publicapi/service/PublicReservationServiceTest.java`

**Interfaces:**
- Consumes: `AvailabilityService.isTableAvailable(...)`, `assertNoOverlap(...)`, `Reservation.setHoldExpiresAt(...)`.
- Produces: solicitudes públicas creadas con mesa asignada y `holdExpiresAt = min(now + holdMinutes, inicio de la reserva)`. Devuelve **409** (`ConflictException`) cuando ninguna mesa admite la franja.

- [ ] **Step 1: Escribir los tests que fallan**

Leer primero `PublicReservationServiceTest` para reutilizar sus mocks y helpers. Añadir:

```java
    @Test
    void createReservationRequest_asignaMesaYBloqueoProvisional() {
        // Restaurante con una mesa libre de capacidad 4, reserva mañana a las 21:00.
        PublicReservationResponse response = service.createReservationRequest(RESTAURANT_ID, requestValido());

        ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
        verify(reservationRepository).save(captor.capture());
        Reservation guardada = captor.getValue();

        assertNotNull(guardada.getDiningTable(), "La solicitud pública debe retener una mesa");
        assertNotNull(guardada.getHoldExpiresAt(), "Debe llevar caducidad de bloqueo");
        assertEquals(ReservationStatus.PENDING, guardada.getStatus());
        assertNotNull(response.getReservationId());
    }

    @Test
    void createReservationRequest_elBloqueoNuncaSobreviveALaHoraDeLaReserva() {
        // Reserva dentro de 2 horas y caducidad configurada en 720 min (12 h):
        // debe recortarse a la hora de inicio de la reserva.
        LocalDateTime inicio = LocalDateTime.now().plusHours(2).withSecond(0).withNano(0);
        PublicReservationRequest request = requestValido();
        request.setReservationDate(inicio.toLocalDate());
        request.setReservationTime(inicio.toLocalTime());

        service.createReservationRequest(RESTAURANT_ID, request);

        ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
        verify(reservationRepository).save(captor.capture());

        assertEquals(inicio, captor.getValue().getHoldExpiresAt(),
                "Con 12 h de caducidad y la reserva dentro de 2 h, el bloqueo vence al empezar la reserva");
    }

    @Test
    void createReservationRequest_rechazaConflictoSiNingunaMesaAdmiteLaFranja() {
        when(availabilityService.isTableAvailable(any(), any(), any(), any(), any())).thenReturn(false);

        ConflictException ex = assertThrows(ConflictException.class,
                () -> service.createReservationRequest(RESTAURANT_ID, requestValido()));

        assertTrue(ex.getMessage().contains("acaba de ocuparse"));
        verify(reservationRepository, never()).save(any());
    }

    @Test
    void createReservationRequest_rechazaHoraYaPasadaDelDiaDeHoy() {
        PublicReservationRequest request = requestValido();
        request.setReservationDate(LocalDate.now());
        request.setReservationTime(LocalTime.of(0, 1));

        assertThrows(BadRequestException.class,
                () -> service.createReservationRequest(RESTAURANT_ID, request));
    }
```

**Importante:** `holdExpirationMinutes` se inyecta con `@Value`, así que en un test de
Mockito vale `0` y el bloqueo caducaría al instante. Fijarlo al final de `setUp()`:

```java
        org.springframework.test.util.ReflectionTestUtils.setField(service, "holdExpirationMinutes", 720);
```

Si el archivo de test aún no tiene un helper `requestValido()`, crearlo:

```java
    private PublicReservationRequest requestValido() {
        PublicReservationRequest request = new PublicReservationRequest();
        request.setCustomerName("Ana García");
        request.setPhone("600123456");
        request.setEmail("ana@test.com");
        request.setReservationDate(LocalDate.now().plusDays(1));
        request.setReservationTime(LocalTime.of(21, 0));
        request.setPartySize(2);
        request.setNotes("");
        return request;
    }
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante_manage && mvn test -Dtest=PublicReservationServiceTest
```

Esperado: FAIL — la mesa guardada es `null` y no hay `holdExpiresAt`.

- [ ] **Step 3: Implementar el bloqueo**

En `PublicReservationService`, sustituir el paso 3 de `createReservationRequest` (líneas 87-98) por:

```java
        // 3. Validar que la reserva no es para un momento ya pasado. La anotación
        //    @FutureOrPresent del request solo valida el día, no la hora.
        LocalDateTime inicio = LocalDateTime.of(request.getReservationDate(), request.getReservationTime());
        if (inicio.isBefore(LocalDateTime.now())) {
            throw new BadRequestException("La hora de la reserva ya ha pasado.");
        }

        // 4. Retener provisionalmente una mesa compatible.
        DiningTable mesa = retenerMesa(restaurant, request);

        // 5. Crear la reserva PENDING con la mesa retenida.
        Reservation reservation = new Reservation();
        reservation.setCustomer(customer);
        reservation.setRestaurant(restaurant);
        reservation.setDiningTable(mesa);
        reservation.setReservationDate(request.getReservationDate());
        reservation.setReservationTime(request.getReservationTime());
        reservation.setPartySize(request.getPartySize());
        reservation.setNotes(request.getNotes());
        reservation.setStatus(ReservationStatus.PENDING);
        reservation.setHoldExpiresAt(calcularCaducidadBloqueo(restaurant, inicio));

        Reservation saved = reservationRepository.save(reservation);
```

**La selección de mesa vive en `AvailabilityService`, no aquí.** `CLAUDE.md` y el
JavaDoc de esa clase la declaran autoridad única de disponibilidad ("ninguna otra
clase reimplementa esta lógica"); duplicar aquí el filtrado de candidatas violaría esa
invariante. Añadir a `AvailabilityService`, junto a `assignFirstAvailableTable`:

```java
    /**
     * Retiene una mesa compatible para la franja solicitada, con bloqueo.
     *
     * <p>A diferencia de {@link #assignFirstAvailableTable}, que solo escanea, este
     * método deja la mesa efectivamente reservada dentro de la transacción del
     * llamante: recorre las candidatas <strong>ordenadas por id</strong> y sobre cada
     * una llama a {@link #assertNoOverlap}, que adquiere el bloqueo pesimista sobre
     * la fila antes de comprobar el solape. El orden determinista es lo que evita
     * interbloqueos: todas las transacciones piden los cerrojos en la misma
     * secuencia. Si otra transacción se lleva una candidata, se prueba la siguiente
     * en lugar de fallar.</p>
     *
     * <p>{@code assertNoOverlap} no abre transacción propia, así que capturar su
     * excepción aquí no marca la transacción como rollback-only.</p>
     *
     * @return la mesa retenida, o vacío si ninguna admite la franja
     */
    public Optional<DiningTable> holdFirstAvailableTable(Restaurant restaurant, LocalDate date,
                                                          LocalTime time, Integer partySize) {
        List<DiningTable> candidatas = diningTableRepository
                .findByRestaurantIdAndDeletedFalse(restaurant.getId()).stream()
                .filter(mesa -> isTableAvailable(mesa, date, time, partySize, null))
                .sorted(Comparator.comparing(DiningTable::getId))
                .toList();

        for (DiningTable candidata : candidatas) {
            try {
                assertNoOverlap(candidata, date, time, null);
                return Optional.of(candidata);
            } catch (ConflictException e) {
                log.debug("Mesa {} tomada por otra transacción, probando la siguiente", candidata.getId());
            }
        }
        return Optional.empty();
    }
```

con `import java.util.Comparator;`. Y en `PublicReservationService`, un envoltorio fino:

```java
    private DiningTable retenerMesa(Restaurant restaurant, PublicReservationRequest request) {
        return availabilityService.holdFirstAvailableTable(restaurant, request.getReservationDate(),
                        request.getReservationTime(), request.getPartySize())
                .orElseThrow(() -> new ConflictException("Esa franja acaba de ocuparse. Elige otra hora."));
    }

    /**
     * Caducidad del bloqueo: lo que ocurra antes entre la ventana configurada y
     * la hora de inicio de la propia reserva. Un bloqueo nunca sobrevive al
     * comienzo del servicio que retiene.
     */
    private LocalDateTime calcularCaducidadBloqueo(Restaurant restaurant, LocalDateTime inicioReserva) {
        LocalDateTime porVentana = LocalDateTime.now().plusMinutes(resolveHoldMinutes(restaurant));
        return porVentana.isBefore(inicioReserva) ? porVentana : inicioReserva;
    }

    /**
     * Minutos de bloqueo aplicables a un restaurante. Hoy siempre el valor global.
     * Punto único de cambio para hacerlo configurable por restaurante: bastará con
     * añadir la columna y devolverla aquí cuando no sea nula.
     */
    private int resolveHoldMinutes(Restaurant restaurant) {
        return holdExpirationMinutes;
    }
```

Añadir a la clase las dependencias nuevas y el campo de configuración. Se mantiene
`@RequiredArgsConstructor` y el valor se inyecta por campo: `@Value` no funciona sobre
parámetros de un constructor generado por Lombok, y el campo no puede ser `final`.

```java
    private final AvailabilityService availabilityService;

    @Value("${app.reservations.hold-expiration-minutes:720}")
    private int holdExpirationMinutes;
```

Imports necesarios:

```java
import com.restaurante.diningtable.entity.DiningTable;
import org.springframework.beans.factory.annotation.Value;
import java.time.LocalDateTime;
```

Cambiar la anotación del método a:

```java
    @Transactional(isolation = Isolation.READ_COMMITTED)
```

con `import org.springframework.transaction.annotation.Isolation;`.

Actualizar el JavaDoc del método, que decía "Crea una reserva con estado PENDING sin mesa asignada":

```java
    /**
     * Crea una solicitud de reserva pública (sin autenticación).
     * - Valida restaurante, reservas públicas habilitadas y que la franja no haya pasado.
     * - Busca o crea el cliente por email dentro del restaurante.
     * - Retiene provisionalmente una mesa compatible y crea la reserva en PENDING.
     * - Devuelve 409 si ninguna mesa admite la franja solicitada.
     */
```

- [ ] **Step 4: Verificar que pasan**

```bash
cd restaurante_manage && mvn test -Dtest=PublicReservationServiceTest
```

Esperado: `BUILD SUCCESS`.

- [ ] **Step 5: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test
```

Esperado: `BUILD SUCCESS`. **No ejecutar `git commit`.** Ojo: si algún test antiguo afirmaba que la reserva pública se crea sin mesa, ese comportamiento ha cambiado a propósito — actualizar la aserción y su comentario.

---

## Task 6: Liberación del bloqueo y visibilidad en el panel

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/reservation/scheduler/ReservationHoldScheduler.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationResponse.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationMapper.java`
- Modify: `restaurante_manage/src/main/resources/application.yml`
- Test: `restaurante_manage/src/test/java/com/restaurante/reservation/dto/ReservationMapperTest.java`

**Interfaces:**
- Produces:
  - `ReservationResponse.holdExpiresAt` (`LocalDateTime`, nulo) y `ReservationResponse.holdStatus` (`String`: `"NONE"` | `"ACTIVE"` | `"EXPIRED"`).
  - `ReservationService.releaseExpiredHolds() → int`, número de bloqueos liberados.

- [ ] **Step 1: Escribir los tests que fallan**

En `ReservationMapperTest`:

```java
    @Test
    void toResponse_holdStatusNoneSiNoHayBloqueo() {
        Reservation reserva = reservaBase();
        reserva.setHoldExpiresAt(null);

        assertEquals("NONE", mapper.toResponse(reserva).getHoldStatus());
    }

    @Test
    void toResponse_holdStatusActiveSiElBloqueoSigueVivo() {
        Reservation reserva = reservaBase();
        reserva.setHoldExpiresAt(LocalDateTime.now().plusHours(3));

        assertEquals("ACTIVE", mapper.toResponse(reserva).getHoldStatus());
    }

    @Test
    void toResponse_holdStatusExpiredSiElBloqueoYaVencio() {
        Reservation reserva = reservaBase();
        reserva.setHoldExpiresAt(LocalDateTime.now().minusMinutes(1));

        assertEquals("EXPIRED", mapper.toResponse(reserva).getHoldStatus());
    }
```

Usar el helper de construcción de `Reservation` que ya exista en ese archivo; si se llama distinto de `reservaBase()`, adaptar las tres llamadas.

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante_manage && mvn test -Dtest=ReservationMapperTest
```

Esperado: error de compilación — `cannot find symbol: method getHoldStatus()`.

- [ ] **Step 3: Exponer el estado del bloqueo**

En `ReservationResponse`, después de `notes`:

```java
    /** Caducidad del bloqueo provisional; null si la reserva no tiene bloqueo. */
    private LocalDateTime holdExpiresAt;

    /** NONE (sin bloqueo) | ACTIVE (bloqueo vivo) | EXPIRED (bloqueo caducado). */
    private String holdStatus;
```

En `ReservationMapper.toResponse`, antes del `return`:

```java
        LocalDateTime holdExpiresAt = reservation.getHoldExpiresAt();
        String holdStatus;
        if (holdExpiresAt == null) {
            holdStatus = "NONE";
        } else if (holdExpiresAt.isAfter(LocalDateTime.now())) {
            holdStatus = "ACTIVE";
        } else {
            holdStatus = "EXPIRED";
        }
```

y añadir al builder, antes de `.build()`:

```java
                .holdExpiresAt(holdExpiresAt)
                .holdStatus(holdStatus)
```

Import: `import java.time.LocalDateTime;`.

- [ ] **Step 4: Limpiar el bloqueo en los cambios de estado**

En `ReservationService.updateStatus`, dentro del bloque `if (newStatus == ReservationStatus.CONFIRMED)`, justo antes de `eventPublisher.publishEvent(...)` (línea 463):

```java
            // El bloqueo provisional deja de tener sentido: la mesa pasa a estar
            // ocupada en firme.
            reservation.setHoldExpiresAt(null);
```

Y en los bloques de `CANCELLED` y de `COMPLETED`/`NO_SHOW`, como primera línea de cada uno:

```java
            reservation.setHoldExpiresAt(null);
```

Colocarla **fuera** del `if (reservation.getDiningTable() != null)` de cada bloque, para que también se limpie en una solicitud cuyo bloqueo ya había caducado y perdido la mesa.

- [ ] **Step 5: Añadir la consulta y el método de liberación**

En `ReservationRepository`:

```java
    /**
     * Solicitudes PENDING cuyo bloqueo provisional ya venció pero que todavía
     * retienen la mesa asignada. Las usa {@code ReservationHoldScheduler} para
     * soltarla; el cálculo de disponibilidad ya las ignora desde el instante
     * mismo de la caducidad, sin esperar al job.
     */
    @Query("SELECT r FROM Reservation r WHERE r.deleted = false " +
           "AND r.status = 'PENDING' AND r.diningTable IS NOT NULL " +
           "AND r.holdExpiresAt IS NOT NULL AND r.holdExpiresAt <= :now")
    List<Reservation> findExpiredHolds(@Param("now") LocalDateTime now);
```

Import: `import java.time.LocalDateTime;`.

En `ReservationService`:

```java
    /**
     * Suelta la mesa de las solicitudes públicas cuyo bloqueo provisional ha
     * caducado, conservando {@code holdExpiresAt} como marca de "pendiente sin
     * bloqueo" y la solicitud en PENDING para que el restaurante pueda
     * gestionarla. Solo es higiene de datos: la disponibilidad ya deja de
     * contarlas en cuanto vence la caducidad.
     *
     * @return número de bloqueos liberados
     */
    @Transactional
    public int releaseExpiredHolds() {
        List<Reservation> caducadas = reservationRepository.findExpiredHolds(LocalDateTime.now());
        for (Reservation reserva : caducadas) {
            Long tableId = reserva.getDiningTable().getId();
            reserva.setDiningTable(null);
            reservationRepository.save(reserva);
            releaseTableIfNoActiveConfirmedReservations(tableId);
            log.info("Bloqueo provisional caducado en la reserva #{}: mesa {} liberada",
                    reserva.getId(), tableId);
        }
        return caducadas.size();
    }
```

- [ ] **Step 6: Crear el scheduler**

`restaurante_manage/src/main/java/com/restaurante/reservation/scheduler/ReservationHoldScheduler.java`:

```java
package com.restaurante.reservation.scheduler;

import com.restaurante.reservation.service.ReservationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Suelta la mesa de las solicitudes públicas cuyo bloqueo provisional ha
 * caducado. Es solo higiene de datos, para que el panel no muestre una mesa
 * que ya no está retenida: el cálculo de disponibilidad descarta los bloqueos
 * caducados en el mismo instante en que vencen, sin esperar a este job.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ReservationHoldScheduler {

    private final ReservationService reservationService;

    @Scheduled(fixedDelayString = "${app.reservations.hold-release-delay-ms:60000}")
    public void releaseExpiredHolds() {
        int liberados = reservationService.releaseExpiredHolds();
        if (liberados > 0) {
            log.info("[BLOQUEOS] {} bloqueos provisionales caducados liberados", liberados);
        }
    }
}
```

Y en `application.yml`, dentro de `app.reservations`:

```yaml
    # Frecuencia (ms) del job que suelta las mesas de bloqueos ya caducados.
    hold-release-delay-ms: ${RESERVATION_HOLD_RELEASE_DELAY_MS:60000}
```

- [ ] **Step 7: Verificar que pasan**

```bash
cd restaurante_manage && mvn test -Dtest=ReservationMapperTest,ReservationServiceTest
```

Esperado: `BUILD SUCCESS`.

- [ ] **Step 8: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test
```

Esperado: `BUILD SUCCESS`. **No ejecutar `git commit`.**

---

## Task 7: Test de concurrencia de solicitudes públicas

**Files:**
- Modify: `restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationConcurrencyIntegrationTest.java`

**Interfaces:**
- Consumes: `PublicReservationService.createReservationRequest(...)` (Task 5).

- [ ] **Step 1: Escribir el test que falla**

Leer el archivo completo antes de tocarlo: ya monta `TransactionTemplate`, `CountDownLatch` y `ExecutorService`, y hay que replicar ese patrón exacto. Añadir:

```java
    @Test
    void dosSolicitudesPublicasSimultaneas_soloUnaObtieneLaUltimaMesa() throws Exception {
        // El restaurante de este test tiene una sola mesa: las dos solicitudes
        // compiten por ella.
        CountDownLatch listos = new CountDownLatch(2);
        CountDownLatch salida = new CountDownLatch(1);
        ExecutorService pool = Executors.newFixedThreadPool(2);

        Callable<Boolean> solicitud = () -> {
            listos.countDown();
            salida.await(5, TimeUnit.SECONDS);
            try {
                publicReservationService.createReservationRequest(restaurant.getId(), peticionPublica());
                return true;
            } catch (ConflictException e) {
                return false;
            }
        };

        Future<Boolean> a = pool.submit(solicitud);
        Future<Boolean> b = pool.submit(solicitud);
        listos.await(5, TimeUnit.SECONDS);
        salida.countDown();

        int exitos = (a.get(15, TimeUnit.SECONDS) ? 1 : 0) + (b.get(15, TimeUnit.SECONDS) ? 1 : 0);
        pool.shutdown();

        assertEquals(1, exitos,
                "Con una sola mesa, solo una de las dos solicitudes simultáneas puede retenerla");
    }

    private PublicReservationRequest peticionPublica() {
        PublicReservationRequest request = new PublicReservationRequest();
        // Emails distintos: si fueran iguales saltaría la validación de duplicado
        // y el test no probaría la concurrencia por la mesa.
        request.setCustomerName("Cliente " + Thread.currentThread().getId());
        request.setPhone("600000000");
        request.setEmail("cliente" + Thread.currentThread().getId() + "@test.com");
        request.setReservationDate(LocalDate.now().plusDays(20));
        request.setReservationTime(LocalTime.of(21, 0));
        request.setPartySize(2);
        return request;
    }
```

Inyectar el servicio junto a los demás `@Autowired`:

```java
    @Autowired private PublicReservationService publicReservationService;
```

Imports:

```java
import com.restaurante.common.exception.ConflictException;
import com.restaurante.publicapi.dto.PublicReservationRequest;
import com.restaurante.publicapi.service.PublicReservationService;
```

Verificar en el `setUp()` existente que el restaurante tiene **exactamente una** mesa y que su capacidad admite 2 comensales. Si tuviera más de una, crear en este test un restaurante propio con una sola mesa antes de lanzar los hilos.

- [ ] **Step 2: Verificar que pasa**

```bash
cd restaurante_manage && mvn test -Dtest=ReservationConcurrencyIntegrationTest
```

Esperado: `BUILD SUCCESS`. Si salen 2 éxitos, el bloqueo pesimista no está serializando: revisar que `createReservationRequest` lleve `@Transactional(isolation = Isolation.READ_COMMITTED)` y que `retenerMesa` pase por `assertNoOverlap`. Cubre el requisito **9**.

- [ ] **Step 3: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test
```

Esperado: `BUILD SUCCESS`, backend completo verde. **No ejecutar `git commit`.**

---

## Task 8: Infraestructura de tests del frontend

**Files:**
- Modify: `restaurante-frontend/package.json`
- Modify: `restaurante-frontend/vite.config.js`
- Create: `restaurante-frontend/src/test/setup.js`
- Test: `restaurante-frontend/src/test/setup.test.js` (temporal, se borra en el Step 5)

**Interfaces:**
- Produces: `pnpm test` (una pasada) y `pnpm test:watch`. Entorno `jsdom`, matchers de `@testing-library/jest-dom` disponibles globalmente, `describe`/`it`/`expect` globales sin importar.

- [ ] **Step 1: Instalar las dependencias**

```bash
cd restaurante-frontend && pnpm add -D vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 2: Configurar Vitest**

`vite.config.js`:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
})
```

`src/test/setup.js`:

```javascript
import '@testing-library/jest-dom';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// Desmonta el árbol de React entre tests para que no se filtre estado.
afterEach(() => {
  cleanup();
});
```

En `package.json`, añadir al bloque `scripts`:

```json
    "test": "vitest run",
    "test:watch": "vitest",
```

- [ ] **Step 3: Escribir un test de humo**

`src/test/setup.test.js`:

```javascript
import { render, screen } from '@testing-library/react';

describe('infraestructura de tests', () => {
  it('renderiza JSX y aplica los matchers de jest-dom', () => {
    render(<p>hola</p>);
    expect(screen.getByText('hola')).toBeInTheDocument();
  });
});
```

- [ ] **Step 4: Verificar que pasa**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: `1 passed`. Si falla con "Failed to parse source ... JSX", renombrar el archivo a `setup.test.jsx`: Vite solo transforma JSX en archivos `.jsx`.

- [ ] **Step 5: Borrar el test de humo y checkpoint (NO commit)**

```bash
cd restaurante-frontend && rm src/test/setup.test.js && pnpm lint
```

Esperado: `pnpm lint` sin errores. **No ejecutar `git commit`.**

---

## Task 9: Componente `TimeSlotSelector`

**Files:**
- Create: `restaurante-frontend/src/components/TimeSlotSelector.jsx`
- Modify: `restaurante-frontend/src/index.css`
- Test: `restaurante-frontend/src/components/TimeSlotSelector.test.jsx`

**Interfaces:**
- Produces: `export default function TimeSlotSelector({ slots, value, onChange, loading, error, onRetry, disabled })`.
  - `slots`: `[{ time: '13:00:00', available: true }]`
  - `value`: `string` — hora seleccionada en formato `'HH:mm:ss'`, o `''`
  - `onChange`: `(time: string) => void` — recibe la hora en el mismo formato que llega en `slots`
  - `loading`, `disabled`: `boolean`; `error`: `string | null`; `onRetry`: `() => void`

- [ ] **Step 1: Escribir los tests que fallan**

`src/components/TimeSlotSelector.test.jsx`:

```jsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import TimeSlotSelector from './TimeSlotSelector';

const SLOTS = [
  { time: '13:00:00', available: true },
  { time: '13:30:00', available: false },
  { time: '14:00:00', available: true },
];

const setup = (props = {}) => {
  const onChange = vi.fn();
  render(
    <TimeSlotSelector
      slots={SLOTS}
      value=""
      onChange={onChange}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      {...props}
    />
  );
  return { onChange };
};

describe('TimeSlotSelector', () => {
  it('permite seleccionar una hora disponible', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /13:00/ }));

    expect(onChange).toHaveBeenCalledWith('13:00:00');
  });

  it('deshabilita las horas completas con el atributo disabled real', () => {
    setup();

    expect(screen.getByRole('button', { name: /13:30/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /13:00/ })).toBeEnabled();
  });

  it('no dispara onChange al pulsar una hora completa', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /13:30/ }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('marca como seleccionada solo la hora activa', () => {
    setup({ value: '14:00:00' });

    expect(screen.getByRole('button', { name: /14:00/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /13:00/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('no pinta ninguna franja que no venga del backend', () => {
    setup();

    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('muestra el estado de carga sin pintar franjas', () => {
    setup({ loading: true });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /13:00/ })).not.toBeInTheDocument();
  });

  it('avisa cuando no queda ninguna hora disponible', () => {
    setup({ slots: [] });

    expect(
      screen.getByText('No hay horarios disponibles para la fecha y el número de personas seleccionados.')
    ).toBeInTheDocument();
  });

  it('permite reintentar cuando la consulta ha fallado', async () => {
    const onRetry = vi.fn();
    setup({ error: 'Error de conexión.', onRetry });

    expect(screen.getByText('Error de conexión.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(onRetry).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: FAIL — `Failed to resolve import "./TimeSlotSelector"`.

- [ ] **Step 3: Implementar el componente**

`src/components/TimeSlotSelector.jsx`:

```jsx
/**
 * Rejilla de franjas horarias para los formularios de reserva (privado y público).
 *
 * No consulta nada: recibe las franjas ya calculadas por el backend, que es quien
 * decide qué horas existen y cuáles admiten reserva. Ver el hook useTimeSlots.
 */

/** '13:00:00' → '13:00'. Las franjas llegan del backend como LocalTime. */
const toShortTime = (time) => String(time || '').substring(0, 5);

const TimeSlotSelector = ({
  slots = [],
  value = '',
  onChange,
  loading = false,
  error = null,
  onRetry,
  disabled = false,
}) => {
  if (loading) {
    return (
      <div className="time-slot-state" role="status">
        <span className="spinner-border spinner-border-sm" aria-hidden="true" />
        <span>Buscando horarios disponibles…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="time-slot-state time-slot-state-error">
        <span>{error}</span>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="time-slot-state">
        No hay horarios disponibles para la fecha y el número de personas seleccionados.
      </div>
    );
  }

  return (
    <div className="time-slot-grid" role="group" aria-label="Franjas horarias disponibles">
      {slots.map((slot) => {
        const selected = slot.time === value;
        return (
          <button
            key={slot.time}
            type="button"
            className={`time-slot${selected ? ' time-slot-selected' : ''}`}
            aria-pressed={selected}
            disabled={disabled || !slot.available}
            onClick={() => onChange(slot.time)}
          >
            <span className="time-slot-hour">{toShortTime(slot.time)}</span>
            {!slot.available && <span className="time-slot-tag">Completo</span>}
          </button>
        );
      })}
    </div>
  );
};

export default TimeSlotSelector;
```

- [ ] **Step 4: Añadir los estilos**

Al final de `src/index.css`:

```css
/* ─── Rejilla de franjas horarias (TimeSlotSelector) ───────────────────── */

.time-slot-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
  gap: 8px;
}

.time-slot {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 2px;
  /* 44px: objetivo táctil mínimo cómodo en móvil. */
  min-height: 44px;
  padding: 8px 4px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-card);
  color: var(--text-primary);
  font-variant-numeric: tabular-nums;
  cursor: pointer;
  transition: border-color 0.15s ease, box-shadow 0.15s ease, transform 0.15s ease;
}

.time-slot:hover:not(:disabled) {
  border-color: var(--primary);
  box-shadow: var(--shadow-sm);
  transform: translateY(-1px);
}

.time-slot:focus-visible {
  outline: none;
  border-color: var(--primary);
  box-shadow: 0 0 0 3px var(--primary-ring);
}

.time-slot-selected,
.time-slot-selected:hover:not(:disabled) {
  border-color: var(--primary);
  background: var(--primary);
  color: var(--text-inverse);
}

.time-slot:disabled {
  border-style: dashed;
  border-color: var(--border-light);
  background: var(--hover-color);
  color: var(--text-muted);
  cursor: not-allowed;
}

.time-slot-hour {
  font-size: 0.95rem;
  font-weight: 500;
  line-height: 1.1;
}

.time-slot-tag {
  font-size: 0.65rem;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--text-muted);
}

.time-slot-state {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px;
  border: 1px dashed var(--border);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.9rem;
}

.time-slot-state-error {
  justify-content: space-between;
  border-color: var(--danger);
  background: var(--danger-light);
  color: var(--danger-text);
}
```

- [ ] **Step 5: Verificar que pasan**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: `8 passed`. Cubre los requisitos **1, 2, 3, 4** y **7**.

- [ ] **Step 6: Checkpoint (NO commit)**

```bash
cd restaurante-frontend && pnpm lint
```

Esperado: sin errores. **No ejecutar `git commit`.**

---

## Task 10: Servicios y hook `useTimeSlots`

**Files:**
- Modify: `restaurante-frontend/src/services/reservationService.js`
- Modify: `restaurante-frontend/src/services/publicReservationService.js`
- Create: `restaurante-frontend/src/hooks/useTimeSlots.js`
- Test: `restaurante-frontend/src/hooks/useTimeSlots.test.jsx`

**Interfaces:**
- Produces:
  - `getTimeSlots(restaurantId, date, partySize) → Promise<Array<{time, available}>>` en `reservationService.js`
  - `fetchPublicTimeSlots(restaurantId, date, partySize) → Promise<Array<{time, available}>>` en `publicReservationService.js`
  - `useTimeSlots({ fetcher, restaurantId, date, partySize, onReset }) → { slots, loading, error, retry }`. Llama a `onReset()` en cada cambio de dependencias para que el formulario limpie su hora seleccionada.

- [ ] **Step 1: Escribir los tests que fallan**

`src/hooks/useTimeSlots.test.jsx`:

```jsx
import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import useTimeSlots from './useTimeSlots';

const SLOTS = [{ time: '13:00:00', available: true }];

describe('useTimeSlots', () => {
  it('consulta las franjas cuando hay restaurante, fecha y comensales', async () => {
    const fetcher = vi.fn().mockResolvedValue(SLOTS);

    const { result } = renderHook(() =>
      useTimeSlots({ fetcher, restaurantId: 1, date: '2026-08-15', partySize: 2 })
    );

    await waitFor(() => expect(result.current.slots).toEqual(SLOTS));
    expect(fetcher).toHaveBeenCalledWith(1, '2026-08-15', 2);
  });

  it('no consulta nada si falta la fecha', () => {
    const fetcher = vi.fn();

    renderHook(() => useTimeSlots({ fetcher, restaurantId: 1, date: '', partySize: 2 }));

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('limpia la hora seleccionada al cambiar la fecha', async () => {
    const fetcher = vi.fn().mockResolvedValue(SLOTS);
    const onReset = vi.fn();

    const { rerender } = renderHook(
      ({ date }) => useTimeSlots({ fetcher, restaurantId: 1, date, partySize: 2, onReset }),
      { initialProps: { date: '2026-08-15' } }
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    rerender({ date: '2026-08-16' });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(onReset).toHaveBeenCalled();
  });

  it('recalcula la disponibilidad al cambiar el número de comensales', async () => {
    const fetcher = vi.fn().mockResolvedValue(SLOTS);

    const { rerender } = renderHook(
      ({ partySize }) => useTimeSlots({ fetcher, restaurantId: 1, date: '2026-08-15', partySize }),
      { initialProps: { partySize: 2 } }
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    rerender({ partySize: 6 });

    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(1, '2026-08-15', 6));
  });

  it('expone el error y permite reintentar', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Servidor caído'));

    const { result } = renderHook(() =>
      useTimeSlots({ fetcher, restaurantId: 1, date: '2026-08-15', partySize: 2 })
    );

    await waitFor(() => expect(result.current.error).toBe('Servidor caído'));

    fetcher.mockResolvedValue(SLOTS);
    result.current.retry();

    await waitFor(() => expect(result.current.slots).toEqual(SLOTS));
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: FAIL — `Failed to resolve import "./useTimeSlots"`.

- [ ] **Step 3: Añadir las funciones de servicio**

Al final de `src/services/reservationService.js`:

```javascript
/**
 * Franjas horarias del restaurante para una fecha y número de comensales.
 * La disponibilidad la calcula el backend; aquí no se filtra ni se genera nada.
 *
 * @param {number} restaurantId
 * @param {string} date - formato YYYY-MM-DD
 * @param {number} partySize
 * @returns {Promise<Array<{time: string, available: boolean}>>}
 */
export const getTimeSlots = async (restaurantId, date, partySize) => {
  try {
    const response = await api.get('/availability/time-slots', {
      params: { restaurantId, date, partySize },
    });
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};
```

Al final de `src/services/publicReservationService.js`:

```javascript
/**
 * Franjas horarias del restaurante para el formulario público.
 * Solo devuelve hora y disponibilidad: el endpoint no expone datos de mesas
 * ni de otras reservas.
 *
 * @param {number} restaurantId
 * @param {string} date - formato YYYY-MM-DD
 * @param {number} partySize
 * @returns {Promise<Array<{time: string, available: boolean}>>}
 */
export const fetchPublicTimeSlots = async (restaurantId, date, partySize) => {
  try {
    const response = await publicApi.get(`/public/restaurants/${Number(restaurantId)}/time-slots`, {
      params: { date, partySize },
    });
    const body = response?.data;
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    return [];
  } catch (error) {
    throw handleError(error);
  }
};
```

- [ ] **Step 4: Implementar el hook**

`src/hooks/useTimeSlots.js`:

```javascript
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Carga las franjas horarias de un restaurante y las mantiene sincronizadas con
 * el restaurante, la fecha y el número de comensales seleccionados.
 *
 * Vive aquí y no en cada página porque el formulario privado y el público
 * necesitan exactamente el mismo comportamiento: recargar en cada cambio, limpiar
 * la hora elegida antes de recargar y descartar respuestas obsoletas.
 *
 * @param {object}   params
 * @param {Function} params.fetcher      - (restaurantId, date, partySize) => Promise<slots>
 * @param {number|string} params.restaurantId
 * @param {string}   params.date         - YYYY-MM-DD
 * @param {number|string} params.partySize
 * @param {Function} [params.onReset]    - se invoca al cambiar cualquier dependencia
 */
const useTimeSlots = ({ fetcher, restaurantId, date, partySize, onReset }) => {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  // En refs para que cambiar de callback no vuelva a disparar la consulta.
  const fetcherRef = useRef(fetcher);
  const onResetRef = useRef(onReset);
  fetcherRef.current = fetcher;
  onResetRef.current = onReset;

  // Identifica la petición en curso: si llega la respuesta de una anterior
  // (más lenta), se descarta en vez de pisar a la más reciente.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (onResetRef.current) {
      onResetRef.current();
    }

    const size = Number(partySize);
    if (!restaurantId || !date || !size || size < 1) {
      setSlots([]);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    fetcherRef.current(Number(restaurantId), date, size)
      .then((data) => {
        if (requestId !== requestIdRef.current) return;
        setSlots(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setSlots([]);
        setError(err?.message || 'No se han podido cargar los horarios.');
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
      });
  }, [restaurantId, date, partySize, reloadToken]);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  return { slots, loading, error, retry };
};

export default useTimeSlots;
```

- [ ] **Step 5: Verificar que pasan**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: `13 passed` (8 del componente + 5 del hook). Cubre los requisitos **5** y **6**.

- [ ] **Step 6: Checkpoint (NO commit)**

```bash
cd restaurante-frontend && pnpm lint
```

Esperado: sin errores. **No ejecutar `git commit`.** Si ESLint se queja de las dependencias del `useEffect` (`react-hooks/exhaustive-deps`), es intencionado: `fetcher` y `onReset` van en refs justamente para no reejecutar. Añadir el comentario `// eslint-disable-next-line react-hooks/exhaustive-deps` sobre la línea del array de dependencias.

---

## Task 11: Integración en el formulario público

**Files:**
- Modify: `restaurante-frontend/src/pages/PublicReservation.jsx`
- Test: `restaurante-frontend/src/pages/PublicReservation.test.jsx` (crear)

**Interfaces:**
- Consumes: `TimeSlotSelector` (Task 9), `useTimeSlots` y `fetchPublicTimeSlots` (Task 10).

- [ ] **Step 1: Escribir el test que falla**

`src/pages/PublicReservation.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../services/publicReservationService', () => ({
  fetchPublicRestaurant: vi.fn().mockResolvedValue({ id: 1, name: 'La Buena Mesa' }),
  fetchPublicTimeSlots: vi.fn().mockResolvedValue([
    { time: '13:00:00', available: true },
    { time: '13:30:00', available: false },
  ]),
  createPublicReservation: vi.fn().mockResolvedValue({ reservationId: 9 }),
}));

import {
  createPublicReservation,
  fetchPublicTimeSlots,
} from '../services/publicReservationService';
import PublicReservation from './PublicReservation';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/r/1']}>
      <Routes>
        <Route path="/r/:restaurantId" element={<PublicReservation />} />
      </Routes>
    </MemoryRouter>
  );

describe('PublicReservation', () => {
  it('no envía el formulario sin una hora seleccionada', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    await userEvent.type(screen.getByLabelText(/nombre/i), 'Ana García');
    await userEvent.type(screen.getByLabelText(/teléfono/i), '600123456');
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@test.com');
    await userEvent.click(screen.getByRole('button', { name: /solicitar reserva/i }));

    expect(createPublicReservation).not.toHaveBeenCalled();
    expect(screen.getByText('Selecciona una hora.')).toBeInTheDocument();
  });

  it('pide las franjas al backend usando fecha y comensales', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    await userEvent.type(screen.getByLabelText(/fecha/i), '2026-08-15');

    await waitFor(() =>
      expect(fetchPublicTimeSlots).toHaveBeenCalledWith(1, '2026-08-15', 2)
    );
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
cd restaurante-frontend && pnpm test src/pages/PublicReservation.test.jsx
```

Esperado: FAIL — `fetchPublicTimeSlots` no se llama nunca porque la página aún usa `<input type="time">`.

- [ ] **Step 3: Integrar la rejilla**

En `PublicReservation.jsx`:

1. Añadir a los imports:

```jsx
import TimeSlotSelector from '../components/TimeSlotSelector';
import useTimeSlots from '../hooks/useTimeSlots';
import {
  fetchPublicRestaurant,
  fetchPublicTimeSlots,
  createPublicReservation,
} from '../services/publicReservationService';
```

2. Dentro del componente, tras el `useState` de `formErrors`, enganchar el hook:

```jsx
  const clearSelectedTime = useCallback(() => {
    setFormData((prev) => (prev.reservationTime ? { ...prev, reservationTime: '' } : prev));
  }, []);

  const { slots, loading: loadingSlots, error: slotsError, retry: retrySlots } = useTimeSlots({
    fetcher: fetchPublicTimeSlots,
    restaurantId,
    date: formData.reservationDate,
    partySize: formData.partySize,
    onReset: clearSelectedTime,
  });
```

3. Mover el campo de comensales por encima del de hora y sustituir el bloque del `<input type="time">` (líneas 440-452) por:

```jsx
            <div className="public-field">
              <label className="public-label" htmlFor="reservationTime">Hora</label>
              <TimeSlotSelector
                slots={slots}
                value={formData.reservationTime}
                onChange={(time) => {
                  setFormData((prev) => ({ ...prev, reservationTime: time }));
                  setFormErrors((prev) => {
                    const next = { ...prev };
                    delete next.reservationTime;
                    return next;
                  });
                }}
                loading={loadingSlots}
                error={slotsError}
                onRetry={retrySlots}
                disabled={!formData.reservationDate}
              />
              {formErrors.reservationTime && (
                <span className="public-field-error">{formErrors.reservationTime}</span>
              )}
            </div>
```

4. En el `catch` del envío, recargar la rejilla si el backend responde 409:

```jsx
      if (err?.status === 409) {
        setFormData((prev) => ({ ...prev, reservationTime: '' }));
        retrySlots();
      }
```

- [ ] **Step 4: Verificar que pasan**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: `15 passed`. Cubre el requisito **8** en el formulario público.

- [ ] **Step 5: Checkpoint (NO commit)**

```bash
cd restaurante-frontend && pnpm lint && pnpm build
```

Esperado: build correcto. **No ejecutar `git commit`.**

---

## Task 12: Integración en el wizard privado

**Files:**
- Modify: `restaurante-frontend/src/pages/Reservations.jsx`
- Test: `restaurante-frontend/src/pages/Reservations.wizard.test.jsx` (crear)

**Interfaces:**
- Consumes: `TimeSlotSelector` (Task 9), `useTimeSlots` y `getTimeSlots` (Task 10).
- Produces: wizard de 4 pasos — `Restaurante` → `Fecha, comensales y hora` → `Mesa` → `Confirmar`.

- [ ] **Step 1: Escribir el test que falla**

`src/pages/Reservations.wizard.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../services/reservationService', () => ({
  getReservations: vi.fn().mockResolvedValue([]),
  createReservation: vi.fn().mockResolvedValue({ id: 1 }),
  updateReservation: vi.fn(),
  deleteReservation: vi.fn(),
  updateReservationStatus: vi.fn(),
  getReservationsByRestaurantAndDate: vi.fn().mockResolvedValue([]),
  getTimeSlots: vi.fn().mockResolvedValue([
    { time: '13:00:00', available: true },
    { time: '13:30:00', available: false },
  ]),
}));
vi.mock('../services/restaurantService', () => ({
  getRestaurants: vi.fn().mockResolvedValue([{ id: 1, name: 'La Buena Mesa' }]),
}));
vi.mock('../services/tableService', () => ({ getTablesByRestaurant: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/customerService', () => ({ getCustomers: vi.fn().mockResolvedValue([]) }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { roles: ['ROLE_SUPER_ADMIN'] } }),
}));

import { getTimeSlots } from '../services/reservationService';
import Reservations from './Reservations';

describe('Wizard de nueva reserva', () => {
  it('consulta las franjas con la fecha y los comensales del mismo paso', async () => {
    render(<MemoryRouter><Reservations /></MemoryRouter>);

    await userEvent.click(await screen.findByTitle('Nueva reserva'));
    await userEvent.click(await screen.findByText('La Buena Mesa'));
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));

    await userEvent.type(screen.getByLabelText(/fecha/i), '2026-08-15');

    await waitFor(() => expect(getTimeSlots).toHaveBeenCalledWith(1, '2026-08-15', 2));
  });

  it('no deja avanzar a la selección de mesa sin hora elegida', async () => {
    render(<MemoryRouter><Reservations /></MemoryRouter>);

    await userEvent.click(await screen.findByTitle('Nueva reserva'));
    await userEvent.click(await screen.findByText('La Buena Mesa'));
    await userEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    await userEvent.type(screen.getByLabelText(/fecha/i), '2026-08-15');
    await screen.findByRole('button', { name: /13:00/ });

    expect(screen.getByRole('button', { name: /siguiente/i })).toBeDisabled();
  });
});
```

Los selectores (`findByTitle`, textos de botón) deben ajustarse a lo que realmente renderiza el wizard: leer el JSX antes de dar el test por bueno.

- [ ] **Step 2: Verificar que falla**

```bash
cd restaurante-frontend && pnpm test src/pages/Reservations.wizard.test.jsx
```

Esperado: FAIL — `getTimeSlots` no se llama.

- [ ] **Step 3: Reestructurar el wizard**

En `Reservations.jsx`:

1. Imports:

```jsx
import TimeSlotSelector from '../components/TimeSlotSelector';
import useTimeSlots from '../hooks/useTimeSlots';
```

y añadir `getTimeSlots` a la importación existente de `../services/reservationService`.

2. Sustituir `WIZARD_STEPS` (líneas 96-102) por:

```jsx
  const WIZARD_STEPS = [
    { id: 1, title: 'Restaurante', subtitle: 'Elige el restaurante' },
    { id: 2, title: 'Fecha y hora', subtitle: 'Cuándo y para cuántos' },
    { id: 3, title: 'Mesa', subtitle: 'Selecciona la mesa disponible' },
    { id: 4, title: 'Confirmar', subtitle: 'Cliente y resumen final' },
  ];
```

3. Enganchar el hook junto a los estados del wizard:

```jsx
  const clearWizardTime = useCallback(() => {
    setWizardData((prev) => (prev.reservationTime ? { ...prev, reservationTime: '' } : prev));
    setAvailableTables([]);
    setAvailabilityChecked(false);
  }, []);

  const {
    slots: wizardSlots,
    loading: loadingWizardSlots,
    error: wizardSlotsError,
    retry: retryWizardSlots,
  } = useTimeSlots({
    fetcher: getTimeSlots,
    restaurantId: wizardData.restaurantId,
    date: wizardData.reservationDate,
    partySize: wizardData.partySize,
    onReset: clearWizardTime,
  });
```

4. Sustituir `canGoNext` (líneas 560-572) por:

```jsx
  const canGoNext = (step) => {
    switch (step) {
      case 0: return !!wizardData.restaurantId;
      case 1: {
        const ps = Number(wizardData.partySize);
        return !!wizardData.reservationDate
          && !!wizardData.reservationTime
          && ps >= 1 && Number.isInteger(ps);
      }
      case 2: return !!wizardData.selectedTable;
      case 3: return !!wizardData.customerId;
      default: return false;
    }
  };
```

5. En `handleNextStep`, la comprobación de disponibilidad de mesas pasa del paso 2 al paso 1, y el salto de `setWizardStep(3)` de `checkAvailability` pasa a `setWizardStep(2)`:

```jsx
  const handleNextStep = () => {
    if (wizardStep === 1 && !availabilityChecked) {
      checkAvailability();
      return;
    }
    if (wizardStep < WIZARD_STEPS.length - 1) {
      setWizardStep((s) => s + 1);
    }
  };
```

6. En el JSX, fusionar los paneles de los pasos 2 y 3 en uno solo: se conserva el `<input type="date">` (líneas 2360-2385) y el contador de comensales con los botones `−`/`+` (líneas 2390-2425), se **elimina** el `<input type="time">` (líneas 2372-2379) y en su lugar, debajo del contador de comensales, se coloca:

```jsx
                          <div className="mb-3">
                            <label className="form-label" htmlFor="wizardTime">Hora</label>
                            <TimeSlotSelector
                              slots={wizardSlots}
                              value={wizardData.reservationTime}
                              onChange={(time) => handleWizardChange('reservationTime', time)}
                              loading={loadingWizardSlots}
                              error={wizardSlotsError}
                              onRetry={retryWizardSlots}
                              disabled={!wizardData.reservationDate}
                            />
                          </div>
```

Renumerar los índices de los paneles siguientes: el antiguo `wizardStep === 3` (mesa) pasa a `2` y el antiguo `4` (confirmar) pasa a `3`.

7. En `handleWizardChange`, la rama de `restaurantId` ya limpia mesas y disponibilidad; el hook se encarga del resto. No tocarla.

- [ ] **Step 4: Verificar que pasan**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: `17 passed`. Cubre el requisito **8** en el formulario privado.

- [ ] **Step 5: Checkpoint (NO commit)**

```bash
cd restaurante-frontend && pnpm lint && pnpm build
```

Esperado: build correcto. **No ejecutar `git commit`.**

---

## Task 13: Badge de bloqueo caducado en el listado

**Files:**
- Modify: `restaurante-frontend/src/pages/Reservations.jsx`
- Modify: `restaurante-frontend/src/index.css`

**Interfaces:**
- Consumes: `ReservationResponse.holdStatus` (Task 6).

- [ ] **Step 1: Añadir el indicador**

En `Reservations.jsx`, en la celda de estado de la tabla de reservas activas (junto al badge de `STATUS_MAP`, alrededor de la línea 1415), añadir:

```jsx
                                    {r.holdStatus === 'EXPIRED' && (
                                      <span className="res-hold-badge" title="El bloqueo provisional de mesa ha caducado; la solicitud sigue pendiente de gestionar.">
                                        Pendiente sin bloqueo
                                      </span>
                                    )}
```

Y en el modal de detalle (junto al resto de `res-detail-value`, alrededor de la línea 1940):

```jsx
                  {detailReservation.holdStatus === 'ACTIVE' && (
                    <div className="res-detail-row">
                      <span className="res-detail-label">Bloqueo de mesa</span>
                      <span className="res-detail-value">
                        Activo hasta {new Date(detailReservation.holdExpiresAt).toLocaleString('es-ES')}
                      </span>
                    </div>
                  )}
```

Al final de `index.css`:

```css
.res-hold-badge {
  display: inline-block;
  margin-left: 6px;
  padding: 1px 6px;
  border: 1px solid var(--warning);
  border-radius: 4px;
  background: var(--warning-light);
  color: var(--warning-text);
  font-size: 0.7rem;
  white-space: nowrap;
}
```

- [ ] **Step 2: Checkpoint (NO commit)**

```bash
cd restaurante-frontend && pnpm lint && pnpm build && pnpm test
```

Esperado: todo verde. **No ejecutar `git commit`.**

---

## Task 14: Verificación final

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa del backend**

```bash
cd restaurante_manage && mvn clean test
```

Esperado: `BUILD SUCCESS`, 0 fallos, 0 errores. Anotar el recuento de tests.

- [ ] **Step 2: Build completo del backend**

```bash
cd restaurante_manage && mvn clean package -DskipTests
```

Esperado: `BUILD SUCCESS`.

- [ ] **Step 3: Suite y build del frontend**

```bash
cd restaurante-frontend && pnpm test && pnpm lint && pnpm build
```

Esperado: todos los tests verdes, sin errores de ESLint, build correcto.

- [ ] **Step 4: Revisión del diff**

```bash
git status && git diff --stat
```

Comprobar que no hay archivos tocados fuera de los listados en "Estructura de archivos", y que **no existe ningún commit nuevo**:

```bash
git log --oneline -3
```

Esperado: el `HEAD` sigue siendo `35d3808 Merge pull request #17 …`.

- [ ] **Step 5: Repaso de seguridad del diff**

Verificar a mano sobre el diff:

1. Ninguna respuesta pública incluye `tableId`, `tableNumber`, `capacity`, `customerName`, `holdExpiresAt` ni `holdStatus`.
2. `AvailabilityController` valida acceso en **ambos** métodos.
3. `PublicReservationService.getPublicTimeSlots` comprueba `publicBookingEnabled`.
4. No queda ningún `permitAll` nuevo en `SecurityConfig`.
5. `createReservationRequest` conserva `@Transactional(isolation = READ_COMMITTED)`.

- [ ] **Step 6: Checkpoint final (NO commit)**

Dejar todos los cambios en el working tree, sin commit, sin push y sin PR.

---

## Cobertura de los requisitos de prueba

| # | Requisito | Task |
|---|---|---|
| 1 | Las horas disponibles se pueden seleccionar | 9 |
| 2 | Las horas completas aparecen deshabilitadas | 9 |
| 3 | Una hora deshabilitada no se puede seleccionar | 9 |
| 4 | Al seleccionar otra hora se desmarca la anterior | 9 |
| 5 | Al cambiar la fecha se limpia la hora seleccionada | 10 |
| 6 | Al cambiar los comensales se recalcula la disponibilidad | 10 |
| 7 | No aparecen horas pasadas para el día actual | 2 (backend) + 9 (frontend) |
| 8 | El formulario no se envía sin una hora válida | 11 (público) + 12 (privado) |
| 9 | El backend rechaza si la disponibilidad cambió | 5 + 7 |
| 10 | Público y privado usan las mismas reglas | 4 |
| 11 | Un restaurante no puede consultar la disponibilidad de otro | 3 + 4 |
| 12 | El endpoint público no expone información sensible | 4 |
