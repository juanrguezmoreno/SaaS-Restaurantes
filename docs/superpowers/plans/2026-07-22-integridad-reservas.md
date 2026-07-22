# Integridad de reservas y mesas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sustituir el solape "misma mesa + misma hora exacta" por un solape real de intervalos horarios (duración configurable por restaurante), unificar la lógica de disponibilidad en un único servicio, y blindar la asignación de mesas contra condiciones de carrera con bloqueo pesimista.

**Architecture:** Cambios quirúrgicos sobre `restaurante_manage/` (Spring Boot). `AvailabilityService` pasa a ser la única autoridad de disponibilidad de mesas (capacidad, mantenimiento, solape); `ReservationService` deja de reimplementar esa lógica y delega en `AvailabilityService`. La duración vive en `Restaurant.defaultReservationDurationMinutes` (no en `Reservation`), así que no cambian los DTOs de reserva, el wizard, el flujo público ni el formulario de edición de reservas. El frontend solo gana un campo nuevo en la pantalla de ajustes de restaurante.

**Tech Stack:** Backend: Spring Boot 3.3, Java 21, Maven, JUnit 5 + Mockito, Flyway (MySQL prod) / H2 (dev y tests). Frontend: React 19 + Vite (sin infraestructura de test — verificación manual con `pnpm dev`).

## Global Constraints

- Backend en español (comentarios, mensajes de error, nombres de excepción de negocio). Commits en Conventional Commits (`fix(reservation): ...`, `feat(restaurant): ...`).
- Todo método de escritura de `ReservationService` debe seguir siendo `@Transactional` (no quitar la anotación existente; solo se le añade `isolation = Isolation.READ_COMMITTED` donde se indique).
- No se toca `Reservation`, `ReservationRequest`, el wizard, el formulario de edición del panel ni el flujo público — la duración es por restaurante, no por reserva.
- Backend tests: `mvn test -Dtest=NombreClase` desde `restaurante_manage/`. Regresión completa: `mvn test` desde `restaurante_manage/`.
- No hay tests de frontend en este repo — la tarea de frontend se verifica manualmente con `pnpm dev` (puerto 5173) contra el backend en perfil `dev` (`mvn spring-boot:run -Dspring-boot.run.profiles=dev`).
- Todas las rutas y nombres de rol ya definidos en `common/util/Constants.java` — no inventar strings nuevos si ya existe una constante equivalente.

---

## Task 1: `Restaurant.defaultReservationDurationMinutes` — modelo de datos

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/restaurant/entity/Restaurant.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/restaurant/dto/RestaurantRequest.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/restaurant/dto/RestaurantResponse.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/restaurant/dto/RestaurantMapper.java`
- Create: `restaurante_manage/src/main/resources/db/migration/V6__add_reservation_duration.sql`
- Create: `restaurante_manage/src/test/java/com/restaurante/restaurant/dto/RestaurantMapperTest.java`
- Create: `restaurante_manage/src/test/java/com/restaurante/restaurant/dto/RestaurantRequestValidationTest.java`

**Interfaces:**
- Produces: `Restaurant.getDefaultReservationDurationMinutes()` / `.setDefaultReservationDurationMinutes(Integer)` (default `90`).
- Produces: `RestaurantRequest.getDefaultReservationDurationMinutes()` (nullable, validado `@Min(15) @Max(480)`).
- Produces: `RestaurantResponse.getDefaultReservationDurationMinutes()`.
- Consumes en tasks posteriores: `DiningTable.getRestaurant().getDefaultReservationDurationMinutes()` (Task 3).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `restaurante_manage/src/test/java/com/restaurante/restaurant/dto/RestaurantMapperTest.java`:

```java
package com.restaurante.restaurant.dto;

import com.restaurante.restaurant.entity.Restaurant;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RestaurantMapperTest {

    private final RestaurantMapper mapper = new RestaurantMapper();

    private RestaurantRequest baseRequest() {
        RestaurantRequest req = new RestaurantRequest();
        req.setName("La Buena Mesa");
        req.setAddress("Calle Falsa 123");
        return req;
    }

    @Test
    void toEntity_usaNoventaMinutosPorDefectoSiNoSeEspecificaDuracion() {
        Restaurant restaurant = mapper.toEntity(baseRequest());
        assertEquals(90, restaurant.getDefaultReservationDurationMinutes());
    }

    @Test
    void toEntity_respetaLaDuracionIndicadaEnElRequest() {
        RestaurantRequest req = baseRequest();
        req.setDefaultReservationDurationMinutes(120);
        Restaurant restaurant = mapper.toEntity(req);
        assertEquals(120, restaurant.getDefaultReservationDurationMinutes());
    }

    @Test
    void updateEntity_actualizaLaDuracionCuandoSeIndica() {
        Restaurant restaurant = new Restaurant();
        restaurant.setDefaultReservationDurationMinutes(90);

        RestaurantRequest req = baseRequest();
        req.setDefaultReservationDurationMinutes(60);
        mapper.updateEntity(restaurant, req);

        assertEquals(60, restaurant.getDefaultReservationDurationMinutes());
    }

    @Test
    void updateEntity_mantieneLaDuracionExistenteSiElRequestNoLaEspecifica() {
        Restaurant restaurant = new Restaurant();
        restaurant.setDefaultReservationDurationMinutes(120);

        mapper.updateEntity(restaurant, baseRequest());

        assertEquals(120, restaurant.getDefaultReservationDurationMinutes());
    }

    @Test
    void toResponse_incluyeLaDuracion() {
        Restaurant restaurant = new Restaurant();
        restaurant.setDefaultReservationDurationMinutes(90);

        RestaurantResponse response = mapper.toResponse(restaurant);

        assertEquals(90, response.getDefaultReservationDurationMinutes());
    }
}
```

Crear `restaurante_manage/src/test/java/com/restaurante/restaurant/dto/RestaurantRequestValidationTest.java`:

```java
package com.restaurante.restaurant.dto;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RestaurantRequestValidationTest {

    private final Validator validator;

    RestaurantRequestValidationTest() {
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
            validator = factory.getValidator();
        }
    }

    private RestaurantRequest baseRequest(Integer duration) {
        RestaurantRequest req = new RestaurantRequest();
        req.setName("La Buena Mesa");
        req.setAddress("Calle Falsa 123");
        req.setDefaultReservationDurationMinutes(duration);
        return req;
    }

    @Test
    void permiteDuracionNula_seAplicaElDefaultEnElMapper() {
        Set<ConstraintViolation<RestaurantRequest>> violations = validator.validate(baseRequest(null));
        assertTrue(violations.isEmpty());
    }

    @Test
    void rechazaDuracionMenorA15Minutos() {
        Set<ConstraintViolation<RestaurantRequest>> violations = validator.validate(baseRequest(10));
        assertFalse(violations.isEmpty());
    }

    @Test
    void rechazaDuracionMayorA480Minutos() {
        Set<ConstraintViolation<RestaurantRequest>> violations = validator.validate(baseRequest(481));
        assertFalse(violations.isEmpty());
    }

    @Test
    void permiteDuracionEnElRangoValido() {
        Set<ConstraintViolation<RestaurantRequest>> violations = validator.validate(baseRequest(90));
        assertTrue(violations.isEmpty());
    }
}
```

- [ ] **Step 2: Ejecutar y confirmar que fallan (no compilan)**

```bash
cd restaurante_manage
mvn test -Dtest=RestaurantMapperTest,RestaurantRequestValidationTest
```

Esperado: FAIL (compilación) — `RestaurantRequest.setDefaultReservationDurationMinutes`, `Restaurant.getDefaultReservationDurationMinutes` y `RestaurantResponse.getDefaultReservationDurationMinutes` no existen todavía.

- [ ] **Step 3: Añadir el campo a la entidad `Restaurant`**

En `restaurante_manage/src/main/java/com/restaurante/restaurant/entity/Restaurant.java`, reemplazar:

```java
    @Column(name = "public_booking_enabled", nullable = false)
    private Boolean publicBookingEnabled = true;
```

por:

```java
    @Column(name = "public_booking_enabled", nullable = false)
    private Boolean publicBookingEnabled = true;

    @Column(name = "default_reservation_duration_minutes", nullable = false)
    private Integer defaultReservationDurationMinutes = 90;
```

- [ ] **Step 4: Crear la migración Flyway**

Crear `restaurante_manage/src/main/resources/db/migration/V6__add_reservation_duration.sql`:

```sql
-- V6 — Duración de reserva configurable por restaurante.
--
-- Minutos que ocupa una reserva la mesa asignada. Se usa para calcular
-- solapes por intervalo horario (antes se comparaba solo la hora exacta).
-- Los restaurantes existentes quedan en 90 minutos por defecto.
ALTER TABLE `restaurants`
  ADD COLUMN `default_reservation_duration_minutes` INT NOT NULL DEFAULT 90;
