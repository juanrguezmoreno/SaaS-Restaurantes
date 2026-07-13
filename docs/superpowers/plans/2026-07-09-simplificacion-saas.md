# Simplificación del SaaS Restaurant Manager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar/fusionar funcionalidad redundante del SaaS (Dashboard+Analítica, notificaciones decorativas, vistas duplicadas del plano, mantenimiento manual de estados de mesa) sin romper login, roles, multi-tenant, reservas ni el plano interactivo.

**Architecture:** Backend Spring Boot (feature packages) — se elimina un paquete muerto, se depura un repositorio, se corrige una regla de negocio divergente y se añade un scheduler. Frontend React — dos páginas (`Dashboard.jsx` + `Analytics.jsx`) se fusionan en una sola (`Inicio.jsx`) con secciones gateadas por permiso; un sistema de notificaciones 100% decorativo se elimina; el plano de mesas pierde sus dos vistas redundantes y conserva solo la interactiva.

**Tech Stack:** Spring Boot 3.3 / Java 21 / JUnit 5 + Mockito (backend). React 19 + Vite / react-router v7 / Bootstrap 5 (frontend, sin framework de tests — verificación por `pnpm lint`/`pnpm build` y smoke manual).

## Global Constraints

- No romper: login/JWT, roles, `CurrentUserService`, multi-tenant, CRUD de restaurantes/mesas/clientes/empleados, reservas (RES-03), plano interactivo.
- Español en código, comentarios, commits (Conventional Commits `feat(...)`/`fix(...)`/`refactor(...)`/`chore(...)`).
- Backend: `mvn test` debe seguir en verde tras cada tarea backend.
- Frontend: no existe suite de tests; cada tarea frontend se verifica con `pnpm lint` (y `pnpm build` en la tarea final) más el checklist de smoke manual de la Tarea 11.
- No introducir librerías nuevas (nada de Redux/Zustand/testing frameworks) — usar los patrones ya existentes (hooks, contexts, servicios `axios`).
- Referenciar rutas y roles vía `common/util/Constants.java` (backend) y `src/config/permissions.js` (frontend), no strings sueltos.

---

## Task 1: Backend — Eliminar el paquete `dashboard/` (código muerto)

**Contexto:** `dashboard/` expone 3 endpoints (`/summary`, `/reservations-by-day`, `/popular-tables/{id}`) que ningún cliente frontend llama (confirmado por grep exhaustivo), y uno de ellos ni está implementado (`return List.of();`). No tiene tests.

**Files:**
- Delete: `restaurante_manage/src/main/java/com/restaurante/dashboard/controller/DashboardController.java`
- Delete: `restaurante_manage/src/main/java/com/restaurante/dashboard/service/DashboardService.java`
- Delete: `restaurante_manage/src/main/java/com/restaurante/dashboard/dto/DashboardSummary.java`
- Delete: `restaurante_manage/src/main/java/com/restaurante/dashboard/dto/ReservationStats.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java:45`

**Interfaces:**
- Produces: nada — solo elimina superficie de API sin consumidores conocidos.

- [ ] **Step 1: Confirmar que no hay tests ni referencias antes de borrar**

Run: `grep -rn "dashboard" restaurante_manage/src/test 2>/dev/null; grep -rn "DASHBOARD_PATH\|DashboardController\|DashboardService\|DashboardSummary\|ReservationStats" restaurante_manage/src/main --include=*.java -l`
Expected: la búsqueda en `src/test` no devuelve nada; la segunda solo lista los 4 ficheros del paquete `dashboard/` más `Constants.java`.

- [ ] **Step 2: Eliminar los 4 ficheros del paquete `dashboard/`**

```bash
git rm -r restaurante_manage/src/main/java/com/restaurante/dashboard
```

- [ ] **Step 3: Quitar la constante `DASHBOARD_PATH` de `Constants.java`**

En `restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java`, eliminar la línea 45:

```java
    public static final String DASHBOARD_PATH = API_BASE_PATH + "/dashboard";
```

- [ ] **Step 4: Ejecutar la suite completa y confirmar que sigue en verde**

Run: `cd restaurante_manage && mvn test`
Expected: `BUILD SUCCESS`, 29 tests, 0 fallos (el mismo número que antes — no había tests de `dashboard/`).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "chore(dashboard): eliminar paquete dashboard sin consumidor en frontend"
```

---

## Task 2: Backend — Eliminar código muerto de `ReservationRepository` y el endpoint `/reservations/my`

**Contexto:** 7 métodos de `ReservationRepository` no tienen ningún caller (incluye `findPopularTables`, que quedó huérfano tras la Tarea 1). El endpoint `GET /api/v1/reservations/my` siempre devuelve `[]` ("Simplificación: retorna todas por ahora") y su función equivalente en frontend (`getMyReservations`) no se llama desde ninguna página — se elimina en vez de implementarse.

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/controller/ReservationController.java:98-103`
- Modify: `restaurante-frontend/src/services/reservationService.js:89-99`

**Interfaces:**
- Consumes: ninguno (solo elimina código sin caller).
- Produces: `ReservationRepository` queda con las queries que sí se usan (`findActiveConfirmedByTableId`, `findConfirmedByTableIdAndDateAndTime` — esta última se toca en la Tarea 3 —, `findActiveConflicts`, y los métodos CRUD/paginados usados por `ReservationService`).

- [ ] **Step 1: Confirmar de nuevo que ninguno de los 7 métodos tiene caller**

Run: `cd restaurante_manage && grep -rn "countByRestaurantAndDate\|countByRestaurantIdAndStatusAndDeletedFalse\|findByCustomerIdAndRestaurantIdIn\|findByRestaurantIdAndReservationDateAndDeletedFalse\|countByRestaurantIdAndReservationDateAndDeletedFalse\|findByDiningTableIdAndReservationDateAndDeletedFalse\|findPopularTables" src/main src/test --include=*.java`
Expected: cada método aparece solo en su propia declaración dentro de `ReservationRepository.java` (ninguna otra clase los invoca).

- [ ] **Step 2: Eliminar los 7 métodos de `ReservationRepository.java`**

Quitar estos bloques (líneas 35-36, 46, 48, 50, 54, 56-57, 59-60 del fichero original):

```java
    List<Reservation> findByCustomerIdAndRestaurantIdInAndDeletedFalseOrderByReservationDateDescReservationTimeDesc(
            Long customerId, Collection<Long> restaurantIds);
```
```java
    List<Reservation> findByRestaurantIdAndReservationDateAndDeletedFalse(Long restaurantId, LocalDate date);

    List<Reservation> findByDiningTableIdAndReservationDateAndDeletedFalse(Long diningTableId, LocalDate date);

    long countByRestaurantIdAndReservationDateAndDeletedFalse(Long restaurantId, LocalDate date);
```
```java
    long countByRestaurantIdAndStatusAndDeletedFalse(Long restaurantId, ReservationStatus status);

    @Query("SELECT r.restaurant.id, COUNT(r) FROM Reservation r WHERE r.reservationDate = :date AND r.deleted = false GROUP BY r.restaurant.id")
    List<Object[]> countByRestaurantAndDate(@Param("date") LocalDate date);

    @Query("SELECT r.diningTable.id, COUNT(r) FROM Reservation r WHERE r.restaurant.id = :restaurantId AND r.deleted = false GROUP BY r.diningTable.id ORDER BY COUNT(r) DESC")
    List<Object[]> findPopularTables(@Param("restaurantId") Long restaurantId);
```

Tras el borrado, el import `java.util.Collection` puede quedar sin uso si ningún otro método de la interfaz lo usa — comprobar con:

Run: `grep -n "Collection" restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java`
Expected: si solo queda la línea del `import`, eliminarla también.

- [ ] **Step 3: Eliminar el endpoint `GET /reservations/my` de `ReservationController.java`**

Quitar (líneas 98-103):

```java
    @GetMapping("/my")
    @Operation(summary = "Mis reservas", description = "Obtiene las reservas del cliente autenticado")
    public ResponseEntity<ApiResponse<List<ReservationResponse>>> getMyReservations(Authentication authentication) {
        // Simplificación: retorna todas por ahora. La lógica de filtrado por usuario se añadirá después.
        return ResponseEntity.ok(ApiResponse.success(List.of()));
    }

```

Si `Authentication` (import `org.springframework.security.core.Authentication`) queda sin otro uso en el fichero, eliminar también ese import.

- [ ] **Step 4: Eliminar `getMyReservations` de `reservationService.js` (frontend)**

En `restaurante-frontend/src/services/reservationService.js`, quitar (líneas 89-99):

```js
/**
 * Obtiene las reservas del usuario autenticado (cliente).
 */
export const getMyReservations = async () => {
  try {
    const response = await api.get(`${RESOURCE}/my`);
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};

```

- [ ] **Step 5: Ejecutar la suite backend y el lint frontend**

Run: `cd restaurante_manage && mvn test`
Expected: `BUILD SUCCESS`, 29 tests, 0 fallos.

