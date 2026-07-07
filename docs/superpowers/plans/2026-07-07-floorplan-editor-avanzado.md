# Editor avanzado del plano de sala — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir en el modo edición del plano cambiar la forma de las mesas (redonda/cuadrada/rectangular), añadir/mover/rotar/eliminar elementos decorativos (barra de bar, puerta de entrada) y persistirlo todo en el backend.

**Architecture:** Nuevo paquete backend `floorplan` (entidad `FloorPlanElement` + endpoints GET/PUT batch por restaurante con reemplazo idempotente y soft delete). En el frontend, `FloorPlanCanvas` gana estado local de edición (formas y elementos) con un panel flotante de propiedades, y `FloorPlan.jsx` guarda mesas y elementos en dos llamadas y recarga del servidor tras guardar.

**Tech Stack:** Spring Boot 3.3 / Java 21 / JPA / Mockito · React 19 + Vite (sin librería de estado; CSS propio con prefijo `fpc-`).

**Spec:** `docs/superpowers/specs/2026-07-07-floorplan-editor-avanzado-design.md`

## Global Constraints

- Código, comentarios, textos de UI y mensajes de commit en **español**; commits Conventional Commits (`feat(floorplan): ...`).
- Rutas y roles del backend como constantes en `common/util/Constants.java` — nunca strings inline.
- Todas las queries de repositorio filtran soft delete (`...AndDeletedFalse`).
- Scoping multi-tenant SIEMPRE vía `CurrentUserService.canAccessRestaurant(restaurantId)` en el servicio.
- El esquema en prod lo gestiona **Flyway** (`db/migration/V*.sql`, MySQL) con `ddl-auto: validate` — toda entidad nueva necesita su migración. En el perfil dev, Flyway está desactivado y `ddl-auto: create-drop` crea el esquema (H2).
- Frontend sin tests: verificación = `pnpm lint` + walkthrough manual (Task 7).
- Comandos backend se ejecutan desde `restaurante_manage/`; frontend desde `restaurante-frontend/`.

---

### Task 1: Backend — modelo de datos del paquete `floorplan`

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/floorplan/enums/ElementType.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/floorplan/entity/FloorPlanElement.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/floorplan/repository/FloorPlanElementRepository.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/floorplan/dto/FloorPlanElementRequest.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/floorplan/dto/FloorPlanElementResponse.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/floorplan/dto/FloorPlanElementMapper.java`
- Create: `restaurante_manage/src/main/resources/db/migration/V3__floor_plan_elements.sql`
- Modify: `restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java` (tras la constante `TABLES_PATH`, línea ~24)

**Interfaces:**
- Consumes: `BaseEntity` (auditoría/soft delete), `Restaurant`.
- Produces: entidad `FloorPlanElement` (getters/setters bean), `FloorPlanElementRepository.findByRestaurantIdAndDeletedFalse(Long)`, DTOs `FloorPlanElementRequest` (getId/getType/getXPosition/getYPosition/getWidth/getHeight/getRotation), `FloorPlanElementResponse` (mismos campos + restaurantId, `type` como String), `FloorPlanElementMapper.toResponse(FloorPlanElement)`, constante `Constants.FLOOR_PLAN_ELEMENTS_SUBPATH`.

- [ ] **Step 1: Crear el enum `ElementType`**

```java
package com.restaurante.floorplan.enums;

/**
 * Tipos de elementos decorativos del plano de sala.
 */
public enum ElementType {
    BAR,
    DOOR
}
```

- [ ] **Step 2: Crear la entidad `FloorPlanElement`**

```java
package com.restaurante.floorplan.entity;

import com.restaurante.common.audit.BaseEntity;
import com.restaurante.floorplan.enums.ElementType;
import com.restaurante.restaurant.entity.Restaurant;
import jakarta.persistence.*;

/**
 * Elemento decorativo del plano de sala (barra de bar, puerta de entrada...).
 * No es una mesa: no tiene estado ni capacidad, solo posición y visualización.
 */
@Entity
@Table(name = "floor_plan_elements")
public class FloorPlanElement extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "restaurant_id", nullable = false)
    private Restaurant restaurant;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private ElementType type;

    @Column(name = "x_position", nullable = false)
    private Integer xPosition;

    @Column(name = "y_position", nullable = false)
    private Integer yPosition;

    @Column(name = "width")
    private Integer width;

    @Column(name = "height")
    private Integer height;

    @Column(name = "rotation")
    private Integer rotation;

    public FloorPlanElement() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Restaurant getRestaurant() {
        return restaurant;
    }

    public void setRestaurant(Restaurant restaurant) {
        this.restaurant = restaurant;
    }

    public ElementType getType() {
        return type;
    }

    public void setType(ElementType type) {
        this.type = type;
    }

    public Integer getXPosition() {
        return xPosition;
    }

    public void setXPosition(Integer xPosition) {
        this.xPosition = xPosition;
    }

    public Integer getYPosition() {
        return yPosition;
    }

    public void setYPosition(Integer yPosition) {
        this.yPosition = yPosition;
    }

    public Integer getWidth() {
        return width;
    }

    public void setWidth(Integer width) {
        this.width = width;
    }

    public Integer getHeight() {
        return height;
    }

    public void setHeight(Integer height) {
        this.height = height;
    }

    public Integer getRotation() {
        return rotation;
    }

    public void setRotation(Integer rotation) {
        this.rotation = rotation;
    }
}
```

- [ ] **Step 3: Crear el repositorio**

```java
package com.restaurante.floorplan.repository;

import com.restaurante.floorplan.entity.FloorPlanElement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface FloorPlanElementRepository extends JpaRepository<FloorPlanElement, Long> {

    List<FloorPlanElement> findByRestaurantIdAndDeletedFalse(Long restaurantId);
}
```

- [ ] **Step 4: Crear los DTOs y el mapper**

`FloorPlanElementRequest.java`:

```java
package com.restaurante.floorplan.dto;

import com.restaurante.floorplan.enums.ElementType;

/**
 * DTO para crear/actualizar un elemento del plano de sala.
 * Sin id = crear; con id = actualizar el elemento existente.
 * La validación de campos obligatorios se hace en el servicio (payload batch).
 */
public class FloorPlanElementRequest {

    private Long id;
    private ElementType type;
    private Integer xPosition;
    private Integer yPosition;
    private Integer width;
    private Integer height;
    private Integer rotation;

    public FloorPlanElementRequest() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public ElementType getType() {
        return type;
    }

    public void setType(ElementType type) {
        this.type = type;
    }

    public Integer getXPosition() {
        return xPosition;
    }

    public void setXPosition(Integer xPosition) {
        this.xPosition = xPosition;
    }

    public Integer getYPosition() {
        return yPosition;
    }

    public void setYPosition(Integer yPosition) {
        this.yPosition = yPosition;
    }

    public Integer getWidth() {
        return width;
    }

    public void setWidth(Integer width) {
        this.width = width;
    }

    public Integer getHeight() {
        return height;
    }

    public void setHeight(Integer height) {
        this.height = height;
    }

    public Integer getRotation() {
        return rotation;
    }

    public void setRotation(Integer rotation) {
        this.rotation = rotation;
    }
}
```

`FloorPlanElementResponse.java`:

```java
package com.restaurante.floorplan.dto;

/**
 * DTO de respuesta de un elemento del plano de sala.
 */
public class FloorPlanElementResponse {

    private Long id;
    private Long restaurantId;
    private String type;
    private Integer xPosition;
    private Integer yPosition;
    private Integer width;
    private Integer height;
    private Integer rotation;

    public FloorPlanElementResponse() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getRestaurantId() {
        return restaurantId;
    }

    public void setRestaurantId(Long restaurantId) {
        this.restaurantId = restaurantId;
    }

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
    }

    public Integer getXPosition() {
        return xPosition;
    }

    public void setXPosition(Integer xPosition) {
        this.xPosition = xPosition;
    }

    public Integer getYPosition() {
        return yPosition;
    }

    public void setYPosition(Integer yPosition) {
        this.yPosition = yPosition;
    }

    public Integer getWidth() {
        return width;
    }

    public void setWidth(Integer width) {
        this.width = width;
    }

    public Integer getHeight() {
        return height;
    }

    public void setHeight(Integer height) {
        this.height = height;
    }

    public Integer getRotation() {
        return rotation;
    }

    public void setRotation(Integer rotation) {
        this.rotation = rotation;
    }
}
```

`FloorPlanElementMapper.java`:

```java
package com.restaurante.floorplan.dto;

import com.restaurante.floorplan.entity.FloorPlanElement;
import org.springframework.stereotype.Component;

