# Horarios de servicio por restaurante — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa superpowers:subagent-driven-development (recomendada) o superpowers:executing-plans para implementar este plan tarea a tarea. Los pasos usan casillas (`- [ ]`) para el seguimiento.

**Goal:** Sustituir la ventana horaria única de cada restaurante por periodos de servicio configurables por día de la semana, editables desde una pantalla propia dentro de la sección de Restaurantes, y usados como fuente de las franjas horarias tanto en el flujo público como en el privado.

**Architecture:** Entidad relacional nueva `ServicePeriod` en su propio paquete, con `GET`/`PUT` bajo `/restaurants/{id}/service-periods` calcados del patrón idempotente de `floorplan/`. El único punto de cambio en la disponibilidad es el método privado `AvailabilityService.generarFranjas`, que pasa a recorrer los periodos del día en lugar de una única ventana; como `getTimeSlots` no cambia de contrato, los endpoints público y privado heredan la configuración sin tocarse. En el frontend, una ruta nueva `/restaurants/:restaurantId/configuracion` con dos apartados: Información (formulario extraído del modal actual y compartido con él) y Horarios de servicio (editor semanal nuevo).

**Tech Stack:** Spring Boot 3.3 / Java 21 / Maven / Flyway / MySQL (H2 en perfil `dev`), React 19 / Vite / pnpm / Bootstrap 5 / react-router v7 / Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-07-31-horarios-servicio-restaurante-design.md`

## Global Constraints

- **Commits locales por tarea, autorizados el 2026-07-31 para permitir la revisión entre tareas por diff.** Un commit por tarea en la rama actual, mensaje Conventional Commits en español. **`git push` y crear Pull Requests siguen PROHIBIDOS.**
- Todo el código, los comentarios, los mensajes de error y los textos de interfaz van **en español**.
- Las rutas y los nombres de rol se declaran como constantes en `common/util/Constants.java`; no se escriben literales sueltos.
- El aislamiento entre restaurantes es innegociable: **todo** endpoint nuevo llama a `currentUserService.validateRestaurantAccess(restaurantId)` en el servicio, además del `@PreAuthorize` del controlador. Ocultar el botón en el frontend no cuenta como protección.
- Toda entidad extiende `BaseEntity` y el borrado es lógico: las consultas filtran `deleted = false`.
- Hibernate corre con `ddl-auto: validate` en producción: **toda columna o tabla nueva necesita su migración Flyway**. La siguiente versión libre es `V8`.
- Los periodos que cruzan medianoche **no** se permiten: `endTime` debe ser estrictamente posterior a `startTime`.
- No se eliminan ni se dejan de editar `openingTime` / `closingTime`: son el fallback.
- **Nunca** arrancar el backend con `-Dspring-boot.run.profiles=dev` para comprobar algo a mano: ese perfil usa H2 en memoria con `create-drop` y borra los datos reales del usuario. Los tests que usan el perfil `dev` sí son correctos.
- No añadir secciones vacías ni funcionalidades futuras simuladas: solo los dos apartados descritos.

## Regla del fallback (rige varias tareas)

- **Cero periodos vivos en toda la semana** → el restaurante usa `openingTime`/`closingTime` (o los valores por defecto de `application.yml` si son nulos) para cualquier día, exactamente como hoy.
- **Al menos un periodo vivo en cualquier día** → la configuración por periodos está activa; un día sin periodos significa **cerrado** y devuelve cero franjas. No hay fallback por día.

## Estructura de archivos

**Backend — paquete nuevo `com.restaurante.serviceperiod`:**

| Archivo | Responsabilidad |
|---|---|
| `entity/ServicePeriod.java` | Entidad: restaurante, día, inicio, fin, nombre opcional |
| `repository/ServicePeriodRepository.java` | Una única consulta: periodos vivos de un restaurante |
| `dto/ServicePeriodRequest.java` | Entrada del `PUT` (id nullable) |
| `dto/ServicePeriodResponse.java` | Salida; no expone `restaurantId` ni auditoría |
| `dto/ServicePeriodMapper.java` | Entidad → respuesta |
| `service/ServicePeriodService.java` | Autorización, validación y reemplazo idempotente |
| `controller/ServicePeriodController.java` | `GET`/`PUT` bajo `/restaurants/{restaurantId}/service-periods` |

**Backend — modificados:**

| Archivo | Cambio |
|---|---|
| `resources/db/migration/V8__add_service_periods.sql` | Tabla nueva |
| `common/util/Constants.java` | `SERVICE_PERIODS_SUBPATH` |
| `availability/service/AvailabilityService.java` | `generarFranjas` por periodos + fallback |

**Frontend — nuevos:**

| Archivo | Responsabilidad |
|---|---|
| `services/servicePeriodService.js` | `getServicePeriods` / `saveServicePeriods` |
| `components/RestaurantInfoForm.jsx` | Campos del restaurante, compartidos por modal y pantalla |
| `components/ServiceSchedule.jsx` | Editor semanal controlado |
| `pages/RestaurantSettings.jsx` | Pantalla con los dos apartados |

**Frontend — modificados:** `App.jsx` (ruta), `pages/Restaurants.jsx` (engranaje que navega, modal solo para crear), `index.css` (estilos del editor).

---

### Task 1: Entidad, migración y repositorio de periodos de servicio

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/serviceperiod/entity/ServicePeriod.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/serviceperiod/repository/ServicePeriodRepository.java`
- Create: `restaurante_manage/src/main/resources/db/migration/V8__add_service_periods.sql`
- Test: `restaurante_manage/src/test/java/com/restaurante/serviceperiod/repository/ServicePeriodRepositoryTest.java`

**Interfaces:**
- Produces: `ServicePeriod` con getters/setters de Lombok (`getId`, `getRestaurant`, `getDayOfWeek`, `getStartTime`, `getEndTime`, `getName` y sus setters), y `ServicePeriodRepository.findByRestaurantIdAndDeletedFalse(Long) → List<ServicePeriod>`.

- [ ] **Step 1: Escribir el test que falla**

Crear `restaurante_manage/src/test/java/com/restaurante/serviceperiod/repository/ServicePeriodRepositoryTest.java`:

```java
package com.restaurante.serviceperiod.repository;

import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.serviceperiod.entity.ServicePeriod;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Persistencia de los periodos de servicio: se guardan asociados a su
 * restaurante y las consultas respetan el borrado lógico.
 */
@SpringBootTest
@ActiveProfiles("dev")
class ServicePeriodRepositoryTest {

    @Autowired private ServicePeriodRepository servicePeriodRepository;
    @Autowired private RestaurantRepository restaurantRepository;

    private Restaurant restaurante;

    @BeforeEach
    void setUp() {
        Restaurant nuevo = new Restaurant();
        nuevo.setName("Horarios Test");
        nuevo.setDefaultReservationDurationMinutes(90);
        nuevo.setPublicBookingEnabled(true);
        restaurante = restaurantRepository.save(nuevo);
    }

    private ServicePeriod periodo(DayOfWeek dia, LocalTime inicio, LocalTime fin, String nombre) {
        ServicePeriod p = new ServicePeriod();
        p.setRestaurant(restaurante);
        p.setDayOfWeek(dia);
        p.setStartTime(inicio);
        p.setEndTime(fin);
        p.setName(nombre);
        return p;
    }

    @Test
    void guardaYRecuperaLosPeriodosDeUnRestaurante() {
        servicePeriodRepository.save(periodo(DayOfWeek.MONDAY, LocalTime.of(13, 0), LocalTime.of(16, 0), "Comidas"));
        servicePeriodRepository.save(periodo(DayOfWeek.MONDAY, LocalTime.of(20, 0), LocalTime.of(23, 0), "Cenas"));

        List<ServicePeriod> vivos = servicePeriodRepository
                .findByRestaurantIdAndDeletedFalse(restaurante.getId());

        assertEquals(2, vivos.size());
    }

    @Test
    void elNombreEsOpcional() {
        ServicePeriod guardado = servicePeriodRepository
                .save(periodo(DayOfWeek.TUESDAY, LocalTime.of(13, 0), LocalTime.of(16, 0), null));

        assertNull(servicePeriodRepository.findById(guardado.getId()).orElseThrow().getName());
    }

    @Test
    void losPeriodosBorradosLogicamenteNoSeDevuelven() {
        ServicePeriod guardado = servicePeriodRepository
                .save(periodo(DayOfWeek.WEDNESDAY, LocalTime.of(13, 0), LocalTime.of(16, 0), null));
        guardado.setDeleted(true);
        guardado.setDeletedAt(LocalDateTime.now());
        servicePeriodRepository.save(guardado);

        assertEquals(0, servicePeriodRepository
                .findByRestaurantIdAndDeletedFalse(restaurante.getId()).size());
    }
}
```

- [ ] **Step 2: Verificar que falla**

```bash
cd restaurante_manage && mvn test -Dtest=ServicePeriodRepositoryTest
```

Esperado: `BUILD FAILURE` con error de compilación — no existen `ServicePeriod` ni `ServicePeriodRepository`.

- [ ] **Step 3: Crear la entidad**

`restaurante_manage/src/main/java/com/restaurante/serviceperiod/entity/ServicePeriod.java`:

```java
package com.restaurante.serviceperiod.entity;

import com.restaurante.common.audit.BaseEntity;
import com.restaurante.restaurant.entity.Restaurant;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.DayOfWeek;
import java.time.LocalTime;

/**
 * Periodo de servicio de un restaurante en un día de la semana: por ejemplo,
 * comidas de 13:00 a 16:00 y cenas de 20:00 a 23:00 del lunes.
 *
 * <p>Sustituyen a la ventana única apertura/cierre como fuente de las franjas
 * horarias ofrecidas. Un día sin periodos vivos está <strong>cerrado</strong>.
 * Un restaurante sin ningún periodo vivo en toda la semana sigue usando
 * {@code openingTime}/{@code closingTime} como horario general: es el fallback
 * que implementa {@code AvailabilityService.generarFranjas}.</p>
 *
 * <p>Un periodo nunca cruza medianoche: la hora de fin es siempre posterior a
 * la de inicio dentro del mismo día.</p>
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "service_periods")
public class ServicePeriod extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "restaurant_id", nullable = false)
    private Restaurant restaurant;

    @Enumerated(EnumType.STRING)
    @Column(name = "day_of_week", nullable = false, length = 20)
    private DayOfWeek dayOfWeek;

    @Column(name = "start_time", nullable = false)
    private LocalTime startTime;

    @Column(name = "end_time", nullable = false)
    private LocalTime endTime;

    /** Etiqueta opcional ("Comidas", "Cenas"). Ninguna lógica depende de su valor. */
    @Column(name = "name", length = 50)
    private String name;
}
```

- [ ] **Step 4: Crear el repositorio**

`restaurante_manage/src/main/java/com/restaurante/serviceperiod/repository/ServicePeriodRepository.java`:

```java
package com.restaurante.serviceperiod.repository;

import com.restaurante.serviceperiod.entity.ServicePeriod;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ServicePeriodRepository extends JpaRepository<ServicePeriod, Long> {

    /**
     * Periodos vivos de un restaurante, de toda la semana.
     *
     * <p>Una sola consulta resuelve los dos usos que tiene el dominio: filtrar
     * por día concreto y detectar si el restaurante tiene algún periodo (lo que
     * decide si aplica el horario general como fallback).</p>
     */
    List<ServicePeriod> findByRestaurantIdAndDeletedFalse(Long restaurantId);
}
```

- [ ] **Step 5: Crear la migración**

`restaurante_manage/src/main/resources/db/migration/V8__add_service_periods.sql`:

```sql
-- ============================================================================
-- V8 — Periodos de servicio por día de la semana.
-- ============================================================================
-- Sustituyen a la ventana única opening_time/closing_time como fuente de las
-- franjas horarias que se ofrecen al reservar.
--
-- Un día sin filas vivas está cerrado. Un restaurante sin ninguna fila viva en
-- toda la semana sigue usando opening_time/closing_time como horario general
-- (fallback), que por eso NO se eliminan de la tabla restaurants.

CREATE TABLE `service_periods` (
  `deleted` bit(1) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  `id` bigint NOT NULL AUTO_INCREMENT,
  `restaurant_id` bigint NOT NULL,
  `day_of_week` enum('MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY') COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_service_periods_restaurant_day` (`restaurant_id`, `day_of_week`),
  CONSTRAINT `fk_service_periods_restaurant` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 6: Verificar que pasa**