Run: `cd restaurante-frontend && pnpm lint`
Expected: sin errores (sin referencias colgantes a `getMyReservations`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(reservation): eliminar queries sin uso y endpoint /reservations/my sin implementar"
```

---

## Task 3: Backend — Corregir el bug de disponibilidad pública (alinear con RES-03)

**Contexto:** `AvailabilityService.checkAvailability()` solo excluye mesas con reservas `CONFIRMED` (`findConfirmedByTableIdAndDateAndTime`), pero la regla real de solape usada al crear/confirmar reservas (`ReservationService`, RES-03) también bloquea por `PENDING` (`findActiveConflicts`). Resultado: la web pública puede mostrar como libre una mesa que el backend rechazará al reservar. Se corrige reutilizando `findActiveConflicts`, y el método `findConfirmedByTableIdAndDateAndTime` (que queda sin otro caller) se elimina.

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/availability/service/AvailabilityService.java:56-59`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java:75-84`
- Create: `restaurante_manage/src/test/java/com/restaurante/availability/service/AvailabilityServiceTest.java`

**Interfaces:**
- Consumes: `ReservationRepository.findActiveConflicts(Long tableId, LocalDate date, LocalTime time, Long excludeId)` — ya existe, firma sin cambios, se le pasa `excludeId = null`.
- Produces: `AvailabilityService.checkAvailability(AvailabilityRequest)` sigue devolviendo `List<AvailableTableResponse>`, sin cambio de firma — solo cambia qué mesas se consideran ocupadas.

- [ ] **Step 1: Escribir el test que reproduce el bug (debe fallar con el código actual)**

Crear `restaurante_manage/src/test/java/com/restaurante/availability/service/AvailabilityServiceTest.java`:

```java
package com.restaurante.availability.service;

import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AvailabilityServiceTest {

    private static final Long RESTAURANT_ID = 1L;
    private static final Long TABLE_ID = 10L;
    private static final LocalDate DATE = LocalDate.of(2026, 12, 31);
    private static final LocalTime TIME = LocalTime.of(21, 0);

    @Mock private DiningTableRepository diningTableRepository;
    @Mock private ReservationRepository reservationRepository;

    @InjectMocks private AvailabilityService service;

    private DiningTable table;

    @BeforeEach
    void setUp() {
        table = new DiningTable();
        table.setId(TABLE_ID);
        table.setTableNumber("1");
        table.setCapacity(4);
        table.setStatus(TableStatus.AVAILABLE);

        when(diningTableRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(table));
    }

    private AvailabilityRequest request() {
        return new AvailabilityRequest(RESTAURANT_ID, DATE, TIME, 2);
    }

    @Test
    void checkAvailability_excluyeMesaConReservaPendienteEnElMismoHueco() {
        // Reserva PENDING (RES-03 la considera activa) en ese hueco
        Reservation pendiente = new Reservation();
        pendiente.setId(99L);
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, null))
                .thenReturn(List.of(pendiente));

        List<AvailableTableResponse> result = service.checkAvailability(request());

        assertTrue(result.isEmpty(),
                "Una mesa con una reserva PENDING en el mismo hueco no debe aparecer como disponible");
    }

    @Test
    void checkAvailability_incluyeMesaSinConflictosActivos() {
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, null))
                .thenReturn(List.of());

        List<AvailableTableResponse> result = service.checkAvailability(request());

        assertEquals(1, result.size());
        assertEquals(TABLE_ID, result.get(0).getTableId());
    }
}
```

- [ ] **Step 2: Ejecutar el test nuevo y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=AvailabilityServiceTest`
Expected: `checkAvailability_excluyeMesaConReservaPendienteEnElMismoHueco` FALLA (el código actual usa `findConfirmedByTableIdAndDateAndTime`, que el mock no ha stubbeado, así que el mock de Mockito con `MockitoExtension` estricto lanzará `UnnecessaryStubbingException` o el resultado incluirá la mesa igualmente porque el stub configurado no coincide con la llamada real). El segundo test (`incluyeMesaSinConflictosActivos`) también falla por el mismo motivo de firma no invocada.

- [ ] **Step 3: Corregir `AvailabilityService.checkAvailability()`**

En `restaurante_manage/src/main/java/com/restaurante/availability/service/AvailabilityService.java`, reemplazar el filtro de conflictos (líneas 55-60):

```java
                // 3. Sin reservas CONFIRMED conflictivas en la misma fecha/hora
                .filter(table -> {
                    List<Reservation> conflicts = reservationRepository
                            .findConfirmedByTableIdAndDateAndTime(table.getId(), date, time);
                    return conflicts.isEmpty();
                })
```

por:

```java
                // 3. Sin reservas activas (PENDING o CONFIRMED) conflictivas — misma regla RES-03
                //    que usa ReservationService al crear/confirmar reservas.
                .filter(table -> {
                    List<Reservation> conflicts = reservationRepository
                            .findActiveConflicts(table.getId(), date, time, null);
                    return conflicts.isEmpty();
                })
```

También actualizar el Javadoc del método (líneas 27-35), cambiando:

```java
     * Una mesa está disponible si:
     * - NO está en estado MAINTENANCE
     * - Su capacidad es >= partySize
     * - NO tiene ninguna reserva CONFIRMED en la misma fecha y hora
     *
     * Las reservas PENDING, CANCELLED, COMPLETED y NO_SHOW NO bloquean disponibilidad.
```

por:

```java
     * Una mesa está disponible si:
     * - NO está en estado MAINTENANCE
     * - Su capacidad es >= partySize
     * - NO tiene ninguna reserva activa (PENDING o CONFIRMED) en la misma fecha y hora
     *   (misma regla RES-03 que aplica ReservationService al crear/confirmar reservas)
     *
     * Las reservas CANCELLED, COMPLETED y NO_SHOW NO bloquean disponibilidad.
```

- [ ] **Step 4: Eliminar `findConfirmedByTableIdAndDateAndTime`, ya sin caller**

Run: `grep -rn "findConfirmedByTableIdAndDateAndTime" restaurante_manage/src`
Expected: solo aparece la declaración en `ReservationRepository.java` (líneas 79-84 del fichero original).

En `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java`, eliminar:

```java
    /**
     * Encuentra reservas CONFIRMED para una mesa en una fecha y hora específicas.
     * Usado para verificar conflictos de disponibilidad.
     */
    @Query("SELECT r FROM Reservation r WHERE r.diningTable.id = :tableId " +
           "AND r.deleted = false AND r.status = 'CONFIRMED' " +
           "AND r.reservationDate = :date AND r.reservationTime = :time")
    List<Reservation> findConfirmedByTableIdAndDateAndTime(@Param("tableId") Long tableId,
                                                           @Param("date") LocalDate date,
                                                           @Param("time") LocalTime time);

```

- [ ] **Step 5: Ejecutar el test nuevo y confirmar que pasa**

Run: `cd restaurante_manage && mvn test -Dtest=AvailabilityServiceTest`
Expected: `BUILD SUCCESS`, 2 tests, 0 fallos.

- [ ] **Step 6: Ejecutar la suite completa**

Run: `cd restaurante_manage && mvn test`
Expected: `BUILD SUCCESS`, 31 tests (29 + 2 nuevos), 0 fallos.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "fix(availability): alinear disponibilidad pública con la regla RES-03 (PENDING también bloquea)"
```

---

## Task 4: Backend — Automatizar `fix-table-statuses` con un job programado

**Contexto:** `ReservationService.fixTableStatuses(null)` (rama "todos los restaurantes") no depende de `CurrentUserService` — es seguro invocarlo sin contexto HTTP/JWT. Hoy solo se ejecuta si alguien lo llama manualmente por Swagger/Postman. Se añade un `@Scheduled` que lo ejecuta cada 15 minutos; el endpoint manual (`POST /reservations/maintenance/fix-table-statuses`, admin-only) se mantiene intacto como red de seguridad para soporte.

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/RestaurantManageApplication.java`
- Modify: `restaurante_manage/src/main/resources/application.yml:56-60`
- Create: `restaurante_manage/src/main/java/com/restaurante/reservation/scheduler/TableStatusScheduler.java`
- Create: `restaurante_manage/src/test/java/com/restaurante/reservation/scheduler/TableStatusSchedulerTest.java`

**Interfaces:**
- Consumes: `ReservationService.fixTableStatuses(Long restaurantId)` — ya existe, se llama con `null`.
- Produces: `TableStatusScheduler.runScheduledFix()` — método público sin parámetros ni retorno, invocado por el contenedor Spring vía `@Scheduled`; también invocable directamente en tests.

- [ ] **Step 1: Escribir el test del scheduler (debe fallar: la clase no existe)**

Crear `restaurante_manage/src/test/java/com/restaurante/reservation/scheduler/TableStatusSchedulerTest.java`:

```java
package com.restaurante.reservation.scheduler;

import com.restaurante.reservation.service.ReservationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TableStatusSchedulerTest {

    @Mock private ReservationService reservationService;

    @InjectMocks private TableStatusScheduler scheduler;

    @Test
    void runScheduledFix_llamaAFixTableStatusesParaTodosLosRestaurantes() {
        when(reservationService.fixTableStatuses(null)).thenReturn(3);

        scheduler.runScheduledFix();

        verify(reservationService).fixTableStatuses(null);
    }
}
```

- [ ] **Step 2: Ejecutar el test y verificar que falla (no compila: `TableStatusScheduler` no existe)**

Run: `cd restaurante_manage && mvn test -Dtest=TableStatusSchedulerTest`
Expected: FALLA en compilación — `cannot find symbol: class TableStatusScheduler`.

- [ ] **Step 3: Crear `TableStatusScheduler`**

Crear `restaurante_manage/src/main/java/com/restaurante/reservation/scheduler/TableStatusScheduler.java`:

```java
package com.restaurante.reservation.scheduler;

import com.restaurante.reservation.service.ReservationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Corrige automáticamente los estados de mesa obsoletos (RESERVED sin
 * reserva CONFIRMED activa) para que nadie tenga que invocar el
 * mantenimiento manual desde Swagger.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class TableStatusScheduler {

    private final ReservationService reservationService;

    @Scheduled(fixedDelayString = "${app.maintenance.table-status-fix-delay-ms:900000}")
    public void runScheduledFix() {
        int fixed = reservationService.fixTableStatuses(null);
        if (fixed > 0) {
            log.info("[MANTENIMIENTO-AUTO] {} mesas corregidas automáticamente a AVAILABLE", fixed);
        }
    }
}
```

- [ ] **Step 4: Habilitar el scheduling en la aplicación**

En `restaurante_manage/src/main/java/com/restaurante/RestaurantManageApplication.java`, añadir `@EnableScheduling`:

```java
package com.restaurante;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class RestaurantManageApplication {

    public static void main(String[] args) {
        SpringApplication.run(RestaurantManageApplication.class, args);
    }
}
```

- [ ] **Step 5: Añadir el intervalo configurable a `application.yml`**

En `restaurante_manage/src/main/resources/application.yml`, dentro del bloque `app:` (tras `cors:`, líneas 57-60), añadir:

```yaml
  cors:
    # Orígenes permitidos, separados por comas. En producción define
    # CORS_ALLOWED_ORIGINS con el dominio real del frontend.
    allowed-origins: ${CORS_ALLOWED_ORIGINS:http://localhost:5173}
  maintenance:
    # Frecuencia (ms) del job que corrige mesas RESERVED sin reserva activa.
    # 900000 ms = 15 minutos.
    table-status-fix-delay-ms: ${TABLE_STATUS_FIX_DELAY_MS:900000}
```