```

- [ ] **Step 5: Añadir el campo a `RestaurantRequest`**

En `restaurante_manage/src/main/java/com/restaurante/restaurant/dto/RestaurantRequest.java`, añadir el import y el campo:

```java
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
```

y, tras `private Boolean publicBookingEnabled;`:

```java
    @Min(value = 15, message = "La duración mínima de una reserva es de 15 minutos")
    @Max(value = 480, message = "La duración máxima de una reserva es de 480 minutos")
    private Integer defaultReservationDurationMinutes;
```

- [ ] **Step 6: Añadir el campo a `RestaurantResponse`**

En `restaurante_manage/src/main/java/com/restaurante/restaurant/dto/RestaurantResponse.java`, añadir tras `private Boolean publicBookingEnabled;`:

```java
    private Integer defaultReservationDurationMinutes;
```

- [ ] **Step 7: Propagar el campo en `RestaurantMapper`**

En `restaurante_manage/src/main/java/com/restaurante/restaurant/dto/RestaurantMapper.java`, en `toResponse`, añadir tras `.publicBookingEnabled(restaurant.getPublicBookingEnabled())`:

```java
                .defaultReservationDurationMinutes(restaurant.getDefaultReservationDurationMinutes())
```

En `toEntity`, añadir tras el bloque `if (request.getPublicBookingEnabled() != null) { ... }`:

```java
        if (request.getDefaultReservationDurationMinutes() != null) {
            restaurant.setDefaultReservationDurationMinutes(request.getDefaultReservationDurationMinutes());
        }
```

En `updateEntity`, añadir el mismo bloque tras su `if (request.getPublicBookingEnabled() != null) { ... }`:

```java
        if (request.getDefaultReservationDurationMinutes() != null) {
            restaurant.setDefaultReservationDurationMinutes(request.getDefaultReservationDurationMinutes());
        }
```

- [ ] **Step 8: Ejecutar y confirmar que pasan**

```bash
mvn test -Dtest=RestaurantMapperTest,RestaurantRequestValidationTest
```

Esperado: PASS (5 + 4 = 9 tests).

- [ ] **Step 9: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/restaurant/entity/Restaurant.java restaurante_manage/src/main/java/com/restaurante/restaurant/dto/RestaurantRequest.java restaurante_manage/src/main/java/com/restaurante/restaurant/dto/RestaurantResponse.java restaurante_manage/src/main/java/com/restaurante/restaurant/dto/RestaurantMapper.java restaurante_manage/src/main/resources/db/migration/V6__add_reservation_duration.sql restaurante_manage/src/test/java/com/restaurante/restaurant/dto/RestaurantMapperTest.java restaurante_manage/src/test/java/com/restaurante/restaurant/dto/RestaurantRequestValidationTest.java
git commit -m "feat(restaurant): añadir duración de reserva configurable por restaurante (default 90 min)"
```

---

## Task 2: `ReservationRepository` — consulta de reservas activas por rango de fechas