```bash
cd restaurante_manage && mvn test -Dtest=ServicePeriodRepositoryTest
```

Esperado: `Tests run: 3, Failures: 0, Errors: 0` y `BUILD SUCCESS`.

- [ ] **Step 7: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test
```

Esperado: `BUILD SUCCESS`, suite completa verde. **No ejecutar `git commit`.**

---

### Task 2: DTOs y servicio con validación

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/serviceperiod/dto/ServicePeriodRequest.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/serviceperiod/dto/ServicePeriodResponse.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/serviceperiod/dto/ServicePeriodMapper.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/serviceperiod/service/ServicePeriodService.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/serviceperiod/service/ServicePeriodServiceTest.java`

**Interfaces:**
- Consumes: `ServicePeriod`, `ServicePeriodRepository.findByRestaurantIdAndDeletedFalse` (Task 1).
- Produces:
  - `ServicePeriodService.findByRestaurantId(Long) → List<ServicePeriodResponse>`
  - `ServicePeriodService.replacePeriods(Long, List<ServicePeriodRequest>) → List<ServicePeriodResponse>`
  - `ServicePeriodRequest` con `getId/setId` (Long, nullable), `getDayOfWeek/setDayOfWeek` (DayOfWeek), `getStartTime/setStartTime`, `getEndTime/setEndTime` (LocalTime), `getName/setName` (String).
  - `ServicePeriodResponse` con los mismos cinco campos, sin `restaurantId`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `restaurante_manage/src/test/java/com/restaurante/serviceperiod/service/ServicePeriodServiceTest.java`:

```java
package com.restaurante.serviceperiod.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.serviceperiod.dto.ServicePeriodMapper;
import com.restaurante.serviceperiod.dto.ServicePeriodRequest;
import com.restaurante.serviceperiod.dto.ServicePeriodResponse;
import com.restaurante.serviceperiod.entity.ServicePeriod;
import com.restaurante.serviceperiod.repository.ServicePeriodRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.DayOfWeek;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ServicePeriodServiceTest {

    private static final Long RESTAURANT_ID = 1L;

    @Mock private ServicePeriodRepository servicePeriodRepository;
    @Mock private RestaurantRepository restaurantRepository;
    @Mock private CurrentUserService currentUserService;

    private ServicePeriodService service;
    private Restaurant restaurante;

    @BeforeEach
    void setUp() {
        service = new ServicePeriodService(servicePeriodRepository, restaurantRepository,
                new ServicePeriodMapper(), currentUserService);

        restaurante = new Restaurant();
        restaurante.setId(RESTAURANT_ID);
        restaurante.setName("Horarios Test");

        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(Optional.of(restaurante));
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of());
        when(servicePeriodRepository.saveAll(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private ServicePeriodRequest peticion(DayOfWeek dia, String inicio, String fin) {
        ServicePeriodRequest req = new ServicePeriodRequest();
        req.setDayOfWeek(dia);
        req.setStartTime(LocalTime.parse(inicio));
        req.setEndTime(LocalTime.parse(fin));
        return req;
    }

    @Test
    void guardaLosPeriodosDeUnDia() {
        List<ServicePeriodResponse> guardados = service.replacePeriods(RESTAURANT_ID, List.of(
                peticion(DayOfWeek.MONDAY, "20:00", "23:00"),
                peticion(DayOfWeek.MONDAY, "13:00", "16:00")));

        assertEquals(2, guardados.size());
        // Se devuelven ordenados por hora de inicio, no en el orden recibido.
        assertEquals(LocalTime.of(13, 0), guardados.get(0).getStartTime());
        assertEquals(LocalTime.of(20, 0), guardados.get(1).getStartTime());
    }

    @Test
    void rechazaPeriodosSolapadosDelMismoDia() {
        BadRequestException ex = assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID, List.of(
                        peticion(DayOfWeek.MONDAY, "13:00", "16:00"),
                        peticion(DayOfWeek.MONDAY, "15:00", "18:00"))));

        assertTrue(ex.getMessage().contains("solapan"), "El mensaje debe explicar el solape: " + ex.getMessage());
        verify(servicePeriodRepository, never()).saveAll(any());
    }

    @Test
    void rechazaPeriodosDuplicados() {
        // Un duplicado exacto es un solape total: cae bajo la misma regla.
        assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID, List.of(
                        peticion(DayOfWeek.TUESDAY, "13:00", "16:00"),
                        peticion(DayOfWeek.TUESDAY, "13:00", "16:00"))));
    }

    @Test
    void permiteElMismoHorarioEnDiasDistintos() {
        List<ServicePeriodResponse> guardados = service.replacePeriods(RESTAURANT_ID, List.of(
                peticion(DayOfWeek.MONDAY, "13:00", "16:00"),
                peticion(DayOfWeek.TUESDAY, "13:00", "16:00")));

        assertEquals(2, guardados.size());
    }

    @Test
    void rechazaInicioIgualAlFin() {
        assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID,
                        List.of(peticion(DayOfWeek.MONDAY, "13:00", "13:00"))));
    }

    @Test
    void rechazaFinAnteriorAlInicio() {
        // Es también el caso de un periodo que cruzaría medianoche (20:00–01:00).
        assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID,
                        List.of(peticion(DayOfWeek.MONDAY, "20:00", "01:00"))));
    }

    @Test
    void rechazaUnPeriodoSinDia() {
        ServicePeriodRequest sinDia = peticion(DayOfWeek.MONDAY, "13:00", "16:00");
        sinDia.setDayOfWeek(null);

        assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID, List.of(sinDia)));
    }

    @Test
    void rechazaUnIdQueNoPerteneceAlRestaurante() {
        ServicePeriodRequest ajeno = peticion(DayOfWeek.MONDAY, "13:00", "16:00");
        ajeno.setId(999L);

        BadRequestException ex = assertThrows(BadRequestException.class,
                () -> service.replacePeriods(RESTAURANT_ID, List.of(ajeno)));

        assertTrue(ex.getMessage().contains("999"));
        verify(servicePeriodRepository, never()).saveAll(any());
    }

    @Test
    void borraLogicamenteLosPeriodosNoIncluidos() {
        ServicePeriod existente = new ServicePeriod();
        existente.setId(7L);
        existente.setRestaurant(restaurante);
        existente.setDayOfWeek(DayOfWeek.MONDAY);
        existente.setStartTime(LocalTime.of(13, 0));
        existente.setEndTime(LocalTime.of(16, 0));
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(existente));

        service.replacePeriods(RESTAURANT_ID, List.of());

        assertTrue(existente.getDeleted(), "El periodo ausente del payload debe quedar borrado lógicamente");
        assertNotNull(existente.getDeletedAt());
    }

    @Test
    void unNombreEnBlancoSeGuardaComoNulo() {
        ServicePeriodRequest conBlancos = peticion(DayOfWeek.MONDAY, "13:00", "16:00");
        conBlancos.setName("   ");

        service.replacePeriods(RESTAURANT_ID, List.of(conBlancos));

        ArgumentCaptor<List<ServicePeriod>> captor = ArgumentCaptor.forClass(List.class);
        verify(servicePeriodRepository).saveAll(captor.capture());
        assertNull(captor.getValue().get(0).getName());
    }

    @Test
    void validaElAccesoAlRestauranteAlLeerYAlGuardar() {
        service.findByRestaurantId(RESTAURANT_ID);
        service.replacePeriods(RESTAURANT_ID, List.of());

        verify(currentUserService, times(2)).validateRestaurantAccess(RESTAURANT_ID);
    }

    @Test
    void noGuardaNadaSiElAccesoEstaDenegado() {
        doThrow(new com.restaurante.common.exception.AccessDeniedException("denegado"))
                .when(currentUserService).validateRestaurantAccess(anyLong());

        assertThrows(com.restaurante.common.exception.AccessDeniedException.class,
                () -> service.replacePeriods(RESTAURANT_ID,
                        List.of(peticion(DayOfWeek.MONDAY, "13:00", "16:00"))));

        verify(servicePeriodRepository, never()).saveAll(any());
    }
}
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante_manage && mvn test -Dtest=ServicePeriodServiceTest
```

Esperado: `BUILD FAILURE` por compilación — no existen `ServicePeriodRequest`, `ServicePeriodResponse`, `ServicePeriodMapper` ni `ServicePeriodService`.

- [ ] **Step 3: Crear los DTOs y el mapper**

`restaurante_manage/src/main/java/com/restaurante/serviceperiod/dto/ServicePeriodRequest.java`:

```java
package com.restaurante.serviceperiod.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.DayOfWeek;
import java.time.LocalTime;

/**
 * Periodo recibido en el PUT de horarios.
 *
 * <p>{@code id} nulo significa periodo nuevo. Las reglas (fin posterior al
 * inicio, sin solapes, id perteneciente al restaurante) se validan en el
 * servicio, no con anotaciones: dependen del conjunto, no de un campo suelto.</p>
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ServicePeriodRequest {

    private Long id;

    private DayOfWeek dayOfWeek;

    private LocalTime startTime;

    private LocalTime endTime;

    private String name;
}
```

`restaurante_manage/src/main/java/com/restaurante/serviceperiod/dto/ServicePeriodResponse.java`:

```java
package com.restaurante.serviceperiod.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.DayOfWeek;
import java.time.LocalTime;

/**
 * Periodo de servicio devuelto al panel privado.
 *
 * <p>No expone {@code restaurantId} ni campos de auditoría: el restaurante ya
 * viene en la ruta.</p>
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class ServicePeriodResponse {

    private Long id;

    private DayOfWeek dayOfWeek;

    @JsonFormat(pattern = "HH:mm:ss")
    private LocalTime startTime;

    @JsonFormat(pattern = "HH:mm:ss")
    private LocalTime endTime;

    private String name;
}
```

`restaurante_manage/src/main/java/com/restaurante/serviceperiod/dto/ServicePeriodMapper.java`:

```java
package com.restaurante.serviceperiod.dto;

import com.restaurante.serviceperiod.entity.ServicePeriod;
import org.springframework.stereotype.Component;

@Component
public class ServicePeriodMapper {

    public ServicePeriodResponse toResponse(ServicePeriod periodo) {
        return new ServicePeriodResponse(
                periodo.getId(),
                periodo.getDayOfWeek(),
                periodo.getStartTime(),
                periodo.getEndTime(),
                periodo.getName());
    }
}
```

- [ ] **Step 4: Crear el servicio**

`restaurante_manage/src/main/java/com/restaurante/serviceperiod/service/ServicePeriodService.java`:

