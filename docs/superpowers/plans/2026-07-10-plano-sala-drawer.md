# Plano de sala como gestión única de mesas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert `/floor-plan` into the sole table-management screen: a non-blocking right-side drawer replaces the centered modal, reservations render directly on table tiles, and `/tables` is removed.

**Architecture:** Add one backend endpoint (`GET /api/v1/restaurants/{restaurantId}/reservations?date=`) so the frontend can fetch only today's reservations for the active restaurant instead of the whole history. On the frontend, `FloorPlan.jsx` loads tables + floor-plan elements + today's reservations in parallel, derives a `tableId → reservation` map, and passes it to `FloorPlanCanvas` (for on-tile display) and a new `TableDrawer` component (for the detail/edit panel). `TableDrawer` owns its own create/edit sub-forms and calls the existing `tableService`/`reservationService` functions directly, notifying `FloorPlan.jsx` to refetch after each mutation. `Tables.jsx` and its route are deleted; `/tables` redirects to `/floor-plan`.

**Tech Stack:** Spring Boot 3.3 / Java 21 (Maven, JUnit 5, Mockito, `@DataJpaTest` + H2) for the backend task; React 19 + Vite, Bootstrap 5 classes + the project's custom `index.css` tokens for the frontend tasks. No new dependencies.

## Global Constraints

- Backend and frontend code, comments, commit messages, and user-facing text are in **Spanish**.
- Commits follow Conventional Commits (`feat(...)`, `fix(...)`, `refactor(...)`, `test(...)`, `docs(...)`).
- All entities filter soft-deleted rows via `deletedFalse` repository methods — never query without it.
- Every service method that reads/writes restaurant-scoped data must go through `CurrentUserService` (`validateRestaurantAccess` / `getVisibleRestaurantIds`) — this is the multi-tenant invariant, see `CLAUDE.md`.
- All backend URL paths are constants in `common/util/Constants.java` — never inline a path string in a controller.
- There are no frontend automated tests in this repo (per `CLAUDE.md`); frontend tasks are verified with `pnpm lint`, `pnpm build`, and the manual checklist in Task 10 — do not attempt to add a test runner.
- Reuse existing services (`tableService.js`, `reservationService.js`) and existing patterns (toast via `showToast`, `canAccess(user, PERMISSIONS.X)`) — do not introduce new state-management libraries or a new notification system.

---

## Task 1: Backend — repository query for reservations by restaurant + date

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java:27`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java:34`
- Test: `restaurante_manage/src/test/java/com/restaurante/reservation/repository/ReservationRepositoryTest.java`

**Interfaces:**
- Produces: `Constants.RESTAURANT_RESERVATIONS_SUBPATH` (String, `"/reservations"`), used by Task 3.
- Produces: `ReservationRepository.findByRestaurantIdAndReservationDateAndDeletedFalse(Long restaurantId, LocalDate date) : List<Reservation>`, used by Task 2.

- [ ] **Step 1: Add the path constant**

In `Constants.java`, right after line 27 (`FLOOR_PLAN_ELEMENTS_SUBPATH`), add:

```java
    // Reservas de un restaurante (plano de sala)
    public static final String RESTAURANT_RESERVATIONS_SUBPATH = "/reservations";
```

- [ ] **Step 2: Add the repository method**

In `ReservationRepository.java`, add this method right after line 34 (`findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds, Pageable pageable)`), before the `// ─── Queries para gestión de disponibilidad...` comment:

```java
    List<Reservation> findByRestaurantIdAndReservationDateAndDeletedFalse(Long restaurantId, LocalDate date);
```

- [ ] **Step 3: Write the failing test**

In `ReservationRepositoryTest.java`, add these test methods at the end of the class, right before the final closing `}` (after `lasReservasBorradasLogicamenteNoBloqueanElHueco`):

```java

    @Test
    void filtraReservasPorRestauranteYFechaExacta() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.CONFIRMED);
        crearReserva(mesa2, DATE, TIME.plusHours(1), ReservationStatus.PENDING);
        crearReserva(mesa1, DATE.plusDays(1), TIME, ReservationStatus.CONFIRMED);

        List<Reservation> resultado = repository
                .findByRestaurantIdAndReservationDateAndDeletedFalse(restaurant.getId(), DATE);

        assertEquals(2, resultado.size());
    }

    @Test
    void noDevuelveReservasBorradasLogicamenteParaLaFecha() {
        Reservation borrada = crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);
        borrada.setDeleted(true);
        borrada.setDeletedAt(LocalDateTime.now());
        em.persistAndFlush(borrada);

        List<Reservation> resultado = repository
                .findByRestaurantIdAndReservationDateAndDeletedFalse(restaurant.getId(), DATE);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void noDevuelveReservasDeOtroRestaurante() {
        Restaurant otro = new Restaurant();
        otro.setName("Otro Restaurante");
        em.persist(otro);
        DiningTable mesaOtro = new DiningTable();
        mesaOtro.setRestaurant(otro);
        mesaOtro.setTableNumber("X1");
        mesaOtro.setCapacity(2);
        em.persist(mesaOtro);
        em.flush();

        Reservation r = new Reservation();
        r.setCustomer(customer);
        r.setRestaurant(otro);
        r.setDiningTable(mesaOtro);
        r.setReservationDate(DATE);
        r.setReservationTime(TIME);
        r.setPartySize(2);
        r.setStatus(ReservationStatus.CONFIRMED);
        em.persistAndFlush(r);

        List<Reservation> resultado = repository
                .findByRestaurantIdAndReservationDateAndDeletedFalse(restaurant.getId(), DATE);

        assertTrue(resultado.isEmpty());
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd restaurante_manage && mvn test -Dtest=ReservationRepositoryTest`
Expected: `Tests run: 10, Failures: 0, Errors: 0` (7 existing + 3 new).

- [ ] **Step 5: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java restaurante_manage/src/test/java/com/restaurante/reservation/repository/ReservationRepositoryTest.java
git commit -m "feat(reservation): añadir consulta de reservas por restaurante y fecha"
```

---

## Task 2: Backend — service method with tenant scoping

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java:167-172`
- Test: `restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationServiceTest.java`

**Interfaces:**
- Consumes: `ReservationRepository.findByRestaurantIdAndReservationDateAndDeletedFalse(Long, LocalDate)` from Task 1; `CurrentUserService.validateRestaurantAccess(Long)` (existing, throws `org.springframework.security.access.AccessDeniedException` when the user cannot see that restaurant).
- Produces: `ReservationService.findByRestaurantIdAndDate(Long restaurantId, LocalDate date) : List<ReservationResponse>`, used by Task 3.

- [ ] **Step 1: Write the failing test**

In `ReservationServiceTest.java`, add `import java.util.List;` is already present; add this test method at the end of the class, right before the final closing `}`:

```java

    @Test
    void findByRestaurantIdAndDate_validaAccesoYDelegaEnElRepositorio() {
        LocalDate fecha = LocalDate.of(2026, 12, 31);
        Reservation reserva = new Reservation();
        reserva.setRestaurant(restaurant);
        reserva.setDiningTable(table);
        reserva.setCustomer(customer);
        reserva.setReservationDate(fecha);
        reserva.setReservationTime(TIME);
        reserva.setPartySize(2);
        reserva.setStatus(ReservationStatus.CONFIRMED);

        when(reservationRepository.findByRestaurantIdAndReservationDateAndDeletedFalse(RESTAURANT_ID, fecha))
                .thenReturn(List.of(reserva));
        ReservationResponse response = new ReservationResponse();
        when(reservationMapper.toResponse(reserva)).thenReturn(response);

        List<ReservationResponse> resultado = service.findByRestaurantIdAndDate(RESTAURANT_ID, fecha);

        assertEquals(1, resultado.size());
        assertSame(response, resultado.get(0));
        verify(currentUserService).validateRestaurantAccess(RESTAURANT_ID);
    }

    @Test
    void findByRestaurantIdAndDate_propagaAccessDeniedSiNoTieneAcceso() {
        LocalDate fecha = LocalDate.of(2026, 12, 31);
        doThrow(new org.springframework.security.access.AccessDeniedException("sin acceso"))
                .when(currentUserService).validateRestaurantAccess(RESTAURANT_ID);

        assertThrows(org.springframework.security.access.AccessDeniedException.class,
                () -> service.findByRestaurantIdAndDate(RESTAURANT_ID, fecha));

        verify(reservationRepository, never())
                .findByRestaurantIdAndReservationDateAndDeletedFalse(any(), any());
    }
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd restaurante_manage && mvn test -Dtest=ReservationServiceTest`
Expected: FAIL — `cannot find symbol: method findByRestaurantIdAndDate`.

