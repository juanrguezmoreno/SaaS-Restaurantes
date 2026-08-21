# Panel escalable de empleados

Fecha: 2026-08-04

Continúa el trabajo de [2026-08-04-panel-restaurantes-superadmin-design.md](2026-08-04-panel-restaurantes-superadmin-design.md),
aplicando el mismo patrón a la pantalla de Empleados. Clientes y Reservas van
después, cada una con su propio spec.

## Problema

`GET /api/v1/users` **solo pagina de verdad para SUPER_ADMIN**. Para ADMIN y
MANAGER, `UserService.findAll` llama a `findAllByDeletedFalse()` sin
`Pageable`, filtra la lista completa en memoria con streams y pagina con
`subList`: el coste crece con el número total de usuarios del sistema aunque se
pida una página de 10.

Encima, `UserMapper.toResponse` recorre `user.getAssignedRestaurants()`, que es
una colección `LAZY`, y `user.getRoles()`, que es `EAGER`: una consulta extra por
usuario y por colección (N+1).

El frontend agrava las dos cosas: pide `size=1000` y hace la búsqueda y la
ordenación en el navegador
(`Employees.jsx`, `filteredEmployees`), y además cruza los nombres de
restaurante contra `getRestaurants({size:500})`.

## Decisión: mejorar el endpoint existente, no crear otro

En restaurantes hubo que añadir un endpoint aparte porque `GET /restaurants` es
público (`permitAll`) y lo comparten cinco pantallas para poblar desplegables.

Aquí no aplica: `GET /users` ya exige rol `SUPER_ADMIN`, `ADMIN` o `MANAGER` y
tiene **un único consumidor** (`getUsers`, usado solo por `Employees.jsx`).
Duplicar la superficie sería peor que arreglar la que hay. No cambian los
permisos del endpoint.

## Datos que existen realmente

`User` tiene: `username, email, password, firstName, lastName, phone, enabled,
tenant, restaurant, assignedRestaurants, roles`, más `createdAt / updatedAt /
deleted / deletedAt` de `BaseEntity`.

**No existen**: fecha de último acceso, estado de invitación, ni ningún campo de
actividad. No se implementan ni se muestran.

`password` no se expone nunca, ni ahora ni en el DTO nuevo.

## Backend

### Endpoints

```
GET /api/v1/users?page=0&size=25&search=ana&role=MANAGER&status=active&sort=name&direction=asc
GET /api/v1/users/stats
```

Validación de parámetros igual que en el panel de restaurantes: `page` ≥ 0,
`size` acotado a 1..100 (25 por defecto), `direction` solo `asc`/`desc`, `sort`
contra una lista cerrada. `role` se resuelve contra el enum `RoleName`;
`status` admite `active`, `inactive` o nada.

`/stats` va antes de `/{id}` en el controlador y no colisiona: la ruta literal
gana, igual que ya ocurre con `/me`.

### `UserRepository.search(...)`

Una sola consulta JPQL sustituye al filtrado en memoria. El alcance llega
resuelto desde el servidor, nunca como parámetro del cliente:

- `unrestricted` (solo SUPER_ADMIN): sin filtro de tenant.
- `tenantId`: acota a la cuenta del usuario autenticado.
- `filterByRestaurants` + `restaurantIds`: para MANAGER con asignaciones, se
  comprueba el restaurante principal **o** una asignación, con `EXISTS` sobre
  `u.assignedRestaurants` en vez de recorrerlo en Java.

Búsqueda por `username`, `email`, `firstName`, `lastName`, nombre completo
concatenado y `phone`, en minúsculas y con los comodines `%`, `_` y `!`
escapados (`ESCAPE '!'`), como en `CustomerService.normalizeSearch`.

Filtros opcionales: `role` (con `EXISTS` sobre `u.roles`) y `enabled`.

### `AdminUserListItem` y el N+1

DTO ligero para el listado: `id, username, email, firstName, lastName, phone,
enabled, tenantName, createdAt`, más `roles` y `restaurantNames`.

La página se proyecta **sin colecciones**, y los roles y los nombres de
restaurante de esa página se resuelven con **dos consultas por lotes** sobre los
identificadores de la página. Total: **3 consultas por página**, independientemente
del tamaño. Es la misma técnica que ya usa
`CustomerService.enrichWithReservationStats`.

