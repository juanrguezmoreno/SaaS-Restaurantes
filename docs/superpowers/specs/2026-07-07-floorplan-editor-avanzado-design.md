# Especificación: Editor avanzado del plano de sala

**Fecha:** 2026-07-07
**Estado:** Aprobado (diseño validado en conversación)

## Objetivo

Ampliar el modo edición de la vista "Plano" (`FloorPlan.jsx`, vista `interactive`) con:

1. Cambio de forma de las mesas (redonda / cuadrada / rectangular) desde la UI.
2. Elementos decorativos nuevos: **barra de bar** y **puerta de entrada**, posicionables en el plano.
3. Persistencia garantizada: todo lo que se guarda desde el modo edición queda almacenado en el backend y se recarga desde el servidor tras guardar.

## Contexto actual

- La entidad `DiningTable` ya tiene `shape`, `width`, `height`, `rotation`, y el endpoint
  `PUT /api/v1/restaurants/{id}/tables/layout` ya los persiste (`DiningTableService.updateRestaurantTablesLayout`).
- `FloorPlanCanvas.jsx` ya renderiza las tres formas (`ROUND`, `SQUARE`, `RECTANGLE`) vía `SHAPE_DEFAULTS`
  pero no existe UI para cambiarlas; `getPositions()` devuelve la forma que vino del servidor.
- No existe ningún concepto de elemento decorativo (barra/puerta) ni en frontend ni en backend.

## Fuera de alcance (YAGNI)

- Redimensionado de elementos con handles.
- Más tipos de elementos (plantas, paredes, columnas...). El enum queda extensible pero solo se implementan `BAR` y `DOOR`.
- Rotación libre (solo pasos de 90° para elementos; las mesas no rotan desde la UI).

---

## 1. Backend — nuevo paquete `floorplan`

Sigue el layout por features del proyecto (`controller/`, `service/`, `repository/`, `entity/`, `dto/`, `enums/`).

### Entidad `FloorPlanElement`

Extiende `common/audit/BaseEntity` (auditoría + soft delete). Tabla `floor_plan_elements`
(la crea Hibernate con `ddl-auto: update` / `create-drop`; no hay migraciones en este proyecto).

| Campo        | Tipo                    | Notas                                   |
|--------------|-------------------------|-----------------------------------------|
| `id`         | `Long` (IDENTITY)       |                                         |
| `restaurant` | `@ManyToOne Restaurant` | `restaurant_id`, `nullable = false`     |
| `type`       | enum `ElementType`      | `BAR`, `DOOR` — `@Enumerated(STRING)`   |
| `xPosition`  | `Integer`               | `nullable = false`                      |
| `yPosition`  | `Integer`               | `nullable = false`                      |
| `width`      | `Integer`               |                                         |
| `height`     | `Integer`               |                                         |
| `rotation`   | `Integer`               | grados (0, 90, 180, 270)                |

### DTOs

- `FloorPlanElementRequest`: `id` (nullable — sin id = crear), `type` (`@NotNull`), `xPosition`/`yPosition` (`@NotNull`), `width`, `height`, `rotation`.
- `FloorPlanElementResponse`: mismos campos con `id` y `restaurantId`.
- `FloorPlanElementMapper`: clase estática de mapeo, como los mappers existentes.

### Repositorio

`FloorPlanElementRepository extends JpaRepository` con
`findByRestaurantIdAndDeletedFalse(Long restaurantId)`.

### Servicio `FloorPlanElementService`

Scoping multi-tenant vía `CurrentUserService.canAccessRestaurant(restaurantId)` (mismo patrón
`checkTableAccess` de `DiningTableService`, con logs).

- `findByRestaurantId(Long restaurantId)` → lista de responses (solo `deletedFalse`).
- `replaceElements(Long restaurantId, List<FloorPlanElementRequest> requests)` — **reemplazo batch idempotente**, `@Transactional`:
  1. Validar acceso y existencia del restaurante.
  2. Cargar elementos actuales (`deletedFalse`) del restaurante.
  3. Requests **con `id`**: deben pertenecer al restaurante (si no → `BadRequestException`); se actualizan posición/tamaño/rotación/tipo.
  4. Requests **sin `id`**: se crean asociados al restaurante.
  5. Elementos existentes **no incluidos** en el payload: soft delete (`deleted = true`, `deletedAt = now`).
  6. Devuelve la lista final de elementos vivos.

### Controlador `FloorPlanElementController`

Rutas construidas sobre `Constants.RESTAURANTS_PATH`; añadir a `Constants.java` el sufijo del recurso
(`FLOOR_PLAN_ELEMENTS_SUBPATH = "/floor-plan/elements"` o constante equivalente — no inline strings).

| Método | Ruta                                                      | Roles                              |
|--------|-----------------------------------------------------------|-------------------------------------|
| GET    | `/api/v1/restaurants/{restaurantId}/floor-plan/elements` | `SUPER_ADMIN, ADMIN, MANAGER, EMPLOYEE` |
| PUT    | `/api/v1/restaurants/{restaurantId}/floor-plan/elements` | `SUPER_ADMIN, ADMIN, MANAGER`      |