- [ ] **Step 3: Implement the service method**

In `ReservationService.java`, add this method right after `findByRestaurantId` (after line 172, the closing `}` of that method), before the `// ════ CREACIÓN ════` comment block:

```java

    public List<ReservationResponse> findByRestaurantIdAndDate(Long restaurantId, LocalDate date) {
        currentUserService.validateRestaurantAccess(restaurantId);
        return reservationRepository.findByRestaurantIdAndReservationDateAndDeletedFalse(restaurantId, date).stream()
                .map(reservationMapper::toResponse)
                .collect(Collectors.toList());
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd restaurante_manage && mvn test -Dtest=ReservationServiceTest`
Expected: all tests pass, including the 2 new ones.

- [ ] **Step 5: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationServiceTest.java
git commit -m "feat(reservation): añadir ReservationService.findByRestaurantIdAndDate con scoping multi-tenant"
```

---

## Task 3: Backend — REST endpoint

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/reservation/controller/RestaurantReservationController.java`

**Interfaces:**
- Consumes: `ReservationService.findByRestaurantIdAndDate(Long, LocalDate)` from Task 2; `Constants.RESTAURANTS_PATH`, `Constants.RESTAURANT_RESERVATIONS_SUBPATH` from Task 1.
- Produces: `GET /api/v1/restaurants/{restaurantId}/reservations?date=YYYY-MM-DD` → `ApiResponse<List<ReservationResponse>>`, consumed by Task 4's frontend service call. `date` omitted defaults to today.

- [ ] **Step 1: Create the controller**

Follows the exact pattern of `FloorPlanElementController` (no class-level `@RequestMapping`, path built from `Constants` pieces):

```java
package com.restaurante.reservation.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.reservation.dto.ReservationResponse;
import com.restaurante.reservation.service.ReservationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequiredArgsConstructor
@Tag(name = "Reservas", description = "Reservas de un restaurante (usado por el plano de sala)")
@SecurityRequirement(name = "bearerAuth")
public class RestaurantReservationController {

    private static final String RESERVATIONS_BY_RESTAURANT_PATH =
            Constants.RESTAURANTS_PATH + "/{restaurantId}" + Constants.RESTAURANT_RESERVATIONS_SUBPATH;

    private final ReservationService reservationService;

    @GetMapping(RESERVATIONS_BY_RESTAURANT_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Listar reservas de un restaurante por fecha",
            description = "Obtiene las reservas de un restaurante para una fecha concreta (por defecto, hoy). " +
                    "Usado por el plano de sala para mostrar la reserva de cada mesa sin cargar todo el histórico.")
    public ResponseEntity<ApiResponse<List<ReservationResponse>>> findByRestaurantAndDate(
            @PathVariable Long restaurantId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        LocalDate targetDate = date != null ? date : LocalDate.now();
        List<ReservationResponse> reservations = reservationService.findByRestaurantIdAndDate(restaurantId, targetDate);
        return ResponseEntity.ok(ApiResponse.success(reservations));
    }
}
```

- [ ] **Step 2: Build the backend to verify it compiles**

Run: `cd restaurante_manage && mvn compile`
Expected: `BUILD SUCCESS`.

- [ ] **Step 3: Manual smoke test against the dev profile**

Run: `cd restaurante_manage && mvn spring-boot:run -Dspring-boot.run.profiles=dev` (in a background terminal), then in another terminal:

```bash
curl -s -X POST http://localhost:8080/api/v1/auth/login -H "Content-Type: application/json" -d '{"username":"juan.admin","password":"admin123"}' | grep -o '"token":"[^"]*"'
```

Copy the token, then:

```bash
curl -s "http://localhost:8080/api/v1/restaurants/1/reservations" -H "Authorization: Bearer <token>"
```

Expected: `200 OK` with `{"success":true,"data":[...]}` (may be an empty array if restaurant 1 has no reservations dated today — that's fine, it confirms the endpoint responds correctly). Stop the backend afterward.

- [ ] **Step 4: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/reservation/controller/RestaurantReservationController.java
git commit -m "feat(reservation): exponer GET /restaurants/{id}/reservations?date= para el plano de sala"
```

---

## Task 4: Frontend — load today's reservations into FloorPlan.jsx

**Files:**
- Modify: `restaurante-frontend/src/services/reservationService.js:1-4` and end of file
- Modify: `restaurante-frontend/src/pages/FloorPlan.jsx`

**Interfaces:**
- Produces: `reservationService.getReservationsByRestaurantAndDate(restaurantId, dateStr) : Promise<Array>`, used here and by Task 8.
- Produces (in `FloorPlan.jsx`): state `reservations` (array of `ReservationResponse`-shaped objects), `reservationsByTableId` (object: `tableId → Array<reservation>`, sorted by `reservationTime` ascending), `nextReservationByTableId` (object: `tableId → reservation|undefined`), helper `getTodayDateStr()`. All three are used by Task 5 (canvas) and Task 6 (drawer).

- [ ] **Step 1: Add the service function**

In `reservationService.js`, add this function at the end of the file (after `updateReservationStatus`):

```js

/**
 * Obtiene las reservas de un restaurante para una fecha concreta.
 * @param {number} restaurantId
 * @param {string} date - formato YYYY-MM-DD
 */
export const getReservationsByRestaurantAndDate = async (restaurantId, date) => {
  try {
    const response = await api.get(`/restaurants/${restaurantId}/reservations`, {
      params: { date },
    });
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};
```

- [ ] **Step 2: Add the `getTodayDateStr` helper and `reservations` state**

In `FloorPlan.jsx`, update the import block (lines 1-16) — add `getReservationsByRestaurantAndDate` to the `reservationService` import:

```jsx
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRestaurants } from '../services/restaurantService';
import {
  getTablesByRestaurant,
  updateTableStatus,
  updateTablesLayout,
} from '../services/tableService';
import {
  getFloorPlanElements,
  saveFloorPlanElements,
} from '../services/floorPlanService';
import { getReservationsByRestaurantAndDate } from '../services/reservationService';
import { canAccess, PERMISSIONS } from '../config/permissions';
import FloorPlanCanvas from '../components/FloorPlanCanvas';
```

Right after the `FILTER_OPTIONS` array (line 31, before `// ─── Componente principal`), add:

```jsx
// ─── Fecha de hoy en formato YYYY-MM-DD (huso horario local) ──────────────
const getTodayDateStr = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// ─── Hora actual en formato HH:mm:ss para comparar con reservationTime ────
const getNowTimeStr = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}:00`;
};
```

Add a `reservations` state right after `elements` (line 43):

```jsx
  const [elements, setElements] = useState([]);
  const [reservations, setReservations] = useState([]);