@Component
public class FloorPlanElementMapper {

    public FloorPlanElementResponse toResponse(FloorPlanElement element) {
        if (element == null) {
            return null;
        }
        FloorPlanElementResponse response = new FloorPlanElementResponse();
        response.setId(element.getId());
        response.setRestaurantId(element.getRestaurant().getId());
        response.setType(element.getType().name());
        response.setXPosition(element.getXPosition());
        response.setYPosition(element.getYPosition());
        response.setWidth(element.getWidth());
        response.setHeight(element.getHeight());
        response.setRotation(element.getRotation());
        return response;
    }
}
```

- [ ] **Step 5: Añadir la constante de ruta en `Constants.java`**

Tras el bloque `// Tables` (línea ~24), añadir:

```java
    // Floor plan (elementos decorativos del plano de sala)
    public static final String FLOOR_PLAN_ELEMENTS_SUBPATH = "/floor-plan/elements";
```

- [ ] **Step 6: Crear la migración Flyway `V3__floor_plan_elements.sql`**

Prod usa Flyway + `ddl-auto: validate`, así que la tabla debe crearse por migración
(mismas convenciones que `V1__baseline_schema.sql`: InnoDB, utf8mb4, enum de MySQL
para `@Enumerated(STRING)` — igual que `dining_tables.status`):

```sql
-- ============================================================================
-- V3 — Elementos decorativos del plano de sala (barra, puerta...)
-- ============================================================================

CREATE TABLE `floor_plan_elements` (
  `deleted` bit(1) NOT NULL,
  `height` int DEFAULT NULL,
  `rotation` int DEFAULT NULL,
  `width` int DEFAULT NULL,
  `x_position` int NOT NULL,
  `y_position` int NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `id` bigint NOT NULL AUTO_INCREMENT,
  `restaurant_id` bigint NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `type` enum('BAR','DOOR') COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_floor_plan_elements_restaurant` (`restaurant_id`),
  CONSTRAINT `fk_floor_plan_elements_restaurant` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

- [ ] **Step 7: Compilar**

Run: `mvn -q compile` (en `restaurante_manage/`)
Expected: BUILD SUCCESS sin errores de compilación.

- [ ] **Step 8: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/floorplan restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java restaurante_manage/src/main/resources/db/migration/V3__floor_plan_elements.sql
git commit -m "feat(floorplan): modelo de elementos decorativos del plano de sala"
```

---

### Task 2: Backend — `FloorPlanElementService` (TDD)

**Files:**
- Create: `restaurante_manage/src/test/java/com/restaurante/floorplan/service/FloorPlanElementServiceTest.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/floorplan/service/FloorPlanElementService.java`

**Interfaces:**
- Consumes: Task 1 (`FloorPlanElement`, `FloorPlanElementRepository`, DTOs, mapper), `CurrentUserService.canAccessRestaurant(Long)` / `getCurrentUsername()` / `getCurrentRoles()` / `getCurrentTenantId()` / `getAssignedRestaurantIds()`, `RestaurantRepository.findByIdAndDeletedFalse(Long)` y `findById(Long)`, excepciones `ResourceNotFoundException(String, String, Object)`, `BadRequestException(String)`, `AccessDeniedException(String)` de `com.restaurante.common.exception`.
- Produces: `FloorPlanElementService.findByRestaurantId(Long) : List<FloorPlanElementResponse>` y `FloorPlanElementService.replaceElements(Long, List<FloorPlanElementRequest>) : List<FloorPlanElementResponse>`.

- [ ] **Step 1: Escribir el test unitario (fallará al no existir el servicio)**

```java
package com.restaurante.floorplan.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.floorplan.dto.FloorPlanElementMapper;
import com.restaurante.floorplan.dto.FloorPlanElementRequest;
import com.restaurante.floorplan.dto.FloorPlanElementResponse;
import com.restaurante.floorplan.entity.FloorPlanElement;
import com.restaurante.floorplan.enums.ElementType;
import com.restaurante.floorplan.repository.FloorPlanElementRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.Spy;
import org.mockito.junit.jupiter.MockitoExtension;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
class FloorPlanElementServiceTest {

    private static final Long RESTAURANT_ID = 1L;

    @Mock
    private FloorPlanElementRepository floorPlanElementRepository;

    @Mock
    private RestaurantRepository restaurantRepository;

    @Mock
    private CurrentUserService currentUserService;

    @Spy
    private FloorPlanElementMapper floorPlanElementMapper = new FloorPlanElementMapper();

    @InjectMocks
    private FloorPlanElementService service;

