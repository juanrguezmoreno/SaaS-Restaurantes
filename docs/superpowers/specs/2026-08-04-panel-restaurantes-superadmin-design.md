# Panel escalable de restaurantes para SUPER_ADMIN

Fecha: 2026-08-04

## Problema

La pantalla `/restaurants` descarga **todos** los restaurantes de una vez
(`getRestaurants()` pide `size=500`) y, debajo de la tabla, renderiza un bloque
«Reservas online» que repite cada restaurante **dos veces más**: una para el
enlace público y otra para las acciones de QR. Con 100, 500 o varios miles de
registros esto significa una respuesta enorme, tres recorridos completos en el
DOM y una tabla imposible de recorrer a mano. Las métricas superiores se
calculan en el navegador sumando el array completo, así que dependen de haber
descargado todo.

Además, el listado actual pasa por `RestaurantMapper.toResponse`, que lee
`restaurant.getTables().size()` y `getEmployees().size()` sobre colecciones
`LAZY`: una consulta extra por restaurante y por colección (N+1).

## Datos que existen realmente

`Restaurant` tiene: `name, address, phone, email, description, openingTime,
closingTime, capacity, publicBookingEnabled,
defaultReservationDurationMinutes, tenant`, más `createdAt / updatedAt /
deleted / deletedAt` heredados de `BaseEntity`.

**No existen** en el modelo: plan de suscripción, estado de pago, última
actividad, un campo `status` de restaurante ni una clave ajena de propietario.
Nada de eso se implementa ni se muestra.

La «cuenta asociada» se representa con `Restaurant.tenant` (`tenantId` /
`tenantName`), que es el dato real de agrupación multi-tenant. No se deriva un
«propietario» a partir de `User.restaurant` / `User.assignedRestaurants`: un
restaurante puede tener cero o varios usuarios vinculados, así que llamarlo
propietario sería una interpretación nuestra, no un dato del modelo.

## Alcance por rol

`/restaurants` está protegida por `VIEW_RESTAURANTS`, que solo tienen
SUPER_ADMIN y ADMIN (MANAGER y EMPLOYEE no la ven). El nuevo endpoint sirve a
ambos, pero **el alcance se resuelve siempre en el servidor** con
`CurrentUserService`:

- SUPER_ADMIN: sin restricción, ve todos los tenants (vista global).
- ADMIN: acotado a su `tenantId`.
- Cualquier otro rol: 403.

Así la vista *global* sigue siendo exclusiva del SUPER_ADMIN, un ADMIN no puede
listar restaurantes de otras cuentas, y ADMIN no se queda con la pantalla
antigua. El rol nunca viaja como parámetro: cambiarlo en el frontend no altera
el alcance.

`GET /api/v1/restaurants` (público, `permitAll`) **no se modifica**: lo consumen
Customers, Employees, FloorPlan, Reservations y `useAllTables` para poblar
desplegables.

## Backend

Todo dentro del paquete `restaurant/`, siguiendo el layout por feature.

### `AdminRestaurantListItem` (DTO ligero de listado)

`id, name, address, phone, email, capacity, publicBookingEnabled, tenantId,
tenantName, createdAt`.

Sin `description`, sin `tableCount` ni `employeeCount`: se construye con una
*constructor expression* JPQL y `LEFT JOIN r.tenant`, de modo que la página
entera sale en **una sola consulta** y no hay N+1. No expone contraseñas,
tokens ni datos internos.

### `AdminRestaurantStats`

`totalRestaurants`, `totalCapacity`, `publicBookingEnabledCount`. Una sola
consulta agregada (`COUNT`, `COALESCE(SUM(capacity),0)`,
`SUM(CASE WHEN publicBookingEnabled THEN 1 ELSE 0 END)`) con el mismo alcance
que el listado. `publicBookingEnabled` es un campo real; no se inventan
estados.

### `AdminRestaurantSortField`

Enum con la lista cerrada de campos ordenables: `id`, `name`, `capacity`,
`createdAt`. Un valor fuera de la lista devuelve 400 (`BadRequestException`),
nunca se interpola en la consulta.

### `AdminRestaurantController`

```
GET /api/v1/admin/restaurants?page=0&size=25&search=pepe&sort=name&direction=asc
GET /api/v1/admin/restaurants/stats
```

`@PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")`. Queda bajo
`anyRequest().authenticated()`; **no se añade ningún `permitAll`** en
`SecurityConfig`.

Validación de parámetros: `page` ≥ 0, `size` acotado a 1..100 (por defecto 25),
`direction` solo `asc`/`desc`, `sort` contra el enum.

Respuesta del listado: `PagedResponse<AdminRestaurantListItem>` (`content`,
`page`, `size`, `totalElements`, `totalPages`, `first`, `last`, `empty`).
Respuesta de métricas: `ApiResponse<AdminRestaurantStats>`.

### Búsqueda

Un único parámetro `search` sobre los campos que existen: `name`, `email`,
`phone`, `address` y el nombre del tenant. Se normaliza como en
`CustomerService.normalizeSearch` (minúsculas, comodines `%`/`_`/`!`
escapados, `ESCAPE '!'`), y siempre como parámetro JPQL: sin concatenación de
SQL.