```java
package com.restaurante.serviceperiod.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.serviceperiod.dto.ServicePeriodMapper;
import com.restaurante.serviceperiod.dto.ServicePeriodRequest;
import com.restaurante.serviceperiod.dto.ServicePeriodResponse;
import com.restaurante.serviceperiod.entity.ServicePeriod;
import com.restaurante.serviceperiod.repository.ServicePeriodRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Periodos de servicio de un restaurante.
 *
 * <p>Toda operación valida primero el acceso al restaurante: el aislamiento no
 * depende de que el frontend oculte el botón.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ServicePeriodService {

    private static final Map<DayOfWeek, String> NOMBRES_DIA = Map.of(
            DayOfWeek.MONDAY, "lunes",
            DayOfWeek.TUESDAY, "martes",
            DayOfWeek.WEDNESDAY, "miércoles",
            DayOfWeek.THURSDAY, "jueves",
            DayOfWeek.FRIDAY, "viernes",
            DayOfWeek.SATURDAY, "sábado",
            DayOfWeek.SUNDAY, "domingo");

    private static final int MAX_LONGITUD_NOMBRE = 50;

    private final ServicePeriodRepository servicePeriodRepository;
    private final RestaurantRepository restaurantRepository;
    private final ServicePeriodMapper servicePeriodMapper;
    private final CurrentUserService currentUserService;

    /**
     * Periodos del restaurante, ordenados por día y hora de inicio. Una lista
     * vacía significa que el restaurante usa el horario general.
     */
    public List<ServicePeriodResponse> findByRestaurantId(Long restaurantId) {
        currentUserService.validateRestaurantAccess(restaurantId);
        return ordenados(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(restaurantId)).stream()
                .map(servicePeriodMapper::toResponse)
                .collect(Collectors.toList());
    }

    /**
     * Reemplaza los periodos de la semana completa, de forma idempotente:
     * con id se actualizan, sin id se crean, y los existentes que no vengan en
     * el payload se borran lógicamente.
     *
     * <p>Rechazar los ids que no pertenecen al restaurante de la ruta es la
     * defensa concreta contra modificar los horarios de otro restaurante
     * manipulando el cuerpo de la petición.</p>
     */
    @Transactional
    public List<ServicePeriodResponse> replacePeriods(Long restaurantId, List<ServicePeriodRequest> requests) {
        currentUserService.validateRestaurantAccess(restaurantId);

        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        List<ServicePeriodRequest> peticiones = requests != null ? requests : List.of();
        validar(peticiones);

        List<ServicePeriod> existentes =
                servicePeriodRepository.findByRestaurantIdAndDeletedFalse(restaurantId);
        Map<Long, ServicePeriod> existentesPorId = existentes.stream()
                .collect(Collectors.toMap(ServicePeriod::getId, p -> p));

        List<Long> ajenos = peticiones.stream()
                .map(ServicePeriodRequest::getId)
                .filter(Objects::nonNull)
                .filter(id -> !existentesPorId.containsKey(id))
                .collect(Collectors.toList());
        if (!ajenos.isEmpty()) {
            throw new BadRequestException(
                    "Los siguientes periodos no pertenecen al restaurante " + restaurantId + ": " + ajenos);
        }

        List<ServicePeriod> aGuardar = new ArrayList<>();
        Set<Long> conservados = new HashSet<>();

        for (ServicePeriodRequest req : peticiones) {
            ServicePeriod periodo;
            if (req.getId() != null) {
                periodo = existentesPorId.get(req.getId());
                conservados.add(req.getId());
            } else {
                periodo = new ServicePeriod();
                periodo.setRestaurant(restaurant);
            }
            periodo.setDayOfWeek(req.getDayOfWeek());
            periodo.setStartTime(req.getStartTime());
            periodo.setEndTime(req.getEndTime());
            periodo.setName(normalizarNombre(req.getName()));
            aGuardar.add(periodo);
        }

        for (ServicePeriod periodo : existentes) {
            if (!conservados.contains(periodo.getId())) {
                periodo.setDeleted(true);
                periodo.setDeletedAt(LocalDateTime.now());
                aGuardar.add(periodo);
            }
        }

        servicePeriodRepository.saveAll(aGuardar);

        log.info("[ServicePeriod] Horarios guardados para restaurante {}: {} vivos, {} eliminados",
                restaurantId, peticiones.size(), aGuardar.size() - peticiones.size());

        List<ServicePeriod> vivos = aGuardar.stream()
                .filter(p -> !p.getDeleted())
                .collect(Collectors.toList());

        return ordenados(vivos).stream()
                .map(servicePeriodMapper::toResponse)
                .collect(Collectors.toList());
    }

    /**
     * Reglas del conjunto de periodos. Se comprueban todas antes de tocar la
     * base de datos: un payload inválido no debe dejar la semana a medias.
     */
    private void validar(List<ServicePeriodRequest> peticiones) {
        for (int i = 0; i < peticiones.size(); i++) {
            ServicePeriodRequest req = peticiones.get(i);

            if (req.getDayOfWeek() == null || req.getStartTime() == null || req.getEndTime() == null) {
                throw new BadRequestException("El periodo " + (i + 1)
                        + " es inválido: el día, la hora de inicio y la hora de fin son obligatorios.");
            }
            // Cubre a la vez inicio igual a fin, fin anterior al inicio y los
            // periodos que cruzarían medianoche.
            if (!req.getEndTime().isAfter(req.getStartTime())) {
                throw new BadRequestException("En " + nombreDia(req.getDayOfWeek())
                        + ", la hora de fin (" + req.getEndTime() + ") debe ser posterior a la de inicio ("
                        + req.getStartTime() + ").");
            }
            if (req.getName() != null && req.getName().trim().length() > MAX_LONGITUD_NOMBRE) {
                throw new BadRequestException(
                        "El nombre de un periodo no debe exceder " + MAX_LONGITUD_NOMBRE + " caracteres.");
            }
        }

        // Solapes dentro de cada día. Ordenando por hora de inicio basta con
        // comparar cada periodo con el anterior: si dos cualesquiera se solapan,
        // algún par consecutivo también lo hace. Un duplicado exacto es un
        // solape total, así que esta misma regla lo cubre.
        Map<DayOfWeek, List<ServicePeriodRequest>> porDia = peticiones.stream()
                .collect(Collectors.groupingBy(ServicePeriodRequest::getDayOfWeek));

        for (Map.Entry<DayOfWeek, List<ServicePeriodRequest>> entrada : porDia.entrySet()) {
            List<ServicePeriodRequest> delDia = entrada.getValue().stream()
                    .sorted(Comparator.comparing(ServicePeriodRequest::getStartTime))
                    .collect(Collectors.toList());

            for (int i = 1; i < delDia.size(); i++) {
                ServicePeriodRequest anterior = delDia.get(i - 1);
                ServicePeriodRequest actual = delDia.get(i);
                if (actual.getStartTime().isBefore(anterior.getEndTime())) {
                    throw new BadRequestException("En " + nombreDia(entrada.getKey()) + ", los periodos "
                            + anterior.getStartTime() + "–" + anterior.getEndTime() + " y "
                            + actual.getStartTime() + "–" + actual.getEndTime() + " se solapan.");
                }
            }
        }
    }

    private List<ServicePeriod> ordenados(List<ServicePeriod> periodos) {
        return periodos.stream()
                .sorted(Comparator.comparing(ServicePeriod::getDayOfWeek)
                        .thenComparing(ServicePeriod::getStartTime))
                .collect(Collectors.toList());
    }

    private String normalizarNombre(String nombre) {
        if (nombre == null) {
            return null;
        }
        String limpio = nombre.trim();
        return limpio.isEmpty() ? null : limpio;
    }

    private String nombreDia(DayOfWeek dia) {
        return NOMBRES_DIA.getOrDefault(dia, dia.name());
    }
}
```

- [ ] **Step 5: Verificar que pasan**

```bash
cd restaurante_manage && mvn test -Dtest=ServicePeriodServiceTest
```

Esperado: `Tests run: 12, Failures: 0, Errors: 0` y `BUILD SUCCESS`.

- [ ] **Step 6: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test
```

Esperado: `BUILD SUCCESS`. **No ejecutar `git commit`.**

---

### Task 3: Controlador y aislamiento entre restaurantes

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/serviceperiod/controller/ServicePeriodController.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/serviceperiod/controller/ServicePeriodEndpointIntegrationTest.java`

**Interfaces:**
- Consumes: `ServicePeriodService.findByRestaurantId`, `ServicePeriodService.replacePeriods` (Task 2).
- Produces: `GET` y `PUT` en `/api/v1/restaurants/{restaurantId}/service-periods`, envueltos en `ApiResponse`.

**Aviso sobre autenticación en tests (descubierto en un plan anterior de este repositorio):** `@WithMockUser` **no funciona** en este código base para nada que pase por `CurrentUserService`, porque `getCurrentPrincipal()` exige el tipo concreto `UserPrincipal` y `@WithMockUser` inyecta un `User` genérico de Spring Security; el resultado es un 403 silencioso con `reason=not_authenticated`. Usar siempre `@WithUserDetails("<usuario-seed>")`, que pasa por el `CustomUserDetailsService` real. Usuarios sembrados por `DemoDataInitializer` en el perfil `dev`: `super.admin` (SUPER_ADMIN, sin tenant), `juan.admin` (ADMIN del tenant "Demo Gourmet"), `employee.demo` (EMPLOYEE del mismo tenant).

- [ ] **Step 1: Escribir los tests que fallan**

Crear `restaurante_manage/src/test/java/com/restaurante/serviceperiod/controller/ServicePeriodEndpointIntegrationTest.java`:

```java
package com.restaurante.serviceperiod.controller;

import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithUserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Horarios de servicio: acceso, aislamiento entre restaurantes y persistencia
 * extremo a extremo.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class ServicePeriodEndpointIntegrationTest {

    private static final String CUERPO_LUNES = """
            [
              {"dayOfWeek":"MONDAY","startTime":"13:00:00","endTime":"16:00:00","name":"Comidas"},
              {"dayOfWeek":"MONDAY","startTime":"20:00:00","endTime":"23:00:00","name":"Cenas"}
            ]
            """;

    @Autowired private MockMvc mockMvc;
    @Autowired private RestaurantRepository restaurantRepository;

    private Long restauranteId;
    private String ruta;

    @BeforeEach
    void setUp() {
        Restaurant restaurante = new Restaurant();
        restaurante.setName("Horarios Endpoint Test");
        restaurante.setDefaultReservationDurationMinutes(90);
        restaurante.setPublicBookingEnabled(true);
        restauranteId = restaurantRepository.save(restaurante).getId();
        ruta = "/api/v1/restaurants/" + restauranteId + "/service-periods";
    }

    @Test
    void requiereAutenticacionParaLeer() throws Exception {
        mockMvc.perform(get(ruta)).andExpect(status().isUnauthorized());
    }

    @Test
    void requiereAutenticacionParaGuardar() throws Exception {
        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(CUERPO_LUNES))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithUserDetails("super.admin")
    void unAdministradorGuardaYRecuperaLosPeriodos() throws Exception {
        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(CUERPO_LUNES))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));

        mockMvc.perform(get(ruta))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                // Devueltos ordenados por hora de inicio.
                .andExpect(jsonPath("$.data[0].startTime").value("13:00:00"))
                .andExpect(jsonPath("$.data[0].name").value("Comidas"))
                .andExpect(jsonPath("$.data[1].startTime").value("20:00:00"));
    }

    @Test
    @WithUserDetails("super.admin")
    void unRestauranteSinPeriodosDevuelveListaVacia() throws Exception {
        mockMvc.perform(get(ruta))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaPeriodosSolapados() throws Exception {
        String solapados = """
                [
                  {"dayOfWeek":"MONDAY","startTime":"13:00:00","endTime":"16:00:00"},
                  {"dayOfWeek":"MONDAY","startTime":"15:00:00","endTime":"18:00:00"}
                ]
                """;

        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(solapados))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithUserDetails("juan.admin")
    void noSePuedeLeerLaConfiguracionDeOtroRestaurante() throws Exception {
        // "Horarios Endpoint Test" se crea sin tenant; juan.admin es ADMIN del
        // tenant "Demo Gourmet", así que el acceso se deniega por cross-tenant.
        mockMvc.perform(get(ruta)).andExpect(status().isForbidden());
    }

    @Test
    @WithUserDetails("juan.admin")
    void noSePuedeEditarOtroRestauranteCambiandoLaUrl() throws Exception {
        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(CUERPO_LUNES))
                .andExpect(status().isForbidden());
    }

    @Test
    @WithUserDetails("employee.demo")
    void unUsuarioSinPermisosDeGestionNoPuedeGuardar() throws Exception {
        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(CUERPO_LUNES))
                .andExpect(status().isForbidden());
    }
}
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante_manage && mvn test -Dtest=ServicePeriodEndpointIntegrationTest
```

Esperado: fallan los que esperan 200/400 (la ruta aún no existe, devuelve 401 o 403 por no estar mapeada), y pasan los de "requiere autenticación".

- [ ] **Step 3: Añadir la constante de ruta**

En `restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java`, junto a `FLOOR_PLAN_ELEMENTS_SUBPATH`:

```java
    /** Subruta de los periodos de servicio de un restaurante. */
    public static final String SERVICE_PERIODS_SUBPATH = "/service-periods";
```

- [ ] **Step 4: Crear el controlador**

`restaurante_manage/src/main/java/com/restaurante/serviceperiod/controller/ServicePeriodController.java`:

```java
package com.restaurante.serviceperiod.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.serviceperiod.dto.ServicePeriodRequest;
import com.restaurante.serviceperiod.dto.ServicePeriodResponse;
import com.restaurante.serviceperiod.service.ServicePeriodService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
@Tag(name = "Horarios de servicio",
        description = "Periodos de servicio por día de la semana de cada restaurante")
@SecurityRequirement(name = "bearerAuth")
public class ServicePeriodController {

    private static final String PERIODS_PATH =
            Constants.RESTAURANTS_PATH + "/{restaurantId}" + Constants.SERVICE_PERIODS_SUBPATH;

    private final ServicePeriodService servicePeriodService;

    @GetMapping(PERIODS_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Listar horarios de servicio",
            description = "Devuelve los periodos de servicio del restaurante, ordenados por día y hora de "
                    + "inicio. Una lista vacía significa que el restaurante usa el horario general "
                    + "(openingTime/closingTime). Requiere acceso al restaurante.")
    public ResponseEntity<ApiResponse<List<ServicePeriodResponse>>> findByRestaurant(
            @PathVariable Long restaurantId) {
        return ResponseEntity.ok(
                ApiResponse.success(servicePeriodService.findByRestaurantId(restaurantId)));
    }

    @PutMapping(PERIODS_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Guardar horarios de servicio",
            description = "Reemplaza los periodos de la semana completa: con id se actualizan, sin id se "
                    + "crean, y los existentes no incluidos se eliminan. Un día sin periodos queda cerrado. "
                    + "Requiere acceso al restaurante.")
    public ResponseEntity<ApiResponse<List<ServicePeriodResponse>>> replacePeriods(
            @PathVariable Long restaurantId,
            @RequestBody List<ServicePeriodRequest> requests) {
        List<ServicePeriodResponse> guardados = servicePeriodService.replacePeriods(restaurantId, requests);
        return ResponseEntity.ok(
                ApiResponse.success("Horarios de servicio guardados exitosamente", guardados));
    }
}
```

- [ ] **Step 5: Verificar que pasan**

```bash
cd restaurante_manage && mvn test -Dtest=ServicePeriodEndpointIntegrationTest
```

Esperado: `Tests run: 8, Failures: 0, Errors: 0` y `BUILD SUCCESS`.

- [ ] **Step 6: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test
```

Esperado: `BUILD SUCCESS`. **No ejecutar `git commit`.**

---

### Task 4: Generación de franjas a partir de los periodos

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/availability/service/AvailabilityService.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/availability/service/AvailabilityServiceTest.java`

**Interfaces:**
- Consumes: `ServicePeriodRepository.findByRestaurantIdAndDeletedFalse` (Task 1).
- Produces: `AvailabilityService.getTimeSlots(Long, LocalDate, Integer)` **sin cambios de firma ni de contrato**; cambia solo su comportamiento interno. Su constructor pasa a recibir `ServicePeriodRepository` como **cuarto** parámetro, antes de los tres `@Value`.

**Contexto imprescindible:** `AvailabilityService` es la autoridad única de disponibilidad de este proyecto: ninguna otra clase reimplementa la generación de franjas ni el cálculo de solapes. Por eso este cambio en un único método privado hace que el endpoint privado (`GET /api/v1/availability/time-slots`) y el público (`GET /api/v1/public/restaurants/{id}/time-slots`) hereden la configuración sin tocar ni un endpoint más.

- [ ] **Step 1: Escribir los tests que fallan**

En `restaurante_manage/src/test/java/com/restaurante/availability/service/AvailabilityServiceTest.java`, añadir el mock nuevo junto a los existentes:

```java
    @Mock private ServicePeriodRepository servicePeriodRepository;
```

con `import com.restaurante.serviceperiod.repository.ServicePeriodRepository;` y `import com.restaurante.serviceperiod.entity.ServicePeriod;` y `import java.time.DayOfWeek;`.

Actualizar la construcción explícita del servicio en `setUp()` para pasar el repositorio nuevo como cuarto argumento (el resto de argumentos no cambia):

```java
        service = new AvailabilityService(diningTableRepository, reservationRepository,
                restaurantRepository, servicePeriodRepository,
                30, LocalTime.of(12, 0), LocalTime.of(23, 0));
```

Añadir al final de `setUp()`, para que los tests ya existentes sigan usando el horario general sin tocarlos:

```java
        // Por defecto, restaurante sin periodos: se comporta con el horario
        // general, que es lo que asumen los tests anteriores a esta tarea.
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of());
```

Añadir este helper y estos tests al final de la clase:

```java
    private ServicePeriod periodoDeServicio(DayOfWeek dia, String inicio, String fin) {
        ServicePeriod periodo = new ServicePeriod();
        periodo.setDayOfWeek(dia);
        periodo.setStartTime(LocalTime.parse(inicio));
        periodo.setEndTime(LocalTime.parse(fin));
        return periodo;
    }

    @Test
    void getTimeSlots_generaFranjasDentroDeCadaPeriodoDelDia() {
        // La ventana general es casi el día entero: si aun así solo salen las
        // horas de los dos servicios, los periodos han tenido prioridad.
        configurarHorario(LocalTime.of(0, 0), LocalTime.of(23, 59));
        restaurant.setDefaultReservationDurationMinutes(60);
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(List.of(
                periodoDeServicio(DayOfWeek.THURSDAY, "13:00", "16:00"),
                periodoDeServicio(DayOfWeek.THURSDAY, "20:00", "23:00")));

        List<TimeSlotResponse> slots = service.getTimeSlots(RESTAURANT_ID, DATE, 2);

        // Comidas: 13:00, 13:30, 14:00, 14:30, 15:00 (15:00+60=16:00, cabe justo).
        // Cenas:   20:00, 20:30, 21:00, 21:30, 22:00.
        assertEquals(List.of(
                        LocalTime.of(13, 0), LocalTime.of(13, 30), LocalTime.of(14, 0),
                        LocalTime.of(14, 30), LocalTime.of(15, 0),
                        LocalTime.of(20, 0), LocalTime.of(20, 30), LocalTime.of(21, 0),
                        LocalTime.of(21, 30), LocalTime.of(22, 0)),
                slots.stream().map(TimeSlotResponse::getTime).toList());
    }

    @Test
    void getTimeSlots_noOfreceHorasEnElHuecoEntreServicios() {
        configurarHorario(LocalTime.of(0, 0), LocalTime.of(23, 59));
        restaurant.setDefaultReservationDurationMinutes(60);
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(List.of(
                periodoDeServicio(DayOfWeek.THURSDAY, "13:00", "16:00"),
                periodoDeServicio(DayOfWeek.THURSDAY, "20:00", "23:00")));

        List<LocalTime> horas = service.getTimeSlots(RESTAURANT_ID, DATE, 2).stream()
                .map(TimeSlotResponse::getTime).toList();

        assertFalse(horas.contains(LocalTime.of(17, 0)), "17:00 cae entre servicios");
        assertFalse(horas.contains(LocalTime.of(18, 30)), "18:30 cae entre servicios");
        assertFalse(horas.contains(LocalTime.of(15, 30)),
                "15:30 no cabe entera en el servicio de comidas (15:30+60 pasa de 16:00)");
    }

    @Test
    void getTimeSlots_unDiaSinPeriodosEstaCerrado() {
        configurarHorario(LocalTime.of(0, 0), LocalTime.of(23, 59));
        // El restaurante tiene periodos, pero ninguno el jueves (DATE es jueves):
        // ese día está cerrado y no cae al horario general.
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(List.of(
                periodoDeServicio(DayOfWeek.TUESDAY, "13:00", "16:00")));

        assertTrue(service.getTimeSlots(RESTAURANT_ID, DATE, 2).isEmpty());
    }

    @Test
    void getTimeSlots_sinNingunPeriodoUsaElHorarioGeneral() {
        // Fallback: mismo resultado que antes de existir los periodos.
        configurarHorario(LocalTime.of(13, 0), LocalTime.of(16, 0));
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(List.of());

        List<LocalTime> horas = service.getTimeSlots(RESTAURANT_ID, DATE, 2).stream()
                .map(TimeSlotResponse::getTime).toList();

        // Con los 90 min por defecto: 14:30 cabe justo, 15:00 ya no.
        assertEquals(List.of(LocalTime.of(13, 0), LocalTime.of(13, 30),
                LocalTime.of(14, 0), LocalTime.of(14, 30)), horas);
    }

    @Test
    void getTimeSlots_unPeriodoMasCortoQueLaReservaNoGeneraFranjas() {
        configurarHorario(LocalTime.of(0, 0), LocalTime.of(23, 59));
        when(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(List.of(
                periodoDeServicio(DayOfWeek.THURSDAY, "13:00", "14:00")));

        assertTrue(service.getTimeSlots(RESTAURANT_ID, DATE, 2).isEmpty(),
                "Una reserva de 90 min no cabe en un servicio de 60 min");
    }
```

**Idioms de este archivo, ya verificados — usarlos tal cual, no crear helpers nuevos:**

- `configurarHorario(apertura, cierre)` recibe **dos** parámetros y, además de fijar el horario, stubea `restaurantRepository.findByIdAndDeletedFalse` y deja `findActiveByTableAndDateBetween` en vacío. Hay que llamarlo también en los tests con periodos, para que el restaurante se encuentre; los valores de apertura/cierre quedan entonces irrelevantes.
- La duración de reserva **no** es parámetro: se cambia con `restaurant.setDefaultReservationDurationMinutes(...)` sobre el campo `restaurant` de la clase. Por defecto son 90 minutos.
- `setUp()` ya stubea `diningTableRepository.findByRestaurantIdAndDeletedFalse` con una única mesa de capacidad 4: no hace falta stubearlo otra vez.
- `DATE` es la constante `LocalDate.of(2026, 12, 31)`, que cae en **jueves** y está en el futuro, así que ninguna franja se descarta por pasada.

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante_manage && mvn test -Dtest=AvailabilityServiceTest
```

Esperado: `BUILD FAILURE` por compilación — el constructor de `AvailabilityService` todavía no acepta `ServicePeriodRepository`.

- [ ] **Step 3: Inyectar el repositorio**

En `AvailabilityService`, añadir el campo y el parámetro de constructor (el constructor ya es explícito, no usa `@RequiredArgsConstructor`):

```java
    private final ServicePeriodRepository servicePeriodRepository;
```

```java
    public AvailabilityService(
            DiningTableRepository diningTableRepository,
            ReservationRepository reservationRepository,
            RestaurantRepository restaurantRepository,
            ServicePeriodRepository servicePeriodRepository,
            @Value("${app.reservations.slot-interval-minutes:30}") int slotIntervalMinutes,
            @Value("${app.reservations.default-opening-time:12:00}") LocalTime defaultOpeningTime,
            @Value("${app.reservations.default-closing-time:23:00}") LocalTime defaultClosingTime) {
        this.diningTableRepository = diningTableRepository;
        this.reservationRepository = reservationRepository;
        this.restaurantRepository = restaurantRepository;
        this.servicePeriodRepository = servicePeriodRepository;
        this.slotIntervalMinutes = slotIntervalMinutes;
        this.defaultOpeningTime = defaultOpeningTime;
        this.defaultClosingTime = defaultClosingTime;
    }