    private Restaurant restaurant;

    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);
    }

    private void permitirAcceso() {
        when(currentUserService.canAccessRestaurant(RESTAURANT_ID)).thenReturn(true);
        when(restaurantRepository.findById(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
    }

    private FloorPlanElement elementoExistente(Long id, ElementType type, int x, int y) {
        FloorPlanElement element = new FloorPlanElement();
        element.setId(id);
        element.setRestaurant(restaurant);
        element.setType(type);
        element.setXPosition(x);
        element.setYPosition(y);
        element.setWidth(200);
        element.setHeight(60);
        element.setRotation(0);
        return element;
    }

    private FloorPlanElementRequest request(Long id, ElementType type, int x, int y) {
        FloorPlanElementRequest req = new FloorPlanElementRequest();
        req.setId(id);
        req.setType(type);
        req.setXPosition(x);
        req.setYPosition(y);
        req.setWidth(200);
        req.setHeight(60);
        req.setRotation(0);
        return req;
    }

    @Test
    void replaceElements_creaElementosNuevosSinId() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(List.of());

        List<FloorPlanElementResponse> result =
                service.replaceElements(RESTAURANT_ID, List.of(request(null, ElementType.BAR, 100, 50)));

        assertEquals(1, result.size());
        assertEquals("BAR", result.get(0).getType());

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<FloorPlanElement>> captor = ArgumentCaptor.forClass(List.class);
        verify(floorPlanElementRepository).saveAll(captor.capture());
        FloorPlanElement guardado = captor.getValue().get(0);
        assertEquals(restaurant, guardado.getRestaurant());
        assertEquals(ElementType.BAR, guardado.getType());
        assertFalse(guardado.getDeleted());
    }

    @Test
    void replaceElements_actualizaElementosExistentesConId() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        FloorPlanElement existente = elementoExistente(5L, ElementType.DOOR, 0, 0);
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(existente));

        List<FloorPlanElementResponse> result =
                service.replaceElements(RESTAURANT_ID, List.of(request(5L, ElementType.DOOR, 300, 120)));

        assertEquals(1, result.size());
        assertEquals(300, existente.getXPosition());
        assertEquals(120, existente.getYPosition());
        assertFalse(existente.getDeleted());
    }

    @Test
    void replaceElements_softDeleteDeLosOmitidos() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        FloorPlanElement mantener = elementoExistente(5L, ElementType.BAR, 10, 10);
        FloorPlanElement eliminar = elementoExistente(6L, ElementType.DOOR, 20, 20);
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(mantener, eliminar));

        List<FloorPlanElementResponse> result =
                service.replaceElements(RESTAURANT_ID, List.of(request(5L, ElementType.BAR, 10, 10)));

        assertEquals(1, result.size());
        assertEquals(5L, result.get(0).getId());
        assertTrue(eliminar.getDeleted());
        assertNotNull(eliminar.getDeletedAt());
        assertFalse(mantener.getDeleted());
    }

    @Test
    void replaceElements_rechazaIdsDeOtroRestaurante() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(List.of());

        assertThrows(BadRequestException.class, () ->
                service.replaceElements(RESTAURANT_ID, List.of(request(99L, ElementType.BAR, 0, 0))));
        verify(floorPlanElementRepository, never()).saveAll(anyList());
    }

    @Test
    void replaceElements_rechazaElementosSinCamposObligatorios() {
        permitirAcceso();
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));

        FloorPlanElementRequest sinTipo = request(null, null, 10, 10);

        assertThrows(BadRequestException.class, () ->
                service.replaceElements(RESTAURANT_ID, List.of(sinTipo)));
        verify(floorPlanElementRepository, never()).saveAll(anyList());
    }

    @Test
    void replaceElements_deniegaAccesoSinPermiso() {
        when(currentUserService.canAccessRestaurant(RESTAURANT_ID)).thenReturn(false);
        when(restaurantRepository.findById(RESTAURANT_ID)).thenReturn(Optional.empty());

        assertThrows(AccessDeniedException.class, () ->
                service.replaceElements(RESTAURANT_ID, List.of()));
    }

    @Test
    void findByRestaurantId_devuelveElementosMapeados() {
        permitirAcceso();
        when(floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(elementoExistente(5L, ElementType.BAR, 10, 10)));

        List<FloorPlanElementResponse> result = service.findByRestaurantId(RESTAURANT_ID);

        assertEquals(1, result.size());
        assertEquals("BAR", result.get(0).getType());
        assertEquals(RESTAURANT_ID, result.get(0).getRestaurantId());
    }
}
```

Nota: si la entidad `Restaurant` no tuviera constructor vacío + `setId`, adapta `setUp()` usando el constructor/builder que exista en `restaurant/entity/Restaurant.java` (comprueba el fichero); el resto del test no cambia.

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `mvn test -Dtest=FloorPlanElementServiceTest` (en `restaurante_manage/`)
Expected: FALLA la compilación con "cannot find symbol: class FloorPlanElementService".

- [ ] **Step 3: Implementar el servicio**

```java
package com.restaurante.floorplan.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.floorplan.dto.FloorPlanElementMapper;
import com.restaurante.floorplan.dto.FloorPlanElementRequest;
import com.restaurante.floorplan.dto.FloorPlanElementResponse;
import com.restaurante.floorplan.entity.FloorPlanElement;
import com.restaurante.floorplan.repository.FloorPlanElementRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class FloorPlanElementService {

    private static final Logger log = LoggerFactory.getLogger(FloorPlanElementService.class);

    private final FloorPlanElementRepository floorPlanElementRepository;
    private final RestaurantRepository restaurantRepository;
    private final FloorPlanElementMapper floorPlanElementMapper;
    private final CurrentUserService currentUserService;

    public List<FloorPlanElementResponse> findByRestaurantId(Long restaurantId) {
        checkFloorPlanAccess(restaurantId, "LISTAR_ELEMENTOS_PLANO");
        return floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(restaurantId).stream()
                .map(floorPlanElementMapper::toResponse)
                .collect(Collectors.toList());
    }

    /**
     * Reemplaza el conjunto de elementos del plano de un restaurante (idempotente):
     * - Requests con id → actualizan el elemento existente.
     * - Requests sin id → crean un elemento nuevo.
     * - Elementos existentes no incluidos en el payload → soft delete.
     */
    @Transactional
    public List<FloorPlanElementResponse> replaceElements(
            Long restaurantId, List<FloorPlanElementRequest> requests) {

        log.info("[FloorPlan] Saving elements for restaurantId={}, elements received={}",
                restaurantId, requests != null ? requests.size() : 0);

        checkFloorPlanAccess(restaurantId, "GUARDAR_ELEMENTOS_PLANO");

        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        List<FloorPlanElementRequest> safeRequests = requests != null ? requests : List.of();

        // Validar campos obligatorios de cada elemento
        for (int i = 0; i < safeRequests.size(); i++) {
            FloorPlanElementRequest req = safeRequests.get(i);
            if (req.getType() == null || req.getXPosition() == null || req.getYPosition() == null) {
                throw new BadRequestException(
                        "El elemento " + i + " del plano es inválido: type, xPosition e yPosition son obligatorios.");
            }
        }

        List<FloorPlanElement> existing =
                floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(restaurantId);
        Map<Long, FloorPlanElement> existingById = existing.stream()
                .collect(Collectors.toMap(FloorPlanElement::getId, e -> e));

        // Validar que los ids del payload pertenecen a este restaurante
        List<Long> invalidIds = safeRequests.stream()
                .map(FloorPlanElementRequest::getId)
                .filter(Objects::nonNull)
                .filter(id -> !existingById.containsKey(id))
                .collect(Collectors.toList());
        if (!invalidIds.isEmpty()) {
            throw new BadRequestException(
                    "Los siguientes elementos no pertenecen al restaurante " + restaurantId + ": " + invalidIds);
        }

        List<FloorPlanElement> toSave = new ArrayList<>();
        Set<Long> keptIds = new HashSet<>();

        for (FloorPlanElementRequest req : safeRequests) {
            FloorPlanElement element;
            if (req.getId() != null) {
                element = existingById.get(req.getId());
                keptIds.add(req.getId());
            } else {
                element = new FloorPlanElement();
                element.setRestaurant(restaurant);
            }
            element.setType(req.getType());
            element.setXPosition(req.getXPosition());
            element.setYPosition(req.getYPosition());
            element.setWidth(req.getWidth());
            element.setHeight(req.getHeight());
            element.setRotation(req.getRotation());
            toSave.add(element);
        }

        // Soft delete de los elementos existentes que no vienen en el payload
        for (FloorPlanElement element : existing) {
            if (!keptIds.contains(element.getId())) {
                element.setDeleted(true);
                element.setDeletedAt(LocalDateTime.now());
                toSave.add(element);
            }
        }

        floorPlanElementRepository.saveAll(toSave);

        log.info("[FloorPlan] Elements saved for restaurantId={}, alive={}, softDeleted={}",
                restaurantId, safeRequests.size(), toSave.size() - safeRequests.size());

        return toSave.stream()
                .filter(e -> !e.getDeleted())
                .map(floorPlanElementMapper::toResponse)
                .collect(Collectors.toList());
    }

    // Mismo patrón de validación centralizada que DiningTableService.checkTableAccess:
    // delega en CurrentUserService.canAccessRestaurant() y añade trazabilidad.
    private void checkFloorPlanAccess(Long restaurantId, String operation) {
        String username = currentUserService.getCurrentUsername();
        Set<String> roles = currentUserService.getCurrentRoles();
        Long tenantId = currentUserService.getCurrentTenantId();
        Set<Long> assignedIds = currentUserService.getAssignedRestaurantIds();

        Restaurant restaurant = restaurantRepository.findById(restaurantId).orElse(null);
        String restaurantName = restaurant != null ? restaurant.getName() : "DESCONOCIDO";

        boolean allowed = currentUserService.canAccessRestaurant(restaurantId);

        log.info("[FloorPlanAccess] user={} operation={} role={} tenant={} restaurantId={} restaurantName=\"{}\" assignedRestaurants={} result={}",
                username, operation, roles, tenantId, restaurantId, restaurantName, assignedIds,
                allowed ? "ALLOW" : "DENY");

        if (!allowed) {
            throw new AccessDeniedException("No tienes permiso para gestionar el plano de este restaurante.");
        }
    }
}
```

- [ ] **Step 4: Ejecutar los tests y verificar que pasan**

Run: `mvn test -Dtest=FloorPlanElementServiceTest`
Expected: PASS — `Tests run: 7, Failures: 0, Errors: 0`.

- [ ] **Step 5: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/floorplan/service restaurante_manage/src/test/java/com/restaurante/floorplan
git commit -m "feat(floorplan): servicio de elementos del plano con reemplazo batch idempotente"
```

---

### Task 3: Backend — `FloorPlanElementController` + verificación manual

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/floorplan/controller/FloorPlanElementController.java`

**Interfaces:**
- Consumes: `FloorPlanElementService` (Task 2), `ApiResponse.success(...)` de `common/dto`, `Constants.RESTAURANTS_PATH` y `Constants.FLOOR_PLAN_ELEMENTS_SUBPATH` (Task 1).
- Produces: `GET/PUT /api/v1/restaurants/{restaurantId}/floor-plan/elements` que consumirá `floorPlanService.js` (Task 4). Formato de respuesta: `{ success, message, data: [FloorPlanElementResponse] }`.

- [ ] **Step 1: Crear el controlador**

```java
package com.restaurante.floorplan.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.floorplan.dto.FloorPlanElementRequest;
import com.restaurante.floorplan.dto.FloorPlanElementResponse;
import com.restaurante.floorplan.service.FloorPlanElementService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
@Tag(name = "Plano de sala", description = "Elementos decorativos del plano de sala (barra, puerta...)")
@SecurityRequirement(name = "bearerAuth")
public class FloorPlanElementController {

    private static final Logger log = LoggerFactory.getLogger(FloorPlanElementController.class);

    private static final String ELEMENTS_PATH =
            Constants.RESTAURANTS_PATH + "/{restaurantId}" + Constants.FLOOR_PLAN_ELEMENTS_SUBPATH;

    private final FloorPlanElementService floorPlanElementService;

    @GetMapping(ELEMENTS_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Listar elementos del plano",
            description = "Obtiene los elementos decorativos (barra, puerta...) del plano de sala de un restaurante.")
    public ResponseEntity<ApiResponse<List<FloorPlanElementResponse>>> findByRestaurant(
            @PathVariable Long restaurantId) {
        List<FloorPlanElementResponse> elements = floorPlanElementService.findByRestaurantId(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(elements));
    }

