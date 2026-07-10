# Plano de sala como punto único de gestión de mesas

**Fecha:** 2026-07-10
**Estado:** Aprobado, pendiente de plan de implementación

## Contexto

Hoy existen dos pantallas redundantes:

- `/floor-plan` (`FloorPlan.jsx` + `FloorPlanCanvas.jsx`) — plano interactivo de mesas, con un **modal centrado** (backdrop oscuro) al hacer clic en una mesa, que muestra detalle y acciones básicas (cambiar estado, ir a `/tables`, ir a `/reservations`).
- `/tables` (`Tables.jsx`) — CRUD clásico de mesas en tabla + modal de formulario.

Las reservas no son visibles en el plano; hay que navegar a `/reservations` para verlas.

## Objetivo

Convertir `/floor-plan` en el único punto de gestión de mesas: creación, edición, cambio de estado, eliminación de mesas, y visualización/edición/cancelación de reservas — todo sin bloquear el plano con overlays, usando un panel lateral (drawer) no bloqueante. Eliminar `/tables`.

## Alcance

Incluye: frontend (`restaurante-frontend`) y un endpoint nuevo de backend optimizado para reservas por restaurante y fecha.
No incluye: creación de reservas nuevas desde el plano (se mantiene solo en `/reservations`), cambios al editor de layout (drag & drop, formas, elementos decorativos), cambios de rol/permisos.

## Backend — endpoint optimizado de reservas por restaurante y fecha

Hoy el frontend traería las reservas con `GET /reservations?size=9999` y filtraría en cliente — funciona pero no escala (trae todo el histórico). Se añade un endpoint específico, siguiendo el mismo patrón que `GET /api/v1/restaurants/{restaurantId}/tables`:

- **Repository** (`ReservationRepository`): `List<Reservation> findByRestaurantIdAndReservationDateAndDeletedFalse(Long restaurantId, LocalDate date)`.
- **Service** (`ReservationService`): `findByRestaurantIdAndDate(Long restaurantId, LocalDate date)` — valida acceso con `CurrentUserService.validateRestaurantAccess(restaurantId)` antes de consultar (mismo invariante multi-tenant que el resto del código).
- **Controller** (`ReservationController`): `GET /api/v1/restaurants/{restaurantId}/reservations?date=YYYY-MM-DD`, con `@PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")` igual que el resto de endpoints de reservas. `date` es opcional; si se omite, por defecto es la fecha de hoy (`LocalDate.now()`).
- Devuelve `ApiResponse<List<ReservationResponse>>` (no paginado, el volumen por restaurante/día es pequeño).
- Test de integración: filtra correctamente por fecha, y un `EMPLOYEE` sin restaurantes asignados recibe lista vacía / 403 según corresponda al patrón existente de `validateRestaurantAccess`.

Es un endpoint aditivo: no modifica `GET /reservations` ni el flujo de `/reservations` existente.

## Frontend — datos

- `reservationService.js`: nueva función `getReservationsByRestaurantAndDate(restaurantId, date)` → `GET /restaurants/{restaurantId}/reservations?date=...`, siguiendo el mismo patrón de manejo de errores (`handleError`) que el resto del servicio.
- `FloorPlan.jsx` carga en paralelo, al cambiar de restaurante: mesas, elementos del plano y reservas de **hoy** del restaurante seleccionado.
- Un `useMemo` construye un mapa `diningTableId → reserva a mostrar`, seleccionando entre las reservas de estado `PENDING`/`CONFIRMED` de ese `diningTableId`: la de hora más próxima cuya `reservationTime >= ahora`; si todas ya pasaron, la última (en curso). Reservas `CANCELLED`/`COMPLETED` se ignoran para este mapa.
- Tras cualquier mutación (cambio de estado de mesa, crear/editar/eliminar mesa, editar/cancelar reserva) se refrescan mesas + reservas del restaurante activo (reutilizando el patrón `reloadPlanData` ya existente).

## Frontend — visibilidad de reservas sobre las mesas

En `FloorPlanCanvas.jsx`, cuando una mesa tiene una reserva asociada (recibida vía nueva prop `reservationsByTableId`) y **no** está en modo edición de layout, la tarjeta de la mesa muestra, además del número:

```
Mesa 8
María Ruiz
19:45 · 4p
```

- Nombre del cliente truncado con ellipsis si no cabe.
- Formato compacto `HH:mm · Np`.
- Mesas sin reserva asociada mantienen el formato actual (número + capacidad + barra de color de estado).
- En modo edición de layout (`editMode=true`) no se muestra info de reserva — prioriza el drag & drop y las propiedades de forma, igual que hoy.

## Frontend — panel lateral (drawer)

Nuevo componente `TableDrawer.jsx`, panel fijo al borde derecho de la pantalla (ancho ~380px, `position: fixed`), sin backdrop ni blur. El plano permanece visible e interactivo mientras el drawer está abierto.