```

Imports necesarios: `com.restaurante.serviceperiod.entity.ServicePeriod`, `com.restaurante.serviceperiod.repository.ServicePeriodRepository`, `java.util.Comparator`.

- [ ] **Step 4: Reescribir la generación de franjas**

Sustituir el método privado `generarFranjas` completo (JavaDoc incluido) por estos tres métodos:

```java
    /**
     * Horas candidatas de la rejilla para una fecha.
     *
     * <p>Si el restaurante tiene periodos de servicio configurados, las franjas
     * salen de los periodos de ese día de la semana. Un día sin periodos está
     * cerrado y no ofrece ninguna hora.</p>
     *
     * <p>Si no tiene ninguno en toda la semana, se mantiene el comportamiento
     * anterior: una única ventana apertura–cierre. Es el fallback que permite
     * que los restaurantes que aún no han configurado horarios sigan aceptando
     * reservas exactamente igual que antes.</p>
     */
    private List<LocalTime> generarFranjas(Restaurant restaurant, LocalDate date) {
        List<ServicePeriod> periodos =
                servicePeriodRepository.findByRestaurantIdAndDeletedFalse(restaurant.getId());

        if (periodos.isEmpty()) {
            return generarFranjasHorarioGeneral(restaurant, date);
        }

        List<ServicePeriod> delDia = periodos.stream()
                .filter(periodo -> periodo.getDayOfWeek() == date.getDayOfWeek())
                .sorted(Comparator.comparing(ServicePeriod::getStartTime))
                .toList();

        if (delDia.isEmpty()) {
            log.debug("Restaurante {} cerrado el {}: ese día no tiene periodos de servicio",
                    restaurant.getId(), date);
            return List.of();
        }

        int duracion = restaurant.getDefaultReservationDurationMinutes();
        boolean esHoy = date.equals(LocalDate.now());
        LocalTime ahora = LocalTime.now();

        List<LocalTime> horas = new ArrayList<>();
        for (ServicePeriod periodo : delDia) {
            acumularFranjas(horas, periodo.getStartTime(), periodo.getEndTime(), duracion, esHoy, ahora);
        }
        return horas;
    }

    /**
     * Fallback para restaurantes sin ningún periodo configurado: la ventana
     * única apertura–cierre de toda la vida.
     *
     * <p>Si el cierre no es posterior a la apertura, el restaurante cerraría
     * pasada la medianoche: no se generan franjas, porque una hora de madrugada
     * pertenecería al día siguiente y contradiría la fecha elegida en el
     * formulario. Queda documentado como fuera de alcance en el diseño.</p>
     */
    private List<LocalTime> generarFranjasHorarioGeneral(Restaurant restaurant, LocalDate date) {
        LocalTime apertura = restaurant.getOpeningTime() != null
                ? restaurant.getOpeningTime() : defaultOpeningTime;
        LocalTime cierre = restaurant.getClosingTime() != null
                ? restaurant.getClosingTime() : defaultClosingTime;

        if (!cierre.isAfter(apertura)) {
            log.debug("Restaurante {} cierra a las {} (no posterior a la apertura {}): sin franjas",
                    restaurant.getId(), cierre, apertura);
            return List.of();
        }

        List<LocalTime> horas = new ArrayList<>();
        acumularFranjas(horas, apertura, cierre, restaurant.getDefaultReservationDurationMinutes(),
                date.equals(LocalDate.now()), LocalTime.now());
        return horas;
    }

    /**
     * Añade a {@code destino} las franjas que caben enteras dentro de la ventana
     * [inicio, fin]: la última es aquella cuya hora más la duración de la
     * reserva no pasa del fin (límite inclusivo, una reserva puede terminar
     * justo al cerrar el servicio). Una reserva nunca se reparte entre dos
     * periodos.
     *
     * <p>Si la fecha es hoy, las franjas ya pasadas se omiten aquí: el frontend
     * nunca decide qué horas mostrar.</p>
     *
     * <p>El bucle trabaja en minutos desde medianoche (enteros), no sumando
     * directamente sobre {@link LocalTime}: {@code LocalTime.plusMinutes} da la
     * vuelta a medianoche sin avisar, y con una ventana que ocupe casi todo el
     * día esa vuelta hace que "hora + duración" nunca quede después del fin, así
     * que la condición de parada no se alcanzaría jamás. Comparando en minutos,
     * sin ese ciclo de 24 h, siempre se alcanza.</p>
     */
    private void acumularFranjas(List<LocalTime> destino, LocalTime inicio, LocalTime fin,
                                 int duracion, boolean esHoy, LocalTime ahora) {
        int minutoInicio = inicio.toSecondOfDay() / 60;
        int minutoFin = fin.toSecondOfDay() / 60;

        for (int minuto = minutoInicio; minuto + duracion <= minutoFin; minuto += slotIntervalMinutes) {
            LocalTime hora = LocalTime.MIDNIGHT.plusMinutes(minuto);
            if (esHoy && !hora.isAfter(ahora)) {
                continue;
            }
            destino.add(hora);
        }
    }
```

- [ ] **Step 5: Verificar que pasan**

```bash
cd restaurante_manage && mvn test -Dtest=AvailabilityServiceTest
```

Esperado: `BUILD SUCCESS`, con los tests preexistentes de `getTimeSlots` intactos (siguen pasando gracias al stub por defecto de lista vacía) más los 5 nuevos.

- [ ] **Step 6: Probar que público y privado comparten la configuración**

`TimeSlotEndpointIntegrationTest` ya compara ambos endpoints, pero con el horario general. Añadir a `restaurante_manage/src/test/java/com/restaurante/availability/controller/TimeSlotEndpointIntegrationTest.java` un caso con periodos configurados, que es el requisito 8 del encargo:

```java
    @Test
    @WithUserDetails("super.admin")
    void publicoYPrivadoAplicanLosMismosPeriodosDeServicio() throws Exception {
        // Configura un único servicio el día de la consulta a través del endpoint
        // real, no escribiendo en la base de datos por debajo.
        String dia = LocalDate.parse(fecha).getDayOfWeek().name();
        mockMvc.perform(put("/api/v1/restaurants/" + restauranteId + "/service-periods")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("[{\"dayOfWeek\":\"" + dia
                                + "\",\"startTime\":\"13:00:00\",\"endTime\":\"16:00:00\"}]"))
                .andExpect(status().isOk());

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
        com.fasterxml.jackson.databind.JsonNode franjasPrivadas = om.readTree(privado).get("data");

        org.junit.jupiter.api.Assertions.assertEquals(franjasPrivadas, om.readTree(publico).get("data"),
                "Ambos flujos deben aplicar los mismos periodos de servicio");
        // El restaurante del setUp abre de 13:00 a 16:00 con reservas de 90 min:
        // el servicio recorta la rejilla a 13:00 y 13:30 (14:00 no cabe entero).
        org.junit.jupiter.api.Assertions.assertEquals(2, franjasPrivadas.size(),
                "Con un servicio de 13:00 a 16:00 y reservas de 90 min solo caben dos franjas");
    }
```

Imports que hay que añadir a ese archivo si no están: `java.time.LocalDate` y `org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put` (estático).

**Nota:** el `setUp()` de esa clase crea el restaurante con `openingTime` 13:00, `closingTime` 16:00 y duración 90, y `fecha` es dentro de 30 días. Leerlo antes de escribir el test para confirmar esos valores; si difieren, ajustar el número de franjas esperadas al cálculo real en lugar de cambiar el `setUp()`, que lo comparten los demás tests.

```bash
cd restaurante_manage && mvn test -Dtest=TimeSlotEndpointIntegrationTest
```

Esperado: `BUILD SUCCESS` con el test nuevo incluido.

- [ ] **Step 7: Checkpoint (NO commit)**

```bash
cd restaurante_manage && mvn test
```

Esperado: `BUILD SUCCESS`. Ojo: `PublicReservationServiceTest`, `ReservationConcurrencyIntegrationTest` y `TimeSlotEndpointIntegrationTest` dependen de la generación de franjas; si alguno falla, la causa está en este cambio, no en ellos. **No ejecutar `git commit`.**

---

### Task 5: Pantalla de configuración con el apartado Información

**Files:**
- Create: `restaurante-frontend/src/components/RestaurantInfoForm.jsx`
- Create: `restaurante-frontend/src/pages/RestaurantSettings.jsx`
- Create: `restaurante-frontend/src/pages/RestaurantSettings.test.jsx`
- Modify: `restaurante-frontend/src/App.jsx`
- Modify: `restaurante-frontend/src/pages/Restaurants.jsx`

**Interfaces:**
- Produces:
  - `RestaurantInfoForm({ formData, formErrors, onChange })` — presentacional puro, sin estado ni guardado.
  - Ruta `/restaurants/:restaurantId/configuracion`.
  - `RestaurantSettings` — pantalla con cabecera, botón volver y apartado Información.

**Contexto:** hoy el lápiz de cada fila abre un modal con todos los campos. Tras esta tarea el modal queda **solo para crear** y el botón de la fila pasa a ser un engranaje "Configurar restaurante" que navega a la pantalla nueva. Los campos viven en un único componente que renderizan los dos sitios, así que no hay dos formularios que se desincronicen.

- [ ] **Step 1: Escribir el test que falla**

Crear `restaurante-frontend/src/pages/RestaurantSettings.test.jsx`:

```jsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../services/restaurantService', () => ({
  getRestaurantById: vi.fn().mockResolvedValue({
    id: 1,
    name: 'La Buena Mesa',
    address: 'Calle Mayor 1',
    phone: '600123456',
    email: 'hola@labuenamesa.com',
    openingTime: '13:00:00',
    closingTime: '23:00:00',
    capacity: 80,
    defaultReservationDurationMinutes: 90,
    description: '',
  }),
  updateRestaurant: vi.fn().mockResolvedValue({ id: 1 }),
}));

import { updateRestaurant } from '../services/restaurantService';
import RestaurantSettings from './RestaurantSettings';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/restaurants/1/configuracion']}>
      <Routes>
        <Route path="/restaurants/:restaurantId/configuracion" element={<RestaurantSettings />} />
      </Routes>
    </MemoryRouter>
  );

describe('RestaurantSettings', () => {
  it('muestra el nombre del restaurante que se está configurando', async () => {
    renderPage();

    expect(await screen.findByText('La Buena Mesa')).toBeInTheDocument();
  });

  it('deshabilita Guardar mientras no haya cambios', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    expect(screen.getByRole('button', { name: /guardar información/i })).toBeDisabled();
  });

  it('habilita Guardar al modificar un campo y envía los datos', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    await userEvent.type(screen.getByLabelText(/^tel/i), '789');

    const guardar = screen.getByRole('button', { name: /guardar información/i });
    expect(guardar).toBeEnabled();

    await userEvent.click(guardar);

    await waitFor(() => expect(updateRestaurant).toHaveBeenCalled());
    expect(updateRestaurant.mock.calls[0][0]).toBe('1');
    expect(updateRestaurant.mock.calls[0][1].phone).toBe('600123456789');
  });
});
```

- [ ] **Step 2: Verificar que falla**

```bash
cd restaurante-frontend && pnpm test src/pages/RestaurantSettings.test.jsx
```

Esperado: FAIL — `Failed to resolve import "./RestaurantSettings"`.

- [ ] **Step 3: Extraer el formulario de datos del restaurante**

Crear `restaurante-frontend/src/components/RestaurantInfoForm.jsx` con **exactamente** los campos que hoy están dentro del modal de `Restaurants.jsx` (nombre, capacidad, teléfono, dirección, email, hora de apertura, hora de cierre, duración de reserva y descripción), sin cambiar ids, clases, placeholders ni validaciones:

```jsx
/**
 * Campos de datos de un restaurante.
 *
 * Los comparten el modal de "Nuevo restaurante" y el apartado Información de la
 * pantalla de configuración: así existe un único formulario y no dos copias que
 * se desincronicen. No tiene estado propio ni sabe guardar — el contenedor le
 * pasa los valores y recibe los cambios.
 *
 * Los dos usos nunca están montados a la vez (son pantallas distintas), así que
 * los ids de los campos pueden ser fijos.
 */
const RestaurantInfoForm = ({ formData, formErrors, onChange }) => (
  <div className="row g-3">
    {/* Nombre */}
    <div className="col-12 col-md-6">
      <label htmlFor="rest-name" className="form-label">
        Nombre <span className="text-danger">*</span>
      </label>
      <input
        id="rest-name"
        type="text"
        className={`form-control ${formErrors.name ? 'is-invalid' : ''}`}
        name="name"
        value={formData.name || ''}
        onChange={onChange}
        placeholder="Ej: Restaurante La Casa"
        required
      />
      {formErrors.name && <div className="invalid-feedback">{formErrors.name}</div>}
    </div>

    {/* Capacidad */}
    <div className="col-12 col-md-3">
      <label htmlFor="rest-capacity" className="form-label">Capacidad</label>
      <input
        id="rest-capacity"
        type="number"
        className={`form-control ${formErrors.capacity ? 'is-invalid' : ''}`}
        name="capacity"
        value={formData.capacity ?? ''}
        onChange={onChange}
        placeholder="Ej: 80"
        min="0"
        step="1"
      />
      {formErrors.capacity && <div className="invalid-feedback">{formErrors.capacity}</div>}
    </div>

    {/* Teléfono */}
    <div className="col-12 col-md-3">
      <label htmlFor="rest-phone" className="form-label">Teléfono</label>
      <input
        id="rest-phone"
        type="text"
        className="form-control"
        name="phone"
        value={formData.phone || ''}
        onChange={onChange}
        placeholder="Ej: 600123456"
      />
    </div>

    {/* Dirección */}
    <div className="col-12">
      <label htmlFor="rest-address" className="form-label">
        Dirección <span className="text-danger">*</span>
      </label>
      <input
        id="rest-address"
        type="text"
        className={`form-control ${formErrors.address ? 'is-invalid' : ''}`}
        name="address"
        value={formData.address || ''}
        onChange={onChange}
        placeholder="Ej: Calle Principal 123, Madrid"
        required
      />
      {formErrors.address && <div className="invalid-feedback">{formErrors.address}</div>}
    </div>

    {/* Email */}
    <div className="col-12 col-md-6">
      <label htmlFor="rest-email" className="form-label">Email</label>
      <input
        id="rest-email"
        type="email"
        className={`form-control ${formErrors.email ? 'is-invalid' : ''}`}
        name="email"
        value={formData.email || ''}
        onChange={onChange}
        placeholder="Ej: contacto@restaurante.com"
      />
      {formErrors.email && <div className="invalid-feedback">{formErrors.email}</div>}
    </div>

    {/* Apertura */}
    <div className="col-6 col-md-3">
      <label htmlFor="rest-opening" className="form-label">Hora Apertura</label>
      <input
        id="rest-opening"
        type="time"
        className="form-control"
        name="openingTime"
        value={formData.openingTime || ''}
        onChange={onChange}
      />
    </div>

    {/* Cierre */}
    <div className="col-6 col-md-3">
      <label htmlFor="rest-closing" className="form-label">Hora Cierre</label>
      <input
        id="rest-closing"
        type="time"
        className="form-control"
        name="closingTime"
        value={formData.closingTime || ''}
        onChange={onChange}
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
        onChange={onChange}
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
    <div className="col-12">
      <label htmlFor="rest-description" className="form-label">Descripción</label>
      <textarea
        id="rest-description"
        className="form-control"
        name="description"
        value={formData.description || ''}
        onChange={onChange}
        rows={3}
        placeholder="Breve descripción del restaurante..."
      />
    </div>
  </div>
);

