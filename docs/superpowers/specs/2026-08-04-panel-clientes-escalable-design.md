# Panel escalable de clientes

Fecha: 2026-08-04

Tercera entrega del mismo patrón, después de
[restaurantes](2026-08-04-panel-restaurantes-superadmin-design.md) y
[empleados](2026-08-04-panel-empleados-escalable-design.md). Reservas queda para
un spec propio.

## Problema

`GET /customers` ya pagina y busca en el servidor, pero el frontend pide
`size=500` y hace el resto en el navegador:

- Las **cuatro tarjetas de segmento** (total, recurrentes, nuevos este mes, sin
  venir en 3 meses) se cuentan sobre la lista descargada. Al paginar contarían
  solo la página, que es peor que no contar.
- El **filtro por segmento** también se aplica en cliente, así que una página de
  25 filtrada por «recurrentes» mostraría solo los recurrentes de esas 25.
- `CustomerMapper.toResponse` lee `customer.getUser().getUsername()` y
  `getRestaurant().getName()`, dos asociaciones `LAZY`: **dos consultas extra por
  fila**.

## Funcionalidad muerta que se retira

La entidad `Customer` **no tiene campo `active`**, y la palabra no aparece en
todo el paquete `customer/` del backend. Pese a ello la pantalla:

- pinta una columna **Estado** que siempre dice «Activo», porque evalúa
  `customer.active !== false` sobre un campo que siempre es `undefined`;
- ofrece un filtro donde **«Inactivos» devuelve siempre cero** y «Activos»
  devuelve todo;
- muestra un botón y un modal de **desactivar/reactivar** que llaman a
  `PATCH /customers/{id}/active`, **un endpoint que no existe**.

Se eliminan la columna, el filtro, el botón, el modal y `toggleCustomerActive`
del servicio. Mostrar un estado inventado y un botón que siempre falla es peor
que no tenerlos. Si más adelante se quiere desactivar clientes, se implementa
con su columna, su endpoint y sus pruebas.

**No se añade un borrado en su lugar.** El backend soporta
`DELETE /customers/{id}`, pero es una acción destructiva fuera de lo pedido.

## Datos que existen realmente

`Customer`: `user, restaurant, firstName, lastName, email, phone, notes`, más
`createdAt / updatedAt / deleted / deletedAt` de `BaseEntity`.

Los agregados `totalReservations` y `lastReservationDate` **sí son reales**: los
calcula `ReservationRepository.findStatsByCustomerIds`, que excluye reservas
canceladas y borradas. Los tres segmentos se apoyan en ellos:

- **recurrentes**: más de una reserva.
- **nuevos este mes**: `createdAt` desde el día 1 del mes en curso.
- **sin venir**: última reserva anterior a hace 3 meses. Quien no ha reservado
  nunca queda fuera a propósito — es otro caso, no un cliente que se enfría — y
  el `NULL` de `MAX(...)` ya lo excluye por sí solo.

No existen segmento de gasto, valor de cliente ni estado de fidelización. No se
inventan.

## Backend

### Endpoints

```
GET /api/v1/customers?page=0&size=25&search=ana&restaurantId=3&segment=recurrentes&sort=name&direction=asc
GET /api/v1/customers/stats
```

`/stats` se declara antes de `/{id}`; la ruta literal gana, como ya ocurre con
`/me` en usuarios.

Validación: `page` ≥ 0, `size` acotado a 1..100 (25 por defecto), `direction`
solo `asc`/`desc`, `sort` y `segment` contra listas cerradas. Cualquier otro
valor devuelve 400. Permisos sin cambios: `SUPER_ADMIN, ADMIN, MANAGER,
EMPLOYEE`, con el alcance multi-tenant que ya resuelve `CurrentUserService`.

### Segmentos en la consulta

El servicio traduce el `segment` a tres parámetros independientes, y la consulta
aplica el que venga:

- `filterRecurrentes`: `(SELECT COUNT(...)) > 1`.
- `newSince`: `c.createdAt >= :newSince`.
- `inactiveBefore`: `(SELECT MAX(reservationDate)) < :inactiveBefore`.

Los dos umbrales de fecha se calculan en el servicio y viajan como parámetros,
no como funciones de fecha de SQL, para que H2 y MySQL se comporten igual.