- [ ] **Step 6: Ejecutar el test del scheduler y confirmar que pasa**

Run: `cd restaurante_manage && mvn test -Dtest=TableStatusSchedulerTest`
Expected: `BUILD SUCCESS`, 1 test, 0 fallos.

- [ ] **Step 7: Ejecutar la suite completa (incluye arranque de contexto con `@EnableScheduling`)**

Run: `cd restaurante_manage && mvn test`
Expected: `BUILD SUCCESS`, 32 tests (31 + 1 nuevo), 0 fallos. `RestaurantManageApplicationTests` (arranque de contexto) debe seguir pasando con el scheduling habilitado.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(reservation): automatizar fix-table-statuses con un job programado cada 15 min"
```

---

## Task 5: Frontend — Extraer `apiHelpers.js` y deduplicar `extractData`/`extractArray`

**Contexto:** La misma función `extractData`/`extractArray` (parseo de formatos de respuesta del backend) está copiada literalmente en 6 archivos de `src/services/`. Se extrae a un único módulo compartido.

**Files:**
- Create: `restaurante-frontend/src/lib/apiHelpers.js`
- Modify: `restaurante-frontend/src/services/restaurantService.js:1-57`
- Modify: `restaurante-frontend/src/services/tableService.js:1-59`
- Modify: `restaurante-frontend/src/services/customerService.js:1-36`
- Modify: `restaurante-frontend/src/services/employeeService.js:1-53`
- Modify: `restaurante-frontend/src/services/reservationService.js:1-39`
- Modify: `restaurante-frontend/src/services/floorPlanService.js:1-29`

**Interfaces:**
- Produces: `extractData(response)` y `extractArray(response)` (alias) desde `src/lib/apiHelpers.js`, mismo comportamiento que las 6 copias que sustituye (superset de la versión reducida que tenía `floorPlanService.js`, sin cambio de comportamiento observable).

- [ ] **Step 1: Crear `src/lib/apiHelpers.js`**

```js
/**
 * Extrae el array de datos de la respuesta del backend.
 * Soporta múltiples formatos:
 *   - Array directo:  [...]
 *   - Paginado:       { content: [...] }
 *   - Envoltorio:     { success: true, data: [...] }
 *   - Anidado:        { data: { content: [...] } }
 *   - Fallback:       []
 */
export const extractData = (response) => {
  if (!response || !response.data) {
    return [];
  }

  const body = response.data;

  if (Array.isArray(body)) {
    return body;
  }

  if (body && Array.isArray(body.content)) {
    return body.content;
  }

  if (body && body.success && Array.isArray(body.data)) {
    return body.data;
  }

  if (body && Array.isArray(body.data)) {
    return body.data;
  }

  if (body && body.data && Array.isArray(body.data.content)) {
    return body.data.content;
  }

  return [];
};

// Alias histórico: algunos módulos la llamaban extractArray.
export const extractArray = extractData;
```

- [ ] **Step 2: Migrar `restaurantService.js`**

Reemplazar el bloque de import + `extractData` local (líneas 1-57) por:

```js
import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const RESOURCE = '/restaurants';
```

(el resto del fichero, desde `export const getRestaurants = ...`, no cambia).

- [ ] **Step 3: Migrar `tableService.js`**

Reemplazar el bloque de import + `extractData` local (líneas 1-59) por:

```js
import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

// ─── Endpoints ──────────────────────────────────────────────────────────────
const TABLES_RESOURCE = '/tables';
const getRestaurantTablesEndpoint = (restaurantId) =>
  `/restaurants/${restaurantId}/tables`;
```

(el resto del fichero, desde `const handleError = ...`, no cambia).

- [ ] **Step 4: Migrar `customerService.js`**

Reemplazar el bloque de import + `extractData` local (líneas 1-36) por:

```js
import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const RESOURCE = '/customers';
```

(el resto del fichero, desde `const extractItem = ...`, no cambia — `extractItem` es lógica distinta por recurso, no se toca).

- [ ] **Step 5: Migrar `employeeService.js`**

Reemplazar el bloque de import + `extractData` local (líneas 1-53) por:

```js
import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const RESOURCE = '/employees';
```

(el resto del fichero, desde `const handleError = ...`, no cambia).

- [ ] **Step 6: Migrar `reservationService.js`**

Reemplazar el bloque de import + `extractData` local (líneas 1-39) por:

```js
import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const RESOURCE = '/reservations';
```

(el resto del fichero, desde `const extractItem = ...`, no cambia).

- [ ] **Step 7: Migrar `floorPlanService.js`**

Reemplazar el bloque de import + `extractData` local (líneas 1-29) por:

```js
import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

// ─── Endpoints ──────────────────────────────────────────────────────────────
const getElementsEndpoint = (restaurantId) =>
  `/restaurants/${restaurantId}/floor-plan/elements`;
```

(el resto del fichero, desde `const handleError = ...`, no cambia; la versión compartida de `extractData` es un superset de la reducida que tenía este fichero, así que el comportamiento observado no cambia).

- [ ] **Step 8: Lint**

Run: `cd restaurante-frontend && pnpm lint`
Expected: sin errores (sin `extractData` declarada y no usada, sin imports rotos).

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "refactor(frontend): extraer extractData/extractArray a src/lib/apiHelpers.js"
```

---

## Task 6: Frontend — Hook compartido `useAllTables`

**Contexto:** El patrón "cargar restaurantes → por cada uno `GET /restaurants/{id}/tables` → `flatMap`" (no existe endpoint global de mesas) está triplicado en `Dashboard.jsx`, `Analytics.jsx` y `NotificationContext.jsx`. Se extrae a un hook único que usará `Inicio.jsx` (Tarea 7); los otros dos puntos desaparecen en tareas posteriores.

**Files:**
- Create: `restaurante-frontend/src/hooks/useAllTables.js`

**Interfaces:**
- Consumes: `getRestaurants()` de `src/services/restaurantService.js`; `api` (cliente axios) de `src/api/axios.js`; `extractArray` de `src/lib/apiHelpers.js` (Tarea 5).
- Produces: `useAllTables()` → `{ restaurants: Array, tables: Array, loading: boolean, error: string|null, refetch: () => Promise<void> }`. Usado por `Inicio.jsx` en la Tarea 7.

- [ ] **Step 1: Crear `src/hooks/useAllTables.js`**

```js
import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import { getRestaurants } from '../services/restaurantService';
import { extractArray } from '../lib/apiHelpers';

/**
 * Carga los restaurantes visibles y, para cada uno, sus mesas
 * (no existe un endpoint global GET /tables).
 */
export const useAllTables = () => {
  const [restaurants, setRestaurants] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const fetchedRestaurants = await getRestaurants();
      const restaurantList = Array.isArray(fetchedRestaurants) ? fetchedRestaurants : [];
      setRestaurants(restaurantList);

      if (restaurantList.length === 0) {
        setTables([]);
        return;
      }

      const promises = restaurantList.map((r) =>
        api.get(`/restaurants/${r.id}/tables`)
          .then((res) => extractArray(res))
          .catch(() => [])
      );
      const results = await Promise.allSettled(promises);
      const fetchedTables = results.flatMap(
        (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [])
      );
      setTables(fetchedTables);
    } catch (err) {
      setError(err?.message || 'Error al cargar las mesas.');
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();
  }, [fetchAll]);

  return { restaurants, tables, loading, error, refetch: fetchAll };
};
```

- [ ] **Step 2: Lint**

Run: `cd restaurante-frontend && pnpm lint`
Expected: sin errores. (El hook aún no tiene consumidores hasta la Tarea 7 — eso es esperado, no hay warning de "unused export" en este proyecto).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(frontend): añadir hook useAllTables para dedupe del patrón restaurantes->mesas"
```

---

## Task 7: Frontend — Crear `Inicio.jsx` (fusión de Dashboard + Analítica + atención ampliada)

**Contexto:** Fusiona el contenido operativo de `Dashboard.jsx` (KPIs, agenda, requiere atención) con el contenido de tendencias de `Analytics.jsx` (selector de periodo/restaurante, gráficos, rankings, insights) en una sola página. La sección "Tendencias" se gatea con el permiso `VIEW_ANALYTICS` (EMPLOYEE no la ve, igual que hoy). "Requiere atención" gana dos avisos nuevos (ocupación crítica, sin mesas disponibles) que antes solo vivían en el sistema de notificaciones decorativo — sin necesidad de importar ese sistema, se calculan igual que el resto de avisos de esta misma sección.

Esta tarea **crea** el fichero nuevo; no borra `Dashboard.jsx`/`Analytics.jsx` ni toca rutas todavía (eso es la Tarea 8), para poder revisar el componente de forma aislada primero.

**Files:**
- Create: `restaurante-frontend/src/pages/Inicio.jsx`

**Interfaces:**
- Consumes: `useAllTables()` (Tarea 6), `getReservations()` de `reservationService.js`, `getCustomers()` de `customerService.js`, `filterPendingReservations`/`filterTodayConfirmedReservations`/`filterReservationsWithoutTable`/`getLocalTodayString` de `src/lib/reservationHelpers.js` (ya existen, sin cambios), `useAuth()` de `src/context/AuthContext.jsx`, `canAccess`/`PERMISSIONS` de `src/config/permissions.js`.
- Produces: `export default Inicio` — componente de página sin props, montado en la ruta `/inicio` en la Tarea 8.

- [ ] **Step 1: Crear `src/pages/Inicio.jsx`**

```jsx
import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getReservations } from '../services/reservationService';
import { getCustomers } from '../services/customerService';
import { useAllTables } from '../hooks/useAllTables';
import { useAuth } from '../context/AuthContext';
import { canAccess, PERMISSIONS } from '../config/permissions';
import {
  filterPendingReservations,
  filterTodayConfirmedReservations,
  filterReservationsWithoutTable,
  getLocalTodayString,
} from '../lib/reservationHelpers';

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS COMPARTIDOS
// ═══════════════════════════════════════════════════════════════════════════