### Repositorio

Dos métodos en `RestaurantRepository`: `searchForAdmin(...)` con `countQuery`
explícita (la derivada no funciona con *constructor expression*) y
`statsForAdmin(...)`. Firma de alcance idéntica al patrón ya usado en
`CustomerRepository.search`: `unrestricted` + `restaurantIds` + `tenantId`.

Crear, editar y eliminar siguen usando los endpoints existentes de
`RestaurantController`. No se cambia su comportamiento.

## Frontend

- `services/adminRestaurantService.js` — devuelve la página **con** metadatos
  (`extractData` los descarta, así que no se usa aquí) y `getAdminRestaurantStats()`.
- `components/Pagination.jsx` — reutilizable: «Mostrando 1–25 de 487
  restaurantes», paginación compacta (`‹ 1 2 3 … 20 ›`, sin cientos de
  botones), selector de tamaño 10/25/50/100 con 25 por defecto, botones
  deshabilitados cuando no se puede avanzar o retroceder.
- `components/ActionMenu.jsx` — menú `⋮` en React puro (Bootstrap JS no está
  importado en el proyecto, y no se añade ninguna dependencia). Cierre por clic
  fuera y `Escape`, estilos `.dropdown-menu` / `.dropdown-item` existentes,
  entrada destructiva visualmente diferenciada.
- `components/RestaurantDetailModal.jsx` — panel de detalle de **un**
  restaurante: nombre, cuenta, contacto, capacidad, horario, fecha de alta,
  enlace público de reservas, copiar enlace, abrir página pública, ver QR
  (delega en el `QRModal` existente) y descargar QR.
- `pages/Restaurants.jsx` — reescrita:
  - Columnas: **Restaurante** (nombre, con `dirección resumida · email` como
    línea secundaria) · **Cuenta** · **Capacidad** · **Reservas online**
    (badge según `publicBookingEnabled`) · **Alta** (`createdAt`) · **⋮**.
    Lo que sale de la tabla vive en el panel de detalle: no se pierde
    información.
  - Cabeceras ordenables con indicador visible de columna y dirección.
  - Buscador con debounce de 350 ms; al cambiar vuelve a la página 0 y
    conserva orden y tamaño.
  - Skeleton en la carga inicial; `.app-card.is-refreshing` en refrescos, para
    que el input no se desmonte ni pierda el foco.
  - Estados: vacío sin restaurantes, vacío por búsqueda sin resultados, error
    con botón de reintento, mensajes de éxito al copiar / crear / eliminar.
  - Borrado: confirmación con el nombre del restaurante afectado, protección
    contra doble clic, refresco solo de la página actual y retroceso automático
    a la página anterior si la actual queda vacía.
  - **Se elimina el bloque masivo de «Reservas online»**: el enlace y el QR
    pasan al panel de detalle del restaurante seleccionado. El QR se genera
    solo cuando el usuario lo pide.

No cambian `permissions.js`, las rutas de `App.jsx`, el tema oscuro, el
`QRModal`, ni ninguna variable de entorno. Se mantiene la identidad visual
(tipografía, espaciado, bordes, colores, tarjetas y botones existentes).

## Pruebas

Backend:

- `AdminRestaurantServiceTest` (Mockito): alcance SUPER_ADMIN / ADMIN / rol sin
  acceso, normalización de la búsqueda, `sort` no permitido → 400, `size`
  fuera de rango acotado.
- `AdminRestaurantEndpointIntegrationTest` (patrón de
  `ServicePeriodEndpointIntegrationTest`): primera página, página intermedia,
  última página, página fuera de rango, cambio de tamaño, búsqueda con y sin
  resultados, orden ascendente y descendente, 200 con SUPER_ADMIN, 403 con
  MANAGER y EMPLOYEE, eliminación de un restaurante, respuesta sin
  restaurantes.

Frontend (`Restaurants.test.jsx`, Vitest + Testing Library): navegación entre
páginas, cambio de tamaño, búsqueda con debounce, limpiar búsqueda, apertura y
cierre del panel de detalle, copiar enlace, abrir página pública, ver y
descargar QR, confirmación de eliminación, estados de carga, error y vacío.

Verificación: `mvn test`, `mvn -q compile`, `pnpm build`, `pnpm lint`,
`pnpm test`. Ninguna comprobación se desactiva para que pase algo.

## Riesgos conocidos

- `ddl-auto: update` y sin migraciones: el diseño **no añade ni cambia
  columnas**, así que no hay riesgo de esquema.
- Ordenar por `createdAt` en registros antiguos con `created_at` nulo los
  agrupa al principio o al final según el motor. Es aceptable y no se
  corrige inventando valores.
- El endpoint público `GET /api/v1/restaurants` sigue devolviendo hasta 500
  registros a los desplegables de otras pantallas. Queda fuera del alcance de
  este trabajo; se anota como deuda pendiente.

## Git

Commits locales pequeños en la rama actual (`JRM-produccion`). Prohibido y no
ejecutado: `git push`, push forzado, pull request, merge remoto, publicación en
GitHub, despliegue en Vercel o Railway, y modificación de ramas remotas.