export default RestaurantInfoForm;
```

En `Restaurants.jsx`, sustituir todo ese bloque de campos dentro del `<div className="modal-body">` por:

```jsx
                  <RestaurantInfoForm
                    formData={formData}
                    formErrors={formErrors}
                    onChange={handleFormChange}
                  />
```

con `import RestaurantInfoForm from '../components/RestaurantInfoForm';`.

- [ ] **Step 4: Crear la pantalla de configuración**

`restaurante-frontend/src/pages/RestaurantSettings.jsx`:

```jsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getRestaurantById, updateRestaurant } from '../services/restaurantService';
import RestaurantInfoForm from '../components/RestaurantInfoForm';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

/** '13:00:00' → '13:00', que es lo que espera un <input type="time">. */
const aHoraCorta = (hora) => (hora ? String(hora).substring(0, 5) : '');

/** '13:00' → '13:00:00', que es lo que espera el backend. */
const aHoraLarga = (hora) => (hora ? `${String(hora).substring(0, 5)}:00` : null);

const aFormulario = (restaurante) => ({
  name: restaurante?.name || '',
  address: restaurante?.address || '',
  phone: restaurante?.phone || '',
  email: restaurante?.email || '',
  description: restaurante?.description || '',
  openingTime: aHoraCorta(restaurante?.openingTime),
  closingTime: aHoraCorta(restaurante?.closingTime),
  capacity: restaurante?.capacity ?? '',
  defaultReservationDurationMinutes: restaurante?.defaultReservationDurationMinutes ?? '',
});

const validarInformacion = (formData) => {
  const errors = {};
  const name = (formData.name || '').trim();
  const address = (formData.address || '').trim();
  const email = (formData.email || '').trim();

  if (!name) errors.name = 'El nombre es obligatorio.';
  if (!address) errors.address = 'La dirección es obligatoria.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Correo electrónico no válido.';
  }

  const capacity = formData.capacity;
  if (capacity !== '' && capacity !== null && capacity !== undefined
      && (Number(capacity) < 0 || !Number.isInteger(Number(capacity)))) {
    errors.capacity = 'La capacidad debe ser un número entero positivo.';
  }

  const duration = formData.defaultReservationDurationMinutes;
  if (duration !== '' && duration !== null && duration !== undefined
      && (!Number.isInteger(Number(duration)) || Number(duration) < 15 || Number(duration) > 480)) {
    errors.defaultReservationDurationMinutes =
      'La duración debe ser un número entero entre 15 y 480 minutos.';
  }

  return errors;
};

// ─── Componente principal ────────────────────────────────────────────────────

const RestaurantSettings = () => {
  const { restaurantId } = useParams();
  const navigate = useNavigate();

  const [restaurante, setRestaurante] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [infoForm, setInfoForm] = useState(aFormulario(null));
  const [infoGuardada, setInfoGuardada] = useState(aFormulario(null));
  const [infoErrors, setInfoErrors] = useState({});
  const [guardandoInfo, setGuardandoInfo] = useState(false);
  const [infoExito, setInfoExito] = useState('');

  // ─── Carga inicial ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelado = false;

    const cargar = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const datos = await getRestaurantById(restaurantId);
        if (cancelado) return;
        if (!datos) {
          setLoadError('Restaurante no encontrado.');
          return;
        }
        setRestaurante(datos);
        setInfoForm(aFormulario(datos));
        setInfoGuardada(aFormulario(datos));
      } catch (err) {
        if (!cancelado) setLoadError(getErrorMessage(err));
      } finally {
        if (!cancelado) setLoading(false);
      }
    };

    cargar();
    return () => { cancelado = true; };
  }, [restaurantId]);

  // ─── Cambios sin guardar ───────────────────────────────────────────────────
  const infoSucia = useMemo(
    () => JSON.stringify(infoForm) !== JSON.stringify(infoGuardada),
    [infoForm, infoGuardada]
  );

  // Avisa al cerrar la pestaña o recargar. Navegar por el menú lateral no queda
  // cubierto: useBlocker exige un data router y la app monta BrowserRouter.
  useEffect(() => {
    if (!infoSucia) return undefined;
    const avisar = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [infoSucia]);

  const handleInfoChange = useCallback((e) => {
    const { name, value } = e.target;
    setInfoForm((prev) => ({ ...prev, [name]: value }));
    setInfoExito('');
    setInfoErrors((prev) => {
      if (!prev[name]) return prev;
      const siguiente = { ...prev };
      delete siguiente[name];
      return siguiente;
    });
  }, []);

  const handleGuardarInfo = async (e) => {
    e.preventDefault();
    const errores = validarInformacion(infoForm);
    if (Object.keys(errores).length > 0) {
      setInfoErrors(errores);
      return;
    }

    setGuardandoInfo(true);
    setInfoErrors({});
    setInfoExito('');

    try {
      const payload = {
        name: (infoForm.name || '').trim(),
        address: (infoForm.address || '').trim(),
        phone: (infoForm.phone || '').trim(),
        email: (infoForm.email || '').trim(),
        description: (infoForm.description || '').trim(),
        openingTime: aHoraLarga(infoForm.openingTime),
        closingTime: aHoraLarga(infoForm.closingTime),
        capacity: infoForm.capacity !== '' && infoForm.capacity !== null
          ? Number(infoForm.capacity) : null,
        defaultReservationDurationMinutes:
          infoForm.defaultReservationDurationMinutes !== ''
          && infoForm.defaultReservationDurationMinutes !== null
            ? Number(infoForm.defaultReservationDurationMinutes) : null,
      };

      await updateRestaurant(restaurantId, payload);
      setInfoGuardada(infoForm);
      setRestaurante((prev) => ({ ...prev, ...payload }));
      setInfoExito('Datos del restaurante guardados correctamente.');
    } catch (err) {
      setInfoErrors({ submit: getErrorMessage(err) });
    } finally {
      setGuardandoInfo(false);
    }
  };

  const handleVolver = () => {
    if (infoSucia && !window.confirm('Hay cambios sin guardar. ¿Seguro que quieres salir?')) {
      return;
    }
    navigate('/restaurants');
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center py-5">
        <div className="spinner-border mb-3" role="status">
          <span className="visually-hidden">Cargando...</span>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>Cargando configuración del restaurante...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <div className="alert alert-danger" role="alert">{loadError}</div>
        <button className="btn btn-outline-secondary" onClick={() => navigate('/restaurants')} type="button">
          Volver a Restaurantes
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* ═══ Cabecera ═══════════════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <h1>{restaurante?.name || 'Restaurante'}</h1>
          <p className="page-description">Configuración del restaurante</p>
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-outline-secondary d-flex align-items-center gap-2"
            onClick={handleVolver}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver a Restaurantes
          </button>
        </div>
      </div>

      {/* ═══ Información ════════════════════════════════════════════════════ */}
      <div className="app-card mb-4">
        <div className="app-card-body">
          <h2 className="h5 fw-semibold mb-3">Información</h2>

          {infoErrors.submit && (
            <div className="alert alert-danger py-2" role="alert">{infoErrors.submit}</div>
          )}
          {infoExito && (
            <div className="alert alert-success py-2" role="alert">{infoExito}</div>
          )}

          <form onSubmit={handleGuardarInfo} noValidate>
            <RestaurantInfoForm
              formData={infoForm}
              formErrors={infoErrors}
              onChange={handleInfoChange}
            />

            <div className="d-flex justify-content-end mt-3">
              <button
                type="submit"
                className="btn btn-primary d-flex align-items-center gap-2"
                disabled={!infoSucia || guardandoInfo}
              >
                {guardandoInfo && (
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                )}
                Guardar información
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};

export default RestaurantSettings;
```

- [ ] **Step 5: Registrar la ruta**

En `restaurante-frontend/src/App.jsx`, añadir el import:

```jsx
import RestaurantSettings from './pages/RestaurantSettings';
```

y, justo debajo de la ruta `/restaurants` existente, dentro del mismo bloque de Administración:

```jsx
        <Route path="/restaurants/:restaurantId/configuracion" element={<PermissionRoute permission={PERMISSIONS.MANAGE_RESTAURANTS}><RestaurantSettings /></PermissionRoute>} />
```

- [ ] **Step 6: Cambiar la acción de la fila y reducir el modal a "crear"**

En `restaurante-frontend/src/pages/Restaurants.jsx`:

1. Añadir `import { useNavigate } from 'react-router-dom';` y, dentro del componente, `const navigate = useNavigate();`.
2. Quitar `updateRestaurant` del import de `../services/restaurantService` (deja de usarse aquí).
3. Eliminar el estado `editingRestaurant` y su `setEditingRestaurant`, y la función `handleOpenEdit` completa.
4. En `handleOpenCreate` y en `handleCloseModal`, quitar las líneas `setEditingRestaurant(...)`.
5. En `handleSubmit`, sustituir el bloque `if (editingRestaurant) { ... } else { ... }` por únicamente:

```jsx
      await createRestaurant(payload);
      setSuccessMessage('Restaurante creado correctamente.');
```

6. Sustituir el botón del lápiz por el engranaje que navega:

```jsx
                          <button
                            className="btn-icon btn-edit"
                            onClick={() => navigate(`/restaurants/${restaurant.id}/configuracion`)}
                            title="Configurar restaurante"
                            type="button"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="3" />
                              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                            </svg>
                          </button>
```

7. En el modal, el título pasa a ser fijo `Nuevo Restaurante` y el botón de envío `Crear Restaurante`:

```jsx
                <h5 className="modal-title">Nuevo Restaurante</h5>
```

```jsx
                    Crear Restaurante
```

- [ ] **Step 7: Verificar que pasan**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: `20 passed` (los 17 previos más los 3 nuevos).

- [ ] **Step 8: Checkpoint (NO commit)**

```bash
cd restaurante-frontend && pnpm lint && pnpm build
```

Esperado: sin errores de ESLint y build correcto. **No ejecutar `git commit`.**

---

### Task 6: Componente `ServiceSchedule` y servicio de horarios

**Files:**
- Create: `restaurante-frontend/src/services/servicePeriodService.js`
- Create: `restaurante-frontend/src/components/ServiceSchedule.jsx`
- Create: `restaurante-frontend/src/components/ServiceSchedule.test.jsx`
- Modify: `restaurante-frontend/src/index.css`

**Interfaces:**
- Produces:
  - `getServicePeriods(restaurantId) → Promise<Array<{id, dayOfWeek, startTime, endTime, name}>>`
  - `saveServicePeriods(restaurantId, periods) → Promise<Array<...>>`
  - `ServiceSchedule({ periods, onChange, disabled })` — controlado; `periods` es un array plano de `{ _key, id, dayOfWeek, startTime, endTime, name }` y `onChange` recibe el array completo ya modificado.
  - `nuevaClave()` no se exporta: es interno del componente.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `restaurante-frontend/src/components/ServiceSchedule.test.jsx`:

```jsx
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ServiceSchedule from './ServiceSchedule';

const PERIODOS = [
  { _key: 'k1', id: 1, dayOfWeek: 'MONDAY', startTime: '13:00:00', endTime: '16:00:00', name: 'Comidas' },
  { _key: 'k2', id: 2, dayOfWeek: 'MONDAY', startTime: '20:00:00', endTime: '23:00:00', name: 'Cenas' },
];

const setup = (props = {}) => {
  const onChange = vi.fn();
  render(<ServiceSchedule periods={PERIODOS} onChange={onChange} disabled={false} {...props} />);
  return { onChange };
};

describe('ServiceSchedule', () => {
  it('muestra los periodos de cada día y marca como cerrados los días vacíos', () => {
    setup();

    expect(screen.getByDisplayValue('13:00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('20:00')).toBeInTheDocument();
    // Martes a domingo no tienen periodos: seis días cerrados.
    expect(screen.getAllByText('Cerrado')).toHaveLength(6);
  });

  it('añade un periodo al día indicado', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /añadir servicio en martes/i }));

    expect(onChange).toHaveBeenCalled();
    const siguiente = onChange.mock.calls[0][0];
    expect(siguiente).toHaveLength(3);
    expect(siguiente.filter((p) => p.dayOfWeek === 'TUESDAY')).toHaveLength(1);
    // Los periodos nuevos van sin id: el backend los creará.
    expect(siguiente.find((p) => p.dayOfWeek === 'TUESDAY').id).toBeNull();
  });

  it('elimina el periodo indicado', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getAllByRole('button', { name: /eliminar servicio/i })[0]);

    const siguiente = onChange.mock.calls[0][0];
    expect(siguiente).toHaveLength(1);
    expect(siguiente[0]._key).toBe('k2');
  });

  it('marcar un día como cerrado elimina todos sus periodos', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /marcar lunes como cerrado/i }));

    expect(onChange.mock.calls[0][0]).toHaveLength(0);
  });

  it('copia los horarios de un día a los días elegidos', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /copiar horarios de lunes/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Miércoles' }));
    await userEvent.click(screen.getByRole('button', { name: /^copiar$/i }));

    const siguiente = onChange.mock.calls[0][0];
    const miercoles = siguiente.filter((p) => p.dayOfWeek === 'WEDNESDAY');
    expect(miercoles).toHaveLength(2);
    expect(miercoles.map((p) => p.startTime)).toEqual(['13:00:00', '20:00:00']);
    // Las copias son periodos nuevos, no la misma fila de la base de datos.
    expect(miercoles.every((p) => p.id === null)).toBe(true);
  });

  it('editar la hora de inicio propaga el cambio en el formato del backend', () => {
    // fireEvent y no userEvent.type: el componente es controlado y aquí el padre
    // es un vi.fn() que no re-renderiza, así que escribir carácter a carácter no
    // acumularía valor. Un único change es determinista y prueba lo mismo.
    const { onChange } = setup();

    fireEvent.change(screen.getAllByLabelText(/hora de inicio en lunes/i)[0], {
      target: { value: '12:30' },
    });

    const siguiente = onChange.mock.calls[0][0];
    expect(siguiente.find((p) => p._key === 'k1').startTime).toBe('12:30:00');
  });
});
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante-frontend && pnpm test src/components/ServiceSchedule.test.jsx
```

Esperado: FAIL — `Failed to resolve import "./ServiceSchedule"`.

- [ ] **Step 3: Crear el servicio de API**

`restaurante-frontend/src/services/servicePeriodService.js`:

```javascript
import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const periodsEndpoint = (restaurantId) => `/restaurants/${restaurantId}/service-periods`;