### `AdminUserSortField`

Lista cerrada: `id`, `name`, `username`, `email`, `createdAt`, `enabled`. Un
valor fuera de la lista devuelve 400 (`BadRequestException`). `name` ordena por
`firstName` y luego `lastName`.

**Cambio de comportamiento aceptado:** hoy la tabla permite ordenar por **Rol**
en cliente. En SQL no es ordenable, porque los roles son una colección
`ManyToMany`. Se sustituye por un **filtro por rol**, que sí es consultable y es
más útil en una lista larga.

### `UserStats`

`total`, `active`, `inactive`, en una consulta agregada con el mismo alcance que
el listado. Solo datos reales (`enabled`).

## Frontend

- `userService.getUsers({page, size, search, role, status, sort, direction})`
  devuelve la página **con** metadatos (no `extractData`, que los descarta), y
  `getUserStats()` para las tarjetas.
- `Employees.jsx` reutiliza `Pagination`, `ActionMenu`, el buscador, el
  esqueleto, `is-refreshing` y las cabeceras ordenables creados para
  restaurantes. Columnas: **#** · **Empleado** (nombre, con `usuario · email`
  como línea secundaria) · **Rol** · **Restaurantes** · **Estado** · **Alta** ·
  **⋮**. Filtros de rol y estado en la barra de herramientas.
- Menú `⋮`: **Editar empleado**, **Copiar email** y **Eliminar** (separado, en
  rojo, con confirmación que nombra al empleado y protección contra doble clic).
  No se añade activar/desactivar: hoy no existe como operación propia del
  backend.
- Buscador con debounce de 350 ms que vuelve a la primera página y conserva
  orden, tamaño y filtros. Estados de carga inicial, refresco, error con
  reintento, sin empleados y sin resultados de búsqueda.
- Si al eliminar la página queda vacía, se retrocede a la anterior.
- Los nombres de restaurante ya vienen en el DTO, así que la tabla deja de
  cruzarlos contra `getRestaurants({size:500})`. La lista de restaurantes se
  sigue pidiendo, pero solo para el formulario de crear/editar.

Se conservan intactos el formulario de creación/edición, las reglas de
`getAssignableRoles`, `permissions.js`, las rutas y el tema.

## Pruebas

Backend:

- `UserSearchRepositoryTest`: alcance de SUPER_ADMIN, ADMIN, MANAGER con
  asignaciones y MANAGER sin asignaciones; búsqueda por cada campo; filtros de
  rol y estado.
- `AdminUserSortFieldTest`: la lista cerrada de campos de orden.
- `UserEndpointIntegrationTest`: primera página, intermedia, última, fuera de
  rango, cambio de tamaño, tope de 100, página negativa, búsqueda con y sin
  resultados, orden ascendente y descendente, campo y dirección no válidos,
  acceso con SUPER_ADMIN/ADMIN/MANAGER, denegación con EMPLOYEE, aislamiento
  entre cuentas, métricas y respuesta sin usuarios.
- Se amplía `UserServiceTest` sin romper sus 7 pruebas actuales.

Frontend: `Employees.test.jsx` (paginación, tamaño, debounce, limpiar búsqueda,
filtros de rol y estado, orden con indicador, copiar email, confirmación de
borrado, doble clic, estados de carga/error/vacío).

Verificación: `mvn test`, `pnpm lint`, `pnpm test`, `pnpm build`. Ninguna
comprobación se desactiva.

## Riesgos conocidos

- El orden por rol desaparece, sustituido por un filtro (decisión aprobada).
- `UserService.findAll(Pageable)` cambia de firma interna; hay que revisar que
  no queden otros llamadores en el backend.
- Ordenar por `createdAt` con valores nulos los agrupa al principio o al final
  según el motor (H2 frente a MySQL).
- Clientes y Reservas siguen pidiendo `size=500` y `size=9999`. Quedan fuera de
  este spec, cada una con su ciclo.

## Git

Commits locales pequeños en `JRM-produccion`. Prohibido y no ejecutado:
`git push`, push forzado, pull request, merge remoto, publicación en GitHub y
despliegue en Vercel o Railway.