    @PutMapping(ELEMENTS_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Guardar elementos del plano",
            description = "Reemplaza los elementos decorativos del plano: con id se actualizan, sin id se crean, " +
                    "y los existentes no incluidos se eliminan (borrado lógico). Requiere rol de administración o gerencia.")
    public ResponseEntity<ApiResponse<List<FloorPlanElementResponse>>> replaceElements(
            @PathVariable Long restaurantId,
            @RequestBody List<FloorPlanElementRequest> requests) {
        log.info("[FloorPlan] PUT elementos del plano — restaurantId={}, received={}",
                restaurantId, requests != null ? requests.size() : 0);
        List<FloorPlanElementResponse> updated =
                floorPlanElementService.replaceElements(restaurantId, requests);
        return ResponseEntity.ok(ApiResponse.success("Elementos del plano guardados exitosamente", updated));
    }
}
```

- [ ] **Step 2: Compilar y correr toda la suite**

Run: `mvn test`
Expected: BUILD SUCCESS (test de contexto + los 7 de Task 2 en verde).

- [ ] **Step 3: Verificación manual con el perfil dev**

Arrancar en una terminal (dejar corriendo): `mvn spring-boot:run -Dspring-boot.run.profiles=dev`

En otra terminal (bash):

```bash
# 1. Login (demo data del perfil dev) y extraer data.token del JSON
TOKEN=$(curl -s -X POST http://localhost:8080/api/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"super.admin","password":"admin123"}' \
  | python -c "import sys,json; print(json.load(sys.stdin)['data']['token'])")

# 2. GET inicial → lista vacía
curl -s http://localhost:8080/api/v1/restaurants/1/floor-plan/elements \
  -H "Authorization: Bearer $TOKEN"
# Esperado: {"success":true,...,"data":[]}

# 3. PUT crear una barra y una puerta
curl -s -X PUT http://localhost:8080/api/v1/restaurants/1/floor-plan/elements \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '[{"type":"BAR","xPosition":40,"yPosition":40,"width":200,"height":60,"rotation":0},
       {"type":"DOOR","xPosition":300,"yPosition":10,"width":80,"height":26,"rotation":0}]'
# Esperado: data con 2 elementos, ambos con id asignado

# 4. PUT dejando solo la barra (con su id del paso anterior) → la puerta se borra lógicamente
curl -s -X PUT http://localhost:8080/api/v1/restaurants/1/floor-plan/elements \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '[{"id":1,"type":"BAR","xPosition":100,"yPosition":80,"width":200,"height":60,"rotation":90}]'

# 5. GET final → solo la barra, en (100,80) con rotation 90
curl -s http://localhost:8080/api/v1/restaurants/1/floor-plan/elements \
  -H "Authorization: Bearer $TOKEN"

# 6. Sin token → 401/403
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/v1/restaurants/1/floor-plan/elements
```

Nota: si el restaurante 1 no existe en los datos demo, obtener un id válido con `GET /api/v1/restaurants` usando el mismo token. Ajustar el `"id":1` del paso 4 al id real devuelto en el paso 3. Parar el servidor al terminar.

- [ ] **Step 4: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/floorplan/controller
git commit -m "feat(floorplan): endpoints GET/PUT de elementos del plano de sala"
```

---

### Task 4: Frontend — servicio `floorPlanService.js`

**Files:**
- Create: `restaurante-frontend/src/services/floorPlanService.js`

**Interfaces:**
- Consumes: cliente autenticado `api` de `src/api/axios.js`; endpoints de Task 3.
- Produces: `getFloorPlanElements(restaurantId) : Promise<Array>` y `saveFloorPlanElements(restaurantId, elements) : Promise<Array>` donde cada elemento es `{ id?, type, xPosition, yPosition, width, height, rotation }`. Los consume Task 6.

- [ ] **Step 1: Crear el servicio (mismo patrón que `tableService.js`)**

```js
import api from '../api/axios';

// ─── Endpoints ──────────────────────────────────────────────────────────────
const getElementsEndpoint = (restaurantId) =>
  `/restaurants/${restaurantId}/floor-plan/elements`;

// ─── Helpers de extracción (mismo patrón que tableService) ──────────────────

/**
 * Extrae el array de datos de la respuesta del backend.
 * Soporta: array directo, { data: [...] }, { success, data: [...] }.
 */
const extractData = (response) => {
  if (!response || !response.data) {
    return [];
  }

  const body = response.data;

  if (Array.isArray(body)) {
    return body;
  }

  if (body && Array.isArray(body.data)) {
    return body.data;
  }

  return [];
};

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
        return new Error('Solicitud inválida. Revisa los datos enviados.');
      case 401:
        return new Error('No autorizado. Inicia sesión nuevamente.');
      case 403:
        return new Error('No tienes permiso para realizar esta acción.');
      case 404:
        return new Error('El servicio de elementos del plano no está disponible (404). Verifica que el servidor backend esté actualizado.');
      case 500:
        return new Error('Error interno del servidor. Intenta nuevamente más tarde.');
      default:
        return new Error(`Error del servidor (${status}). Intenta de nuevo.`);
    }
  }

  if (error.message) {
    return error;
  }

  return new Error(
    'Error de conexión. Verifica que el servidor esté funcionando.'
  );
};

// ─── Funciones API ───────────────────────────────────────────────────────────

/**
 * Obtiene los elementos decorativos del plano de un restaurante.
 * @param {number} restaurantId - ID del restaurante
 */
export const getFloorPlanElements = async (restaurantId) => {
  const url = getElementsEndpoint(restaurantId);
  try {
    const response = await api.get(url);
    return extractData(response);
  } catch (error) {
    console.error('[floorPlanService] getFloorPlanElements — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Reemplaza los elementos decorativos del plano de un restaurante.
 * Los elementos con id se actualizan, sin id se crean, y los omitidos se eliminan.
 * @param {number} restaurantId - ID del restaurante
 * @param {Array<{id?: number, type: string, xPosition: number, yPosition: number, width?: number, height?: number, rotation?: number}>} elements
 */
export const saveFloorPlanElements = async (restaurantId, elements) => {
  const url = getElementsEndpoint(restaurantId);
  try {
    const response = await api.put(url, elements);
    return extractData(response);
  } catch (error) {
    console.error('[floorPlanService] saveFloorPlanElements — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};
```

- [ ] **Step 2: Lint**

Run: `pnpm lint` (en `restaurante-frontend/`)
Expected: sin errores nuevos.

- [ ] **Step 3: Commit**

```bash
git add restaurante-frontend/src/services/floorPlanService.js
git commit -m "feat(plano): servicio API de elementos del plano de sala"
```

---

### Task 5: Frontend — `FloorPlanCanvas.jsx` (formas, elementos, panel de propiedades) + CSS

**Files:**
- Modify: `restaurante-frontend/src/components/FloorPlanCanvas.jsx` (reemplazo completo del fichero — abajo está el contenido final íntegro)
- Modify: `restaurante-frontend/src/index.css` (añadir bloque al final)

**Interfaces:**
- Consumes: nada nuevo de otros ficheros (componente autocontenido).
- Produces (lo que Task 6 usará):
  - Props nuevas: `elements` (array de elementos del servidor `{id, type, xPosition, yPosition, width, height, rotation}`), `onLayoutChange()` (callback sin argumentos: algo cambió → marcar dirty).
  - Ref imperativo: `getLayout() : { tables: Array<{tableId, xPosition, yPosition, width, height, shape, rotation}>, elements: Array<{id, type, xPosition, yPosition, width, height, rotation}> }`, `addElement(type: 'BAR'|'DOOR')`, `resetAutoLayout()`.
  - **`getPositions()` desaparece** (sustituido por `getLayout()`).
  - Comportamiento: en modo edición, clic sin arrastre sobre mesa/elemento abre panel flotante (forma para mesas; rotar/eliminar para elementos); en modo vista, clic en mesa llama a `onTableClick` y los elementos son decorativos (sin eventos).

- [ ] **Step 1: Reemplazar `FloorPlanCanvas.jsx` con este contenido completo**