/**
 * Normaliza el error para extraer un mensaje legible.
 */
const handleError = (error) => {
  if (error.response) {
    const { status, data: body } = error.response;

    if (body) {
      const message = body.message || body.error;
      if (message) return new Error(message);
    }

    switch (status) {
      case 400:
        return new Error('Los horarios enviados no son válidos. Revisa los periodos.');
      case 401:
        return new Error('No autorizado. Inicia sesión nuevamente.');
      case 403:
        return new Error('No tienes permiso para configurar este restaurante.');
      case 404:
        return new Error('El restaurante no existe o no está disponible.');
      case 500:
        return new Error('Error interno del servidor. Intenta nuevamente más tarde.');
      default:
        return new Error(`Error del servidor (${status}). Intenta de nuevo.`);
    }
  }

  if (error.message) return error;
  return new Error('No se ha podido contactar con el servidor.');
};

/**
 * Periodos de servicio del restaurante, ordenados por día y hora de inicio.
 * Una lista vacía significa que el restaurante usa el horario general.
 * @param {number|string} restaurantId
 */
export const getServicePeriods = async (restaurantId) => {
  try {
    const response = await api.get(periodsEndpoint(restaurantId));
    const datos = extractData(response);
    return Array.isArray(datos) ? datos : [];
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Reemplaza los periodos de la semana completa. El backend valida solapes,
 * duplicados y pertenencia al restaurante.
 * @param {number|string} restaurantId
 * @param {Array<{id: number|null, dayOfWeek: string, startTime: string, endTime: string, name: string|null}>} periods
 */
export const saveServicePeriods = async (restaurantId, periods) => {
  try {
    const response = await api.put(periodsEndpoint(restaurantId), periods);
    const datos = extractData(response);
    return Array.isArray(datos) ? datos : [];
  } catch (error) {
    throw handleError(error);
  }
};
```

- [ ] **Step 4: Crear el componente**

`restaurante-frontend/src/components/ServiceSchedule.jsx`:

```jsx
import { useState } from 'react';

/**
 * Editor semanal de periodos de servicio.
 *
 * Controlado: no guarda nada ni consulta al backend. Recibe la lista plana de
 * periodos y devuelve la lista modificada por onChange; el contenedor decide
 * cuándo persistirla.
 *
 * Un día sin periodos está cerrado. El backend valida solapes y duplicados: aquí
 * no se replica esa lógica para no tener dos reglas que puedan discrepar.
 */

const DIAS = [
  { id: 'MONDAY', etiqueta: 'Lunes' },
  { id: 'TUESDAY', etiqueta: 'Martes' },
  { id: 'WEDNESDAY', etiqueta: 'Miércoles' },
  { id: 'THURSDAY', etiqueta: 'Jueves' },
  { id: 'FRIDAY', etiqueta: 'Viernes' },
  { id: 'SATURDAY', etiqueta: 'Sábado' },
  { id: 'SUNDAY', etiqueta: 'Domingo' },
];

/** '13:00:00' → '13:00', que es lo que espera un <input type="time">. */
const aHoraCorta = (hora) => (hora ? String(hora).substring(0, 5) : '');

/** '13:00' → '13:00:00', que es lo que espera el backend. */
const aHoraLarga = (hora) => (hora ? `${String(hora).substring(0, 5)}:00` : '');

let contadorClaves = 0;
/** Clave estable de React para periodos que aún no tienen id de base de datos. */
const nuevaClave = () => {
  contadorClaves += 1;
  return `nuevo-${contadorClaves}`;
};

const ServiceSchedule = ({ periods = [], onChange, disabled = false }) => {
  const [copiandoDesde, setCopiandoDesde] = useState(null);
  const [destinosCopia, setDestinosCopia] = useState([]);

  const periodosDe = (dia) => periods.filter((p) => p.dayOfWeek === dia);

  const añadirPeriodo = (dia) => {
    onChange([
      ...periods,
      {
        _key: nuevaClave(),
        id: null,
        dayOfWeek: dia,
        startTime: '13:00:00',
        endTime: '16:00:00',
        name: '',
      },
    ]);
  };

  const eliminarPeriodo = (clave) => {
    onChange(periods.filter((p) => p._key !== clave));
  };

  const actualizarPeriodo = (clave, campo, valor) => {
    onChange(periods.map((p) => (p._key === clave ? { ...p, [campo]: valor } : p)));
  };

  const cerrarDia = (dia) => {
    onChange(periods.filter((p) => p.dayOfWeek !== dia));
  };

  const abrirCopia = (dia) => {
    setCopiandoDesde(dia);
    setDestinosCopia([]);
  };

  const alternarDestino = (dia) => {
    setDestinosCopia((prev) => (prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]));
  };

  const confirmarCopia = () => {
    const origen = periodosDe(copiandoDesde);
    // Los días destino se reemplazan por completo, y las copias son periodos
    // nuevos (id nulo): nunca se reutiliza la fila de otro día.
    const sinDestinos = periods.filter((p) => !destinosCopia.includes(p.dayOfWeek));
    const copias = destinosCopia.flatMap((dia) =>
      origen.map((p) => ({
        _key: nuevaClave(),
        id: null,
        dayOfWeek: dia,
        startTime: p.startTime,
        endTime: p.endTime,
        name: p.name,
      }))
    );
    onChange([...sinDestinos, ...copias]);
    setCopiandoDesde(null);
    setDestinosCopia([]);
  };

  return (
    <div className="service-schedule">
      {DIAS.map(({ id, etiqueta }) => {
        const delDia = periodosDe(id);
        return (
          <div key={id} className="service-day">
            <div className="service-day-header">
              <h3 className="service-day-title">{etiqueta}</h3>
              <div className="service-day-actions">
                {/* El texto visible se mantiene corto y el nombre accesible lleva
                    el día, para que cada botón sea distinguible sin repetir
                    "lunes", "martes"... siete veces en pantalla. */}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => añadirPeriodo(id)}
                  disabled={disabled}
                  aria-label={`Añadir servicio en ${etiqueta.toLowerCase()}`}
                >
                  Añadir servicio
                </button>
                {delDia.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => abrirCopia(id)}
                      disabled={disabled}
                      aria-label={`Copiar horarios de ${etiqueta.toLowerCase()}`}
                    >
                      Copiar a otros días
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => cerrarDia(id)}
                      disabled={disabled}
                      aria-label={`Marcar ${etiqueta.toLowerCase()} como cerrado`}
                    >
                      Marcar como cerrado
                    </button>
                  </>
                )}
              </div>
            </div>

            {delDia.length === 0 ? (
              <p className="service-day-closed">Cerrado</p>
            ) : (
              <ul className="service-period-list">
                {delDia.map((periodo) => (
                  <li key={periodo._key} className="service-period">
                    <input
                      type="time"
                      className="form-control form-control-sm"
                      aria-label={`Hora de inicio en ${etiqueta.toLowerCase()}`}
                      value={aHoraCorta(periodo.startTime)}
                      onChange={(e) => actualizarPeriodo(periodo._key, 'startTime', aHoraLarga(e.target.value))}
                      disabled={disabled}
                    />
                    <span className="service-period-separator">–</span>
                    <input
                      type="time"
                      className="form-control form-control-sm"
                      aria-label={`Hora de fin en ${etiqueta.toLowerCase()}`}
                      value={aHoraCorta(periodo.endTime)}
                      onChange={(e) => actualizarPeriodo(periodo._key, 'endTime', aHoraLarga(e.target.value))}
                      disabled={disabled}
                    />
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      aria-label={`Nombre del servicio en ${etiqueta.toLowerCase()}`}
                      placeholder="Nombre (opcional)"
                      maxLength={50}
                      value={periodo.name || ''}
                      onChange={(e) => actualizarPeriodo(periodo._key, 'name', e.target.value)}
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => eliminarPeriodo(periodo._key)}
                      disabled={disabled}
                      aria-label={`Eliminar servicio de ${etiqueta.toLowerCase()}`}
                    >
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {copiandoDesde === id && (
              <div className="service-copy-panel">
                <p className="service-copy-title">Copiar estos horarios a:</p>
                <div className="service-copy-days">
                  {DIAS.filter((d) => d.id !== id).map((destino) => (
                    <label key={destino.id} className="service-copy-day">
                      <input
                        type="checkbox"
                        checked={destinosCopia.includes(destino.id)}
                        onChange={() => alternarDestino(destino.id)}
                      />
                      {destino.etiqueta}
                    </label>
                  ))}
                </div>
                <div className="service-copy-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={confirmarCopia}
                    disabled={destinosCopia.length === 0}
                  >
                    Copiar
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-light"
                    onClick={() => setCopiandoDesde(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ServiceSchedule;
```

- [ ] **Step 5: Añadir los estilos**

Al final de `restaurante-frontend/src/index.css`:

```css
/* ─── Editor de horarios de servicio (ServiceSchedule) ──────────────────── */

.service-day {
  padding: 12px 0;
  border-bottom: 1px solid var(--border-light);
}

.service-day:last-child {
  border-bottom: none;
}

.service-day-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 8px;
}

.service-day-title {
  margin: 0;
  font-size: 0.95rem;
  font-weight: 600;
}

.service-day-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.service-day-closed {
  margin: 0;
  color: var(--text-muted);
  font-size: 0.85rem;
  font-style: italic;
}

.service-period-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.service-period {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.service-period input[type='time'] {
  max-width: 130px;
}

.service-period input[type='text'] {
  max-width: 220px;
}

.service-period-separator {
  color: var(--text-secondary);
}

.service-copy-panel {
  margin-top: 10px;
  padding: 10px;
  border: 1px dashed var(--border);
  border-radius: 8px;
}

.service-copy-title {
  margin: 0 0 6px;
  font-size: 0.85rem;
  color: var(--text-secondary);
}

.service-copy-days {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 10px;
}

.service-copy-day {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.85rem;
}

.service-copy-actions {
  display: flex;
  gap: 6px;
}

@media (max-width: 576px) {
  .service-period {
    /* En móvil cada control ocupa su propia línea para no quedar aplastado. */
    flex-direction: column;
    align-items: stretch;
  }

  .service-period input[type='time'],
  .service-period input[type='text'] {
    max-width: none;
  }

  .service-period-separator {
    display: none;
  }
}
```

- [ ] **Step 6: Verificar que pasan**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: `26 passed` (los 20 previos más los 6 nuevos).

- [ ] **Step 7: Checkpoint (NO commit)**

```bash
cd restaurante-frontend && pnpm lint
```

Esperado: sin errores. **No ejecutar `git commit`.**

---

### Task 7: Integrar los horarios en la pantalla de configuración

**Files:**
- Modify: `restaurante-frontend/src/pages/RestaurantSettings.jsx`
- Test: `restaurante-frontend/src/pages/RestaurantSettings.test.jsx`

**Interfaces:**
- Consumes: `ServiceSchedule` y `getServicePeriods`/`saveServicePeriods` (Task 6).

- [ ] **Step 1: Añadir los tests que fallan**

En `restaurante-frontend/src/pages/RestaurantSettings.test.jsx`, ampliar el mock de servicios añadiendo, **antes** de los imports de módulos bajo prueba:

```jsx
vi.mock('../services/servicePeriodService', () => ({
  getServicePeriods: vi.fn().mockResolvedValue([]),
  saveServicePeriods: vi.fn().mockResolvedValue([]),
}));
```

y el import correspondiente:

```jsx
import { getServicePeriods, saveServicePeriods } from '../services/servicePeriodService';
```

Añadir estos tests al final del `describe`:

```jsx
  it('avisa de que usa el horario general cuando no hay periodos', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    expect(
      await screen.findByText(/utiliza el horario general/i)
    ).toBeInTheDocument();
  });

  it('guarda los periodos configurados', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');
    await waitFor(() => expect(getServicePeriods).toHaveBeenCalledWith('1'));

    await userEvent.click(screen.getByRole('button', { name: /añadir servicio en lunes/i }));
    await userEvent.click(screen.getByRole('button', { name: /guardar horarios/i }));

    await waitFor(() => expect(saveServicePeriods).toHaveBeenCalled());
    const [id, periodos] = saveServicePeriods.mock.calls[0];
    expect(id).toBe('1');
    expect(periodos).toHaveLength(1);
    expect(periodos[0].dayOfWeek).toBe('MONDAY');
    // El campo interno de React no debe viajar al backend.
    expect(periodos[0]._key).toBeUndefined();
  });

  it('deshabilita Guardar horarios mientras no haya cambios', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    expect(await screen.findByRole('button', { name: /guardar horarios/i })).toBeDisabled();
  });
```

- [ ] **Step 2: Verificar que fallan**

```bash
cd restaurante-frontend && pnpm test src/pages/RestaurantSettings.test.jsx
```

Esperado: FAIL — no existe el apartado de horarios ni su botón.

- [ ] **Step 3: Integrar el editor en la pantalla**

En `restaurante-frontend/src/pages/RestaurantSettings.jsx`:

1. Añadir los imports:

```jsx
import ServiceSchedule from '../components/ServiceSchedule';
import { getServicePeriods, saveServicePeriods } from '../services/servicePeriodService';
```

2. Añadir junto a los helpers del archivo:

```jsx
let contadorClavesPeriodo = 0;
/** Clave estable de React; el backend no la conoce ni la necesita. */
const conClave = (periodo) => {
  contadorClavesPeriodo += 1;
  return { ...periodo, _key: `guardado-${periodo.id ?? contadorClavesPeriodo}` };
};

/** Quita el campo interno _key antes de enviar al backend. */
const aPayloadPeriodos = (periodos) =>
  periodos.map(({ _key, ...resto }) => ({ ...resto, name: resto.name?.trim() || null }));
```

3. Añadir los estados nuevos junto a los de Información:

```jsx
  const [periodos, setPeriodos] = useState([]);
  const [periodosGuardados, setPeriodosGuardados] = useState([]);
  const [guardandoPeriodos, setGuardandoPeriodos] = useState(false);
  const [periodosError, setPeriodosError] = useState('');
  const [periodosExito, setPeriodosExito] = useState('');
```

4. En el `useEffect` de carga, cargar también los periodos. Sustituir la línea
   `const datos = await getRestaurantById(restaurantId);` y las tres asignaciones
   siguientes por:

```jsx
        const [datos, periodosCargados] = await Promise.all([
          getRestaurantById(restaurantId),
          getServicePeriods(restaurantId),
        ]);
        if (cancelado) return;
        if (!datos) {
          setLoadError('Restaurante no encontrado.');
          return;
        }
        setRestaurante(datos);
        setInfoForm(aFormulario(datos));
        setInfoGuardada(aFormulario(datos));
        const conClaves = periodosCargados.map(conClave);
        setPeriodos(conClaves);
        setPeriodosGuardados(conClaves);
```

5. Añadir el cálculo de cambios pendientes de horarios y ampliar el aviso de salida.
   Sustituir la constante `infoSucia` y el `useEffect` de `beforeunload` por:

```jsx
  const infoSucia = useMemo(
    () => JSON.stringify(infoForm) !== JSON.stringify(infoGuardada),
    [infoForm, infoGuardada]
  );

  const periodosSucios = useMemo(
    () => JSON.stringify(aPayloadPeriodos(periodos)) !== JSON.stringify(aPayloadPeriodos(periodosGuardados)),
    [periodos, periodosGuardados]
  );

  const haySinGuardar = infoSucia || periodosSucios;

  // Avisa al cerrar la pestaña o recargar. Navegar por el menú lateral no queda
  // cubierto: useBlocker exige un data router y la app monta BrowserRouter.
  useEffect(() => {
    if (!haySinGuardar) return undefined;
    const avisar = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [haySinGuardar]);
```

   y en `handleVolver`, cambiar la condición `infoSucia` por `haySinGuardar`.

6. Añadir el handler de guardado de horarios:

```jsx
  const handleCambioPeriodos = useCallback((siguientes) => {
    setPeriodos(siguientes);
    setPeriodosExito('');
    setPeriodosError('');
  }, []);

  const handleGuardarPeriodos = async () => {
    setGuardandoPeriodos(true);
    setPeriodosError('');
    setPeriodosExito('');

    try {
      const guardados = await saveServicePeriods(restaurantId, aPayloadPeriodos(periodos));
      const conClaves = guardados.map(conClave);
      setPeriodos(conClaves);
      setPeriodosGuardados(conClaves);
      setPeriodosExito('Horarios de servicio guardados correctamente.');
    } catch (err) {
      setPeriodosError(getErrorMessage(err));
    } finally {
      setGuardandoPeriodos(false);
    }
  };
```

7. Añadir el apartado en el render, justo después de la tarjeta de Información y
   antes del cierre del `<div>` principal:

```jsx
      {/* ═══ Horarios de servicio ═══════════════════════════════════════════ */}
      <div className="app-card">
        <div className="app-card-body">
          <h2 className="h5 fw-semibold mb-3">Horarios de servicio</h2>

          {periodos.length === 0 && (
            <div className="alert alert-info py-2" role="alert">
              Este restaurante utiliza el horario general ({aHoraCorta(restaurante?.openingTime) || '—'}
              {' – '}{aHoraCorta(restaurante?.closingTime) || '—'}) para todos los días.
              Al añadir el primer servicio, esta configuración pasará a regir la semana completa y los
              días que queden vacíos se considerarán cerrados.
            </div>
          )}

          {periodosError && (
            <div className="alert alert-danger py-2" role="alert">{periodosError}</div>
          )}
          {periodosExito && (
            <div className="alert alert-success py-2" role="alert">{periodosExito}</div>
          )}

          <ServiceSchedule
            periods={periodos}
            onChange={handleCambioPeriodos}
            disabled={guardandoPeriodos}
          />

          <div className="d-flex justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-primary d-flex align-items-center gap-2"
              onClick={handleGuardarPeriodos}
              disabled={!periodosSucios || guardandoPeriodos}
            >
              {guardandoPeriodos && (
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
              )}
              Guardar horarios
            </button>
          </div>
        </div>
      </div>
```

- [ ] **Step 4: Verificar que pasan**

```bash
cd restaurante-frontend && pnpm test
```

Esperado: `29 passed` (los 26 previos más los 3 nuevos).

- [ ] **Step 5: Checkpoint (NO commit)**

```bash
cd restaurante-frontend && pnpm lint && pnpm build
```

Esperado: sin errores de ESLint y build correcto. **No ejecutar `git commit`.**

---

### Task 8: Verificación final

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa del backend**

```bash
cd restaurante_manage && mvn clean test
```

Esperado: `BUILD SUCCESS`, 0 fallos y 0 errores. Anotar el recuento de tests.

- [ ] **Step 2: Build completo del backend**

```bash
cd restaurante_manage && mvn clean package -DskipTests
```

Esperado: `BUILD SUCCESS`.

- [ ] **Step 3: Suite, lint y build del frontend**

```bash
cd restaurante-frontend && pnpm test && pnpm lint && pnpm build
```

Esperado: 29 tests verdes, ESLint sin errores y build correcto.

- [ ] **Step 4: Revisión del diff**

```bash
git status --short
git diff --stat
```

Comprobar que no hay archivos tocados fuera de los listados en "Estructura de archivos" y que **no existe ningún commit nuevo**:

```bash
git log --oneline -3
```

Esperado: el `HEAD` sigue siendo el mismo que antes de empezar este plan.

- [ ] **Step 5: Repaso de seguridad y de la regla del fallback**

Verificar a mano sobre el diff:

1. `ServicePeriodService.findByRestaurantId` y `replacePeriods` llaman ambos a
   `validateRestaurantAccess` como primera instrucción.
2. `ServicePeriodController` declara `@PreAuthorize` en los dos verbos.
3. `replacePeriods` rechaza los ids que no pertenecen al restaurante de la ruta.
4. Ninguna respuesta pública (`TimeSlotResponse`, `PublicReservationResponse`,
   `PublicRestaurantResponse`) incluye periodos, ids de periodo ni datos de mesas.
5. No se ha añadido ningún `permitAll` nuevo en `SecurityConfig`.
6. `openingTime` y `closingTime` siguen existiendo en `Restaurant`, en
   `RestaurantRequest` y en el formulario de Información.
7. `generarFranjas` cae al horario general **solo** cuando la lista de periodos del
   restaurante está vacía, y devuelve lista vacía cuando hay periodos pero ninguno
   ese día.

- [ ] **Step 6: Checkpoint final (NO commit)**

Dejar todos los cambios en el árbol de trabajo, **sin commit, sin push y sin Pull Request**.

---

## Cobertura de los requisitos de prueba del encargo

| # | Requisito | Task |
|---|---|---|
| 1 | Un administrador puede abrir la configuración de su restaurante | 3 (backend) + 5 (ruta y pantalla) |
| 2 | Un usuario sin permisos no puede acceder | 3 (`employee.demo` recibe 403) + 5 (`PermissionRoute`) |
| 3 | No se puede editar otro restaurante modificando la URL | 3 (`juan.admin` recibe 403 en `GET` y `PUT`) |
| 4 | Los periodos se guardan y se recuperan correctamente | 1 (persistencia) + 3 (extremo a extremo) |
| 5 | Se rechazan periodos solapados o duplicados | 2 (unitarios) + 3 (400 vía HTTP) |
| 6 | Un día cerrado no devuelve horarios | 4 |
| 7 | No aparecen horas entre los servicios | 4 |
| 8 | Las reservas públicas y privadas usan la misma configuración | 4 (un único `generarFranjas` alimenta ambos endpoints) |
| 9 | Los restaurantes sin periodos siguen usando el fallback | 4 |
| 10 | El frontend y el backend compilan correctamente | 8 |