Query aditiva: no se toca `findActiveConflicts` todavía (lo siguen usando `AvailabilityService`/`ReservationService` hasta la Task 4). Esto mantiene el proyecto compilando en todo momento.

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java`
- Modify: `restaurante_manage/src/test/java/com/restaurante/reservation/repository/ReservationRepositoryTest.java`

**Interfaces:**
- Produces: `ReservationRepository.findActiveByTableAndDateBetween(Long tableId, LocalDate from, LocalDate to, Long excludeId) -> List<Reservation>` — reservas `PENDING`/`CONFIRMED`, no borradas, de esa mesa, con `reservationDate` entre `from` y `to` (ambos inclusive), excluyendo `excludeId` si no es `null`. Consumido por `AvailabilityService` en la Task 3.

- [ ] **Step 1: Escribir los tests que fallan**

En `restaurante_manage/src/test/java/com/restaurante/reservation/repository/ReservationRepositoryTest.java`, añadir al final de la clase (antes del `}` de cierre):

```java

    // ─── findActiveByTableAndDateBetween: solape por intervalo (duración configurable) ───

    @Test
    void findActiveByTableAndDateBetween_incluyeReservaPendienteDentroDelRango() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertEquals(1, resultado.size());
    }

    @Test
    void findActiveByTableAndDateBetween_incluyeReservaConfirmadaDentroDelRango() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.CONFIRMED);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertEquals(1, resultado.size());
    }

    @Test
    void findActiveByTableAndDateBetween_excluyeCanceladasCompletadasYNoShow() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.CANCELLED);
        crearReserva(mesa1, DATE, TIME, ReservationStatus.COMPLETED);
        crearReserva(mesa1, DATE, TIME, ReservationStatus.NO_SHOW);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_excluyeOtraMesa() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa2.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_excluyeFechasFueraDelRango() {
        crearReserva(mesa1, DATE.plusDays(5), TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_excludeIdIgnoraLaPropiaReserva() {
        Reservation propia = crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), propia.getId());

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_excluyeBorradasLogicamente() {
        Reservation borrada = crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);
        borrada.setDeleted(true);
        borrada.setDeletedAt(LocalDateTime.now());
        em.persistAndFlush(borrada);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_incluyeReservaEnElLimiteInferiorDelRango() {
        crearReserva(mesa1, DATE.minusDays(1), TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertEquals(1, resultado.size());
    }
```

- [ ] **Step 2: Ejecutar y confirmar que falla (no compila)**

```bash
cd restaurante_manage
mvn test -Dtest=ReservationRepositoryTest
```

Esperado: FAIL (compilación) — `findActiveByTableAndDateBetween` no existe todavía.

- [ ] **Step 3: Añadir el método al repositorio**

En `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java`, añadir tras `findActiveConflicts`:

```java

    /**
     * Reservas ACTIVAS (PENDING o CONFIRMED, no borradas) de una mesa cuya
     * {@code reservationDate} cae dentro de {@code [from, to]} (ambos inclusive).
     * Usada por {@code AvailabilityService} para calcular solape por intervalo
     * horario (no solo por hora exacta): el rango debe cubrir el día anterior
     * y el siguiente al de la reserva solicitada, para detectar solapes que
     * cruzan medianoche (p.ej. una reserva a las 23:30 con 90 min de duración
     * termina a la 01:00 del día siguiente).
     * {@code excludeId} permite ignorar la propia reserva al editar (null = ninguna).
     */
    @Query("SELECT r FROM Reservation r WHERE r.diningTable.id = :tableId " +
           "AND r.deleted = false AND r.status IN ('PENDING','CONFIRMED') " +
           "AND r.reservationDate BETWEEN :from AND :to " +
           "AND (:excludeId IS NULL OR r.id <> :excludeId)")
    List<Reservation> findActiveByTableAndDateBetween(@Param("tableId") Long tableId,
                                                       @Param("from") LocalDate from,
                                                       @Param("to") LocalDate to,
                                                       @Param("excludeId") Long excludeId);
```

- [ ] **Step 4: Ejecutar y confirmar que pasan**

```bash
mvn test -Dtest=ReservationRepositoryTest
```

Esperado: PASS (todos, incluidos los 8 nuevos).

- [ ] **Step 5: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java restaurante_manage/src/test/java/com/restaurante/reservation/repository/ReservationRepositoryTest.java
git commit -m "feat(reservation): añadir consulta de reservas activas por mesa y rango de fechas"
```

---

## Task 3: `AvailabilityService` — autoridad única de disponibilidad con solape por intervalo y bloqueo pesimista

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/diningtable/repository/DiningTableRepository.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/availability/service/AvailabilityService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/availability/dto/AvailabilityRequest.java`
- Modify: `restaurante_manage/src/test/java/com/restaurante/availability/service/AvailabilityServiceTest.java`

**Interfaces:**
- Produces: `DiningTableRepository.findByIdAndDeletedFalseForUpdate(Long id) -> Optional<DiningTable>` — bloqueo pesimista (`PESSIMISTIC_WRITE`) sobre la fila de la mesa.
- Produces: `AvailabilityService.isTableAvailable(DiningTable table, LocalDate date, LocalTime time, Integer partySize, Long excludeReservationId) -> boolean`.
- Produces: `AvailabilityService.assertNoOverlap(DiningTable table, LocalDate date, LocalTime time, Long excludeReservationId)` — lanza `ConflictException` (409); adquiere el bloqueo pesimista antes de comprobar el solape.
- Produces: `AvailabilityService.assignFirstAvailableTable(Restaurant restaurant, LocalDate date, LocalTime time, Integer partySize, Long excludeReservationId) -> Optional<DiningTable>`.
- Consumes: `ReservationRepository.findActiveByTableAndDateBetween(...)` (Task 2).
- Consumido por `ReservationService` en la Task 4 (que dejará de tener sus propios `assertNoOverlap`/`isTableAvailableForReservation`/`assignAvailableTable`).

- [ ] **Step 1: Escribir el test de validación de `AvailabilityRequest` (falla)**

Crear `restaurante_manage/src/test/java/com/restaurante/availability/dto/AvailabilityRequestValidationTest.java`:

```java
package com.restaurante.availability.dto;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class AvailabilityRequestValidationTest {

    private final Validator validator;

    AvailabilityRequestValidationTest() {
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
            validator = factory.getValidator();
        }
    }

    @Test
    void rechazaTimeNulo() {
        AvailabilityRequest req = new AvailabilityRequest(1L, LocalDate.now().plusDays(1), null, 2);
        Set<ConstraintViolation<AvailabilityRequest>> violations = validator.validate(req);
        assertFalse(violations.isEmpty());
    }

    @Test
    void permiteTimeInformado() {
        AvailabilityRequest req = new AvailabilityRequest(1L, LocalDate.now().plusDays(1), LocalTime.of(21, 0), 2);
        Set<ConstraintViolation<AvailabilityRequest>> violations = validator.validate(req);
        assertTrue(violations.isEmpty());
    }
}
```

- [ ] **Step 2: Ejecutar y confirmar que falla**

```bash
cd restaurante_manage
mvn test -Dtest=AvailabilityRequestValidationTest
```

Esperado: FAIL en `rechazaTimeNulo` (`time` no tiene `@NotNull` todavía, así que con `null` no hay violaciones).

- [ ] **Step 3: Añadir `@NotNull` a `AvailabilityRequest.time`**

En `restaurante_manage/src/main/java/com/restaurante/availability/dto/AvailabilityRequest.java`, reemplazar:

```java
    private LocalTime time;
```

por:

```java
    @NotNull(message = "La hora es obligatoria")
    private LocalTime time;
```

- [ ] **Step 4: Ejecutar y confirmar que pasa**

```bash
mvn test -Dtest=AvailabilityRequestValidationTest
```

Esperado: PASS (2/2).

- [ ] **Step 5: Reescribir `AvailabilityServiceTest` con la nueva lógica de solape por intervalo (falla)**

Reemplazar el contenido completo de `restaurante_manage/src/test/java/com/restaurante/availability/service/AvailabilityServiceTest.java`:

```java
package com.restaurante.availability.service;

import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AvailabilityServiceTest {

    private static final Long RESTAURANT_ID = 1L;
    private static final Long TABLE_ID = 10L;
    private static final LocalDate DATE = LocalDate.of(2026, 12, 31);
    private static final LocalTime TIME = LocalTime.of(21, 0);
    private static final int DURATION_MINUTES = 90;

    @Mock private DiningTableRepository diningTableRepository;
    @Mock private ReservationRepository reservationRepository;

    @InjectMocks private AvailabilityService service;

    private Restaurant restaurant;
    private DiningTable table;

    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);
        restaurant.setName("La Buena Mesa");
        restaurant.setDefaultReservationDurationMinutes(DURATION_MINUTES);

        table = new DiningTable();
        table.setId(TABLE_ID);
        table.setTableNumber("1");
        table.setCapacity(4);
        table.setStatus(TableStatus.AVAILABLE);
        table.setRestaurant(restaurant);

        when(diningTableRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(table));
        when(diningTableRepository.findByIdAndDeletedFalseForUpdate(TABLE_ID))
                .thenReturn(Optional.of(table));
    }

    private AvailabilityRequest request() {
        return new AvailabilityRequest(RESTAURANT_ID, DATE, TIME, 2);
    }

    private Reservation reservaActiva(LocalDate fecha, LocalTime hora, ReservationStatus estado) {
        Reservation r = new Reservation();
        r.setReservationDate(fecha);
        r.setReservationTime(hora);
        r.setStatus(estado);
        return r;
    }

    // ─── checkAvailability (endpoint público de disponibilidad) ───────────

    @Test
    void checkAvailability_excluyeMesaConReservaEnHuecoQueSolapaPorDuracion() {
        // Reserva a las 20:30 (30 min antes de las 21:00 solicitadas); con
        // 90 min de duración, 20:30-22:00 solapa con 21:00-22:30.
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(20, 30), ReservationStatus.PENDING)));

        List<AvailableTableResponse> result = service.checkAvailability(request());

        assertTrue(result.isEmpty(), "Una reserva 30 min antes con 90 min de duración debe solapar");
    }

    @Test
    void checkAvailability_incluyeMesaSinConflictosActivos() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of());

        List<AvailableTableResponse> result = service.checkAvailability(request());

        assertEquals(1, result.size());
        assertEquals(TABLE_ID, result.get(0).getTableId());
    }

    // ─── isTableAvailable / hasOverlap: casos de solape requeridos ────────

    @Test
    void isTableAvailable_rechazaReservaA30MinDeDiferencia_menosQueLaDuracion() {
        // Caso 1: 20:00-21:30 existente; se pide 20:30-22:00 → solapan (30 min < 90 min)
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(20, 0), ReservationStatus.CONFIRMED)));

        boolean disponible = service.isTableAvailable(table, DATE, LocalTime.of(20, 30), 2, null);

        assertFalse(disponible);
    }

    @Test
    void isTableAvailable_permiteReservaConsecutivaExactaAlLimiteDeLaDuracion() {
        // Caso 3: 20:00-21:30 existente; se pide 21:30-23:00 → NO solapan (exactamente 90 min de diferencia)
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(20, 0), ReservationStatus.CONFIRMED)));

        boolean disponible = service.isTableAvailable(table, DATE, LocalTime.of(21, 30), 2, null);

        assertTrue(disponible);
    }

    @Test
    void isTableAvailable_detectaSolapeQueCruzaMedianoche() {
        // Reserva a las 23:30 (dura hasta la 01:00 del día siguiente); se pide
        // la misma mesa a las 00:15 del día siguiente → debe solapar.
        LocalDate diaSiguiente = DATE.plusDays(1);
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE, diaSiguiente.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(23, 30), ReservationStatus.CONFIRMED)));

        boolean disponible = service.isTableAvailable(table, diaSiguiente, LocalTime.of(0, 15), 2, null);

        assertFalse(disponible);
    }

    @Test
    void isTableAvailable_rechazaSiCapacidadInsuficiente() {
        boolean disponible = service.isTableAvailable(table, DATE, TIME, 6, null);
        assertFalse(disponible);
    }

    @Test
    void isTableAvailable_rechazaSiLaMesaEstaEnMantenimiento() {
        table.setStatus(TableStatus.MAINTENANCE);
        boolean disponible = service.isTableAvailable(table, DATE, TIME, 2, null);
        assertFalse(disponible);
    }

    @Test
    void isTableAvailable_excludeReservationIdIgnoraLaPropiaReserva() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), 99L))
                .thenReturn(List.of());

        boolean disponible = service.isTableAvailable(table, DATE, TIME, 2, 99L);

        assertTrue(disponible);
    }

    // ─── assertNoOverlap: bloqueo pesimista + 409 ─────────────────────────

    @Test
    void assertNoOverlap_lanzaConflictExceptionSiHaySolape() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(20, 30), ReservationStatus.PENDING)));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> service.assertNoOverlap(table, DATE, TIME, null));
        assertTrue(ex.getMessage().contains("solapa"));
    }

    @Test
    void assertNoOverlap_adquiereElBloqueoPesimistaAntesDeComprobar() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of());

        service.assertNoOverlap(table, DATE, TIME, null);

        org.mockito.Mockito.verify(diningTableRepository).findByIdAndDeletedFalseForUpdate(TABLE_ID);
    }

    @Test
    void assertNoOverlap_noLanzaSiNoHaySolape() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of());

        assertDoesNotThrow(() -> service.assertNoOverlap(table, DATE, TIME, null));
    }

    // ─── assignFirstAvailableTable ────────────────────────────────────────

    @Test
    void assignFirstAvailableTable_devuelveLaMesaSiEstaLibre() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of());

        Optional<DiningTable> resultado = service.assignFirstAvailableTable(restaurant, DATE, TIME, 2, null);

        assertTrue(resultado.isPresent());
        assertEquals(TABLE_ID, resultado.get().getId());
    }

    @Test
    void assignFirstAvailableTable_devuelveVacioSiNingunaEstaLibre() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, TIME, ReservationStatus.CONFIRMED)));

        Optional<DiningTable> resultado = service.assignFirstAvailableTable(restaurant, DATE, TIME, 2, null);

        assertTrue(resultado.isEmpty());
    }
}
```

- [ ] **Step 6: Ejecutar y confirmar que falla (no compila)**

```bash
mvn test -Dtest=AvailabilityServiceTest
```

Esperado: FAIL (compilación) — `isTableAvailable`, `assertNoOverlap`, `assignFirstAvailableTable` y `findByIdAndDeletedFalseForUpdate` no existen todavía.

- [ ] **Step 7: Añadir el método de bloqueo pesimista a `DiningTableRepository`**

En `restaurante_manage/src/main/java/com/restaurante/diningtable/repository/DiningTableRepository.java`, añadir los imports:

```java
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
```

y el método, tras `findByIdAndDeletedFalse`:

```java

    /**
     * Igual que {@link #findByIdAndDeletedFalse(Long)} pero adquiriendo un
     * bloqueo pesimista de escritura sobre la fila de la mesa. Se usa justo
     * antes de comprobar solape y guardar, para serializar dos transacciones
     * que compitan por la misma mesa (ver AvailabilityService.assertNoOverlap).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM DiningTable t WHERE t.id = :id AND t.deleted = false")
    Optional<DiningTable> findByIdAndDeletedFalseForUpdate(@Param("id") Long id);
```

- [ ] **Step 8: Reescribir `AvailabilityService`**

Reemplazar el contenido completo de `restaurante_manage/src/main/java/com/restaurante/availability/service/AvailabilityService.java`:

```java
package com.restaurante.availability.service;

import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Autoridad única de disponibilidad de mesas: capacidad, mantenimiento y
 * solape de horario. Tanto el endpoint público de disponibilidad como
 * {@code ReservationService} (crear, editar, confirmar, reasignar) pasan
 * por aquí — ninguna otra clase reimplementa esta lógica.
 *
 * El solape se calcula por INTERVALO horario, no por igualdad exacta de
 * hora: cada reserva ocupa la mesa desde {@code reservationTime} durante
 * {@code Restaurant.defaultReservationDurationMinutes} minutos. Dos reservas
 * de la misma mesa solapan si sus intervalos [inicio, fin) se cruzan.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AvailabilityService {

    private final DiningTableRepository diningTableRepository;
    private final ReservationRepository reservationRepository;

    /**
     * Verifica disponibilidad real de mesas para una fecha y hora determinadas.
     * Las reservas CANCELLED, COMPLETED y NO_SHOW NO bloquean disponibilidad.
     */
    public List<AvailableTableResponse> checkAvailability(AvailabilityRequest request) {
        List<DiningTable> allTables = diningTableRepository
                .findByRestaurantIdAndDeletedFalse(request.getRestaurantId());

        log.debug("Verificando disponibilidad: restaurante={}, fecha={}, hora={}, comensales={}",
                request.getRestaurantId(), request.getDate(), request.getTime(), request.getPartySize());

        List<AvailableTableResponse> available = allTables.stream()
                .filter(table -> isTableAvailable(table, request.getDate(), request.getTime(),
                        request.getPartySize(), null))
                .map(table -> new AvailableTableResponse(
                        table.getId(), table.getTableNumber(), table.getCapacity(), table.getLocation()))
                .collect(Collectors.toList());

        log.info("Disponibilidad para restaurante {}: {} mesas disponibles de {}",
                request.getRestaurantId(), available.size(), allTables.size());

        return available;
    }

    /**
     * Verifica si una mesa está disponible para una reserva en una fecha/hora
     * concretas: capacidad suficiente, no está en MAINTENANCE, y no solapa con
     * ninguna otra reserva ACTIVA (PENDING/CONFIRMED) de esa mesa.
     * {@code excludeReservationId} ignora la propia reserva al editar/reconfirmar.
     */
    public boolean isTableAvailable(DiningTable table, LocalDate date, LocalTime time,
                                     Integer partySize, Long excludeReservationId) {
        if (partySize != null && table.getCapacity() < partySize) {
            log.debug("Mesa {} NO disponible: capacidad {} < comensales {}", table.getId(), table.getCapacity(), partySize);
            return false;
        }
        if (table.getStatus() == TableStatus.MAINTENANCE) {
            log.debug("Mesa {} NO disponible: está en MANTENIMIENTO", table.getId());
            return false;
        }
        return !hasOverlap(table, date, time, excludeReservationId);
    }

    /**
     * Lanza {@link ConflictException} (HTTP 409) si la mesa tiene una reserva
     * activa cuyo intervalo horario solapa con el solicitado. Adquiere un
     * bloqueo pesimista sobre la fila de la mesa ANTES de comprobar el solape,
     * para serializar dos transacciones que compitan por la misma mesa
     * (ver Task 4: se combina con aislamiento READ_COMMITTED en el llamador).
     */
    public void assertNoOverlap(DiningTable table, LocalDate date, LocalTime time, Long excludeReservationId) {
        DiningTable lockedTable = diningTableRepository.findByIdAndDeletedFalseForUpdate(table.getId())
                .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", table.getId()));

        if (hasOverlap(lockedTable, date, time, excludeReservationId)) {
            int duration = lockedTable.getRestaurant().getDefaultReservationDurationMinutes();
            throw new ConflictException("La mesa " + lockedTable.getTableNumber()
                    + " ya tiene una reserva que solapa con la franja de " + time + " a "
                    + time.plusMinutes(duration) + " el " + date + ".");
        }
    }

    /**
     * Busca la primera mesa del restaurante disponible para la fecha/hora/comensales
     * indicados. No adquiere bloqueo (solo escaneo de candidatas); el bloqueo se
     * adquiere después, cuando se llama a {@link #assertNoOverlap} sobre la mesa elegida.
     */
    public Optional<DiningTable> assignFirstAvailableTable(Restaurant restaurant, LocalDate date, LocalTime time,
                                                            Integer partySize, Long excludeReservationId) {
        return diningTableRepository.findByRestaurantIdAndDeletedFalse(restaurant.getId()).stream()
                .filter(t -> isTableAvailable(t, date, time, partySize, excludeReservationId))
                .findFirst();
    }

    /**
     * Calcula si el intervalo [time, time+duración) de la mesa solicitada
     * solapa con el de alguna reserva activa existente. Se consultan las
     * reservas de esa mesa en el rango [fecha-1, fecha+1] (no solo el mismo
     * día) para detectar solapes que cruzan medianoche.
     */
    private boolean hasOverlap(DiningTable table, LocalDate date, LocalTime time, Long excludeReservationId) {
        int durationMinutes = table.getRestaurant().getDefaultReservationDurationMinutes();
        LocalDateTime start = LocalDateTime.of(date, time);
        LocalDateTime end = start.plusMinutes(durationMinutes);

        List<Reservation> candidatas = reservationRepository.findActiveByTableAndDateBetween(
                table.getId(), date.minusDays(1), date.plusDays(1), excludeReservationId);

        for (Reservation candidata : candidatas) {
            LocalDateTime otroInicio = LocalDateTime.of(candidata.getReservationDate(), candidata.getReservationTime());
            LocalDateTime otroFin = otroInicio.plusMinutes(durationMinutes);
            if (start.isBefore(otroFin) && otroInicio.isBefore(end)) {
                return true;
            }
        }
        return false;
    }
}
```

- [ ] **Step 9: Ejecutar y confirmar que todo pasa**

```bash
mvn test -Dtest=AvailabilityRequestValidationTest,AvailabilityServiceTest
```

Esperado: PASS (todos).

- [ ] **Step 10: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/diningtable/repository/DiningTableRepository.java restaurante_manage/src/main/java/com/restaurante/availability/service/AvailabilityService.java restaurante_manage/src/main/java/com/restaurante/availability/dto/AvailabilityRequest.java restaurante_manage/src/test/java/com/restaurante/availability/service/AvailabilityServiceTest.java restaurante_manage/src/test/java/com/restaurante/availability/dto/AvailabilityRequestValidationTest.java
git commit -m "feat(availability): solape por intervalo horario con bloqueo pesimista (autoridad única)"
```