```jsx
import { useState, useRef, useCallback, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';

// ═══════════════════════════════════════════════════════════════════════════════
// FloorPlanCanvas — Plano de sala interactivo
//
// Renderiza mesas y elementos decorativos (barra, puerta) posicionados dentro de
// un contenedor tipo canvas. Modo vista (click para info) y modo edición
// (drag & drop + panel de propiedades: forma de mesa, rotar/eliminar elemento).
//
// Props:
//   tables          — Array de mesas a renderizar
//   elements        — Array de elementos decorativos del servidor
//   editMode        — Si true, permite arrastrar y editar propiedades
//   selectedTableId — ID de mesa seleccionada (opcional, modo vista)
//   onTableClick    — Callback al hacer clic en una mesa (solo modo vista)
//   onTableDragEnd  — Callback al terminar un arrastre de mesa (tableId, x, y)
//   onLayoutChange  — Callback cuando cambia algo del layout (forma/elementos)
//   saving          — Si true, muestra indicador de guardado
//
// Ref expone: { getLayout, addElement, resetAutoLayout }
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Configuración visual por estado ────────────────────────────────────────
const STATUS_CONFIG = {
  AVAILABLE: { label: 'Disponible', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)' },
  RESERVED: { label: 'Reservada', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  OCCUPIED: { label: 'Ocupada', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
  MAINTENANCE: { label: 'En mantenimiento', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)' },
};

const DEFAULT_STATUS = STATUS_CONFIG.MAINTENANCE;

// ─── Dimensiones por defecto según forma ────────────────────────────────────
const SHAPE_DEFAULTS = {
  ROUND: { width: 90, height: 90 },
  SQUARE: { width: 90, height: 90 },
  RECTANGLE: { width: 130, height: 85 },
};

const DEFAULT_DIMS = { width: 90, height: 90 };

const SHAPE_OPTIONS = [
  { value: 'ROUND', label: 'Redonda' },
  { value: 'SQUARE', label: 'Cuadrada' },
  { value: 'RECTANGLE', label: 'Rectangular' },
];

// ─── Configuración de elementos decorativos ────────────────────────────────
const ELEMENT_CONFIG = {
  BAR: { label: 'Barra', width: 200, height: 60 },
  DOOR: { label: 'Puerta', width: 80, height: 26 },
};

// ─── Auto-layout: cuadrícula de 5 columnas ─────────────────────────────────
const autoLayoutPosition = (index) => {
  const cols = 5;
  const marginX = 140;
  const marginY = 130;
  const startX = 50;
  const startY = 50;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: startX + col * marginX, y: startY + row * marginY };
};

/**
 * Convierte los elementos del servidor al formato local de edición.
 * `key` es el identificador local (los nuevos aún no tienen id de BD).
 */
const normalizeElements = (elements) =>
  (Array.isArray(elements) ? elements : []).map((el) => ({
    key: `srv-${el.id}`,
    id: el.id,
    type: el.type,
    x: el.xPosition ?? 0,
    y: el.yPosition ?? 0,
    width: el.width || ELEMENT_CONFIG[el.type]?.width || 100,
    height: el.height || ELEMENT_CONFIG[el.type]?.height || 40,
    rotation: el.rotation || 0,
  }));

/**
 * Obtiene las dimensiones y forma visual de una mesa.
 * Si hay override local de forma, se usan las dimensiones por defecto
 * de la nueva forma (las guardadas corresponden a la forma anterior).
 */
const getTableShape = (table, shapeOverride) => {
  const shape = shapeOverride || table.shape || 'ROUND';
  const dims = SHAPE_DEFAULTS[shape] || DEFAULT_DIMS;
  const w = shapeOverride ? dims.width : table.width || dims.width;
  const h = shapeOverride ? dims.height : table.height || dims.height;

  let borderRadius;
  switch (shape) {
    case 'ROUND':
      borderRadius = '50%';
      break;
    case 'RECTANGLE':
      borderRadius = '6px';
      break;
    default:
      borderRadius = '8px';
  }

  return { w, h, borderRadius, shape };
};

// ═══ COMPONENTE PRINCIPAL ═══════════════════════════════════════════════════

const FloorPlanCanvas = forwardRef(function FloorPlanCanvas(
  {
    tables = [],
    elements = [],
    editMode = false,
    selectedTableId = null,
    onTableClick,
    onTableDragEnd,
    onLayoutChange,
    saving = false,
  },
  ref
) {
  // ── Estado local ─────────────────────────────────────────────────────────
  const [localPositions, setLocalPositions] = useState({});
  const [localShapes, setLocalShapes] = useState({});
  const [localElements, setLocalElements] = useState(() => normalizeElements(elements));
  // selectedItem: { kind: 'table', id } | { kind: 'element', key } | null
  const [selectedItem, setSelectedItem] = useState(null);
  // dragging: { kind: 'table', id } | { kind: 'element', key } | null
  const [dragging, setDragging] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const pointerStart = useRef({ x: 0, y: 0 });
  const hasDragged = useRef(false);
  const clickedTableRef = useRef(null);
  const tablesRef = useRef(tables);
  const newElementSeq = useRef(0);

  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  // Sincronizar elementos del servidor mientras no se está editando
  // (carga tardía tras el montaje y recargas tras guardar/cancelar)
  useEffect(() => {
    if (!editMode) setLocalElements(normalizeElements(elements));
  }, [elements, editMode]);

  // Al salir del modo edición se cierra el panel de propiedades
  useEffect(() => {
    if (!editMode) setSelectedItem(null);
  }, [editMode]);

  const notifyLayoutChange = useCallback(() => {
    if (onLayoutChange) onLayoutChange();
  }, [onLayoutChange]);

  // ── Obtener posición efectiva de una mesa ────────────────────────────────
  const getTablePosition = useCallback(
    (table, index) => {
      const local = localPositions[table.id];
      if (local) return local;

      const hasPosition =
        table.xPosition !== null &&
        table.xPosition !== undefined &&
        table.yPosition !== null &&
        table.yPosition !== undefined;
      if (hasPosition) {
        return { x: table.xPosition, y: table.yPosition };
      }

      return autoLayoutPosition(index);
    },
    [localPositions]
  );

  // ── API imperativa para el componente padre ──────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      /**
       * Devuelve el estado final del plano: payload de mesas para
       * PUT /tables/layout y de elementos para PUT /floor-plan/elements.
       */
      getLayout: () => {
        const currentTables = tablesRef.current;
        const tablesPayload = currentTables.map((table, index) => {
          const local = localPositions[table.id];
          let pos;
          if (local) {
            pos = local;
          } else {
            const hasPosition =
              table.xPosition !== null &&
              table.xPosition !== undefined &&
              table.yPosition !== null &&
              table.yPosition !== undefined;
            pos = hasPosition
              ? { x: table.xPosition, y: table.yPosition }
              : autoLayoutPosition(index);
          }
          const shapeOverride = localShapes[table.id];
          const shape = shapeOverride || table.shape || 'ROUND';
          const dims = SHAPE_DEFAULTS[shape] || DEFAULT_DIMS;
          return {
            tableId: table.id,
            xPosition: Math.round(pos.x),
            yPosition: Math.round(pos.y),
            width: shapeOverride ? dims.width : table.width || dims.width,
            height: shapeOverride ? dims.height : table.height || dims.height,
            shape,
            rotation: table.rotation || 0,
          };
        });

        const elementsPayload = localElements.map((el) => ({
          id: el.id,
          type: el.type,
          xPosition: Math.round(el.x),
          yPosition: Math.round(el.y),
          width: el.width,
          height: el.height,
          rotation: el.rotation || 0,
        }));

        return { tables: tablesPayload, elements: elementsPayload };
      },

      /**
       * Inserta un elemento decorativo nuevo en el plano.
       * @param {'BAR'|'DOOR'} type
       */
      addElement: (type) => {
        const cfg = ELEMENT_CONFIG[type];
        if (!cfg) return;
        newElementSeq.current += 1;
        const key = `new-${newElementSeq.current}`;
        setLocalElements((prev) => [
          ...prev,
          {
            key,
            id: null,
            type,
            x: 60 + (prev.length % 6) * 30,
            y: 60 + (prev.length % 6) * 30,
            width: cfg.width,
            height: cfg.height,
            rotation: 0,
          },
        ]);
        setSelectedItem({ kind: 'element', key });
      },

      /**
       * Recoloca todas las mesas en la cuadrícula automática.
       * No afecta a los elementos decorativos.
       */
      resetAutoLayout: () => {
        const positions = {};
        tablesRef.current.forEach((table, index) => {
          positions[table.id] = autoLayoutPosition(index);
        });
        setLocalPositions(positions);
      },
    }),
    [localPositions, localShapes, localElements]
  );

  // ── Calcular dimensiones del canvas según contenido ──────────────────────
  const canvasDimensions = useMemo(() => {
    let maxX = 800;
    let maxY = 500;

    tables.forEach((table, index) => {
      const pos = getTablePosition(table, index);
      const { w, h } = getTableShape(table, localShapes[table.id]);
      if (pos.x + w + 60 > maxX) maxX = pos.x + w + 60;
      if (pos.y + h + 60 > maxY) maxY = pos.y + h + 60;
    });

    localElements.forEach((el) => {
      if (el.x + el.width + 60 > maxX) maxX = el.x + el.width + 60;
      if (el.y + el.height + 60 > maxY) maxY = el.y + el.height + 60;
    });

    return { width: Math.max(maxX, 800), height: Math.max(maxY, 450) };
  }, [tables, localElements, localShapes, getTablePosition]);

  // ── Handler: Iniciar drag o click sobre mesa/elemento ────────────────────
  // item: { kind: 'table', table, index } | { kind: 'element', element }
  const handleItemPointerDown = useCallback(
    (e, item) => {
      pointerStart.current = { x: e.clientX, y: e.clientY };
      hasDragged.current = false;
      clickedTableRef.current = item.kind === 'table' ? item.table : null;

      if (!editMode) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const canvasRect = canvas.getBoundingClientRect();

      let x;
      let y;
      if (item.kind === 'table') {
        const pos = getTablePosition(item.table, item.index);
        x = pos.x;
        y = pos.y;
        setDragging({ kind: 'table', id: item.table.id });
      } else {
        x = item.element.x;
        y = item.element.y;
        setDragging({ kind: 'element', key: item.element.key });
      }

      setDragOffset({
        x: e.clientX - canvasRect.left - x,
        y: e.clientY - canvasRect.top - y,
      });

      e.target.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [editMode, getTablePosition]
  );

  // ── Handler: Mover durante drag ──────────────────────────────────────────
  const handlePointerMove = useCallback(
    (e) => {
      if (!dragging || !editMode) return;

      // Detectar si realmente hubo arrastre (umbral 4px)
      const dx = Math.abs(e.clientX - pointerStart.current.x);
      const dy = Math.abs(e.clientY - pointerStart.current.y);
      if (dx > 4 || dy > 4) {
        hasDragged.current = true;
      }

      if (!hasDragged.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const canvasRect = canvas.getBoundingClientRect();
      const newX = Math.max(0, e.clientX - canvasRect.left - dragOffset.x);
      const newY = Math.max(0, e.clientY - canvasRect.top - dragOffset.y);

      if (dragging.kind === 'table') {
        setLocalPositions((prev) => ({
          ...prev,
          [dragging.id]: { x: newX, y: newY },
        }));
      } else {
        setLocalElements((prev) =>
          prev.map((el) =>
            el.key === dragging.key ? { ...el, x: newX, y: newY } : el
          )
        );
      }
    },
    [dragging, dragOffset, editMode]
  );

  // ── Handler: Finalizar drag o click ──────────────────────────────────────
  const handlePointerUp = useCallback(() => {
    if (!dragging) {
      // Modo vista: click sin arrastre sobre una mesa → abrir info
      if (!editMode && !hasDragged.current && clickedTableRef.current && onTableClick) {
        onTableClick(clickedTableRef.current);
      }
      clickedTableRef.current = null;
      return;
    }

    if (hasDragged.current) {
      // Fue un arrastre → notificar al padre
      if (dragging.kind === 'table') {
        const pos = localPositions[dragging.id];
        if (pos && onTableDragEnd) {
          onTableDragEnd(dragging.id, pos.x, pos.y);
        }
      } else {
        notifyLayoutChange();
      }
    } else {
      // Click sin arrastre en modo edición → abrir panel de propiedades
      setSelectedItem(
        dragging.kind === 'table'
          ? { kind: 'table', id: dragging.id }
          : { kind: 'element', key: dragging.key }
      );
    }

    setDragging(null);
    clickedTableRef.current = null;
  }, [dragging, editMode, localPositions, onTableClick, onTableDragEnd, notifyLayoutChange]);

  // ── Acciones del panel de propiedades ────────────────────────────────────
  const handleShapeChange = useCallback(
    (tableId, shape) => {
      setLocalShapes((prev) => ({ ...prev, [tableId]: shape }));
      notifyLayoutChange();
    },
    [notifyLayoutChange]
  );

  const handleRotateElement = useCallback(
    (key) => {
      setLocalElements((prev) =>
        prev.map((el) =>
          el.key === key ? { ...el, rotation: ((el.rotation || 0) + 90) % 360 } : el
        )
      );
      notifyLayoutChange();
    },
    [notifyLayoutChange]
  );

  const handleRemoveElement = useCallback(
    (key) => {
      setLocalElements((prev) => prev.filter((el) => el.key !== key));
      setSelectedItem(null);
      notifyLayoutChange();
    },
    [notifyLayoutChange]
  );

  // ── Datos del ítem seleccionado para posicionar el panel ─────────────────
  const selectedInfo = useMemo(() => {
    if (!selectedItem || !editMode) return null;

    if (selectedItem.kind === 'table') {
      const index = tables.findIndex((t) => t.id === selectedItem.id);
      if (index === -1) return null;
      const table = tables[index];
      const pos = getTablePosition(table, index);
      const { w } = getTableShape(table, localShapes[table.id]);
      return { kind: 'table', table, x: pos.x + w + 12, y: pos.y };
    }

    const element = localElements.find((el) => el.key === selectedItem.key);
    if (!element) return null;
    return { kind: 'element', element, x: element.x + element.width + 12, y: element.y };
  }, [selectedItem, editMode, tables, localElements, localShapes, getTablePosition]);

  // ── Obtener configuración visual del estado ──────────────────────────────
  const getStatusConfig = useCallback((status) => {
    return STATUS_CONFIG[status] || DEFAULT_STATUS;
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fpc-wrapper">
      {/* Barra de estado del modo edición */}
      {editMode && (
        <div className="fpc-info-bar">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Arrastra mesas y elementos; haz clic en uno para editar sus propiedades</span>
          {saving && (
            <span className="fpc-saving-badge">
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
              {' '}Guardando...
            </span>
          )}
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`fpc-canvas ${editMode ? 'fpc-canvas-editable' : ''} ${dragging ? 'fpc-canvas-dragging' : ''}`}
        style={{ minHeight: `${canvasDimensions.height}px` }}
        onPointerDown={(e) => {
          // Click en el fondo vacío → cerrar panel de propiedades
          if (e.target === canvasRef.current) setSelectedItem(null);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Elementos decorativos (barra, puerta) */}
        {localElements.map((el) => {
          const cfg = ELEMENT_CONFIG[el.type] || { label: el.type };
          const isSelectedEl =
            editMode && selectedItem?.kind === 'element' && selectedItem.key === el.key;
          const isDraggingEl = dragging?.kind === 'element' && dragging.key === el.key;

          return (
            <div
              key={el.key}
              className={`fpc-element fpc-element-${(el.type || '').toLowerCase()} ${isSelectedEl ? 'fpc-element-selected' : ''}`}
              style={{
                left: `${el.x}px`,
                top: `${el.y}px`,
                width: `${el.width}px`,
                height: `${el.height}px`,
                transform: el.rotation ? `rotate(${el.rotation}deg)` : 'none',
                zIndex: isDraggingEl ? 100 : isSelectedEl ? 10 : 0,
                pointerEvents: editMode ? 'auto' : 'none',
                cursor: editMode ? 'grab' : 'default',
              }}
              onPointerDown={(e) => handleItemPointerDown(e, { kind: 'element', element: el })}
              role={editMode ? 'button' : 'img'}
              aria-label={cfg.label}
              title={cfg.label}
            >
              {el.type === 'DOOR' ? (
                <svg viewBox="0 0 48 26" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
                  <line x1="2" y1="24" x2="46" y2="24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  <path d="M 8 24 A 18 18 0 0 1 26 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="8" y1="24" x2="26" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <span className="fpc-element-label">{cfg.label}</span>
              )}
            </div>
          );
        })}

        {/* Mesas */}
        {tables.map((table, index) => {
          const pos = getTablePosition(table, index);
          const statusCfg = getStatusConfig(table.status);
          const { w, h, borderRadius } = getTableShape(table, localShapes[table.id]);
          const isSelected =
            table.id === selectedTableId ||
            (editMode && selectedItem?.kind === 'table' && selectedItem.id === table.id);
          const isDragging = dragging?.kind === 'table' && dragging.id === table.id;

          return (
            <div
              key={table.id}
              className={`fpc-table 
                ${isSelected ? 'fpc-table-selected' : ''} 
                ${isDragging ? 'fpc-table-dragging' : ''} 
                ${editMode ? 'fpc-table-draggable' : ''}
              `}
              style={{
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                width: `${w}px`,
                height: `${h}px`,
                borderRadius,
                borderColor: statusCfg.color,
                backgroundColor: statusCfg.bg,
                color: statusCfg.color,
                cursor: editMode ? 'grab' : 'pointer',
                zIndex: isDragging ? 100 : isSelected ? 10 : 1,
                transform: table.rotation ? `rotate(${table.rotation}deg)` : 'none',
              }}
              onPointerDown={(e) => handleItemPointerDown(e, { kind: 'table', table, index })}
              role="button"
              tabIndex={0}
              aria-label={`Mesa ${table.tableNumber || table.id} — ${statusCfg.label}`}
              title={`Mesa ${table.tableNumber || table.id} — ${statusCfg.label}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (editMode) {
                    setSelectedItem({ kind: 'table', id: table.id });
                  } else if (onTableClick) {
                    onTableClick(table);
                  }
                }
              }}
            >
              {/* Número de mesa */}
              <span className="fpc-table-number">
                {table.tableNumber || table.id}
              </span>

              {/* Capacidad (en mesas con espacio suficiente) */}
              {w >= 75 && h >= 75 && (
                <span className="fpc-table-capacity">
                  {table.capacity || '—'}
                </span>
              )}

              {/* Indicador de estado (barra inferior) */}
              <span
                className="fpc-table-status-bar"
                style={{ backgroundColor: statusCfg.color }}
              />
            </div>
          );
        })}

        {/* Panel flotante de propiedades (solo modo edición) */}
        {editMode && selectedInfo && (
          <div
            className="fpc-props-panel"
            style={{ left: `${selectedInfo.x}px`, top: `${selectedInfo.y}px` }}
            onPointerDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Propiedades del elemento seleccionado"
          >
            <button
              type="button"
              className="fpc-props-close"
              aria-label="Cerrar panel"
              onClick={() => setSelectedItem(null)}
            >
              ×
            </button>

            {selectedInfo.kind === 'table' ? (
              <>
                <div className="fpc-props-title">
                  Mesa {selectedInfo.table.tableNumber || selectedInfo.table.id}
                </div>
                <div className="fpc-props-label">Forma</div>
                {SHAPE_OPTIONS.map((opt) => {
                  const current =
                    localShapes[selectedInfo.table.id] || selectedInfo.table.shape || 'ROUND';
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`fpc-props-btn ${current === opt.value ? 'fpc-props-btn-active' : ''}`}
                      onClick={() => handleShapeChange(selectedInfo.table.id, opt.value)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                <div className="fpc-props-title">
                  {ELEMENT_CONFIG[selectedInfo.element.type]?.label || selectedInfo.element.type}
                </div>
                <button
                  type="button"
                  className="fpc-props-btn"
                  onClick={() => handleRotateElement(selectedInfo.element.key)}
                >
                  Rotar 90°
                </button>
                <button
                  type="button"
                  className="fpc-props-btn fpc-props-btn-danger"
                  onClick={() => handleRemoveElement(selectedInfo.element.key)}
                >
                  Eliminar
                </button>
              </>
            )}
          </div>
        )}

        {/* Mensaje si no hay mesas */}
        {tables.length === 0 && (
          <div className="fpc-empty-canvas">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.3"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
            <p>No hay mesas en este plano</p>
          </div>
        )}
      </div>

      {/* Leyenda de estados */}
      <div className="fpc-legend">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <div key={key} className="fpc-legend-item">
            <span className="fpc-legend-dot" style={{ backgroundColor: cfg.color }} />
            <span className="fpc-legend-label">{cfg.label}</span>
          </div>
        ))}
        {editMode && (
          <span className="fpc-legend-hint">
            {saving ? 'Guardando...' : 'Haz clic en una mesa o elemento para editarlo'}
          </span>
        )}
      </div>
    </div>
  );
});