const formatTime = (timeStr) => {
  if (!timeStr) return '—';
  return String(timeStr).substring(0, 5);
};

const getCustomerDisplay = (r) => {
  if (r.customer) {
    const c = r.customer;
    if (c.name) return c.name;
    if (c.firstName || c.lastName) return `${c.firstName || ''} ${c.lastName || ''}`.trim();
  }
  if (r.customerName) return r.customerName;
  return `#${r.customerId || '?'}`;
};

const getTableDisplay = (r, tables) => {
  if (r.diningTable && r.diningTable.tableNumber) return `Mesa ${r.diningTable.tableNumber}`;
  if (r.table && r.table.tableNumber) return `Mesa ${r.table.tableNumber}`;
  if (r.diningTableId) {
    const found = tables.find((t) => t.id === r.diningTableId);
    if (found) return `Mesa ${found.tableNumber}`;
  }
  return 'Sin mesa asignada';
};

const STATUS_LABELS = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  COMPLETED: 'Completada',
  NO_SHOW: 'No presentado',
};

// ─── Helpers de la sección Tendencias (antes en Analytics.jsx) ─────────────

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const getPeriodBounds = (period) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end;

  switch (period) {
    case 'today': {
      start = today;
      end = new Date(today);
      end.setDate(end.getDate() + 1);
      break;
    }
    case 'week': {
      start = new Date(today);
      const dayOfWeek = start.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      start.setDate(start.getDate() - diff);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      break;
    }
    case 'month':
    default: {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      break;
    }
  }

  return { start, end };
};

const getCustomerName = (r) => {
  if (r.customer) {
    const c = r.customer;
    if (c.name) return c.name;
    if (c.firstName || c.lastName) return `${c.firstName || ''} ${c.lastName || ''}`.trim();
  }
  if (r.customerName) return r.customerName;
  return null;
};

const getTableNumber = (r) => {
  if (r.diningTable && r.diningTable.tableNumber) return r.diningTable.tableNumber;
  if (r.table && r.table.tableNumber) return r.table.tableNumber;
  if (r.diningTableId) return `Mesa #${r.diningTableId}`;
  return null;
};

const formatNum = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '0';
  return String(Math.round(n));
};

const formatPercent = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '0%';
  return `${Math.round(n)}%`;
};

const safeText = (value, fallback = '—') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isNaN(value)) return fallback;
  if (typeof value === 'object') return fallback;
  return String(value);
};