```

- [ ] **Step 3: Load reservations alongside tables and elements**

In the "Cargar mesas al cambiar de restaurante" `useEffect` (lines 84-124), replace the `loadTables` function body's `Promise.all` (lines 96-102) with:

```jsx
      try {
        const [tablesData, elementsData, reservationsData] = await Promise.all([
          getTablesByRestaurant(Number(selectedRestaurantId)),
          getFloorPlanElements(Number(selectedRestaurantId)).catch((err) => {
            console.warn('[FloorPlan] No se pudieron cargar los elementos del plano:', err?.message);
            return [];
          }),
          getReservationsByRestaurantAndDate(Number(selectedRestaurantId), getTodayDateStr()).catch((err) => {
            console.warn('[FloorPlan] No se pudieron cargar las reservas de hoy:', err?.message);
            return [];
          }),
        ]);
        if (mounted) {
          const tableList = Array.isArray(tablesData) ? tablesData : [];
          setTables(tableList);
          setElements(Array.isArray(elementsData) ? elementsData : []);
          setReservations(Array.isArray(reservationsData) ? reservationsData : []);
        }
      } catch {
        if (mounted) {
          setError('Error al cargar las mesas del restaurante.');
          setTables([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    loadTables();
```

Also clear `reservations` alongside `tables`/`elements` at the top of `loadTables` (where `setTables([]); setElements([]);` already runs, around line 92-93):

```jsx
        setTables([]);
        setElements([]);
        setReservations([]);
```

- [ ] **Step 4: Refresh reservations in `reloadPlanData`**

In `reloadPlanData` (lines 244-253), replace its body with:

```jsx
  const reloadPlanData = useCallback(async () => {
    if (!selectedRestaurantId) return;
    const [tablesData, elementsData, reservationsData] = await Promise.all([
      getTablesByRestaurant(Number(selectedRestaurantId)),
      getFloorPlanElements(Number(selectedRestaurantId)).catch(() => []),
      getReservationsByRestaurantAndDate(Number(selectedRestaurantId), getTodayDateStr()).catch(() => []),
    ]);
    setTables(Array.isArray(tablesData) ? tablesData : []);
    setElements(Array.isArray(elementsData) ? elementsData : []);
    setReservations(Array.isArray(reservationsData) ? reservationsData : []);
    setCanvasReloadKey((prev) => prev + 1);
  }, [selectedRestaurantId]);
```

- [ ] **Step 5: Derive the reservation maps**

Right after the `summary` `useMemo` (lines 168-175), add:

```jsx
  // ── Reservas de hoy agrupadas por mesa (PENDING/CONFIRMED, orden por hora) ──
  const reservationsByTableId = useMemo(() => {
    const map = {};
    reservations
      .filter((r) => r.status === 'PENDING' || r.status === 'CONFIRMED')
      .forEach((r) => {
        if (!r.diningTableId) return;
        if (!map[r.diningTableId]) map[r.diningTableId] = [];
        map[r.diningTableId].push(r);
      });
    Object.values(map).forEach((list) =>
      list.sort((a, b) => String(a.reservationTime).localeCompare(String(b.reservationTime)))
    );
    return map;
  }, [reservations]);

  // ── Próxima reserva de hoy por mesa (o la última en curso si todas pasaron) ──
  const nextReservationByTableId = useMemo(() => {
    const nowStr = getNowTimeStr();
    const map = {};
    Object.entries(reservationsByTableId).forEach(([tableId, list]) => {
      const upcoming = list.find((r) => String(r.reservationTime) >= nowStr);
      map[tableId] = upcoming || list[list.length - 1];
    });
    return map;
  }, [reservationsByTableId]);
```

- [ ] **Step 6: Verify with lint and build**

Run: `cd restaurante-frontend && pnpm lint`
Expected: no errors (existing warnings, if any, are unrelated to this change).

Run: `cd restaurante-frontend && pnpm build`
Expected: build succeeds.

- [ ] **Step 7: Commit**

```bash
git add restaurante-frontend/src/services/reservationService.js restaurante-frontend/src/pages/FloorPlan.jsx
git commit -m "feat(floor-plan): cargar reservas de hoy y derivar mapas mesa→reserva"
```

---

## Task 5: Frontend — show reservation info on table tiles

**Files:**
- Modify: `restaurante-frontend/src/components/FloorPlanCanvas.jsx`
- Modify: `restaurante-frontend/src/pages/FloorPlan.jsx`
- Modify: `restaurante-frontend/src/index.css`

**Interfaces:**
- Consumes: `nextReservationByTableId` from Task 4 (object: `tableId → reservation|undefined`).
- Produces (in `FloorPlanCanvas.jsx`): new prop `nextReservationByTableId` (object map, same shape as the one produced in Task 4 — passed straight through from `FloorPlan.jsx`).

- [ ] **Step 1: Pass the map into `FloorPlanCanvas`**

In `FloorPlan.jsx`, find the `<FloorPlanCanvas>` invocation (around line 698-709) and add the new prop:

```jsx
          <FloorPlanCanvas
            key={`canvas-${selectedRestaurantId}-${canvasReloadKey}`}
            ref={canvasSaveRef}
            tables={filteredTables}
            elements={elements}
            editMode={isEditMode}
            selectedTableId={selectedTable?.id}
            nextReservationByTableId={nextReservationByTableId}
            onTableClick={handleCanvasTableClick}
            onTableDragEnd={handleTableDragEnd}
            onLayoutChange={handleLayoutChange}
            saving={savingLayout}
          />
```

- [ ] **Step 2: Accept the prop and format a compact reservation label**

In `FloorPlanCanvas.jsx`, add `nextReservationByTableId = {}` to the destructured props (in the function signature block, lines 110-121):

```jsx
const FloorPlanCanvas = forwardRef(function FloorPlanCanvas(
  {
    tables = [],
    elements = [],
    editMode = false,
    selectedTableId = null,
    nextReservationByTableId = {},
    onTableClick,
    onTableDragEnd,
    onLayoutChange,
    saving = false,
  },
  ref
) {
```

Add a small formatting helper right after `getTableShape` (after line 106, before `// ═══ COMPONENTE PRINCIPAL ═══`):

```jsx
/**
 * "19:45:00" → "19:45"
 */
const formatReservationTime = (timeStr) => (timeStr ? String(timeStr).substring(0, 5) : '');
```

- [ ] **Step 3: Render the reservation block on the table tile**

In the mesas render block (around line 580-583, the `{/* Número de mesa */}` span), replace it with a block that also shows the reservation when present and not in edit mode:

```jsx
              {/* Número de mesa */}
              <span className="fpc-table-number">
                {table.tableNumber || table.id}
              </span>

              {/* Reserva de hoy (solo modo vista) */}
              {!editMode && nextReservationByTableId[table.id] && (
                <div className="fpc-table-reservation">
                  <span className="fpc-table-reservation-name">
                    {nextReservationByTableId[table.id].customerName || 'Reserva'}
                  </span>
                  <span className="fpc-table-reservation-meta">
                    {formatReservationTime(nextReservationByTableId[table.id].reservationTime)}
                    {' · '}
                    {nextReservationByTableId[table.id].partySize || '—'}p
                  </span>
                </div>
              )}

              {/* Capacidad (en mesas con espacio suficiente y sin reserva mostrada) */}
              {w >= 75 && h >= 75 && !(!editMode && nextReservationByTableId[table.id]) && (
                <span className="fpc-table-capacity">
                  {table.capacity || '—'}
                </span>
              )}
```

- [ ] **Step 4: Add CSS for the reservation block**

In `index.css`, right after the `.fpc-table-capacity` rule (ends at line 764, before the `.fpc-table-status-bar` rule at line 766), add:

```css
.fpc-table-reservation {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 92%;
  margin-top: 1px;
  line-height: 1.15;
}

.fpc-table-reservation-name {
  font-size: 0.625rem;
  font-weight: 700;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 100%;
}

.fpc-table-reservation-meta {
  font-size: 0.5625rem;
  font-weight: 600;
  opacity: 0.85;
}
```

- [ ] **Step 5: Verify with lint and build**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: both succeed.

- [ ] **Step 6: Manual check**

Run `pnpm dev`, log in as `juan.admin` / `admin123`, open "Plano de sala". If the demo data has a reservation dated today for a visible table, confirm its card shows name/time/party-size instead of just capacity. (If no demo reservation is dated today, this is fine — full end-to-end confirmation happens in Task 10 after the drawer can create/edit data.)

- [ ] **Step 7: Commit**

```bash
git add restaurante-frontend/src/components/FloorPlanCanvas.jsx restaurante-frontend/src/pages/FloorPlan.jsx restaurante-frontend/src/index.css
git commit -m "feat(floor-plan): mostrar cliente, hora y comensales sobre la mesa reservada"
```

---

## Task 6: Frontend — TableDrawer detail mode, replaces the centered modal

**Files:**
- Create: `restaurante-frontend/src/components/TableDrawer.jsx`
- Modify: `restaurante-frontend/src/pages/FloorPlan.jsx`
- Modify: `restaurante-frontend/src/index.css`

**Interfaces:**
- Consumes: `reservationsByTableId`, `nextReservationByTableId` from Task 4; `TABLE_STATUS`-shaped `getStatusInfo(status)` from `FloorPlan.jsx` (existing, lines 138-141).
- Produces: `TableDrawer` component, props:
  ```
  {
    open: boolean,
    table: object|null,           // selected table, null when isCreating
    isCreating: boolean,
    restaurantId: number,
    restaurantName: string,
    reservation: object|null,     // nextReservationByTableId[table.id]
    otherReservations: array,     // reservationsByTableId[table.id] minus `reservation`
    getStatusInfo: (status) => { label, class, color },
    statusUpdating: number|null,
    canManageTables: boolean,
    canManageReservations: boolean,
    onClose: () => void,
    onStatusChange: (table, newStatus) => Promise<void>,
  }
  ```
  This task implements only the `'detail'` internal mode (view info + change status + close). Later tasks (7, 8) add `'edit-table'`, `'create-table'`, `'edit-reservation'` modes to the same file — the mode-switch scaffolding is built now so those tasks only add branches.

- [ ] **Step 1: Create the drawer component (detail mode only)**

```jsx
import { useState, useEffect, useCallback } from 'react';

// ─── Formateo ────────────────────────────────────────────────────────────
const formatTime = (timeStr) => (timeStr ? String(timeStr).substring(0, 5) : '—');

const TableDrawer = ({
  open,
  table,
  isCreating,
  restaurantId,
  restaurantName,
  reservation,
  otherReservations = [],
  getStatusInfo,
  statusUpdating,
  canManageTables,
  canManageReservations,
  onClose,
  onStatusChange,
}) => {
  const [mode, setMode] = useState('detail');

  // Al cambiar de mesa (o al pasar a modo creación) siempre se vuelve a 'detail'
  useEffect(() => {
    setMode(isCreating ? 'create-table' : 'detail');
  }, [table?.id, isCreating]);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleClose = useCallback(() => {
    setMode('detail');
    onClose();
  }, [onClose]);

  if (!open) return null;

  const statusInfo = table ? getStatusInfo(table.status) : null;

  return (
    <aside className="table-drawer" role="dialog" aria-label="Detalle de mesa">
      <div className="table-drawer-header">
        <h5 className="table-drawer-title d-flex align-items-center gap-2">
          {statusInfo && (
            <span className="table-drawer-badge-dot" style={{ backgroundColor: statusInfo.color }} />
          )}
          {mode === 'create-table'
            ? 'Nueva mesa'
            : `Mesa ${table?.tableNumber || table?.id}`}
        </h5>
        <button
          type="button"
          className="btn-close"
          onClick={handleClose}
          aria-label="Cerrar"
        />
      </div>

      <div className="table-drawer-body">
        {mode === 'detail' && table && (
          <>
            <div className="table-drawer-details">
              <div className="table-drawer-row">
                <span className="table-drawer-label">Restaurante</span>
                <span className="table-drawer-value">{restaurantName || '—'}</span>
              </div>
              <div className="table-drawer-row">
                <span className="table-drawer-label">Estado</span>
                <span className="table-drawer-value">
                  <span className="table-drawer-status-badge" style={{ backgroundColor: statusInfo.color }}>
                    {statusInfo.label}
                  </span>
                </span>
              </div>
              <div className="table-drawer-row">
                <span className="table-drawer-label">Capacidad</span>
                <span className="table-drawer-value">{table.capacity || '—'} personas</span>
              </div>
              <div className="table-drawer-row">
                <span className="table-drawer-label">Ubicación</span>
                <span className="table-drawer-value">{table.location || 'Sin ubicación'}</span>
              </div>
            </div>

            {reservation && (
              <div className="table-drawer-reservation">
                <p className="table-drawer-section-title">Reserva actual</p>
                <div className="table-drawer-row">
                  <span className="table-drawer-label">Cliente</span>
                  <span className="table-drawer-value">{reservation.customerName || '—'}</span>
                </div>
                {reservation.customerEmail && (
                  <div className="table-drawer-row">
                    <span className="table-drawer-label">Email</span>
                    <span className="table-drawer-value">{reservation.customerEmail}</span>
                  </div>
                )}
                <div className="table-drawer-row">
                  <span className="table-drawer-label">Hora</span>
                  <span className="table-drawer-value">{formatTime(reservation.reservationTime)}</span>
                </div>
                <div className="table-drawer-row">
                  <span className="table-drawer-label">Comensales</span>
                  <span className="table-drawer-value">{reservation.partySize || '—'}</span>
                </div>
                {reservation.notes && (
                  <div className="table-drawer-row">
                    <span className="table-drawer-label">Notas</span>
                    <span className="table-drawer-value">{reservation.notes}</span>
                  </div>
                )}
              </div>
            )}

            {otherReservations.length > 0 && (
              <div className="table-drawer-reservation">
                <p className="table-drawer-section-title">Otras reservas de hoy</p>
                {otherReservations.map((r) => (
                  <div className="table-drawer-row" key={r.id}>
                    <span className="table-drawer-label">{formatTime(r.reservationTime)}</span>
                    <span className="table-drawer-value">
                      {r.customerName || '—'} · {r.partySize || '—'}p
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="table-drawer-actions">
              <p className="table-drawer-section-title">Acciones</p>

              <div className="table-drawer-status-group">
                <span className="table-drawer-label">Cambiar estado</span>
                <div className="table-drawer-status-options">
                  {['AVAILABLE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE']
                    .filter((key) => key !== table.status)
                    .map((key) => {
                      const st = getStatusInfo(key);
                      return (
                        <button
                          key={key}
                          className="table-drawer-status-btn"
                          onClick={() => onStatusChange(table, key)}
                          disabled={statusUpdating === table.id}
                          type="button"
                        >
                          {statusUpdating === table.id ? (
                            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                          ) : (
                            <span className="table-drawer-status-dot" style={{ backgroundColor: st.color }} />
                          )}
                          {st.label}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};

export default TableDrawer;
```

- [ ] **Step 2: Wire the drawer into `FloorPlan.jsx`, remove the modal**

Add the import near the top (after the `FloorPlanCanvas` import, line 15):

```jsx
import FloorPlanCanvas from '../components/FloorPlanCanvas';
import TableDrawer from '../components/TableDrawer';
```

Replace the entire "Modal de detalle de mesa" block (lines 713-847, from `{/* ═══ Modal de detalle de mesa ═══ */}` through its closing `)}`) with:

```jsx
      {/* ═══ Drawer lateral de detalle de mesa ═══════════════════════════ */}
      <TableDrawer
        open={!!selectedTable}
        table={selectedTable}
        isCreating={false}
        restaurantId={selectedRestaurantId ? Number(selectedRestaurantId) : null}
        restaurantName={selectedRestaurantName}
        reservation={selectedTable ? nextReservationByTableId[selectedTable.id] : null}
        otherReservations={
          selectedTable
            ? (reservationsByTableId[selectedTable.id] || []).filter(
                (r) => r.id !== nextReservationByTableId[selectedTable.id]?.id
              )
            : []
        }
        getStatusInfo={getStatusInfo}
        statusUpdating={statusUpdating}
        canManageTables={canAccess(user, PERMISSIONS.MANAGE_TABLES)}
        canManageReservations={canAccess(user, PERMISSIONS.MANAGE_RESERVATIONS)}
        onClose={() => setSelectedTable(null)}
        onStatusChange={handleStatusChange}
      />
```

Note: `isCreating` is hardcoded `false` here — Task 7 wires the real create-mode trigger.

- [ ] **Step 3: Add drawer CSS (shell, no backdrop)**

In `index.css`, add this block right after the `.fpc-legend-hint` rule (after line 825, before the responsive `@media` block at line ~4835):

```css
/* ─── Table Drawer (panel lateral no bloqueante) ──────────────────────── */

.table-drawer {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  width: 380px;
  max-width: 100vw;
  background: var(--bg-card);
  border-left: 1px solid var(--border);
  box-shadow: -8px 0 24px rgba(0, 0, 0, 0.12);
  z-index: 1040;
  display: flex;
  flex-direction: column;
  animation: table-drawer-slide-in 0.2s ease-out;
}

@keyframes table-drawer-slide-in {
  from { transform: translateX(100%); }
  to { transform: translateX(0); }
}

.table-drawer-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}

.table-drawer-title {
  margin: 0;
  font-size: 1rem;
  font-weight: 700;
}

.table-drawer-badge-dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  display: inline-block;
  flex-shrink: 0;
}

.table-drawer-body {
  flex: 1;
  overflow-y: auto;
  padding: 1.25rem;
}

.table-drawer-details,
.table-drawer-reservation,
.table-drawer-actions {
  margin-bottom: 1.5rem;
}

.table-drawer-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.5rem 0;
  border-bottom: 1px solid var(--border);
  gap: 0.75rem;
}

.table-drawer-row:last-child {
  border-bottom: none;
}

.table-drawer-label {
  font-size: 0.8125rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.table-drawer-value {
  font-size: 0.875rem;
  font-weight: 600;
  text-align: right;
}

.table-drawer-status-badge {
  display: inline-block;
  padding: 0.2rem 0.6rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  color: #fff;
}

.table-drawer-section-title {
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: var(--text-muted);
  margin-bottom: 0.5rem;
}

.table-drawer-status-group {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.table-drawer-status-options {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.table-drawer-status-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  border-radius: 8px;
  border: 1px solid var(--border);
  background: var(--bg-card);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all 0.15s ease;
}

.table-drawer-status-btn:hover:not(:disabled) {
  border-color: var(--primary);
  box-shadow: var(--shadow-xs);
}

.table-drawer-status-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.table-drawer-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  display: inline-block;
}

@media (max-width: 480px) {
  .table-drawer {
    width: 100vw;
  }
}
```

- [ ] **Step 4: Verify with lint and build**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: both succeed.

- [ ] **Step 5: Manual check**

Run `pnpm dev`. Open "Plano de sala", click a table. Confirm: the drawer slides in from the right, the plan behind it stays visible and clickable (no dark overlay, no blur), clicking a different table updates the drawer content without closing/reopening, Esc and the ✕ button close it, and changing status from the drawer still works.

- [ ] **Step 6: Commit**

```bash
git add restaurante-frontend/src/components/TableDrawer.jsx restaurante-frontend/src/pages/FloorPlan.jsx restaurante-frontend/src/index.css
git commit -m "feat(floor-plan): sustituir el modal centrado por un drawer lateral no bloqueante"
```

---

## Task 7: Frontend — TableDrawer edit/create/delete table modes

**Files:**
- Modify: `restaurante-frontend/src/components/TableDrawer.jsx`
- Modify: `restaurante-frontend/src/pages/FloorPlan.jsx`
- Modify: `restaurante-frontend/src/index.css`

**Interfaces:**
- Consumes: `tableService.createTable(restaurantId, data)`, `tableService.updateTable(id, data)`, `tableService.deleteTable(id)` (existing, signatures shown in `tableService.js` already read).
- Produces (new `TableDrawer` props): `onTableCreated: (table) => void` (called with the created table so the parent can select it), `onTableSaved: () => void` (edit success), `onTableDeleted: () => void` (delete success).
- Produces (in `FloorPlan.jsx`): state `isCreatingTable`, handler `handleAddTableClick`, handler `handleCloseDrawer` (replaces the inline `() => setSelectedTable(null)` used in Task 6), toolbar button "+ Añadir mesa".

- [ ] **Step 1: Add form state and validation to `TableDrawer`**

In `TableDrawer.jsx`, add near the top (after the `formatTime` helper):

```jsx
const STATUS_OPTIONS = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE'];

const EMPTY_TABLE_FORM = { tableNumber: '', capacity: '', location: '', status: 'AVAILABLE' };

const validateTableForm = (form) => {
  const errors = {};
  if (!String(form.tableNumber || '').trim()) {
    errors.tableNumber = 'El número de mesa es obligatorio.';
  }
  const capacity = form.capacity;
  if (capacity === '' || capacity === null || capacity === undefined) {
    errors.capacity = 'La capacidad es obligatoria.';
  } else if (Number(capacity) < 1 || !Number.isInteger(Number(capacity))) {
    errors.capacity = 'La capacidad debe ser un número entero positivo.';
  }
  return errors;
};

const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};
```

Update the imports line to include the table service functions:

```jsx
import { useState, useEffect, useCallback } from 'react';
import { createTable, updateTable, deleteTable } from '../services/tableService';
```

Add these props to the component signature: `onTableCreated`, `onTableSaved`, `onTableDeleted`:

```jsx
const TableDrawer = ({
  open,
  table,
  isCreating,
  restaurantId,
  restaurantName,
  reservation,
  otherReservations = [],
  getStatusInfo,
  statusUpdating,
  canManageTables,
  canManageReservations,
  onClose,
  onStatusChange,
  onTableCreated,
  onTableSaved,
  onTableDeleted,
}) => {
```

Add form state right after `const [mode, setMode] = useState('detail');`:

```jsx
  const [tableForm, setTableForm] = useState(EMPTY_TABLE_FORM);
  const [tableFormErrors, setTableFormErrors] = useState({});
  const [savingTable, setSavingTable] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingTable, setDeletingTable] = useState(false);
```

- [ ] **Step 2: Reset form state on mode/table change and add handlers**

Replace the existing mode-reset `useEffect`:

```jsx
  useEffect(() => {
    setMode(isCreating ? 'create-table' : 'detail');
    setConfirmingDelete(false);
    setTableFormErrors({});
    if (isCreating) {
      setTableForm(EMPTY_TABLE_FORM);
    } else if (table) {
      setTableForm({
        tableNumber: table.tableNumber ?? '',
        capacity: table.capacity ?? '',
        location: table.location ?? '',
        status: table.status || 'AVAILABLE',
      });
    }
  }, [table?.id, isCreating]);
```

Add handlers right after `handleClose`:

```jsx
  const handleTableFormChange = (e) => {
    const { name, value } = e.target;
    setTableForm((prev) => ({ ...prev, [name]: value }));
    setTableFormErrors((prev) => {
      if (!prev[name]) return prev;
      const updated = { ...prev };
      delete updated[name];
      return updated;
    });
  };

  const handleStartEditTable = () => {
    setTableForm({
      tableNumber: table.tableNumber ?? '',
      capacity: table.capacity ?? '',
      location: table.location ?? '',
      status: table.status || 'AVAILABLE',
    });
    setTableFormErrors({});
    setMode('edit-table');
  };

  const handleSubmitTableForm = async (e) => {
    e.preventDefault();
    const errors = validateTableForm(tableForm);
    if (Object.keys(errors).length > 0) {
      setTableFormErrors(errors);
      return;
    }

    setSavingTable(true);
    setTableFormErrors({});
    try {
      const payload = {
        restaurantId: Number(restaurantId),
        tableNumber: String(tableForm.tableNumber || '').trim(),
        capacity: Number(tableForm.capacity),
        location: (tableForm.location || '').trim(),
        status: tableForm.status || 'AVAILABLE',
      };

      if (mode === 'create-table') {
        const created = await createTable(restaurantId, payload);
        setMode('detail');
        if (onTableCreated) onTableCreated(created);
      } else {
        await updateTable(table.id, payload);
        setMode('detail');
        if (onTableSaved) onTableSaved();
      }
    } catch (err) {
      setTableFormErrors({ submit: getErrorMessage(err) });
    } finally {
      setSavingTable(false);
    }
  };

  const handleConfirmDeleteTable = async () => {
    setDeletingTable(true);
    try {
      await deleteTable(table.id);
      setConfirmingDelete(false);
      if (onTableDeleted) onTableDeleted();
    } catch (err) {
      setTableFormErrors({ submit: getErrorMessage(err) });
      setConfirmingDelete(false);
    } finally {
      setDeletingTable(false);
    }
  };
```

- [ ] **Step 3: Render the table form (shared by create and edit) and the delete danger zone**

Add this block right after the closing `</div>` of `table-drawer-actions` (still inside `{mode === 'detail' && table && ( ... )}`), i.e. append it as the last child of the "Acciones" block, right before its closing `</div>`:

```jsx
              {canManageTables && (
                <div className="table-drawer-action-buttons">
                  <button className="btn btn-outline-primary btn-sm" onClick={handleStartEditTable} type="button">
                    Editar mesa
                  </button>
                  <button
                    className="btn btn-outline-danger btn-sm"
                    onClick={() => setConfirmingDelete(true)}
                    type="button"
                  >
                    Eliminar mesa
                  </button>
                </div>
              )}
```

Now add the delete confirmation and the create/edit form as siblings of the `{mode === 'detail' && table && (...)}` block (right after its closing `)}`, still inside `<div className="table-drawer-body">`):

```jsx
        {mode === 'detail' && table && confirmingDelete && (
          <div className="table-drawer-danger-zone">
            <p className="table-drawer-section-title">Eliminar mesa</p>
            <p className="table-drawer-danger-text">
              Se eliminará la mesa {table.tableNumber || table.id}. Esta acción no se puede deshacer.
            </p>
            <div className="table-drawer-action-buttons">
              <button
                className="btn btn-danger btn-sm"
                onClick={handleConfirmDeleteTable}
                disabled={deletingTable}
                type="button"
              >
                {deletingTable ? 'Eliminando...' : 'Confirmar eliminación'}
              </button>
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setConfirmingDelete(false)}
                disabled={deletingTable}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {(mode === 'edit-table' || mode === 'create-table') && (
          <form onSubmit={handleSubmitTableForm} className="table-drawer-form">
            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-tableNumber">Número de mesa</label>
              <input
                id="drawer-tableNumber"
                name="tableNumber"
                className={`form-control ${tableFormErrors.tableNumber ? 'is-invalid' : ''}`}
                value={tableForm.tableNumber}
                onChange={handleTableFormChange}
              />
              {tableFormErrors.tableNumber && (
                <div className="invalid-feedback">{tableFormErrors.tableNumber}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-capacity">Capacidad</label>
              <input
                id="drawer-capacity"
                name="capacity"
                type="number"
                min="1"
                className={`form-control ${tableFormErrors.capacity ? 'is-invalid' : ''}`}
                value={tableForm.capacity}
                onChange={handleTableFormChange}
              />
              {tableFormErrors.capacity && (
                <div className="invalid-feedback">{tableFormErrors.capacity}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-location">Ubicación</label>
              <input
                id="drawer-location"
                name="location"
                className="form-control"
                value={tableForm.location}
                onChange={handleTableFormChange}
                placeholder="Terraza, salón principal..."
              />
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-status">Estado</label>
              <select
                id="drawer-status"
                name="status"
                className="form-select"
                value={tableForm.status}
                onChange={handleTableFormChange}
              >
                {STATUS_OPTIONS.map((key) => (
                  <option key={key} value={key}>{getStatusInfo(key).label}</option>
                ))}
              </select>
            </div>

            {tableFormErrors.submit && (
              <div className="alert alert-danger py-2 px-3 small">{tableFormErrors.submit}</div>
            )}

            <div className="table-drawer-action-buttons">
              <button className="btn btn-primary btn-sm" type="submit" disabled={savingTable}>
                {savingTable ? 'Guardando...' : 'Guardar'}
              </button>
              <button
                className="btn btn-outline-secondary btn-sm"
                type="button"
                disabled={savingTable}
                onClick={() => (mode === 'create-table' ? handleClose() : setMode('detail'))}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
```

- [ ] **Step 4: Add CSS for the form and danger zone**

In `index.css`, right after the `.table-drawer-status-dot` rule (inside the block added in Task 6), add:

```css
.table-drawer-action-buttons {
  display: flex;
  gap: 0.5rem;
  margin-top: 0.75rem;
}

.table-drawer-danger-zone {
  border: 1px solid #ef4444;
  border-radius: 10px;
  padding: 0.875rem;
  margin-bottom: 1.5rem;
  background: rgba(239, 68, 68, 0.06);
}

.table-drawer-danger-text {
  font-size: 0.8125rem;
  color: var(--text-muted);
  margin-bottom: 0.75rem;
}

.table-drawer-form .form-label {
  font-size: 0.8125rem;
  font-weight: 600;
}
```

- [ ] **Step 5: Wire the "+ Añadir mesa" trigger and mutation callbacks in `FloorPlan.jsx`**

Add `isCreatingTable` state right after `selectedTable` (line 47):

```jsx
  const [selectedTable, setSelectedTable] = useState(null);
  const [isCreatingTable, setIsCreatingTable] = useState(false);
```

These handlers call `reloadPlanData`, which is declared later in the file (around line 244, inside the "Refs y estados para el plano interactivo" section). Add the block immediately **after** the `reloadPlanData` function's closing `}, [selectedRestaurantId]);` (i.e., right before the `handleCancelEdit` function), so there's no forward reference:

```jsx
  const handleCloseDrawer = useCallback(() => {
    setSelectedTable(null);
    setIsCreatingTable(false);
  }, []);

  const handleAddTableClick = useCallback(() => {
    setSelectedTable(null);
    setIsCreatingTable(true);
  }, []);

  const handleTableCreated = useCallback(
    async (created) => {
      setIsCreatingTable(false);
      await reloadPlanData();
      if (created?.id) {
        setSelectedTable(created);
      }
    },
    [reloadPlanData]
  );

  const handleTableMutated = useCallback(async () => {
    setSelectedTable(null);
    setIsCreatingTable(false);
    await reloadPlanData();
  }, [reloadPlanData]);
```

Update the `<TableDrawer>` invocation from Task 6 to use the new handlers and pass the create-mode props:

```jsx
      <TableDrawer
        open={!!selectedTable || isCreatingTable}
        table={selectedTable}
        isCreating={isCreatingTable}
        restaurantId={selectedRestaurantId ? Number(selectedRestaurantId) : null}
        restaurantName={selectedRestaurantName}
        reservation={selectedTable ? nextReservationByTableId[selectedTable.id] : null}
        otherReservations={
          selectedTable
            ? (reservationsByTableId[selectedTable.id] || []).filter(
                (r) => r.id !== nextReservationByTableId[selectedTable.id]?.id
              )
            : []
        }
        getStatusInfo={getStatusInfo}
        statusUpdating={statusUpdating}
        canManageTables={canAccess(user, PERMISSIONS.MANAGE_TABLES)}
        canManageReservations={canAccess(user, PERMISSIONS.MANAGE_RESERVATIONS)}
        onClose={handleCloseDrawer}
        onStatusChange={handleStatusChange}
        onTableCreated={handleTableCreated}
        onTableSaved={handleTableMutated}
        onTableDeleted={handleTableMutated}
      />
```

Add the "+ Añadir mesa" button in the toolbar. In the `fp-toolbar-row` div (lines 349-370), add it as a sibling of `fp-selector-group`:

```jsx
        <div className="fp-toolbar-row">
          <div className="fp-selector-group">
            <label htmlFor="restaurant-select">Restaurante</label>
            <select
              id="restaurant-select"
              className="fp-select"
              value={selectedRestaurantId}
              onChange={handleRestaurantChange}
              disabled={loadingRestaurants}
            >
              {loadingRestaurants && <option value="">Cargando...</option>}
              {!loadingRestaurants && restaurants.length === 0 && (
                <option value="">Sin restaurantes</option>
              )}
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {selectedRestaurantId && canAccess(user, PERMISSIONS.MANAGE_TABLES) && (
            <button
              className="btn btn-primary btn-sm d-flex align-items-center gap-2"
              onClick={handleAddTableClick}
              type="button"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Añadir mesa
            </button>
          )}
        </div>
```

Finally, update the empty-state "Crear primera mesa" button (around line 660-666) to open the drawer instead of navigating:

```jsx
          <button
            className="btn btn-primary"
            onClick={handleAddTableClick}
            type="button"
          >
            Crear primera mesa
          </button>
```

(This replaces the `onClick={() => navigate('/tables')}` in that specific empty-state block only — the "No hay restaurantes" empty state a few lines above it, which still navigates to `/restaurants`, is untouched.)

- [ ] **Step 6: Verify with lint and build**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: both succeed. `deleteTable`/`createTable`/`updateTable` unused-import lint errors would indicate a wiring mistake — fix before proceeding.

- [ ] **Step 7: Manual check**

Run `pnpm dev`. Click "+ Añadir mesa", fill the form, save — confirm the new table appears on the plan and its drawer opens in detail mode. Open an existing table, click "Editar mesa", change the location, save — confirm it persists. Click "Eliminar mesa", confirm — the table disappears from the plan and the drawer closes.

- [ ] **Step 8: Commit**

```bash
git add restaurante-frontend/src/components/TableDrawer.jsx restaurante-frontend/src/pages/FloorPlan.jsx restaurante-frontend/src/index.css
git commit -m "feat(floor-plan): crear, editar y eliminar mesas desde el drawer"
```

---

## Task 8: Frontend — TableDrawer edit/cancel reservation modes

**Files:**
- Modify: `restaurante-frontend/src/components/TableDrawer.jsx`
- Modify: `restaurante-frontend/src/pages/FloorPlan.jsx`

**Interfaces:**
- Consumes: `reservationService.updateReservation(id, data)`, `reservationService.deleteReservation(id)` (existing).
- Produces (new `TableDrawer` prop): `onReservationChanged: () => void` (called after a successful edit or cancel, parent refetches).

- [ ] **Step 1: Add reservation form state and helpers**

In `TableDrawer.jsx`, update the import line:

```jsx
import { updateReservation, deleteReservation } from '../services/reservationService';
```

Add near `EMPTY_TABLE_FORM`:

```jsx
const RESERVATION_STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pendiente' },
  { value: 'CONFIRMED', label: 'Confirmada' },
  { value: 'CANCELLED', label: 'Cancelada' },
  { value: 'COMPLETED', label: 'Completada' },
  { value: 'NO_SHOW', label: 'No presentado' },
];

const validateReservationForm = (form) => {
  const errors = {};
  if (!form.reservationDate) errors.reservationDate = 'La fecha es obligatoria.';
  if (!form.reservationTime) errors.reservationTime = 'La hora es obligatoria.';
  const partySize = Number(form.partySize);
  if (!form.partySize || partySize < 1 || !Number.isInteger(partySize)) {
    errors.partySize = 'Debe ser un número entero mayor a 0.';
  }
  return errors;
};
```

Add the prop `onReservationChanged` to the component signature (alongside `onTableCreated` etc.), and add state right after `const [deletingTable, setDeletingTable] = useState(false);`:

```jsx
  const [reservationForm, setReservationForm] = useState(null);
  const [reservationFormErrors, setReservationFormErrors] = useState({});
  const [savingReservation, setSavingReservation] = useState(false);
  const [confirmingCancelReservation, setConfirmingCancelReservation] = useState(false);
  const [cancelingReservation, setCancelingReservation] = useState(false);
```

- [ ] **Step 2: Add handlers**

Add right after `handleConfirmDeleteTable`:

```jsx
  const handleStartEditReservation = () => {
    if (!reservation) return;
    setReservationForm({
      reservationDate: reservation.reservationDate
        ? String(reservation.reservationDate).substring(0, 10)
        : '',
      reservationTime: reservation.reservationTime
        ? String(reservation.reservationTime).substring(0, 5)
        : '',
      partySize: reservation.partySize ?? '2',
      notes: reservation.notes || '',
      status: reservation.status || 'PENDING',
    });
    setReservationFormErrors({});
    setMode('edit-reservation');
  };

  const handleReservationFormChange = (e) => {
    const { name, value } = e.target;
    setReservationForm((prev) => ({ ...prev, [name]: value }));
    setReservationFormErrors((prev) => {
      if (!prev[name]) return prev;
      const updated = { ...prev };
      delete updated[name];
      return updated;
    });
  };

  const handleSubmitReservationForm = async (e) => {
    e.preventDefault();
    const errors = validateReservationForm(reservationForm);
    if (Object.keys(errors).length > 0) {
      setReservationFormErrors(errors);
      return;
    }

    setSavingReservation(true);
    setReservationFormErrors({});
    try {
      const payload = {
        customerId: reservation.customerId,
        restaurantId: Number(restaurantId),
        diningTableId: reservation.diningTableId,
        reservationDate: reservationForm.reservationDate,
        reservationTime: `${String(reservationForm.reservationTime).substring(0, 5)}:00`,
        partySize: Number(reservationForm.partySize),
        notes: (reservationForm.notes || '').trim(),
        status: reservationForm.status || 'PENDING',
      };
      await updateReservation(reservation.id, payload);
      setMode('detail');
      if (onReservationChanged) onReservationChanged();
    } catch (err) {
      setReservationFormErrors({ submit: getErrorMessage(err) });
    } finally {
      setSavingReservation(false);
    }
  };

  const handleConfirmCancelReservation = async () => {
    if (!reservation) return;
    setCancelingReservation(true);
    try {
      await deleteReservation(reservation.id);
      setConfirmingCancelReservation(false);
      if (onReservationChanged) onReservationChanged();
    } catch (err) {
      setReservationFormErrors({ submit: getErrorMessage(err) });
      setConfirmingCancelReservation(false);
    } finally {
      setCancelingReservation(false);
    }
  };
```

- [ ] **Step 3: Render reservation action buttons, cancel confirmation, and the edit form**

Inside the `{reservation && ( ... )}` block from Task 6 (the "Reserva actual" section), add action buttons right before its closing `</div>`:

```jsx
                {canManageReservations && (
                  <div className="table-drawer-action-buttons">
                    <button className="btn btn-outline-primary btn-sm" onClick={handleStartEditReservation} type="button">
                      Editar reserva
                    </button>
                    <button
                      className="btn btn-outline-danger btn-sm"
                      onClick={() => setConfirmingCancelReservation(true)}
                      type="button"
                    >
                      Cancelar reserva
                    </button>
                  </div>
                )}
```

Add the cancel-confirmation block and the edit-reservation form as new siblings at the end of `table-drawer-body`, right after the `{(mode === 'edit-table' || mode === 'create-table') && ( ... )}` block from Task 7:

```jsx
        {mode === 'detail' && reservation && confirmingCancelReservation && (
          <div className="table-drawer-danger-zone">
            <p className="table-drawer-section-title">Cancelar reserva</p>
            <p className="table-drawer-danger-text">
              Se cancelará la reserva de {reservation.customerName || 'este cliente'} a las{' '}
              {formatTime(reservation.reservationTime)}.
            </p>
            <div className="table-drawer-action-buttons">
              <button
                className="btn btn-danger btn-sm"
                onClick={handleConfirmCancelReservation}
                disabled={cancelingReservation}
                type="button"
              >
                {cancelingReservation ? 'Cancelando...' : 'Confirmar cancelación'}
              </button>
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={() => setConfirmingCancelReservation(false)}
                disabled={cancelingReservation}
                type="button"
              >
                Volver
              </button>
            </div>
          </div>
        )}

        {mode === 'edit-reservation' && reservationForm && (
          <form onSubmit={handleSubmitReservationForm} className="table-drawer-form">
            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-res-date">Fecha</label>
              <input
                id="drawer-res-date"
                name="reservationDate"
                type="date"
                className={`form-control ${reservationFormErrors.reservationDate ? 'is-invalid' : ''}`}
                value={reservationForm.reservationDate}
                onChange={handleReservationFormChange}
              />
              {reservationFormErrors.reservationDate && (
                <div className="invalid-feedback">{reservationFormErrors.reservationDate}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-res-time">Hora</label>
              <input
                id="drawer-res-time"
                name="reservationTime"
                type="time"
                className={`form-control ${reservationFormErrors.reservationTime ? 'is-invalid' : ''}`}
                value={reservationForm.reservationTime}
                onChange={handleReservationFormChange}
              />
              {reservationFormErrors.reservationTime && (
                <div className="invalid-feedback">{reservationFormErrors.reservationTime}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-res-party">Comensales</label>
              <input
                id="drawer-res-party"
                name="partySize"
                type="number"
                min="1"
                className={`form-control ${reservationFormErrors.partySize ? 'is-invalid' : ''}`}
                value={reservationForm.partySize}
                onChange={handleReservationFormChange}
              />
              {reservationFormErrors.partySize && (
                <div className="invalid-feedback">{reservationFormErrors.partySize}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-res-notes">Notas</label>
              <textarea
                id="drawer-res-notes"
                name="notes"
                className="form-control"
                rows={2}
                value={reservationForm.notes}
                onChange={handleReservationFormChange}
              />
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-res-status">Estado</label>
              <select
                id="drawer-res-status"
                name="status"
                className="form-select"
                value={reservationForm.status}
                onChange={handleReservationFormChange}
              >
                {RESERVATION_STATUS_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {reservationFormErrors.submit && (
              <div className="alert alert-danger py-2 px-3 small">{reservationFormErrors.submit}</div>
            )}

            <div className="table-drawer-action-buttons">
              <button className="btn btn-primary btn-sm" type="submit" disabled={savingReservation}>
                {savingReservation ? 'Guardando...' : 'Guardar'}
              </button>
              <button
                className="btn btn-outline-secondary btn-sm"
                type="button"
                disabled={savingReservation}
                onClick={() => setMode('detail')}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
```

Also reset `confirmingCancelReservation` in the mode-reset `useEffect` from Task 7 — add `setConfirmingCancelReservation(false);` alongside `setConfirmingDelete(false);`.

- [ ] **Step 4: Wire the callback in `FloorPlan.jsx`**

Add `onReservationChanged={handleTableMutated}` to the `<TableDrawer>` invocation (reuses the same refetch-and-close handler from Task 7 — a reservation change also affects the table's displayed status/info, so a full refresh is correct here too):

```jsx
        onTableCreated={handleTableCreated}
        onTableSaved={handleTableMutated}
        onTableDeleted={handleTableMutated}
        onReservationChanged={handleTableMutated}
      />
```

- [ ] **Step 5: Verify with lint and build**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: both succeed.

- [ ] **Step 6: Manual check**

Run `pnpm dev`. Open a table with a reservation today. Click "Editar reserva", change the party size, save — confirm the tile and drawer reflect the new value. Click "Cancelar reserva", confirm — confirm the reservation info disappears from both the tile and the drawer.

- [ ] **Step 7: Commit**

```bash
git add restaurante-frontend/src/components/TableDrawer.jsx restaurante-frontend/src/pages/FloorPlan.jsx
git commit -m "feat(floor-plan): editar y cancelar reservas desde el drawer"
```

---

## Task 9: Frontend — remove /tables route, page, and nav entries

**Files:**
- Modify: `restaurante-frontend/src/App.jsx`
- Modify: `restaurante-frontend/src/components/Sidebar.jsx:86`
- Modify: `restaurante-frontend/src/components/Navbar.jsx:10`
- Modify: `restaurante-frontend/src/config/permissions.js:107,121`
- Delete: `restaurante-frontend/src/pages/Tables.jsx`

**Interfaces:** None — this task only removes dead navigation surface. `PERMISSIONS.VIEW_TABLES` / `MANAGE_TABLES` are kept (still used by `TableDrawer.jsx` from Tasks 6-8).

- [ ] **Step 1: Redirect `/tables` in `App.jsx`**

Remove the `Tables` import (line 12) and the `/tables` route (line 44), then add a redirect next to the other legacy redirects. Full replacement of the routes section:

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
        <Route path="/employees" element={<PermissionRoute permission={PERMISSIONS.VIEW_EMPLOYEES}><Employees /></PermissionRoute>} />
      </Route>

      {/* Redirecciones — /inicio es la ruta canónica; /dashboard, /analytics y /tables
          se mantienen por compatibilidad con enlaces existentes */}
      <Route path="/" element={<Navigate to="/inicio" replace />} />
      <Route path="/dashboard" element={<Navigate to="/inicio" replace />} />
      <Route path="/analytics" element={<Navigate to="/inicio" replace />} />
      <Route path="/tables" element={<Navigate to="/floor-plan" replace />} />
      <Route path="*" element={<Navigate to="/inicio" replace />} />
    </Routes>
  );
}

export default App;
```

- [ ] **Step 2: Remove the sidebar entry**

In `Sidebar.jsx`, remove line 86 (`{ path: '/tables', label: 'Gestión de mesas', icon: 'tables' },`) from the `ADMINISTRACIÓN` group, so it reads:

```jsx
  {
    title: 'ADMINISTRACIÓN',
    items: [
      { path: '/restaurants', label: 'Restaurantes', icon: 'restaurants' },
      { path: '/employees', label: 'Empleados', icon: 'employees' },
    ],
  },
```

- [ ] **Step 3: Remove the breadcrumb entry**

In `Navbar.jsx`, remove line 10 (`'/tables': { parent: null, label: 'Gestión de mesas' },`) from `breadcrumbMap`.

- [ ] **Step 4: Remove `/tables` from the route-permission maps**

In `permissions.js`, remove the `'/tables': PERMISSIONS.VIEW_TABLES,` line from both `ROUTE_PERMISSIONS` (line 107) and `SIDEBAR_PERMISSIONS` (line 121). Leave `PERMISSIONS.VIEW_TABLES` / `MANAGE_TABLES` and their entries in `ROLE_PERMISSIONS` and `DENIED_MESSAGES` untouched — they're still used as action-level permissions inside `TableDrawer.jsx`.

- [ ] **Step 5: Delete the page**

```bash
git rm restaurante-frontend/src/pages/Tables.jsx
```

- [ ] **Step 6: Verify with lint and build**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: both succeed, no "unused import" or "module not found" errors.

- [ ] **Step 7: Manual check**

Run `pnpm dev`. Confirm the sidebar no longer shows "Gestión de mesas". Navigate directly to `http://localhost:5173/tables` — confirm it redirects to `/floor-plan`.

- [ ] **Step 8: Commit**

```bash
git add restaurante-frontend/src/App.jsx restaurante-frontend/src/components/Sidebar.jsx restaurante-frontend/src/components/Navbar.jsx restaurante-frontend/src/config/permissions.js
git commit -m "refactor(frontend): eliminar la pantalla Gestión de mesas, /tables redirige al plano de sala"
```

---

## Task 10: End-to-end verification

**Files:** None modified — verification only.

- [ ] **Step 1: Full backend test suite**

Run: `cd restaurante_manage && mvn test`
Expected: `BUILD SUCCESS`, all tests pass (no regressions from Tasks 1-3).

- [ ] **Step 2: Full frontend lint + build**

Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: both succeed.

- [ ] **Step 3: Manual end-to-end walkthrough**

Start both servers:

```bash
cd restaurante_manage && mvn spring-boot:run -Dspring-boot.run.profiles=dev
```

```bash
cd restaurante-frontend && pnpm dev
```

Log in as `juan.admin` / `admin123` and, on "Plano de sala":

1. Click "+ Añadir mesa", create a table "T-99", capacity 4 — confirm it appears on the plan and the drawer opens showing it.
2. In the drawer, use "Cambiar estado" to set it to `RESERVED` — confirm the tile's status color updates live.
3. Go to `/reservations`, create a reservation for today on table T-99 (any customer, any time, `CONFIRMED`).
4. Return to "Plano de sala" — confirm the T-99 tile now shows the customer's name, time, and party size instead of just the capacity number.
5. Click T-99 — confirm the drawer's "Reserva actual" section shows the same customer/time/party-size/notes.
6. Click "Editar reserva", change the party size, save — confirm both the drawer and the tile update.
7. Click "Editar mesa", change the location, save — confirm the drawer reflects the new location.
8. Click "Cancelar reserva", confirm — confirm the reservation info disappears from the tile and drawer.
9. Click "Eliminar mesa", confirm — confirm T-99 disappears from the plan.
10. Throughout steps 1-9, confirm: the plan behind the drawer is always visible, never dimmed or blurred, and remains clickable (clicking another table while the drawer is open swaps its content immediately).
11. Navigate to `http://localhost:5173/tables` — confirm it redirects to `/floor-plan`.
12. Confirm the sidebar has no "Gestión de mesas" entry.

If any step fails, fix the underlying task before proceeding — do not patch around it here.

- [ ] **Step 4: Report**

No commit for this task (verification only). Summarize the walkthrough result to the user.