export default FloorPlanCanvas;
```

- [ ] **Step 2: Añadir estilos al final de `restaurante-frontend/src/index.css`**

```css
/* ═══ Plano interactivo: elementos decorativos y panel de propiedades ═══ */
.fpc-element {
  position: absolute;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--text-secondary);
  user-select: none;
  touch-action: none;
}

.fpc-element-bar {
  background: var(--hover-color);
  border: 2px solid var(--text-muted);
  border-radius: 10px;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

.fpc-element-door {
  background: transparent;
  border: none;
}

.fpc-element-selected {
  outline: 2px dashed var(--primary);
  outline-offset: 3px;
}

.fpc-props-panel {
  position: absolute;
  z-index: 200;
  display: flex;
  flex-direction: column;
  gap: 4px;
  min-width: 150px;
  padding: 10px 12px;
  background: var(--bg-card);
  border: 1px solid var(--border);
  border-radius: 10px;
  box-shadow: var(--shadow-lg);
}

.fpc-props-title {
  font-weight: 700;
  font-size: 0.85rem;
  color: var(--text-primary);
  margin-bottom: 2px;
  padding-right: 18px;
}

.fpc-props-label {
  font-size: 0.7rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-muted);
}

.fpc-props-btn {
  display: block;
  width: 100%;
  text-align: left;
  padding: 5px 8px;
  font-size: 0.8rem;
  background: transparent;
  border: 1px solid var(--border);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
}