---

## Task 4: `ReservationService` — delegar en `AvailabilityService` y aislar transacciones

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java` (elimina `findActiveConflicts`, ya sin consumidores tras este task)
- Modify: `restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationServiceTest.java`
- Modify: `restaurante_manage/src/test/java/com/restaurante/reservation/repository/ReservationRepositoryTest.java` (elimina los tests de `findActiveConflicts`, ya cubiertos por `findActiveByTableAndDateBetween` en la Task 2)

**Interfaces:**
- Consumes: `AvailabilityService.isTableAvailable(...)`, `.assertNoOverlap(...)`, `.assignFirstAvailableTable(...)` (Task 3).
- `ReservationService` ya no expone ni usa `assertNoOverlap`, `isTableAvailableForReservation`, `assignAvailableTable` propios (eliminados).

- [ ] **Step 1: Reescribir `ReservationServiceTest` para mockear `AvailabilityService` (falla)**

En `restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationServiceTest.java`:

1. Añadir el import:

```java
import com.restaurante.availability.service.AvailabilityService;
```

2. Añadir el mock, junto a los demás `@Mock`:

```java
    @Mock private AvailabilityService availabilityService;
```

3. Reemplazar `create_rechazaReservaSolapadaEnLaMismaMesaFechaHora`:

```java
    @Test
    void create_rechazaReservaSolapadaEnLaMismaMesaFechaHora() {
        stubMapperPending();
        doThrow(new ConflictException("La mesa 1 ya tiene una reserva que solapa con la franja solicitada."))
                .when(availabilityService).assertNoOverlap(table, DATE, TIME, null);

        ConflictException ex = assertThrows(ConflictException.class,
                () -> service.create(request()));
        assertTrue(ex.getMessage().contains("solapa"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }
```

4. Reemplazar `create_permiteReservaSiElHuecoEstaLibre`:

```java
    @Test
    void create_permiteReservaSiElHuecoEstaLibre() {
        stubMapperPending();

        assertDoesNotThrow(() -> service.create(request()));
        verify(reservationRepository).save(any(Reservation.class));
    }
```

5. Reemplazar `create_permiteReservaEnOtraMesaALaMismaHora`:

```java
    @Test
    void create_permiteReservaEnOtraMesaALaMismaHora() {
        Long otraMesaId = 11L;
        DiningTable otraMesa = new DiningTable();
        otraMesa.setId(otraMesaId);
        otraMesa.setTableNumber("2");
        otraMesa.setCapacity(4);
        otraMesa.setRestaurant(restaurant);
        when(diningTableRepository.findByIdAndDeletedFalse(otraMesaId)).thenReturn(Optional.of(otraMesa));

        stubMapperPending();
        doThrow(new ConflictException("La mesa 1 ya tiene una reserva que solapa."))
                .when(availabilityService).assertNoOverlap(eq(table), any(), any(), any());

        ReservationRequest req = request();
        req.setDiningTableId(otraMesaId);

        assertDoesNotThrow(() -> service.create(req));
        verify(reservationRepository).save(any(Reservation.class));
        verify(availabilityService, never()).assertNoOverlap(eq(otraMesa), any(), any(), any());
    }
```

Nota: este último `verify` confirma que la mesa 1 nunca se comprueba (solo se pidió la 2); se deja también el stub sobre la mesa 1 lanzando conflicto para demostrar que, aunque estuviera ocupada, no afecta a la creación sobre la mesa 2.

6. Eliminar el stub inútil de `create_rechazaCapacidadInsuficienteAunqueLaReservaSeaPending` (la excepción de capacidad se lanza ANTES de llegar a comprobar solape, así que el stub de disponibilidad nunca se ejecuta): quitar la línea

```java
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, null)).thenReturn(List.of());
```

del cuerpo de ese test (el resto del test no cambia).

7. Reemplazar `updateStatus_noConfirmaSiLaUnicaMesaTieneOtraReservaActivaEnElHueco` por `updateStatus_rechazaConfirmarSiNoHayMesaDisponibleParaAutoAsignar`:

```java
    @Test
    void updateStatus_rechazaConfirmarSiNoHayMesaDisponibleParaAutoAsignar() {
        Reservation reserva = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reserva));
        when(availabilityService.assignFirstAvailableTable(restaurant, DATE, TIME, 2, 5L))
                .thenReturn(Optional.empty());

        assertThrows(com.restaurante.common.exception.BadRequestException.class,
                () -> service.updateStatus(5L, "CONFIRMED"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }
```

8. Reemplazar `updateStatus_confirmaYAsignaMesaCuandoElHuecoEstaLibre`:

```java
    @Test
    void updateStatus_confirmaYAsignaMesaCuandoElHuecoEstaLibre() {
        Reservation reserva = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reserva));
        when(availabilityService.assignFirstAvailableTable(restaurant, DATE, TIME, 2, 5L))
                .thenReturn(Optional.of(table));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        assertDoesNotThrow(() -> service.updateStatus(5L, "CONFIRMED"));
        assertEquals(ReservationStatus.CONFIRMED, reserva.getStatus());
        assertEquals(table, reserva.getDiningTable());
        verify(availabilityService).assertNoOverlap(table, DATE, TIME, 5L);
    }