- Respuestas envueltas en `ApiResponse.success(...)`, anotaciones Swagger en español, `@SecurityRequirement(name = "bearerAuth")`.
- GET incluye `EMPLOYEE` porque el modo vista del plano lo usan todos los roles con acceso al restaurante
  (el scoping fino lo hace `CurrentUserService`).

### Tests

`FloorPlanElementServiceTest` (unitario, Mockito): crear nuevos, actualizar existentes,
soft-delete de los omitidos, rechazo de ids ajenos al restaurante, denegación de acceso.

---

## 2. Frontend — servicio API

Nuevo `src/services/floorPlanService.js`, mismo patrón de extracción de datos y manejo de
errores que `tableService.js`:

- `getFloorPlanElements(restaurantId)` → GET.
- `saveFloorPlanElements(restaurantId, elements)` → PUT (array completo = estado final).

## 3. Frontend — `FloorPlanCanvas.jsx`

### Estado local de edición

- `localShapes` — `{ [tableId]: 'ROUND' | 'SQUARE' | 'RECTANGLE' }`, overrides sobre `table.shape`.
- `localElements` — array de elementos en edición: `{ key, id?, type, x, y, width, height, rotation }`
  (`key` local para React; `id` solo si viene del servidor). Se inicializa desde la prop `elements`.
- `selectedItem` — `{ kind: 'table' | 'element', ... }` para el panel flotante (solo en modo edición).

### Props nuevas

- `elements` — elementos del servidor.
- El ref expone `getLayout()` que devuelve `{ tables, elements }`: `tables` es el payload actual de
  `getPositions()` incorporando `localShapes`, y `elements` el estado final de `localElements`.
  `getPositions()` se elimina en favor de `getLayout()` (solo lo consume `FloorPlan.jsx`).
- `onLayoutChange` — callback para marcar `layoutDirty` (forma cambiada, elemento añadido/movido/rotado/eliminado).
- Método imperativo `addElement(type)` para insertar barra/puerta desde la toolbar del padre.

### Render de elementos

- **Barra** (`BAR`): rectángulo ~200×60, fondo/borde neutro distinto de los estados de mesa, etiqueta "Barra".
- **Puerta** (`DOOR`): ~80×20 con arco de apertura (SVG) y etiqueta accesible "Puerta".
- Draggable en modo edición (misma lógica pointer que las mesas); estáticos y sin interacción en modo vista.
- `rotation` aplicada con `transform: rotate(...)`.

### Panel flotante de propiedades (solo modo edición)

Aparece anclado junto al ítem seleccionado:

- **Mesa**: 3 botones de forma — Redonda / Cuadrada / Rectangular (activa la actual). Al cambiar,
  actualiza `localShapes` y dispara `onLayoutChange`.
- **Elemento**: botón "Rotar 90°" y botón "Eliminar" (elimina de `localElements`).
- Botón de cierre; también se cierra al hacer clic en el lienzo vacío o arrastrar otro ítem.
- En modo edición, el clic en mesa abre este panel (NO el modal de detalle, que queda para modo vista).

## 4. Frontend — `FloorPlan.jsx`

- Cargar elementos junto a las mesas al seleccionar restaurante (y pasarlos al canvas).
- Toolbar de edición: botones **“+ Barra”** y **“+ Puerta”** (solo con `MANAGE_FLOOR_PLAN`),
  que llaman a `addElement(type)` del canvas y marcan `layoutDirty`.
- **Guardar plano**: ejecuta `updateTablesLayout(...)` y `saveFloorPlanElements(...)`.
  - Éxito de ambas → toast de éxito, salir de modo edición, **recargar mesas y elementos del servidor**.
  - Fallo de cualquiera → toast de error y permanecer en modo edición (patrón actual). Si mesas se
    guardó pero elementos falló, el mensaje lo indica ("Mesas guardadas, pero falló el guardado de elementos...").
- **Cancelar cambios**: recarga mesas y elementos del servidor.
- **Resetear plano**: solo afecta a mesas (comportamiento actual), no toca elementos.

## 5. Estilos

Ampliar `index.css` con clases `fpc-element`, `fpc-element-bar`, `fpc-element-door`,
`fpc-props-panel` y variantes, siguiendo el prefijo/naming `fpc-*` existente.

## Criterios de aceptación

1. En modo edición, seleccionar una mesa permite cambiarla entre redonda, cuadrada y rectangular; al
   guardar y recargar la página, la forma persiste.
2. Se puede añadir una barra y una puerta, moverlas, rotarlas y eliminarlas; al guardar y recargar,
   el estado persiste exactamente.
3. Un usuario de otro tenant no puede leer ni escribir elementos de un restaurante ajeno (403).
4. Cancelar descarta todos los cambios locales (formas y elementos incluidos).
5. `mvn test` pasa con los tests nuevos; `pnpm lint` sin errores.