.fpc-props-btn:hover {
  background: var(--hover-color);
}

.fpc-props-btn-active {
  border-color: var(--primary);
  color: var(--primary);
  background: var(--primary-light);
  font-weight: 600;
}

.fpc-props-btn-danger {
  color: var(--danger);
  border-color: var(--danger-light);
}

.fpc-props-btn-danger:hover {
  background: var(--danger-light);
}

.fpc-props-close {
  position: absolute;
  top: 6px;
  right: 8px;
  padding: 0;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 1rem;
  line-height: 1;
  cursor: pointer;
}
```

- [ ] **Step 3: Lint**

Run: `pnpm lint`
Expected: sin errores. (`FloorPlan.jsx` aún llama a `getPositions()`, que ya no existe — eso es runtime, no lint; se corrige en Task 6, por eso Task 5 y 6 deben ir en commits consecutivos sin probar la app entre medias.)

- [ ] **Step 4: Commit**

```bash
git add restaurante-frontend/src/components/FloorPlanCanvas.jsx restaurante-frontend/src/index.css
git commit -m "feat(plano): formas de mesa, elementos decorativos y panel de propiedades en el canvas"
```

---

### Task 6: Frontend — integración en `FloorPlan.jsx`

**Files:**
- Modify: `restaurante-frontend/src/pages/FloorPlan.jsx`

**Interfaces:**
- Consumes: `getFloorPlanElements` / `saveFloorPlanElements` (Task 4); ref del canvas `getLayout()` / `addElement(type)` / `resetAutoLayout()` y props `elements` / `onLayoutChange` (Task 5).
- Produces: página completa funcionando (es la hoja del árbol de dependencias).

- [ ] **Step 1: Añadir import del servicio de elementos**

Tras el import de `tableService` (línea ~9):

```js
import {
  getFloorPlanElements,
  saveFloorPlanElements,
} from '../services/floorPlanService';
```

- [ ] **Step 2: Añadir estado de elementos y clave de recarga del canvas**

En el bloque «Estados de datos», tras `const [tables, setTables] = useState([]);`:

```js
  const [elements, setElements] = useState([]);
```

Reemplazar la línea `const [layoutResetKey, setLayoutResetKey] = useState(0);` (junto a `canvasSaveRef`) por:

```js
  // Fuerza el remontaje del canvas tras guardar/cancelar para sincronizar
  // el estado local con lo persistido en el servidor
  const [canvasReloadKey, setCanvasReloadKey] = useState(0);
```

- [ ] **Step 3: Eliminar `originalPositionsRef` y simplificar `handleStartEditMode`**

Eliminar la declaración `const originalPositionsRef = useRef({});` (y su comentario). Reemplazar `handleStartEditMode` completo por:

```js
  /**
   * Inicia el modo edición. Los cambios locales viven en el canvas;
   * cancelar recarga el estado persistido del servidor.
   */
  const handleStartEditMode = useCallback(() => {
    setLayoutDirty(false);
    setIsEditMode(true);
  }, []);