```

9. Reemplazar `create_publicaReservationConfirmedEventSiSeCreaConfirmada`:

```java
    @Test
    void create_publicaReservationConfirmedEventSiSeCreaConfirmada() {
        when(reservationMapper.toEntity(any(ReservationRequest.class))).thenAnswer(inv -> {
            Reservation r = new Reservation();
            r.setReservationDate(DATE);
            r.setReservationTime(TIME);
            r.setPartySize(2);
            r.setStatus(ReservationStatus.CONFIRMED);
            return r;
        });
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(availabilityService.isTableAvailable(table, DATE, TIME, 2, null)).thenReturn(true);

        service.create(request());

        ArgumentCaptor<ReservationConfirmedEvent> captor = ArgumentCaptor.forClass(ReservationConfirmedEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
        assertEquals("ana@example.com", captor.getValue().data().customerEmail());
    }
```

10. Reemplazar `updateStatus_publicaReservationConfirmedEventAlConfirmar`:

```java
    @Test
    void updateStatus_publicaReservationConfirmedEventAlConfirmar() {
        Reservation reserva = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reserva));
        when(availabilityService.assignFirstAvailableTable(restaurant, DATE, TIME, 2, 5L))
                .thenReturn(Optional.of(table));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(5L, "CONFIRMED");

        ArgumentCaptor<ReservationConfirmedEvent> captor = ArgumentCaptor.forClass(ReservationConfirmedEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
    }
```

11. Reemplazar `create_rechazaCapacidadInsuficienteAunqueLaReservaSeaPending` (después de quitar el stub del paso 6, queda igual salvo esa línea eliminada — no requiere más cambios).

El resto de tests de la clase (`update_rechazaMesaDeOtroRestaurante`, `create_rechazaMesaDeOtroRestaurante`, `create_rechazaClienteDeOtroRestaurante`, `update_rechazaClienteDeOtroRestauranteAlCambiarDeCliente`, `update_rechazaCapacidadInsuficienteAunqueLaReservaSeaPending`, `findByRestaurantIdAndDate_*`, `updateStatus_publicaReservationCancelledEventAlCancelar`, `updateStatus_noPublicaReservationCancelledEventSiYaEstabaCancelada`, `delete_*`, la matriz de transiciones `updateStatus_rechaza*`/`updateStatus_permiteCancelarDosVeces`, y `create_rechazaHoraYaPasadaHoy`) no tocan `findActiveConflicts` ni disponibilidad y **no cambian**.

- [ ] **Step 2: Ejecutar y confirmar que falla (no compila)**

```bash
cd restaurante_manage
mvn test -Dtest=ReservationServiceTest
```

Esperado: FAIL (compilación) — `ReservationService` aún no acepta `AvailabilityService` en su constructor ni expone ese comportamiento.

- [ ] **Step 3: Añadir la dependencia de `AvailabilityService` a `ReservationService`**

En `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java`, añadir el import:

```java
import com.restaurante.availability.service.AvailabilityService;
import org.springframework.transaction.annotation.Isolation;
```

y el campo, junto a los demás:

```java
    private final AvailabilityService availabilityService;
```

(Lombok `@RequiredArgsConstructor` añade el parámetro al constructor automáticamente — no hace falta tocarlo a mano.)

- [ ] **Step 4: Eliminar los métodos privados duplicados y sus usos en `create()`**

Eliminar por completo el método privado `assertNoOverlap` (líneas 379-390 del archivo original):

```java
    /**
     * RES-03: lanza {@link ConflictException} (HTTP 409) si la mesa ya tiene otra
     * reserva activa (PENDING o CONFIRMED) en esa fecha y hora exactas.
     */
    private void assertNoOverlap(DiningTable table, LocalDate date, LocalTime time, Long excludeId) {
        List<Reservation> conflicts = reservationRepository
                .findActiveConflicts(table.getId(), date, time, excludeId);
        if (!conflicts.isEmpty()) {
            throw new ConflictException("La mesa " + table.getTableNumber()
                    + " ya tiene una reserva activa para el " + date + " a las " + time + ".");
        }
    }