### `CustomerListItem`

Proyección con `LEFT JOIN` a `user` y `restaurant`, que elimina el N+1. Incluye
`notes` porque el formulario de edición se abre con los datos de la fila. Los
agregados de reservas se completan con la consulta por lotes que ya existe, así
que el listado cuesta **2 consultas por página**.

### `CustomerSortField`

Lista cerrada: `id`, `name` (nombre y luego apellido), `email`, `createdAt`.

**Reservas y Última reserva no son ordenables**: son subconsultas, y ordenar por
ellas no encaja con `Pageable` sin meter el `ORDER BY` dentro de la consulta.
Hoy la tabla no tiene ninguna cabecera ordenable, así que el cambio suma de
todos modos.

### `CustomerStats`

`total`, `recurrentes`, `nuevosEsteMes`, `sinVenir` en una consulta agregada con
`SUM(CASE WHEN ...)`, en el mismo alcance que el listado.

### Coste conocido

Las subconsultas correlacionadas del segmento se evalúan por fila candidata. Con
el volumen actual es correcto y sobrado; con decenas de miles de clientes
convendría un índice sobre `(customer_id, status, reservation_date)` o una tabla
de agregados. Se anota, no se implementa.

## Frontend

- `customerService.getCustomers({page, size, search, restaurantId, segment,
  sort, direction})` devuelve la página **con** metadatos, y
  `getCustomerStats()` alimenta las tarjetas. Desaparece `toggleCustomerActive`.
- Las **cuatro tarjetas siguen siendo interruptores** (`aria-pressed`), que es lo
  mejor de esta pantalla, pero ahora mandan `segment` al backend y sus cifras
  vienen de `/customers/stats`, no de contar la página.
- Tabla: **Cliente** (nombre, con `email · teléfono` como línea secundaria) ·
  **Restaurante** · **Reservas** · **Última reserva** · **⋮**. Cabeceras
  ordenables donde el backend lo permite.
- Menú `⋮`: **Ver detalles**, **Editar cliente** y **Copiar email**.
- Reutiliza `Pagination` y `ActionMenu`; buscador con debounce de 350 ms que
  vuelve a la primera página y conserva segmento, restaurante, orden y tamaño;
  esqueleto en la carga inicial, `is-refreshing` en los refrescos, estados
  vacío / sin resultados / error con reintento, y retroceso de página si la
  actual queda vacía.
- El modal de detalle y su historial de reservas se conservan: usan su propio
  endpoint.

## Pruebas

Backend:

- `CustomerEndpointIntegrationTest`: paginación completa (primera, intermedia,
  última, fuera de rango, tamaño, tope de 100, página negativa), búsqueda con y
  sin resultados, comodín literal, los tres segmentos, filtro por restaurante,
  orden ascendente y descendente, `sort` y `segment` no válidos, acceso con los
  cuatro roles autorizados, aislamiento entre cuentas, métricas y conjunto
  vacío.
- `CustomerSortFieldTest` y `CustomerSegmentTest`: las listas cerradas.
- Se amplía `CustomerSearchRepositoryTest` sin romper lo que ya cubre.

Frontend: `Customers.test.jsx` (paginación, tamaño, debounce, tarjetas como
interruptores de segmento contra el backend, filtro por restaurante, orden,
copiar email, detalle, y estados de carga, error y vacío).

Verificación: `mvn test`, `pnpm lint`, `pnpm test`, `pnpm build`.

## Riesgos conocidos

- Se retira funcionalidad visible (columna Estado, filtro y modal de
  desactivar). Es una decisión aprobada, pero es un cambio que el usuario nota.
- `CustomerResponse` sigue existiendo para el detalle y las escrituras; el
  listado pasa a `CustomerListItem`. Hay que revisar que ningún otro consumidor
  del listado espere el formato anterior.
- Ordenar por `createdAt` con valores nulos los agrupa al principio o al final
  según el motor.
- Reservas sigue pidiendo `size=9999`, y los desplegables de restaurantes
  `size=500`. Fuera de este spec.

## Git

Commits locales pequeños en `JRM-produccion`. Prohibido y no ejecutado:
`git push`, push forzado, pull request, merge remoto, publicación en GitHub y
despliegue en Vercel o Railway.