```

- [ ] **Step 4: Cargar elementos junto a las mesas**

En el `useEffect` de carga de mesas, reemplazar el cuerpo de `loadTables` para pedir ambas cosas en paralelo (el fallo de elementos no bloquea las mesas):

```js
    const loadTables = async () => {
      setLoading(true);
      setError(null);
      setTables([]);
      setElements([]);

      try {
        const [tablesData, elementsData] = await Promise.all([
          getTablesByRestaurant(Number(selectedRestaurantId)),
          getFloorPlanElements(Number(selectedRestaurantId)).catch((err) => {
            console.warn('[FloorPlan] No se pudieron cargar los elementos del plano:', err?.message);
            return [];
          }),
        ]);
        if (mounted) {
          const tableList = Array.isArray(tablesData) ? tablesData : [];
          setTables(tableList);
          setElements(Array.isArray(elementsData) ? elementsData : []);
          // Auto-detectar vista según cantidad de mesas
          setViewMode(tableList.length > 8 ? 'compact' : 'visual');
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
```

- [ ] **Step 5: Helper de recarga + nuevos handlers de cancelar/resetear/añadir**

Reemplazar `handleCancelEdit` y `handleResetLayout` por:

```js
  /**
   * Recarga mesas y elementos del servidor y remonta el canvas para
   * descartar cualquier estado local (posiciones, formas, elementos).
   */
  const reloadPlanData = useCallback(async () => {
    if (!selectedRestaurantId) return;
    const [tablesData, elementsData] = await Promise.all([
      getTablesByRestaurant(Number(selectedRestaurantId)),
      getFloorPlanElements(Number(selectedRestaurantId)).catch(() => []),
    ]);
    setTables(Array.isArray(tablesData) ? tablesData : []);
    setElements(Array.isArray(elementsData) ? elementsData : []);
    setCanvasReloadKey((prev) => prev + 1);
  }, [selectedRestaurantId]);

  /**
   * Sale del modo edición sin guardar. Recarga el estado del servidor.
   */
  const handleCancelEdit = useCallback(() => {
    setIsEditMode(false);
    setLayoutDirty(false);
    reloadPlanData().catch(() => {
      window.location.reload();
    });
  }, [reloadPlanData]);

  /**
   * Recoloca las mesas en la cuadrícula automática (no toca los elementos).
   */
  const handleResetLayout = useCallback(() => {
    canvasSaveRef.current?.resetAutoLayout();
    setLayoutDirty(true);
    showToast('Posiciones restablecidas a la cuadrícula automática', 'success');
  }, [showToast]);

  /**
   * Añade un elemento decorativo (BAR | DOOR) al plano en modo edición.
   */
  const handleAddElement = useCallback((type) => {
    canvasSaveRef.current?.addElement(type);
    setLayoutDirty(true);
  }, []);

  /**
   * Callback del canvas cuando cambia el layout (forma, elementos...).
   */
  const handleLayoutChange = useCallback(() => {
    setLayoutDirty(true);
  }, []);
```

- [ ] **Step 6: Reescribir `handleSaveLayout` para guardar mesas + elementos**

Reemplazar `handleSaveLayout` completo por:

```js
  /**
   * Guarda el layout completo (mesas + elementos) en el backend.
   * Solo muestra éxito si ambas llamadas responden OK; después recarga
   * el estado persistido del servidor. Si algo falla, mantiene el modo
   * edición para no perder los cambios locales.
   */
  const handleSaveLayout = useCallback(async () => {
    if (!selectedRestaurantId || !layoutDirty) return;
    if (!canvasSaveRef.current) {
      showToast('Error al obtener el estado del plano', 'error');
      return;
    }

    setSavingLayout(true);
    const { tables: tablesPayload, elements: elementsPayload } =
      canvasSaveRef.current.getLayout();

    let tablesSaved = false;
    try {
      if (tablesPayload.length > 0) {
        await updateTablesLayout(Number(selectedRestaurantId), tablesPayload);
      }
      tablesSaved = true;

      await saveFloorPlanElements(Number(selectedRestaurantId), elementsPayload);

      showToast('Plano guardado correctamente', 'success');
      setLayoutDirty(false);
      setIsEditMode(false);
      await reloadPlanData();
    } catch (err) {
      console.error('[FloorPlan] Error al guardar el plano:', err);
      showToast(
        tablesSaved
          ? `Las mesas se guardaron, pero falló el guardado de los elementos: ${err?.message || 'error desconocido'}`
          : err?.message || 'Error al guardar el plano. Intenta de nuevo.',
        'error'
      );
      // Mantener modo edición — el usuario puede corregir o cancelar
    } finally {
      setSavingLayout(false);
    }
  }, [selectedRestaurantId, layoutDirty, showToast, reloadPlanData]);
```

- [ ] **Step 7: Botones «+ Barra» y «+ Puerta» en la toolbar de edición**

Dentro del fragmento del modo edición (tras el `<span className="fp-edit-badge-active">…Editando plano…</span>` y antes del botón «Guardar plano»), añadir:

```jsx
                    <button
                      className="fp-edit-btn"
                      onClick={() => handleAddElement('BAR')}
                      disabled={savingLayout}
                      type="button"
                      title="Añadir una barra de bar al plano"
                    >
                      + Barra
                    </button>
                    <button
                      className="fp-edit-btn"
                      onClick={() => handleAddElement('DOOR')}
                      disabled={savingLayout}
                      type="button"
                      title="Añadir una puerta de entrada al plano"
                    >
                      + Puerta
                    </button>
```

- [ ] **Step 8: Actualizar el uso de `FloorPlanCanvas`**

Reemplazar el JSX del canvas por:

```jsx
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
```

- [ ] **Step 9: Lint y build**

Run: `pnpm lint && pnpm build`
Expected: sin errores (si lint se queja de `layoutResetKey`/`originalPositionsRef` residuales, es que algún paso anterior quedó a medias — buscar y eliminar todo uso restante).

- [ ] **Step 10: Commit**

```bash
git add restaurante-frontend/src/pages/FloorPlan.jsx
git commit -m "feat(plano): edicion de formas y elementos con guardado y recarga desde el servidor"
```

---

### Task 7: Verificación end-to-end

**Files:** ninguno (solo verificación; correcciones menores si aparecen).

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: confirmación de los criterios de aceptación de la spec.

- [ ] **Step 1: Arrancar backend y frontend**

Terminal 1 (en `restaurante_manage/`): `mvn spring-boot:run -Dspring-boot.run.profiles=dev`
Terminal 2 (en `restaurante-frontend/`): `pnpm dev`
Abrir `http://localhost:5173`, login `juan.admin` / `admin123`.

- [ ] **Step 2: Walkthrough de criterios de aceptación (plano → vista Plano → Modo edición)**

1. Seleccionar una mesa → panel flotante → cambiar a «Cuadrada» → Guardar plano → toast de éxito → recargar la página (F5) → la mesa sigue cuadrada. Repetir cambiándola a «Redonda».
2. «+ Barra» y «+ Puerta» → arrastrarlas a una posición, rotar la puerta 90°, Guardar → F5 → posición, rotación y tipo persisten. Entrar de nuevo en edición, eliminar la barra, Guardar → F5 → la barra ya no está.
3. Hacer cambios (mover mesa, añadir elemento) y pulsar «Cancelar cambios» → el plano vuelve exactamente al estado guardado sin recargar la página.
4. «Resetear plano» recoloca las mesas en cuadrícula pero NO mueve ni borra los elementos.
5. En modo vista (sin editar), clic en una mesa abre el modal de información; la barra y la puerta no responden a clics.
6. Con las herramientas de red del navegador: al guardar se ven `PUT .../tables/layout` y `PUT .../floor-plan/elements` con 200, seguidos de los `GET` de recarga.

- [ ] **Step 3: Verificación de aislamiento multi-tenant**

Con el token de un usuario de otro tenant (p. ej. login como un manager demo de otro tenant, ver `DemoDataInitializer`), `GET /api/v1/restaurants/{id}/floor-plan/elements` de un restaurante ajeno devuelve 403.

- [ ] **Step 4: Suites completas**

Run: `mvn test` (backend) y `pnpm lint && pnpm build` (frontend).
Expected: todo en verde.

- [ ] **Step 5: Commit final (solo si hubo correcciones en la verificación)**

```bash
git add -A -- restaurante-frontend/src restaurante_manage/src
git commit -m "fix(plano): ajustes de la verificacion end-to-end"
```

---

## Self-review del plan (hecho)

- **Cobertura de la spec:** entidad/DTOs/repo (Task 1), servicio batch idempotente + tests (Task 2), endpoints con roles (Task 3), servicio frontend (Task 4), formas + elementos + panel (Task 5), guardado dual + recarga + botones (Task 6), criterios de aceptación (Task 7). La spec pedía además que «Cancelar» descarte formas/elementos: cubierto vía remontaje del canvas (`canvasReloadKey`).
- **Sin placeholders:** todo el código está completo; el único punto condicional (constructor de `Restaurant` en el test) indica exactamente qué comprobar y dónde.
- **Consistencia de tipos:** `getLayout()` produce `{tables, elements}` cuyos campos coinciden con `TableLayoutRequest` y `FloorPlanElementRequest`; `type` viaja como string (`'BAR'|'DOOR'`) y deserializa al enum `ElementType`; `Constants.FLOOR_PLAN_ELEMENTS_SUBPATH` se define en Task 1 y se usa en Task 3.