```

Eliminar por completo el método privado `isTableAvailableForReservation` (líneas 561-601 del archivo original, incluido su bloque de comentario javadoc).

Eliminar por completo el método privado `assignAvailableTable` (líneas 603-634 del archivo original, incluido su comentario javadoc).

- [ ] **Step 5: Actualizar `create()` para delegar en `AvailabilityService`**

Reemplazar:

```java
            // RES-03: el conflicto de hueco (409) tiene prioridad sobre el chequeo
            // de disponibilidad (400) para que un solape devuelva siempre Conflict.
            assertNoOverlap(table, reservation.getReservationDate(), reservation.getReservationTime(), null);

            // Si la reserva se crea como CONFIRMED, verificar disponibilidad y marcar mesa como RESERVED
            if (finalStatus == ReservationStatus.CONFIRMED) {
                if (!isTableAvailableForReservation(table, reservation.getReservationDate(),
                        reservation.getReservationTime(), reservation.getPartySize(), null)) {
                    throw new BadRequestException(
                            "La mesa " + table.getTableNumber() + " no está disponible para la fecha y hora solicitadas");
                }
                table.setStatus(TableStatus.RESERVED);
                diningTableRepository.save(table);
                log.info("Mesa {} marcada como RESERVED al crear reserva CONFIRMED (nueva)", table.getId());
            }
            // Si la reserva es PENDING, NO cambiamos el estado de la mesa bajo ninguna circunstancia
        } else if (finalStatus == ReservationStatus.CONFIRMED) {
            // No se proporcionó mesa pero la reserva es CONFIRMED → auto-asignar
            table = assignAvailableTable(reservation);
            if (table == null) {
                throw new BadRequestException(
                        "No hay mesas disponibles para la fecha, hora y número de comensales solicitados. " +
                        "Asigna una mesa manualmente o cambia el estado a PENDING.");
            }
            table.setStatus(TableStatus.RESERVED);
            diningTableRepository.save(table);
            log.info("Mesa {} auto-asignada a reserva CONFIRMED (nueva)", table.getId());
        }

        if (table != null) {
            // RES-03: impedir dos reservas activas (PENDING/CONFIRMED) en la misma mesa/fecha/hora.
            assertNoOverlap(table, reservation.getReservationDate(), reservation.getReservationTime(), null);
            reservation.setDiningTable(table);
        }
```

por:

```java
            // RES-03: el conflicto de hueco (409) tiene prioridad sobre el chequeo
            // de disponibilidad (400) para que un solape devuelva siempre Conflict.
            availabilityService.assertNoOverlap(table, reservation.getReservationDate(), reservation.getReservationTime(), null);

            // Si la reserva se crea como CONFIRMED, verificar disponibilidad y marcar mesa como RESERVED
            if (finalStatus == ReservationStatus.CONFIRMED) {
                if (!availabilityService.isTableAvailable(table, reservation.getReservationDate(),
                        reservation.getReservationTime(), reservation.getPartySize(), null)) {
                    throw new BadRequestException(
                            "La mesa " + table.getTableNumber() + " no está disponible para la fecha y hora solicitadas");
                }
                table.setStatus(TableStatus.RESERVED);
                diningTableRepository.save(table);
                log.info("Mesa {} marcada como RESERVED al crear reserva CONFIRMED (nueva)", table.getId());
            }
            // Si la reserva es PENDING, NO cambiamos el estado de la mesa bajo ninguna circunstancia
        } else if (finalStatus == ReservationStatus.CONFIRMED) {
            // No se proporcionó mesa pero la reserva es CONFIRMED → auto-asignar
            table = availabilityService.assignFirstAvailableTable(restaurant, reservation.getReservationDate(),
                    reservation.getReservationTime(), reservation.getPartySize(), null).orElse(null);
            if (table == null) {
                throw new BadRequestException(
                        "No hay mesas disponibles para la fecha, hora y número de comensales solicitados. " +
                        "Asigna una mesa manualmente o cambia el estado a PENDING.");
            }
            table.setStatus(TableStatus.RESERVED);
            diningTableRepository.save(table);
            log.info("Mesa {} auto-asignada a reserva CONFIRMED (nueva)", table.getId());
        }

        if (table != null) {
            // RES-03: impedir dos reservas activas (PENDING/CONFIRMED) en la misma mesa/fecha/hora.
            availabilityService.assertNoOverlap(table, reservation.getReservationDate(), reservation.getReservationTime(), null);
            reservation.setDiningTable(table);
        }