**Apertura/cierre:**
- Se abre al hacer clic en una mesa (sustituye al modal centrado actual).
- Se cierra con: botón ✕, tecla Esc, o clic en zona vacía del plano.
- Clic en otra mesa mientras el drawer está abierto cambia su contenido a la mesa nueva (no hay que cerrar y reabrir).
- Solo existe cuando hay una mesa seleccionada (`selectedTable !== null`); si no, no se renderiza.

**Modos** (estado interno del drawer, no rutas separadas):

1. **Detalle** (modo por defecto al abrir): nombre de mesa, badge de estado, capacidad, ubicación, reserva actual de hoy (cliente, email, hora, personas, notas) si existe, y lista compacta del resto de reservas de hoy para esa mesa si hay más de una. Acciones disponibles:
   - Cambiar estado (botones inline, visible para cualquiera que vea el plano — igual que hoy).
   - Editar mesa (visible si `MANAGE_TABLES`) → pasa a modo **Editar mesa**.
   - Eliminar mesa (visible si `MANAGE_TABLES`) → confirmación inline (danger zone) dentro del propio drawer, luego llama a `deleteTable` y cierra el drawer.
   - Editar reserva (visible si `MANAGE_RESERVATIONS` y hay reserva actual) → pasa a modo **Editar reserva**.
   - Cancelar reserva (visible si `MANAGE_RESERVATIONS` y hay reserva actual) → confirmación inline, luego `deleteReservation` (cancelación lógica ya existente en el backend).
2. **Editar mesa**: formulario inline (número, capacidad, ubicación, estado) reutilizando la lógica de validación de `Tables.jsx`, guarda con `updateTable` y vuelve a modo Detalle.
3. **Crear mesa**: mismo formulario que Editar mesa pero vacío, se activa desde el botón "+ Añadir mesa" de la toolbar superior o desde el empty state; guarda con `createTable(restaurantId, data)` y, al terminar, selecciona la mesa recién creada en modo Detalle.
4. **Editar reserva**: formulario inline (fecha, hora, número de personas, notas, estado), guarda con `updateReservation` y vuelve a modo Detalle.

El botón **"+ Añadir mesa"** permanece en la toolbar superior de `FloorPlan.jsx` (visible solo con `MANAGE_TABLES`, como ya ocurre con el modo edición de layout hoy).

## Limpieza de rutas y navegación

- `App.jsx`: se elimina el `import Tables` y la ruta `/tables`; se añade `<Route path="/tables" element={<Navigate to="/floor-plan" replace />} />` para no romper enlaces/favoritos existentes.
- `Sidebar.jsx`: se elimina la entrada `{ path: '/tables', label: 'Gestión de mesas', icon: 'tables' }`.
- `Navbar.jsx`: se elimina la entrada de breadcrumb `'/tables': { parent: null, label: 'Gestión de mesas' }`.
- `permissions.js`: se elimina `/tables` de `ROUTE_PERMISSIONS` y de cualquier otro mapa de rutas (líneas ~107 y ~121); `VIEW_TABLES` y `MANAGE_TABLES` se conservan como permisos de acción (usados dentro del drawer), no como permiso de ruta.
- Se elimina `restaurante-frontend/src/pages/Tables.jsx`.
- El empty state "Este restaurante no tiene mesas" en `FloorPlan.jsx` deja de navegar a `/tables` y en su lugar abre el drawer en modo **Crear mesa**.

## Errores y feedback

Se reutiliza el sistema de toasts ya existente en `FloorPlan.jsx` (`showToast`) para éxito/error de todas las acciones del drawer (crear, editar, eliminar mesa; editar/cancelar reserva). No se introduce un sistema de notificaciones nuevo.

## Verificación

- Backend: test de integración del nuevo endpoint (`GET /restaurants/{id}/reservations?date=`), incluyendo el caso de scoping por rol (`EMPLOYEE` sin restaurantes asignados).
- Frontend: `pnpm lint` y `pnpm build` sin errores.
- Prueba manual end-to-end en `dev` (H2 + datos demo): crear mesa → crear reserva vía `/reservations` → verificar que aparece sobre la mesa en el plano → abrir drawer → editar reserva → cancelar reserva → cambiar estado de mesa → eliminar mesa. Confirmar que el plano nunca queda bloqueado por overlay/blur y que `/tables` redirige a `/floor-plan`.

## Fuera de alcance (explícitamente descartado)

- Crear reservas nuevas desde el drawer del plano (se mantiene en `/reservations`).
- Tocar el editor de layout (drag & drop, formas de mesa, elementos decorativos) más allá de ocultar la info de reserva mientras `editMode=true`.
- Cambios a `permissions.js` a nivel de qué rol puede hacer qué (solo se reubican los permisos existentes de ruta a acción).