const BarChart = ({ data, labelKey, valueKey, barClass = 'analytics-bar-fill' }) => (
  <div className="analytics-chart-bars">
    {data.map((item, idx) => (
      <div key={idx} className="analytics-bar-row">
        <span className="analytics-bar-label">{item[labelKey]}</span>
        <div className="analytics-bar-track">
          <div className={barClass} style={{ width: `${item.percent || 0}%` }} />
        </div>
        <span className="analytics-bar-value">{item[valueKey]}</span>
      </div>
    ))}
    {data.length === 0 && <div className="analytics-empty-chart">Sin datos</div>}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

const Inicio = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canViewTrends = canAccess(user, PERMISSIONS.VIEW_ANALYTICS);

  const { restaurants, tables, loading: tablesLoading, error: tablesError, refetch: refetchTables } = useAllTables();
  const [reservations, setReservations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [partialError, setPartialError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Selectores de la sección Tendencias
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('week');

  const todayStr = getLocalTodayString();

  // ─── Carga de reservas y clientes (las mesas las gestiona useAllTables) ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [reservationsRes, customersRes] = await Promise.allSettled([
        getReservations(),
        getCustomers(),
      ]);

      const fetchedReservations =
        reservationsRes.status === 'fulfilled' && Array.isArray(reservationsRes.value)
          ? reservationsRes.value
          : [];
      const fetchedCustomers =
        customersRes.status === 'fulfilled' && Array.isArray(customersRes.value)
          ? customersRes.value
          : [];

      setReservations(fetchedReservations);
      setCustomers(fetchedCustomers);
      await refetchTables();

      if (reservationsRes.status !== 'fulfilled') {
        setPartialError('Algunas fuentes de datos no respondieron. Los datos pueden estar incompletos.');
      } else {
        setPartialError(null);
      }
    } catch (err) {
      setError(err?.message || 'Error al cargar los datos de Inicio.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setLastUpdate(new Date());
    }
  }, [refetchTables]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refrescar al volver a la pestaña y cada 60s
  useEffect(() => {
    let mounted = true;
    const handleRefresh = () => {
      if (mounted) {
        setIsRefreshing(true);
        fetchData();
      }
    };
    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handleRefresh();
    });
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setIsRefreshing(true);
        fetchData();
      }
    }, 60000);
    return () => {
      mounted = false;
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
      clearInterval(interval);
    };
  }, [fetchData]);

  // Seleccionar primer restaurante por defecto para Tendencias
  useEffect(() => {
    if (!selectedRestaurantId && restaurants.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRestaurantId(String(restaurants[0].id));
    }
  }, [restaurants, selectedRestaurantId]);

  const safeTables = useMemo(() => (Array.isArray(tables) ? tables : []), [tables]);
  const safeReservations = useMemo(() => (Array.isArray(reservations) ? reservations : []), [reservations]);

  // ═══════════════════════════════════════════════════════════════════════
  //  SECCIÓN OPERATIVA (KPIs, agenda, requiere atención)
  // ═══════════════════════════════════════════════════════════════════════

  const pendingReservations = useMemo(
    () => filterPendingReservations(safeReservations),
    [safeReservations]
  );

  const occupiedCount = safeTables.filter((t) => t.status === 'OCCUPIED').length;
  const reservedTablesCount = safeTables.filter((t) => t.status === 'RESERVED').length;
  const availableTablesCount = safeTables.filter((t) => t.status === 'AVAILABLE').length;
  const outOfServiceCount = safeTables.filter((t) => t.status === 'MAINTENANCE').length;
  const totalTables = safeTables.length;

  const occupiedPercent =
    totalTables > 0 ? Math.round(((occupiedCount + reservedTablesCount) / totalTables) * 100) : 0;
  const highOccupancy = totalTables > 0 && occupiedPercent > 80;
  const noTablesAvailable = totalTables > 0 && availableTablesCount === 0;

  const todayConfirmedReservations = useMemo(
    () => filterTodayConfirmedReservations(safeReservations),
    [safeReservations]
  );

  const nextReservation = useMemo(() => {
    const sorted = [...todayConfirmedReservations]
      .filter((r) => r.status === 'CONFIRMED')
      .sort((a, b) => (a.reservationTime || '').localeCompare(b.reservationTime || ''));
    return sorted[0] || null;
  }, [todayConfirmedReservations]);

  const urgentReservations = useMemo(() => {
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    return safeReservations.filter((r) => {
      if (r.status !== 'CONFIRMED') return false;
      const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      if (rd !== todayStr) return false;
      const time = r.reservationTime || '';
      const [h, m] = time.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return false;
      const totalMin = h * 60 + m;
      const diff = totalMin - currentMin;
      return diff > 0 && diff <= 60;
    });
  }, [safeReservations, todayStr]);

  const unassignedTableReservations = useMemo(
    () => filterReservationsWithoutTable(safeReservations),
    [safeReservations]
  );

  const renderStatusBadge = (status) => {
    const label = STATUS_LABELS[status] || status || '—';
    const cls = (status || '').toLowerCase();
    return <span className={`badge-status ${cls}`}>{label}</span>;
  };

  const noAttentionItems =
    pendingReservations.length === 0 &&
    outOfServiceCount === 0 &&
    urgentReservations.length === 0 &&
    unassignedTableReservations.length === 0 &&
    !highOccupancy &&
    !noTablesAvailable;

  // ═══════════════════════════════════════════════════════════════════════
  //  SECCIÓN TENDENCIAS (antes Analytics.jsx) — solo se calcula/renderiza
  //  si el usuario tiene permiso VIEW_ANALYTICS.
  // ═══════════════════════════════════════════════════════════════════════

  const filteredReservations = useMemo(() => {
    const { start, end } = getPeriodBounds(selectedPeriod);
    return safeReservations.filter((r) => {
      if (selectedRestaurantId) {
        const rid = r.restaurantId ? String(r.restaurantId) : '';
        if (rid !== selectedRestaurantId) return false;
      }
      const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      if (!rd) return false;
      const d = new Date(rd + 'T00:00:00');
      return d >= start && d < end;
    });
  }, [safeReservations, selectedRestaurantId, selectedPeriod]);

  const metrics = useMemo(() => {
    const total = filteredReservations.length;
    const confirmed = filteredReservations.filter((r) => r.status === 'CONFIRMED').length;
    const cancelled = filteredReservations.filter((r) => r.status === 'CANCELLED').length;
    const pending = filteredReservations.filter((r) => r.status === 'PENDING').length;
    const completed = filteredReservations.filter((r) => r.status === 'COMPLETED').length;
    const cancellationRate = total > 0 ? (cancelled / total) * 100 : 0;

    const newCustomers = Array.isArray(customers)
      ? customers.filter((c) =>
          filteredReservations.some((r) => {
            const cid = r.customerId || r.customer?.id;
            return cid && String(cid) === String(c.id);
          })
        ).length
      : 0;

    const tablesInRestaurant = selectedRestaurantId
      ? safeTables.filter((t) => String(t.restaurantId) === selectedRestaurantId)
      : safeTables;
    const totalTablesForMetrics = tablesInRestaurant.length;
    const occupiedTables = tablesInRestaurant.filter(
      (t) => t.status === 'OCCUPIED' || t.status === 'RESERVED'
    ).length;
    const estimatedOccupancy = totalTablesForMetrics > 0 ? (occupiedTables / totalTablesForMetrics) * 100 : 0;

    return {
      total, confirmed, cancelled, pending, completed,
      cancellationRate, newCustomers, estimatedOccupancy,
      totalTables: totalTablesForMetrics,
    };
  }, [filteredReservations, customers, safeTables, selectedRestaurantId]);

  const reservationsByDay = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    filteredReservations.forEach((r) => {
      const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      if (rd) {
        const d = new Date(rd + 'T00:00:00');
        counts[d.getDay()]++;
      }
    });
    const maxVal = Math.max(...counts, 1);
    return counts.map((count, idx) => ({
      day: DAY_NAMES[idx],
      dayShort: DAY_NAMES_SHORT[idx],
      count,
      percent: maxVal > 0 ? (count / maxVal) * 100 : 0,
    }));
  }, [filteredReservations]);

  const peakHours = useMemo(() => {
    const hourCounts = {};
    filteredReservations.forEach((r) => {
      const time = r.reservationTime ? String(r.reservationTime).substring(0, 5) : '';
      if (time) {
        const hour = time.substring(0, 2);
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
    });
    const entries = Object.entries(hourCounts)
      .map(([hour, count]) => ({ hour: `${hour}:00`, hourNum: parseInt(hour, 10), count }))
      .sort((a, b) => a.hourNum - b.hourNum);
    const maxVal = Math.max(...entries.map((e) => e.count), 1);
    return entries.map((e) => ({ ...e, percent: (e.count / maxVal) * 100 }));
  }, [filteredReservations]);

  const topTables = useMemo(() => {
    const tableCounts = {};
    filteredReservations.forEach((r) => {
      const tableId = r.diningTableId;
      if (!tableId) return;
      const tableNum = getTableNumber(r);
      const key = tableNum || `Mesa #${tableId}`;
      if (!tableCounts[key]) tableCounts[key] = { name: key, count: 0, id: tableId };
      tableCounts[key].count++;
    });
    return Object.values(tableCounts).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filteredReservations]);

  const topCustomers = useMemo(() => {
    const customerCounts = {};
    filteredReservations.forEach((r) => {
      const cId = r.customerId || r.customer?.id;
      if (!cId) return;
      const name = getCustomerName(r) || `Cliente #${cId}`;
      if (!customerCounts[cId]) customerCounts[cId] = { name, count: 0, id: cId };
      customerCounts[cId].count++;
      const betterName = getCustomerName(r);
      if (betterName) customerCounts[cId].name = betterName;
    });
    return Object.values(customerCounts).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filteredReservations]);

  const insights = useMemo(() => {
    const list = [];
    const maxDay = [...reservationsByDay].sort((a, b) => b.count - a.count)[0];
    if (maxDay && maxDay.count > 0) {
      const minDay = [...reservationsByDay].filter((d) => d.count > 0).sort((a, b) => a.count - b.count)[0];
      if (maxDay.count > (minDay?.count || 0)) {
        list.push({ icon: '📈', text: `El día con más reservas es el ${maxDay.day} (${maxDay.count} reservas).` });
      } else {
        list.push({ icon: '📊', text: 'La actividad es constante todos los días de la semana.' });
      }
    }
    if (peakHours.length > 0) {
      const maxHour = peakHours.reduce((a, b) => (a.count > b.count ? a : b), peakHours[0]);
      if (maxHour && maxHour.count >= 2) {
        const hourInt = parseInt(maxHour.hour, 10);
        const nextHour = hourInt + 1;
        list.push({
          icon: '⏰',
          text: `La hora punta se concentra entre las ${String(hourInt).padStart(2, '0')}:00 y las ${String(nextHour).padStart(2, '0')}:00 (${maxHour.count} reservas).`,
        });
      }
    }
    if (metrics.total > 0) {
      if (metrics.cancellationRate < 10) {
        list.push({ icon: '✅', text: `La tasa de cancelación es baja (${formatPercent(metrics.cancellationRate)}). Los clientes cumplen con sus reservas.` });
      } else if (metrics.cancellationRate < 25) {
        list.push({ icon: '⚠️', text: `La tasa de cancelación es del ${formatPercent(metrics.cancellationRate)}. Considera recordar las reservas a los clientes.` });
      } else {
        list.push({ icon: '🔴', text: `La tasa de cancelación es alta (${formatPercent(metrics.cancellationRate)}). Revisa tus políticas de cancelación.` });
      }
    }
    if (topTables.length > 0) {
      list.push({ icon: '🪑', text: `La ${topTables[0].name} es la más solicitada con ${topTables[0].count} reservas.` });
    }
    if (topCustomers.length > 0) {
      list.push({ icon: '⭐', text: `${topCustomers[0].name} es el cliente más frecuente con ${topCustomers[0].count} visitas en este periodo.` });
    }
    if (metrics.estimatedOccupancy > 0) {
      if (metrics.estimatedOccupancy > 80) {
        list.push({ icon: '📊', text: `La ocupación estimada es alta (${formatPercent(metrics.estimatedOccupancy)}). Considera expandir tu capacidad.` });
      } else if (metrics.estimatedOccupancy < 30) {
        list.push({ icon: '📊', text: `La ocupación estimada es baja (${formatPercent(metrics.estimatedOccupancy)}). Podrías lanzar promociones.` });
      }
    }
    if (metrics.total === 0) {
      list.push({ icon: 'ℹ️', text: 'No hay suficientes datos para generar insights en este periodo.' });
    }
    return list;
  }, [reservationsByDay, peakHours, metrics, topTables, topCustomers]);

  const trendsNoData = canViewTrends && !loading && !error && filteredReservations.length === 0;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="exec-dashboard">
      {/* ═══ HEADER ═══ */}
      <div className="exec-header">
        <div>
          <h1 className="exec-header-title">Inicio</h1>
          <p className="exec-header-subtitle">
            {loading
              ? 'Cargando...'
              : `Resumen operativo del día — ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
          </p>
        </div>
        <div className="exec-header-actions">
          {lastUpdate && (
            <span className="exec-update-time">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            className="exec-refresh-btn"
            onClick={() => { setIsRefreshing(true); fetchData(); }}
            type="button"
            title="Actualizar datos"
            aria-label="Actualizar datos de Inicio"
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ═══ ALERTAS ═══ */}
      {(error || tablesError) && (
        <div className="exec-alert exec-alert-error" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span className="flex-grow-1">{error || tablesError}</span>
          <button className="exec-alert-btn" onClick={fetchData} type="button">Reintentar</button>
        </div>
      )}
      {partialError && !error && !tablesError && (
        <div className="exec-alert exec-alert-warning" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          <span className="flex-grow-1">{partialError}</span>
        </div>
      )}

      {/* ═══ LOADING ═══ */}
      {(loading || tablesLoading) && (
        <div className="exec-loading">
          <div className="spinner-border mb-3" role="status" style={{ width: '2rem', height: '2rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="mb-0" style={{ color: 'var(--text-secondary)' }}>Cargando datos de Inicio...</p>
        </div>
      )}

      {/* ═══ CONTENIDO OPERATIVO ═══ */}
      {!loading && !tablesLoading && (
        <>
          <div className="exec-kpi-grid">
            <div className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver reservas de hoy">
              <div className="exec-kpi-icon" style={{ color: 'var(--info, #06b6d4)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value">{todayConfirmedReservations.length}</span>
                <span className="exec-kpi-label">Reservas hoy</span>
                <span className="exec-kpi-trend">Confirmadas</span>
              </div>
            </div>

            <div className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver solicitudes pendientes">
              <div className="exec-kpi-icon" style={{ color: 'var(--warning)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value">{pendingReservations.length}</span>
                <span className="exec-kpi-label">Solicitudes pendientes</span>
                <span className="exec-kpi-trend">{pendingReservations.length === 1 ? 'Requiere atención' : 'Requieren atención'}</span>
              </div>
            </div>

            <div className="exec-kpi" onClick={() => navigate('/floor-plan')} title="Ver plano de sala">
              <div className="exec-kpi-icon" style={{ color: 'var(--violet, #8b5cf6)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value" style={{ fontSize: '1.75rem' }}>{totalTables > 0 ? `${occupiedPercent}%` : '—'}</span>
                <span className="exec-kpi-label">Estado de sala</span>
                <span className="exec-kpi-trend" style={{ color: occupiedPercent > 75 ? 'var(--danger)' : occupiedPercent > 50 ? 'var(--warning)' : 'var(--success)' }}>
                  {availableTablesCount} disponibles &middot; {reservedTablesCount} reservadas &middot; {occupiedCount} ocupadas
                </span>
              </div>
            </div>

            <div className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver próximas reservas">
              <div className="exec-kpi-icon" style={{ color: 'var(--primary)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-label" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>Próxima reserva</span>
                <span className="exec-kpi-value" style={{ fontSize: '1rem', fontWeight: 600 }}>{nextReservation ? formatTime(nextReservation.reservationTime) : '—'}</span>
                <span className="exec-kpi-trend">{nextReservation ? getCustomerDisplay(nextReservation) : 'Sin reservas confirmadas'}</span>
              </div>
            </div>
          </div>

          <div className="exec-two-col-wide">
            <div className="exec-card agenda-card">
              <div className="exec-card-header">
                <h3>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                  Agenda de hoy
                </h3>
                {todayConfirmedReservations.length > 5 && (
                  <button className="exec-card-action" onClick={() => navigate('/reservations')} type="button">
                    Ver todas
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                )}
              </div>
              <div className="exec-card-body" style={{ padding: 0 }}>
                {todayConfirmedReservations.length === 0 ? (
                  <div className="exec-empty">
                    <div className="exec-empty-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                    </div>
                    <p>No hay reservas confirmadas para hoy.</p>
                  </div>
                ) : (
                  <div className="exec-upcoming-list">
                    {[...todayConfirmedReservations]
                      .sort((a, b) => (a.reservationTime || '').localeCompare(b.reservationTime || ''))
                      .slice(0, 5)
                      .map((r, idx) => (
                        <div key={r.id || idx} className="exec-upcoming-item" onClick={() => navigate('/reservations')}>
                          <div className="exec-upcoming-time"><span className="exec-upcoming-time-value">{formatTime(r.reservationTime)}</span></div>
                          <div className="exec-upcoming-info">
                            <div className="exec-upcoming-client">{getCustomerDisplay(r)}</div>
                            <div className="exec-upcoming-meta">
                              <span>{r.partySize || '?'} {r.partySize === 1 ? 'persona' : 'personas'}</span>
                              <span className="exec-dot" />
                              <span>{getTableDisplay(r, safeTables)}</span>
                            </div>
                          </div>
                          <div className="exec-upcoming-status">{renderStatusBadge(r.status)}</div>
                        </div>
                      ))}
                  </div>
                )}
                {todayConfirmedReservations.length > 5 && (
                  <div className="exec-card-footer-link" onClick={() => navigate('/reservations')}>
                    Ver todas las {todayConfirmedReservations.length} reservas de hoy
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                )}
              </div>
            </div>

            <div className="exec-card attention-card">
              <div className="exec-card-header">
                <h3>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  Requiere atención
                </h3>
              </div>
              <div className="exec-card-body">
                {noAttentionItems ? (
                  <div className="exec-attention-empty">
                    <div className="exec-attention-empty-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    </div>
                    <p className="exec-attention-empty-title">Todo en orden</p>
                    <p className="exec-attention-empty-sub">No hay solicitudes pendientes ni incidencias.</p>
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {pendingReservations.length > 0 && (
                      <div className="exec-attention-item" onClick={() => navigate('/reservations')}>
                        <div className="exec-attention-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">{pendingReservations.length} {pendingReservations.length === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}</span></div>
                        <span className="exec-attention-badge">{pendingReservations.length}</span>
                      </div>
                    )}
                    {unassignedTableReservations.length > 0 && (
                      <div className="exec-attention-item" onClick={() => navigate('/reservations')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><path d="M9 3v18" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">{unassignedTableReservations.length} {unassignedTableReservations.length === 1 ? 'reserva sin mesa asignada' : 'reservas sin mesa asignada'}</span></div>
                        <span className="exec-attention-badge" style={{ background: 'var(--warning)', color: '#fff' }}>{unassignedTableReservations.length}</span>
                      </div>
                    )}
                    {outOfServiceCount > 0 && (
                      <div className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">{outOfServiceCount} {outOfServiceCount === 1 ? 'mesa en mantenimiento' : 'mesas en mantenimiento'}</span></div>
                        <span className="exec-attention-badge" style={{ background: 'var(--danger)', color: '#fff' }}>{outOfServiceCount}</span>
                      </div>
                    )}
                    {highOccupancy && (
                      <div className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">Ocupación crítica ({occupiedPercent}%)</span></div>
                        <span className="exec-attention-time">Ahora</span>
                      </div>
                    )}
                    {noTablesAvailable && (
                      <div className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">Sin mesas disponibles</span></div>
                        <span className="exec-attention-time">Ahora</span>
                      </div>
                    )}
                    {urgentReservations.map((r, idx) => (
                      <div key={r.id || `urg-${idx}`} className="exec-attention-item" onClick={() => navigate('/reservations')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--primary)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">Reserva a las {formatTime(r.reservationTime)} &mdash; {getCustomerDisplay(r)}</span></div>
                        <span className="exec-attention-time">Pronto</span>
                      </div>
                    ))}
                    <div className="exec-attention-actions">
                      {(pendingReservations.length > 0 || unassignedTableReservations.length > 0) && (
                        <button className="exec-attention-btn" onClick={() => navigate('/reservations')} type="button">Gestionar solicitudes</button>
                      )}
                      {(outOfServiceCount > 0 || highOccupancy || noTablesAvailable) && (
                        <button className="exec-attention-btn" onClick={() => navigate('/floor-plan')} type="button">Ir al plano</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ SECCIÓN TENDENCIAS (solo con permiso VIEW_ANALYTICS) ═══ */}
      {canViewTrends && !loading && !tablesLoading && (
        <div className="analytics-page" style={{ marginTop: '1.5rem' }}>
          <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
            <div>
              <h2>Tendencias</h2>
              <p className="page-description">Estadísticas y rendimiento de tu negocio</p>
            </div>
            <div className="d-flex align-items-center gap-3 flex-wrap">
              <div className="analytics-selector-group">
                <label htmlFor="trends-restaurant" className="analytics-selector-label">Restaurante</label>
                <select
                  id="trends-restaurant"
                  className="form-select form-select-sm"
                  value={selectedRestaurantId}
                  onChange={(e) => setSelectedRestaurantId(e.target.value)}
                  aria-label="Seleccionar restaurante"
                  style={{ minWidth: '160px' }}
                >
                  <option value="">Todos los restaurantes</option>
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>{r.name || 'No disponible'}</option>
                  ))}
                </select>
              </div>
              <div className="analytics-selector-group">
                <label htmlFor="trends-period" className="analytics-selector-label">Periodo</label>
                <select
                  id="trends-period"
                  className="form-select form-select-sm"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  aria-label="Seleccionar periodo"
                  style={{ minWidth: '130px' }}
                >
                  <option value="today">Hoy</option>
                  <option value="week">Esta semana</option>
                  <option value="month">Este mes</option>
                </select>
              </div>
            </div>
          </div>

          {trendsNoData && (
            <div className="app-card">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                </div>
                <h5>Sin datos suficientes para este periodo</h5>
                <p>No hay reservas registradas en el periodo y restaurante seleccionados. Prueba con otro período o restaurante.</p>
              </div>
            </div>
          )}

          {!trendsNoData && filteredReservations.length > 0 && (
            <>
              <div className="analytics-kpi-grid">
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatNum(metrics.total)}</span><span className="analytics-kpi-label">Reservas totales</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatNum(metrics.confirmed)}</span><span className="analytics-kpi-label">Confirmadas</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatNum(metrics.cancelled)}</span><span className="analytics-kpi-label">Canceladas</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatPercent(metrics.cancellationRate)}</span><span className="analytics-kpi-label">Tasa cancelación</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon cyan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatNum(metrics.newCustomers)}</span><span className="analytics-kpi-label">Clientes nuevos</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatPercent(metrics.estimatedOccupancy)}</span><span className="analytics-kpi-label">Ocupación estimada</span></div>
                </div>
              </div>

              <div className="analytics-two-col">
                <div className="analytics-card">
                  <div className="analytics-card-header"><h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>Reservas por día</h3></div>
                  <div className="analytics-card-body"><BarChart data={reservationsByDay} labelKey="dayShort" valueKey="count" barClass="analytics-bar-fill primary" /></div>
                </div>
                <div className="analytics-card">
                  <div className="analytics-card-header"><h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>Horas punta</h3></div>
                  <div className="analytics-card-body"><BarChart data={peakHours} labelKey="hour" valueKey="count" barClass="analytics-bar-fill warning" /></div>
                </div>
              </div>

              <div className="analytics-two-col">
                <div className="analytics-card">
                  <div className="analytics-card-header"><h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>Mesas más utilizadas</h3></div>
                  <div className="analytics-card-body">
                    {topTables.length === 0 ? (
                      <div className="analytics-empty-state">Sin datos suficientes</div>
                    ) : (
                      <div className="analytics-ranking">
                        {topTables.map((t, idx) => (
                          <div key={t.id || idx} className="analytics-ranking-item">
                            <span className="analytics-ranking-pos">{idx + 1}</span>
                            <div className="analytics-ranking-info">
                              <span className="analytics-ranking-name">{safeText(t.name)}</span>
                              <span className="analytics-ranking-count">{t.count} reserva{t.count !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="analytics-ranking-bar">
                              <div className="analytics-ranking-fill" style={{ width: `${(t.count / topTables[0].count) * 100}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="analytics-card">
                  <div className="analytics-card-header"><h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>Clientes recurrentes</h3></div>
                  <div className="analytics-card-body">
                    {topCustomers.length === 0 ? (
                      <div className="analytics-empty-state">Sin datos suficientes</div>
                    ) : (
                      <div className="analytics-ranking">
                        {topCustomers.map((c, idx) => (
                          <div key={c.id || idx} className="analytics-ranking-item">
                            <span className="analytics-ranking-pos">{idx + 1}</span>
                            <div className="analytics-ranking-info">
                              <span className="analytics-ranking-name">{safeText(c.name)}</span>
                              <span className="analytics-ranking-count">{c.count} visita{c.count !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="analytics-ranking-bar">
                              <div className="analytics-ranking-fill customer" style={{ width: `${(c.count / topCustomers[0].count) * 100}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="analytics-card">
                <div className="analytics-card-header">
                  <h3>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                    Insights inteligentes
                  </h3>
                </div>
                <div className="analytics-card-body">
                  {insights.length === 0 ? (
                    <div className="analytics-empty-state">Sin datos suficientes para generar insights</div>
                  ) : (
                    <div className="analytics-insights">
                      {insights.map((insight, idx) => (
                        <div key={idx} className="analytics-insight-item">
                          <span className="analytics-insight-icon">{insight.icon}</span>
                          <span className="analytics-insight-text">{insight.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Inicio;
```

- [ ] **Step 2: Lint**

Run: `cd restaurante-frontend && pnpm lint`
Expected: sin errores. (`Inicio.jsx` aún no está montado en ninguna ruta — eso ocurre en la Tarea 8 — así que no hay smoke visual todavía).

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "feat(frontend): crear Inicio.jsx fusionando Dashboard + Analítica + avisos ampliados"
```

---

## Task 8: Frontend — Cablear rutas/sidebar/permisos a `Inicio.jsx` y eliminar `Dashboard.jsx`/`Analytics.jsx`

**Files:**
- Modify: `restaurante-frontend/src/App.jsx`
- Modify: `restaurante-frontend/src/components/Sidebar.jsx:81-110,169-173`
- Modify: `restaurante-frontend/src/config/permissions.js`
- Delete: `restaurante-frontend/src/pages/Dashboard.jsx`
- Delete: `restaurante-frontend/src/pages/Analytics.jsx`

**Interfaces:**
- Consumes: `Inicio` de `src/pages/Inicio.jsx` (Tarea 7).
- Produces: `/inicio` es la única ruta real de la página de inicio; `/dashboard` y `/analytics` quedan como redirects a `/inicio`.

- [ ] **Step 1: Reescribir `App.jsx`**

```jsx
import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import PermissionRoute from './components/PermissionRoute';
import MainLayout from './layouts/MainLayout';
import PublicLayout from './layouts/PublicLayout';
import Login from './pages/Login';
import Inicio from './pages/Inicio';
import Customers from './pages/Customers';
import Employees from './pages/Employees';
import Reservations from './pages/Reservations';
import Restaurants from './pages/Restaurants';
import Tables from './pages/Tables';
import FloorPlan from './pages/FloorPlan';
import PublicReservation from './pages/PublicReservation';
import { PERMISSIONS } from './config/permissions';

function App() {
  return (
    <Routes>
      {/* Rutas públicas (sin autenticación) */}
      <Route path="/login" element={<Login />} />
      <Route element={<PublicLayout />}>
        <Route path="/public/reservar/:restaurantId" element={<PublicReservation />} />
        <Route path="/r/:restaurantId" element={<PublicReservation />} />
      </Route>

      {/* Rutas protegidas con layout */}
      <Route
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/inicio" element={<PermissionRoute permission={PERMISSIONS.VIEW_DASHBOARD}><Inicio /></PermissionRoute>} />

        {/* ── Operativa ── */}
        <Route path="/reservations" element={<PermissionRoute permission={PERMISSIONS.VIEW_RESERVATIONS}><Reservations /></PermissionRoute>} />
        <Route path="/floor-plan" element={<PermissionRoute permission={PERMISSIONS.VIEW_FLOOR_PLAN}><FloorPlan /></PermissionRoute>} />
        <Route path="/customers" element={<PermissionRoute permission={PERMISSIONS.VIEW_CUSTOMERS}><Customers /></PermissionRoute>} />

        {/* ── Administración ── */}
        <Route path="/restaurants" element={<PermissionRoute permission={PERMISSIONS.VIEW_RESTAURANTS}><Restaurants /></PermissionRoute>} />
        <Route path="/tables" element={<PermissionRoute permission={PERMISSIONS.VIEW_TABLES}><Tables /></PermissionRoute>} />
        <Route path="/employees" element={<PermissionRoute permission={PERMISSIONS.VIEW_EMPLOYEES}><Employees /></PermissionRoute>} />
      </Route>

      {/* Redirecciones — /inicio es la ruta canónica; /dashboard y /analytics
          se mantienen por compatibilidad con enlaces existentes */}
      <Route path="/" element={<Navigate to="/inicio" replace />} />
      <Route path="/dashboard" element={<Navigate to="/inicio" replace />} />
      <Route path="/analytics" element={<Navigate to="/inicio" replace />} />
      <Route path="*" element={<Navigate to="/inicio" replace />} />
    </Routes>
  );
}

export default App;
```

(El `NotificationProvider` se retira aquí porque el sistema de notificaciones se elimina en la Tarea 9 — si esa tarea se ejecuta después de esta, `NotificationProvider` seguiría existiendo sin usarse hasta entonces, lo cual es válido como paso intermedio).

- [ ] **Step 2: Actualizar `Sidebar.jsx` — grupo "Inicio" apunta a `/inicio`, se retira el grupo "NEGOCIO"**

Reemplazar el array `navGroups` (líneas 81-110):

```jsx
const navGroups = [
  {
    items: [
      { path: '/inicio', label: 'Inicio', icon: 'dashboard' },
    ],
  },
  {
    title: 'OPERATIVA',
    items: [
      { path: '/reservations', label: 'Reservas', icon: 'reservations' },
      { path: '/floor-plan', label: 'Plano de sala', icon: 'floorPlan' },
      { path: '/customers', label: 'Clientes', icon: 'customers' },
    ],
  },
  {
    title: 'ADMINISTRACIÓN',
    items: [
      { path: '/restaurants', label: 'Restaurantes', icon: 'restaurants' },
      { path: '/tables', label: 'Gestión de mesas', icon: 'tables' },
      { path: '/employees', label: 'Empleados', icon: 'employees' },
    ],
  },
];
```

Simplificar el cálculo de `isActivePath` (líneas 169-173), quitando el caso especial de `/dashboard`:

```jsx
                    {visibleItems.map((item) => {
                      const isActivePath = location.pathname === item.path;
                      return (
```

- [ ] **Step 3: Actualizar `permissions.js` — retirar `VIEW_NOTIFICATIONS` y las entradas de rutas eliminadas**

En `PERMISSIONS` (líneas 31-54), quitar la línea `VIEW_NOTIFICATIONS: 'VIEW_NOTIFICATIONS',`. `VIEW_ANALYTICS` se mantiene (ahora gatea la sección "Tendencias" dentro de Inicio, no una ruta).

En `ROLE_PERMISSIONS[ROLES.MANAGER]` (líneas 68-86), quitar la línea `PERMISSIONS.VIEW_NOTIFICATIONS,`.

En `ROUTE_PERMISSIONS` (líneas 103-114), dejar:

```js
export const ROUTE_PERMISSIONS = {
  '/inicio': PERMISSIONS.VIEW_DASHBOARD,
  '/reservations': PERMISSIONS.VIEW_RESERVATIONS,
  '/floor-plan': PERMISSIONS.VIEW_FLOOR_PLAN,
  '/customers': PERMISSIONS.VIEW_CUSTOMERS,
  '/restaurants': PERMISSIONS.VIEW_RESTAURANTS,
  '/tables': PERMISSIONS.VIEW_TABLES,
  '/employees': PERMISSIONS.VIEW_EMPLOYEES,
};
```

En `SIDEBAR_PERMISSIONS` (líneas 120-130), dejar:

```js
export const SIDEBAR_PERMISSIONS = {
  '/inicio': PERMISSIONS.VIEW_DASHBOARD,
  '/reservations': PERMISSIONS.VIEW_RESERVATIONS,
  '/floor-plan': PERMISSIONS.VIEW_FLOOR_PLAN,
  '/customers': PERMISSIONS.VIEW_CUSTOMERS,
  '/restaurants': PERMISSIONS.VIEW_RESTAURANTS,
  '/tables': PERMISSIONS.VIEW_TABLES,
  '/employees': PERMISSIONS.VIEW_EMPLOYEES,
};
```

En `DENIED_MESSAGES` (líneas 197-207), quitar las entradas `[PERMISSIONS.VIEW_ANALYTICS]` y `[PERMISSIONS.VIEW_NOTIFICATIONS]` (la sección Tendencias ahora se oculta dentro de la página en vez de mostrar una pantalla de 403 aparte).

- [ ] **Step 4: Eliminar `Dashboard.jsx` y `Analytics.jsx`**

```bash
git rm restaurante-frontend/src/pages/Dashboard.jsx restaurante-frontend/src/pages/Analytics.jsx
```

- [ ] **Step 5: Lint**

Run: `cd restaurante-frontend && pnpm lint`
Expected: sin errores (sin imports rotos a `Dashboard`/`Analytics`, sin referencias a `PERMISSIONS.VIEW_NOTIFICATIONS` fuera de lo ya limpiado).

- [ ] **Step 6: Verificación manual del build**

Run: `cd restaurante-frontend && pnpm build`
Expected: build exitoso sin errores de módulo no encontrado.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor(frontend): montar Inicio.jsx como página única, retirar Dashboard/Analytics"
```

---

## Task 9: Frontend — Eliminar el sistema de notificaciones standalone

**Contexto:** Confirmado en la auditoría: 100% cliente, sin persistencia, no accionable (solo navega). Su único valor real (avisos de mesas en mantenimiento, próxima reserva, ocupación, sin mesas libres) ya vive en "Requiere atención" de `Inicio.jsx` desde la Tarea 7.

**Files:**
- Delete: `restaurante-frontend/src/components/NotificationBell.jsx`
- Delete: `restaurante-frontend/src/components/NotificationPanel.jsx`
- Delete: `restaurante-frontend/src/pages/Notifications.jsx`
- Delete: `restaurante-frontend/src/context/NotificationContext.jsx`
- Delete: `restaurante-frontend/src/services/notificationService.js`
- Modify: `restaurante-frontend/src/components/Navbar.jsx:4,89`

**Interfaces:**
- Produces: ninguno — solo retira superficie de UI sin backend real detrás.

- [ ] **Step 1: Confirmar que nada más importa estos ficheros**

Run: `cd restaurante-frontend && grep -rn "NotificationBell\|NotificationPanel\|NotificationContext\|useNotifications\|notificationService" src --include=*.jsx --include=*.js`
Expected: solo aparecen los propios ficheros a borrar más `Navbar.jsx` (import y uso de `NotificationBell`) y `App.jsx` (si la Tarea 8 aún no ha quitado `NotificationProvider`, aparecerá ahí también).

- [ ] **Step 2: Quitar `NotificationBell` de `Navbar.jsx`**

En `restaurante-frontend/src/components/Navbar.jsx`, quitar la línea de import (línea 4):

```js
import NotificationBell from './NotificationBell';
```

y quitar el bloque de uso (línea 88-89):

```jsx
        {/* Notification Bell */}
        <NotificationBell />

```

- [ ] **Step 3: Confirmar que `App.jsx` ya no envuelve con `NotificationProvider`**

Si la Tarea 8 ya se aplicó, `App.jsx` no debe tener ningún `import { NotificationProvider }` ni `<NotificationProvider>`. Si por algún motivo se ejecuta esta tarea antes que la 8, quitar aquí:

```js
import { NotificationProvider } from './context/NotificationContext';
```

y desenvolver `<MainLayout />` de `<NotificationProvider>...</NotificationProvider>` en la ruta protegida.

- [ ] **Step 4: Eliminar los 5 ficheros del sistema de notificaciones**

```bash
git rm restaurante-frontend/src/components/NotificationBell.jsx \
       restaurante-frontend/src/components/NotificationPanel.jsx \
       restaurante-frontend/src/pages/Notifications.jsx \
       restaurante-frontend/src/context/NotificationContext.jsx \
       restaurante-frontend/src/services/notificationService.js
```

- [ ] **Step 5: Lint y build**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore(frontend): eliminar sistema de notificaciones standalone (sin backend, no accionable)"
```

---

## Task 10: Frontend — Simplificar `FloorPlan.jsx` a solo vista interactiva

**Contexto:** `FloorPlan.jsx` tiene 3 sub-vistas (`visual`/`compact`/`interactive`) en un único componente. Las vistas `visual`/`compact` son tarjetas por zona sin posicionamiento; `interactive` (canvas, drag&drop) ya cubre ver mesas, mover mesas, guardar posiciones, ver estado/capacidad y gestionar ocupación/reservas vía el modal compartido. Se retira el selector de vista y las dos ramas de render redundantes; se conservan filtros, búsqueda, resumen por estado y el modal de detalle.

**Files:**
- Modify: `restaurante-frontend/src/pages/FloorPlan.jsx`

**Interfaces:**
- Consumes: sin cambios — `getTablesByRestaurant`, `updateTableStatus`, `updateTablesLayout` (`tableService.js`), `getFloorPlanElements`, `saveFloorPlanElements` (`floorPlanService.js`), `FloorPlanCanvas` (sin cambios en su API `ref`: `getLayout()`, `resetAutoLayout()`, `addElement(type)`).
- Produces: `export default FloorPlan` sin cambios de firma — sigue siendo la página montada en `/floor-plan`.

- [ ] **Step 1: Quitar el estado `viewMode` y la auto-detección de vista por cantidad de mesas**

Quitar (línea 54):

```jsx
  const [viewMode, setViewMode] = useState('visual');
```

En el `useEffect` de carga de mesas (líneas 88-131), quitar la línea de auto-detección (línea 113):

```jsx
          // Auto-detectar vista según cantidad de mesas
          setViewMode(tableList.length > 8 ? 'compact' : 'visual');
```

- [ ] **Step 2: Quitar el estado y la lógica de zonas/colapso, ya sin uso (solo servían a las vistas visual/compacta)**

Quitar el estado (línea 57):

```jsx
  const [collapsedZones, setCollapsedZones] = useState(() => new Set());
```

Quitar la constante `ZONE_ORDER` (línea 34), el memo `groupedTables` (líneas 175-199), la función `getZoneSummary` (líneas 212-219) y la función `toggleZoneCollapse` (líneas 242-252).

- [ ] **Step 3: Quitar los renderers `renderVisualCard`, `renderCompactCard` y `renderZone`, ya sin uso**

Quitar los tres bloques completos (líneas 392-435, 438-471 y 474-528 del fichero original).

- [ ] **Step 4: Simplificar el header — el subtítulo ya no depende de `viewMode`**

Reemplazar (líneas 534-543):

```jsx
        <div>
          <h1>Plano del Restaurante</h1>
          <p className="fp-header-subtitle">
            {viewMode === 'interactive'
              ? 'Plano interactivo con mesas posicionadas en el espacio del restaurante'
              : `Vista ${viewMode === 'compact' ? 'compacta' : 'visual'} de las mesas agrupadas por ubicación`}
          </p>
        </div>
```

por:

```jsx
        <div>
          <h1>Plano del Restaurante</h1>
          <p className="fp-header-subtitle">
            Plano interactivo con mesas posicionadas en el espacio del restaurante
          </p>
        </div>
```

- [ ] **Step 5: Quitar el bloque `fp-view-toggle` (selector Visual/Compacta/Plano)**

Quitar el bloque completo (líneas 569-618, dentro de `fp-toolbar-row`):

```jsx
          {/* ─── View Mode Toggle ──────────────────────────────────── */}
          {tables.length > 0 && (
            <div className="fp-view-toggle" role="group" aria-label="Cambiar vista">
              ...
            </div>
          )}
```

- [ ] **Step 6: La toolbar de edición ya no depende de `viewMode === 'interactive'`**

Reemplazar (línea 749):

```jsx
      {viewMode === 'interactive' && tables.length > 0 && (
```

por:

```jsx
      {tables.length > 0 && (
```

- [ ] **Step 7: Quitar el bloque de render por zonas (vista visual/compacta) y dejar el canvas incondicional**

Reemplazar los dos bloques condicionales (líneas 944-967):

```jsx
      {/* ═══ Plano interactivo (modo canvas) ════════════════════════════ */}
      {!loadingRestaurants && !loading && filteredTables.length > 0 && viewMode === 'interactive' && (
        <div className="fp-canvas-container">
          <FloorPlanCanvas
            key={`canvas-${selectedRestaurantId}-${canvasReloadKey}`}
            ref={canvasSaveRef}
            tables={filteredTables}
            elements={elements}
            editMode={isEditMode}
            selectedTableId={selectedTable?.id}
            onTableClick={handleCanvasTableClick}
            onTableDragEnd={handleTableDragEnd}
            onLayoutChange={handleLayoutChange}
            saving={savingLayout}
          />
        </div>
      )}

      {/* ═══ Plano por zonas (vista visual/compacta) ════════════════════ */}
      {!loadingRestaurants && !loading && filteredTables.length > 0 && viewMode !== 'interactive' && (
        <div className="fp-plan">
          {groupedTables.map(renderZone)}
        </div>
      )}
```

por:

```jsx
      {/* ═══ Plano interactivo (modo canvas) ════════════════════════════ */}
      {!loadingRestaurants && !loading && filteredTables.length > 0 && (
        <div className="fp-canvas-container">
          <FloorPlanCanvas
            key={`canvas-${selectedRestaurantId}-${canvasReloadKey}`}
            ref={canvasSaveRef}
            tables={filteredTables}
            elements={elements}
            editMode={isEditMode}
            selectedTableId={selectedTable?.id}
            onTableClick={handleCanvasTableClick}
            onTableDragEnd={handleTableDragEnd}
            onLayoutChange={handleLayoutChange}
            saving={savingLayout}
          />
        </div>
      )}
```

- [ ] **Step 8: Quitar el `onClick`/toggle de `setIsEditMode(false)` ligado a los botones de vista eliminados**

Ya no queda ningún botón que llame a `setViewMode(...)`; confirmar con:

Run: `grep -n "viewMode\|setViewMode\|collapsedZones\|toggleZoneCollapse\|groupedTables\|getZoneSummary\|renderVisualCard\|renderCompactCard\|renderZone\|ZONE_ORDER" restaurante-frontend/src/pages/FloorPlan.jsx`
Expected: sin resultados (todo lo referido a vistas redundantes ha sido eliminado).

- [ ] **Step 9: Lint y build**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: ambos sin errores (sin variables/funciones declaradas y no usadas).

- [ ] **Step 10: Commit**

```bash
git add -A
git commit -m "refactor(floor-plan): mantener solo la vista interactiva, eliminar vistas visual/compacta redundantes"
```

---

## Task 11: Verificación final — backend + frontend + smoke manual

**Contexto:** Cierre del plan. No hay tests frontend (confirmado: no hay `vitest`/`jest`/`@testing-library` en `package.json`), así que la verificación de UI es manual y dirigida por esta checklist.

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite completa backend**

Run: `cd restaurante_manage && mvn test`
Expected: `BUILD SUCCESS`, 32 tests, 0 fallos (29 originales + `AvailabilityServiceTest` x2 + `TableStatusSchedulerTest` x1).

- [ ] **Step 2: Build completo frontend**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: ambos sin errores.

- [ ] **Step 3: Arrancar backend en modo dev y frontend, y ejecutar el smoke manual**

Run: `cd restaurante_manage && mvn spring-boot:run -Dspring-boot.run.profiles=dev` (en una terminal)
Run: `cd restaurante-frontend && pnpm dev` (en otra terminal)

Checklist manual (usuarios demo del perfil `dev`, contraseña `admin123` para todos):

1. **Login** con `super.admin`, `juan.admin`, y un usuario MANAGER/EMPLOYEE si existe en los datos demo — cada uno debe llegar a `/inicio`.
2. **Carga de Inicio**: KPIs, agenda de hoy y "Requiere atención" se rellenan sin error en consola. Con un rol EMPLOYEE (o MANAGER sin `VIEW_ANALYTICS` si aplica), la sección "Tendencias" no debe aparecer; con ADMIN/SUPER_ADMIN sí.
3. **Navegación de compatibilidad**: visitar manualmente `/dashboard` y `/analytics` en la URL — ambas deben redirigir a `/inicio` sin parpadeo de contenido roto. `/notifications` debe devolver la redirección genérica (`*` → `/inicio`), no una página en blanco.
4. **Creación de reserva**: crear una reserva normal (éxito) y luego otra que solape mesa/fecha/hora con una existente (`PENDING` o `CONFIRMED`) — debe devolver 409 y el frontend debe mostrarlo como error, no como éxito.
5. **Creación/edición de mesa**: en `/tables`, crear una mesa nueva y editarla — debe persistir y aparecer también en `/floor-plan`.
6. **Plano interactivo**: en `/floor-plan`, no debe aparecer ningún selector de vista (Visual/Compacta/Plano). Mover una mesa en modo edición, guardar el layout, recargar la página y confirmar que la posición persiste. Abrir el modal de una mesa y confirmar que muestra estado/capacidad/ubicación y permite cambiar el estado.
7. **Sidebar**: confirmar que no aparecen "Analítica" ni "Notificaciones" como entradas de menú, y que "Inicio" navega a `/inicio`.
8. **Mantenimiento automático**: dejar el backend corriendo >15 minutos con al menos una mesa `RESERVED` sin reserva `CONFIRMED` activa (o bajar temporalmente `TABLE_STATUS_FIX_DELAY_MS` a un valor pequeño, p.ej. `60000`, para la prueba) y confirmar en los logs la línea `[MANTENIMIENTO-AUTO] N mesas corregidas automáticamente a AVAILABLE`, y que la mesa pasa a `AVAILABLE` en `/floor-plan` sin intervención manual.
9. **Disponibilidad pública**: desde `/public/reservar/:restaurantId` (o `/r/:restaurantId`), comprobar que una mesa con una reserva `PENDING` en una fecha/hora dada ya NO aparece como disponible para esa fecha/hora (antes del fix sí aparecía).

- [ ] **Step 4: Confirmar que no queda ningún resto de las funcionalidades eliminadas**

Run: `cd restaurante_manage && grep -rn "dashboard" src/main --include=*.java -i; grep -rn "fix-table-statuses" ../restaurante-frontend/src`
Expected: sin resultados en el backend (paquete `dashboard/` ya no existe); sin resultados en frontend (el endpoint de mantenimiento sigue sin exponerse en UI, como se decidió).

- [ ] **Step 5: Commit final (si quedó algo pendiente de un paso anterior)**

Si todos los commits de las Tareas 1-10 ya se hicieron, este paso no genera cambios. Si quedara algo sin commitear:

```bash
git status
git add -A
git commit -m "chore: verificación final de la simplificación del SaaS"
```