```

Y en la firma del método, añadir el aislamiento de transacción:

```java
    @Transactional
    public ReservationResponse create(ReservationRequest request) {
```

por:

```java
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReservationResponse create(ReservationRequest request) {
```

- [ ] **Step 6: Actualizar `update()` para delegar en `AvailabilityService`**

Reemplazar:

```java
    @Transactional
    public ReservationResponse update(Long id, ReservationRequest request) {
```

por:

```java
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReservationResponse update(Long id, ReservationRequest request) {
```

Reemplazar:

```java
            // Si la reserva está CONFIRMED, actualizar estado de mesas
            if (reservation.getStatus() == ReservationStatus.CONFIRMED) {
                // Verificar disponibilidad de la nueva mesa
                if (!isTableAvailableForReservation(table, reservation.getReservationDate(),
                        reservation.getReservationTime(), reservation.getPartySize(), reservation.getId())) {
```

por:

```java
            // Si la reserva está CONFIRMED, actualizar estado de mesas
            if (reservation.getStatus() == ReservationStatus.CONFIRMED) {
                // Verificar disponibilidad de la nueva mesa
                if (!availabilityService.isTableAvailable(table, reservation.getReservationDate(),
                        reservation.getReservationTime(), reservation.getPartySize(), reservation.getId())) {
```

Reemplazar:

```java
        // RES-03: validar solape con el estado final (fecha/hora/mesa ya actualizadas),
        // excluyendo la propia reserva.
        if (reservation.getDiningTable() != null) {
            assertNoOverlap(reservation.getDiningTable(), reservation.getReservationDate(),
                    reservation.getReservationTime(), reservation.getId());
        }
```

por:

```java
        // RES-03: validar solape con el estado final (fecha/hora/mesa ya actualizadas),
        // excluyendo la propia reserva.
        if (reservation.getDiningTable() != null) {
            availabilityService.assertNoOverlap(reservation.getDiningTable(), reservation.getReservationDate(),
                    reservation.getReservationTime(), reservation.getId());
        }
```

- [ ] **Step 7: Actualizar `updateStatus()` para delegar en `AvailabilityService`**

Reemplazar:

```java
    @Transactional
    public ReservationResponse updateStatus(Long id, String status) {
```

por:

```java
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReservationResponse updateStatus(Long id, String status) {
```

Reemplazar:

```java
            // Si no tiene mesa asignada, intentar auto-asignar una disponible
            if (table == null) {
                table = assignAvailableTable(reservation);
                if (table == null) {
                    throw new BadRequestException(
                            "No hay mesas disponibles para la fecha, hora y número de comensales solicitados. " +
                            "Asigna una mesa manualmente o contacta al administrador.");
                }
                reservation.setDiningTable(table);
                log.info("Mesa {} auto-asignada a la reserva #{}", table.getId(), id);
            } else {
                // Tiene mesa asignada → verificar que sigue disponible
                if (!isTableAvailableForReservation(table, reservation.getReservationDate(),
                        reservation.getReservationTime(), reservation.getPartySize(), reservation.getId())) {
                    // Intentar re-asignar otra mesa
                    DiningTable alternativeTable = assignAvailableTable(reservation);
                    if (alternativeTable != null) {
                        reservation.setDiningTable(alternativeTable);
                        table = alternativeTable;
                        log.info("Mesa re-asignada a {} para reserva #{} (anterior ya no disponible)", table.getId(), id);
                    } else {
                        throw new BadRequestException(
                                "La mesa " + table.getTableNumber() + " ya no está disponible y no hay mesas alternativas libres.");
                    }
                }
            }

            // RES-03: guarda final antes de confirmar — ninguna otra reserva activa
            // (PENDING o CONFIRMED) puede ocupar ya esa mesa en esa fecha/hora.
            assertNoOverlap(table, reservation.getReservationDate(),
                    reservation.getReservationTime(), reservation.getId());
```

por:

```java
            // Si no tiene mesa asignada, intentar auto-asignar una disponible
            if (table == null) {
                table = availabilityService.assignFirstAvailableTable(reservation.getRestaurant(),
                        reservation.getReservationDate(), reservation.getReservationTime(),
                        reservation.getPartySize(), reservation.getId()).orElse(null);
                if (table == null) {
                    throw new BadRequestException(
                            "No hay mesas disponibles para la fecha, hora y número de comensales solicitados. " +
                            "Asigna una mesa manualmente o contacta al administrador.");
                }
                reservation.setDiningTable(table);
                log.info("Mesa {} auto-asignada a la reserva #{}", table.getId(), id);
            } else {
                // Tiene mesa asignada → verificar que sigue disponible
                if (!availabilityService.isTableAvailable(table, reservation.getReservationDate(),
                        reservation.getReservationTime(), reservation.getPartySize(), reservation.getId())) {
                    // Intentar re-asignar otra mesa
                    DiningTable alternativeTable = availabilityService.assignFirstAvailableTable(reservation.getRestaurant(),
                            reservation.getReservationDate(), reservation.getReservationTime(),
                            reservation.getPartySize(), reservation.getId()).orElse(null);
                    if (alternativeTable != null) {
                        reservation.setDiningTable(alternativeTable);
                        table = alternativeTable;
                        log.info("Mesa re-asignada a {} para reserva #{} (anterior ya no disponible)", table.getId(), id);
                    } else {
                        throw new BadRequestException(
                                "La mesa " + table.getTableNumber() + " ya no está disponible y no hay mesas alternativas libres.");
                    }
                }
            }

            // RES-03: guarda final antes de confirmar — ninguna otra reserva activa
            // (PENDING o CONFIRMED) puede ocupar ya esa mesa en esa fecha/hora.
            availabilityService.assertNoOverlap(table, reservation.getReservationDate(),
                    reservation.getReservationTime(), reservation.getId());
```

- [ ] **Step 8: Quitar el import y uso de `ConflictException` si ya no se usa directamente**

Comprobar si `ConflictException` sigue usándose en `ReservationService.java` tras los cambios anteriores:

```bash
grep -n "ConflictException" restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java
```

Si ya no aparece ninguna referencia (la única era el método `assertNoOverlap` eliminado), quitar la línea `import com.restaurante.common.exception.ConflictException;` del bloque de imports.

- [ ] **Step 9: Eliminar `findActiveConflicts` de `ReservationRepository` (ya sin consumidores)**

Confirmar que ya no hay llamadas a `findActiveConflicts` en `src/main` (solo en tests, que se limpian a continuación):

```bash
grep -rn "findActiveConflicts" restaurante_manage/src/main
```

Esperado: sin resultados. En `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java`, eliminar el método completo:

```java
    /**
     * RES-03: reservas ACTIVAS (PENDING o CONFIRMED) que ocupan una mesa en una
     * fecha/hora exactas. Las CANCELLED, COMPLETED y NO_SHOW no bloquean.
     * {@code excludeId} permite ignorar la propia reserva al editar (null = ninguna).
     */
    @Query("SELECT r FROM Reservation r WHERE r.diningTable.id = :tableId " +
           "AND r.deleted = false AND r.status IN ('PENDING','CONFIRMED') " +
           "AND r.reservationDate = :date AND r.reservationTime = :time " +
           "AND (:excludeId IS NULL OR r.id <> :excludeId)")
    List<Reservation> findActiveConflicts(@Param("tableId") Long tableId,
                                          @Param("date") LocalDate date,
                                          @Param("time") LocalTime time,
                                          @Param("excludeId") Long excludeId);
```

- [ ] **Step 10: Eliminar los tests obsoletos de `findActiveConflicts` en `ReservationRepositoryTest`**

En `restaurante_manage/src/test/java/com/restaurante/reservation/repository/ReservationRepositoryTest.java`, eliminar estos 6 tests (ya cubiertos por los de `findActiveByTableAndDateBetween` añadidos en la Task 2): `detectaConflictoConReservaPendienteEnElMismoHueco`, `detectaConflictoConReservaConfirmadaEnElMismoHueco`, `lasReservasCanceladasCompletadasONoShowNoBloqueanElHueco`, `otraMesaALaMismaHoraNoEsConflicto`, `laMismaMesaAOtraHoraNoEsConflicto`, `excludeIdIgnoraLaPropiaReservaAlEditar`, `lasReservasBorradasLogicamenteNoBloqueanElHueco`.

También actualizar el comentario javadoc de la clase (líneas 23-27), que menciona `findActiveConflicts`:

```java
/**
 * RES-03: verifica contra una base de datos real (H2) la semántica de
 * {@link ReservationRepository#findActiveConflicts}: solo las reservas ACTIVAS
 * (PENDING/CONFIRMED) y no borradas bloquean el hueco mesa+fecha+hora.
 */
```

por:

```java
/**
 * RES-03: verifica contra una base de datos real (H2) la semántica de
 * {@link ReservationRepository#findActiveByTableAndDateBetween}: solo las
 * reservas ACTIVAS (PENDING/CONFIRMED) y no borradas bloquean una mesa, y
 * el solape real por duración se calcula en {@code AvailabilityService}
 * sobre este resultado (ver AvailabilityServiceTest).
 */
```

(Los tests de `findActiveByTableAndDateBetween` añadidos en la Task 2 permanecen intactos.)

- [ ] **Step 11: Ejecutar toda la suite relacionada y confirmar que pasa**

```bash
cd restaurante_manage
mvn test -Dtest=ReservationServiceTest,ReservationRepositoryTest,AvailabilityServiceTest,AvailabilityRequestValidationTest
```

Esperado: PASS completo.

- [ ] **Step 12: Compilar todo el módulo para detectar referencias rotas**

```bash
mvn compile test-compile
```

Esperado: BUILD SUCCESS (confirma que ningún otro archivo referenciaba los métodos eliminados).

- [ ] **Step 13: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationServiceTest.java restaurante_manage/src/test/java/com/restaurante/reservation/repository/ReservationRepositoryTest.java
git commit -m "refactor(reservation): delegar disponibilidad en AvailabilityService y aislar transacciones en READ_COMMITTED"
```

---

## Task 5: Frontend — campo de duración de reserva en ajustes de restaurante

**Files:**
- Modify: `restaurante-frontend/src/pages/Restaurants.jsx`

**Interfaces:** ninguna nueva — añade `defaultReservationDurationMinutes` al estado del formulario y al payload que ya construye `handleSubmit`.

- [ ] **Step 1: Añadir el campo al estado inicial del formulario**

En `restaurante-frontend/src/pages/Restaurants.jsx`, reemplazar:

```javascript
const INITIAL_FORM = {
  name: '',
  address: '',
  phone: '',
  email: '',
  description: '',
  openingTime: '',
  closingTime: '',
  capacity: '',
};
```

por:

```javascript
const INITIAL_FORM = {
  name: '',
  address: '',
  phone: '',
  email: '',
  description: '',
  openingTime: '',
  closingTime: '',
  capacity: '',
  defaultReservationDurationMinutes: '',
};
```

- [ ] **Step 2: Precargar el campo al abrir el modal de edición**

Reemplazar:

```javascript
      capacity: restaurant.capacity ?? '',
    });
    setFormErrors({});
    setShowModal(true);
  };
```

por:

```javascript
      capacity: restaurant.capacity ?? '',
      defaultReservationDurationMinutes: restaurant.defaultReservationDurationMinutes ?? '',
    });
    setFormErrors({});
    setShowModal(true);
  };
```

- [ ] **Step 3: Validar el rango en `validateForm`**

Reemplazar:

```javascript
    if (
      capacity !== '' &&
      capacity !== null &&
      capacity !== undefined &&
      (Number(capacity) < 0 || !Number.isInteger(Number(capacity)))
    ) {
      errors.capacity = 'La capacidad debe ser un número entero positivo.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };
```

por:

```javascript
    if (
      capacity !== '' &&
      capacity !== null &&
      capacity !== undefined &&
      (Number(capacity) < 0 || !Number.isInteger(Number(capacity)))
    ) {
      errors.capacity = 'La capacidad debe ser un número entero positivo.';
    }

    const duration = formData.defaultReservationDurationMinutes;
    if (
      duration !== '' &&
      duration !== null &&
      duration !== undefined &&
      (!Number.isInteger(Number(duration)) || Number(duration) < 15 || Number(duration) > 480)
    ) {
      errors.defaultReservationDurationMinutes = 'La duración debe ser un número entero entre 15 y 480 minutos.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };
```

- [ ] **Step 4: Incluir el campo en el payload de `handleSubmit`**

Reemplazar:

```javascript
        capacity:
          formData.capacity !== '' && formData.capacity !== null
            ? Number(formData.capacity)
            : null,
      };
```

por:

```javascript
        capacity:
          formData.capacity !== '' && formData.capacity !== null
            ? Number(formData.capacity)
            : null,
        defaultReservationDurationMinutes:
          formData.defaultReservationDurationMinutes !== '' && formData.defaultReservationDurationMinutes !== null
            ? Number(formData.defaultReservationDurationMinutes)
            : null,
      };
```

- [ ] **Step 5: Añadir el input al formulario, junto a Hora Cierre**

Reemplazar:

```javascript
                    {/* Cierre */}
                    <div className="col-6 col-md-3">
                      <label htmlFor="rest-closing" className="form-label">Hora Cierre</label>
                      <input
                        id="rest-closing"
                        type="time"
                        className="form-control"
                        name="closingTime"
                        value={formData.closingTime || ''}
                        onChange={handleFormChange}
                      />
                    </div>

                    {/* Descripción */}
```

por:

```javascript
                    {/* Cierre */}
                    <div className="col-6 col-md-3">
                      <label htmlFor="rest-closing" className="form-label">Hora Cierre</label>
                      <input
                        id="rest-closing"
                        type="time"
                        className="form-control"
                        name="closingTime"
                        value={formData.closingTime || ''}
                        onChange={handleFormChange}
                      />
                    </div>

                    {/* Duración de reserva */}
                    <div className="col-6 col-md-3">
                      <label htmlFor="rest-duration" className="form-label">Duración de reserva (min)</label>
                      <input
                        id="rest-duration"
                        type="number"
                        className={`form-control ${formErrors.defaultReservationDurationMinutes ? 'is-invalid' : ''}`}
                        name="defaultReservationDurationMinutes"
                        value={formData.defaultReservationDurationMinutes ?? ''}
                        onChange={handleFormChange}
                        placeholder="Ej: 90"
                        min="15"
                        max="480"
                        step="1"
                      />
                      {formErrors.defaultReservationDurationMinutes && (
                        <div className="invalid-feedback">{formErrors.defaultReservationDurationMinutes}</div>
                      )}
                    </div>

                    {/* Descripción */}
```

- [ ] **Step 6: Verificación manual**

```bash
cd restaurante_manage
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

En otra terminal:

```bash
cd restaurante-frontend
pnpm dev
```

En el navegador (`http://localhost:5173`), iniciar sesión como `super.admin`/`admin123`, ir a Restaurantes, editar un restaurante: confirmar que aparece "Duración de reserva (min)" precargada a 90, que aceptar 120 y guardar funciona, que 10 (fuera de rango) muestra el error de validación en el propio formulario y no llega a enviarse, y que 500 también lo rechaza.

- [ ] **Step 7: Commit**

```bash
git add restaurante-frontend/src/pages/Restaurants.jsx
git commit -m "feat(restaurantes): añadir campo de duración de reserva en ajustes del restaurante"
```

---

## Task 6: Test de concurrencia real — dos reservas simultáneas por la misma mesa

**Files:**
- Create: `restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationConcurrencyIntegrationTest.java`

**Interfaces:** ninguna nueva — ejercita `ReservationService.create` con transacciones reales (H2, perfil `dev`) desde dos hilos.

- [ ] **Step 1: Escribir el test de concurrencia**

Crear `restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationConcurrencyIntegrationTest.java`:

```java
package com.restaurante.reservation.service;

import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.dto.ReservationRequest;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.security.userdetails.UserPrincipal;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Caso 8 del blindaje de reservas: dos peticiones concurrentes intentando
 * reservar la misma mesa/franja horaria. Usa transacciones reales sobre H2
 * (no Mockito) para verificar que el bloqueo pesimista de AvailabilityService
 * serializa las dos transacciones y solo una puede tener éxito.
 */
@SpringBootTest
@ActiveProfiles("dev")
class ReservationConcurrencyIntegrationTest {

    @Autowired private ReservationService reservationService;
    @Autowired private ReservationRepository reservationRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private DiningTableRepository diningTableRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private UserRepository userRepository;

    private Restaurant restaurant;
    private DiningTable table;
    private Customer customerA;
    private Customer customerB;
    private User superAdmin;

    @BeforeEach
    void setUp() {
        superAdmin = userRepository.findByUsernameAndDeletedFalse("super.admin")
                .orElseThrow(() -> new IllegalStateException(
                        "Usuario demo 'super.admin' no encontrado — este test requiere el perfil dev con DemoDataInitializer"));

        restaurant = new Restaurant();
        restaurant.setName("Concurrencia Test");
        restaurant.setDefaultReservationDurationMinutes(90);
        restaurant = restaurantRepository.save(restaurant);

        table = new DiningTable();
        table.setRestaurant(restaurant);
        table.setTableNumber("C1");
        table.setCapacity(4);
        table = diningTableRepository.save(table);

        customerA = new Customer();
        customerA.setRestaurant(restaurant);
        customerA.setFirstName("Cliente");
        customerA.setLastName("A");
        customerA.setEmail("concurrencia.a@test.com");
        customerA = customerRepository.save(customerA);

        customerB = new Customer();
        customerB.setRestaurant(restaurant);
        customerB.setFirstName("Cliente");
        customerB.setLastName("B");
        customerB.setEmail("concurrencia.b@test.com");
        customerB = customerRepository.save(customerB);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private void authenticateAsSuperAdmin() {
        UserPrincipal principal = new UserPrincipal(superAdmin);
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
    }

    private ReservationRequest request(Customer customer) {
        ReservationRequest req = new ReservationRequest();
        req.setCustomerId(customer.getId());
        req.setRestaurantId(restaurant.getId());
        req.setDiningTableId(table.getId());
        req.setReservationDate(LocalDate.now().plusDays(1));
        req.setReservationTime(LocalTime.of(20, 0));
        req.setPartySize(2);
        return req;
    }

    @Test
    void soloUnaDeDosPeticionesConcurrentesReservaLaMismaMesaYFranja() throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);

        Callable<Boolean> intentoA = () -> {
            authenticateAsSuperAdmin();
            startLatch.await();
            try {
                reservationService.create(request(customerA));
                return true;
            } catch (Exception e) {
                return false;
            } finally {
                SecurityContextHolder.clearContext();
            }
        };
        Callable<Boolean> intentoB = () -> {
            authenticateAsSuperAdmin();
            startLatch.await();
            try {
                reservationService.create(request(customerB));
                return true;
            } catch (Exception e) {
                return false;
            } finally {
                SecurityContextHolder.clearContext();
            }
        };

        Future<Boolean> futureA = executor.submit(intentoA);
        Future<Boolean> futureB = executor.submit(intentoB);
        startLatch.countDown();

        boolean exitoA = futureA.get(10, TimeUnit.SECONDS);
        boolean exitoB = futureB.get(10, TimeUnit.SECONDS);
        executor.shutdown();

        int totalExitos = (exitoA ? 1 : 0) + (exitoB ? 1 : 0);
        assertEquals(1, totalExitos, "Exactamente una de las dos peticiones concurrentes debe tener éxito");

        List<Reservation> reservasCreadas = reservationRepository.findByRestaurantIdAndDeletedFalse(restaurant.getId());
        assertEquals(1, reservasCreadas.size(), "Solo una de las dos peticiones concurrentes debe haber persistido una reserva");
    }
}
```

- [ ] **Step 2: Ejecutar y confirmar que pasa**

```bash
cd restaurante_manage
mvn test -Dtest=ReservationConcurrencyIntegrationTest
```

Esperado: PASS. Si falla de forma intermitente (flaky) porque ambas transacciones logran completarse, revisar que `AvailabilityService.assertNoOverlap` (Task 3) efectivamente llama a `findByIdAndDeletedFalseForUpdate` (bloqueo pesimista) y que `ReservationService.create` (Task 4) tiene `@Transactional(isolation = Isolation.READ_COMMITTED)` — sin ambos, la prueba puede ser intermitente en vez de determinista.

- [ ] **Step 3: Commit**

```bash
git add restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationConcurrencyIntegrationTest.java
git commit -m "test(reservation): verificar con transacciones reales que solo una de dos reservas concurrentes tiene éxito"
```

---

## Task 7: Regresión completa

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa del backend**

```bash
cd restaurante_manage
mvn test
```

Esperado: BUILD SUCCESS, 0 fallos. Presta especial atención a `PublicReservationServiceTest`, `ReservationMapperTest` y `TableStatusSchedulerTest` — no deberían verse afectados por este cambio, pero confirman que no hay acoplamiento oculto con la lógica de disponibilidad tocada.

- [ ] **Step 2: Arrancar el backend contra H2/perfil dev y probar el flujo completo a mano**

```bash
mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

En otra terminal, con `pnpm dev` corriendo en `restaurante-frontend/`, verificar manualmente en el navegador (login `super.admin`/`admin123`):

1. Crear una reserva CONFIRMED a las 20:00 en una mesa. Intentar crear otra CONFIRMED a las 20:30 en la misma mesa → debe rechazarse con 409 y un mensaje mencionando el rango horario.
2. Crear una reserva a las 21:30 en la misma mesa (justo al terminar la anterior, si la duración es 90 min) → debe permitirse.
3. Cancelar la primera reserva y comprobar que una nueva petición a las 20:00 en esa mesa ya no se rechaza.
4. Editar una reserva sin cambiar mesa/fecha/hora → debe guardarse sin lanzar 409 contra sí misma.
5. En Ajustes → Restaurantes, cambiar la duración de reserva a 60 minutos y repetir el paso 1 con franjas de 60 minutos para confirmar que el nuevo valor se usa.

- [ ] **Step 2: Confirmar que no se ha modificado ningún contrato de API existente ni el diseño visual**

```bash
git diff --stat main
```

Revisar que los archivos tocados coinciden exactamente con los de este plan (Tasks 1-6) y que no hay cambios accidentales en otros archivos.
