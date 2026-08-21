# Panel escalable de reservas

Fecha: 2026-08-21
Estado: aprobado

Cuarta y última pantalla de la tanda, después de restaurantes, empleados y
clientes. Aquí el patrón es el mismo, pero el punto de partida es peor: una
sola petición alimenta siete vistas distintas y un segundo consumidor la
repite cada minuto.

## 1. Problema

### 1.1 El listado provoca `3 × N` consultas

`ReservationMapper.toResponse` lee tres asociaciones `LAZY` por fila —
`customer` (tres campos), `diningTable` y `restaurant`. Con `size=9999` eso
son decenas de miles de consultas por carga de pantalla.

### 1.2 El orden acepta cualquier propiedad

`ReservationController.findAll` parte la cadena `sort` y pasa el nombre
resultante directo a `Sort.by(...)`. `?sort=pepe` no devuelve 400: revienta
con 500 desde Hibernate. Es el mismo agujero cerrado en las otras tres
pantallas.

### 1.3 No hay ningún filtro en servidor

El endpoint solo acepta `page`, `size`, `sort` y `direction`. Restaurante,
estado, fecha y búsqueda no existen: todo se filtra en el navegador.

### 1.4 El navegador hace el trabajo, sin recortar nada

`Reservations.jsx` pide `size=9999` una vez y de esa lista salen siete
vistas: cuatro tarjetas, el aviso de solicitudes, las tres tablas apiladas de
la pestaña «Activas», la pestaña «Historial», la pestaña «Todas» y el
calendario diario. Ninguna de las cuatro tablas aplica `slice`: pintan todas
las filas que casen.

### 1.5 Inicio es el consumidor más caro

`Inicio.jsx` llama al mismo `getReservations()` y lo repite al recuperar el
foco, al volver a la pestaña del navegador y **cada 60 segundos**. En cuanto
el backend limite `size`, Inicio se rompe en silencio: seguiría pintando
KPIs, pero calculados sobre las primeras 100 filas. Por eso entra en esta
fase.

## 2. Backend

### 2.1 `ReservationListItem`

Proyección plana construida por expresión constructora JPQL, con
`JOIN r.customer c`, `JOIN r.restaurant rest` y `LEFT JOIN r.diningTable t`
(la mesa es opcional).

**Sus campos JSON son exactamente los de `ReservationResponse`**, incluido
`holdStatus`, que se deriva en un getter a partir de `holdExpiresAt`
(`NONE` / `ACTIVE` / `EXPIRED`) con la misma regla que el mapper. `customerName`
también es un getter, sobre `customerFirstName` + `customerLastName`, que se
marcan `@JsonIgnore`.

Esa compatibilidad es deliberada: el modal de detalle, el formulario de
editar (que se rellena con los datos de la fila) y el asistente siguen
leyendo lo mismo y no se tocan. Por eso la proyección incluye `notes`,
`customerId`, `restaurantId` y `diningTableId` aunque no se pinten en la
tabla.

Coste del listado: **una consulta por página**, sea cual sea el tamaño.

### 2.2 `ReservationView`

Lista cerrada de vistas. `hoy` es `LocalDate.now()`; la JVM fija
`Europe/Madrid` en `RestaurantManageApplication`, así que coincide con la
fecha local del navegador para un usuario español.

| Vista | Criterio |
|---|---|
| `solicitudes` | `PENDING` y `reservationDate >= hoy` |
| `hoy` | `CONFIRMED` y `reservationDate = hoy` |
| `proximas` | `CONFIRMED` y `reservationDate > hoy` |
| `historial` | estado en (`CANCELLED`,`COMPLETED`,`NO_SHOW`), o `reservationDate < hoy` y estado distinto de `PENDING` |
| `todas` | sin criterio |

Son los mismos criterios que hoy aplica el navegador en
`lib/reservationHelpers.js` y en los `useMemo` de `Reservations.jsx`,
traducidos a SQL. Un valor desconocido devuelve **400**; ausencia o cadena en
blanco equivale a `todas`.

La vista se traduce en el servicio a un registro interno
`ViewPredicate(boolean filterStatuses, Set<ReservationStatus> statuses,
LocalDate dateFrom, LocalDate dateTo, boolean historyMode)` que viaja a la
consulta como parámetros bandera, igual que en clientes. Se compone con los
filtros que elija el usuario: son condiciones que se suman, no que se
sustituyen.

### 2.3 Filtros y búsqueda

- `search`: nombre, apellido y email del cliente, y número de mesa.
  Insensible a mayúsculas, `LIKE %valor%`.
- `restaurantId`: uno concreto, siempre dentro del alcance del usuario.
- `status`: un `ReservationStatus`; valor inválido → 400.
- `date`: fecha exacta. Se mantiene el filtro de fecha única que ya existe en
  la interfaz; no se añade rango porque nadie lo ha pedido.

### 2.4 `ReservationSortField`

Lista cerrada: `id`, `date` (`reservationDate` y luego `reservationTime`),
`customer` (`customer.firstName`, `customer.lastName`), `partySize`,
`status`, `createdAt`. Por defecto `date` descendente, que es el orden
actual. Cualquier otro valor → `BadRequestException` (400).

Si al implementarlo se comprueba que ordenar por `customer` genera un `JOIN`
duplicado en Hibernate, ese campo se retira de la lista y se documenta, como
se hizo con el rol en empleados. No se deja pasar un orden que produzca una
consulta mal formada.

### 2.5 Alcance por rol

Se resuelve como en las tres pantallas anteriores, a través de
`CurrentUserService.getVisibleRestaurantIds()`: lista con `-1` significa
«ningún acceso» y devuelve página vacía; lista con IDs filtra por ellos;
lista vacía cae en la rama por rol (`SUPER_ADMIN` ve todo, el resto filtra por
los restaurantes de su tenant).

Esto sustituye las cuatro ramas duplicadas que hoy tiene
`ReservationService.findAll`, cada una repitiendo la misma consulta con un
filtro distinto.

### 2.6 `GET /reservations/stats`

Una consulta agregada con `SUM(CASE WHEN ... THEN 1 ELSE 0 END)` que devuelve
seis cifras:

`total`, `pendientes`, `hoyConfirmadas`, `proximasConfirmadas`,
`canceladasFuturas`, `historial`.

Respeta el alcance del usuario y el filtro de restaurante. **No** respeta
búsqueda, estado, fecha ni vista: las cifras no deben bailar al filtrar, y
son también las que van en los contadores de las pestañas.

Las cuatro tarjetas conservan su significado actual sin cambios:
total, confirmadas futuras (`hoyConfirmadas + proximasConfirmadas`),
pendientes y canceladas futuras.

### 2.7 Controlador

`GET /reservations` pasa a aceptar
`page, size, view, search, restaurantId, status, date, sort, direction`.

Se retira el análisis del array `sort` con múltiples criterios: nadie lo
usaba desde la interfaz y era la vía del 500. `MAX_PAGE_SIZE = 100`, como en
las otras tres.

Los permisos no cambian:
`@PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")`.

## 3. Frontend — pantalla de reservas

### 3.1 Estructura

Cinco pestañas con contador — Solicitudes · Hoy · Próximas · Historial ·
Todas — y **una sola tabla paginada** debajo. Cada pestaña es una consulta al
servidor; cambiar de pestaña vuelve a la página 0.

Desaparece la pestaña «Activas» con sus tres tablas apiladas: sus tres
secciones son ahora las tres primeras pestañas. Desaparece también el aviso
flotante de solicitudes que había sobre las pestañas, porque duplicaba
exactamente lo que ahora dice el contador de la pestaña «Solicitudes». Los
botones de confirmar y rechazar viven en esa vista.

### 3.2 Barra de herramientas

Buscador con retardo de 350 ms (que actualiza búsqueda y página en el mismo
render, para disparar una sola petición) y selector de restaurante, siempre
visibles. Estado y fecha solo en «Todas» e «Historial»: en las otras tres
vistas el estado ya viene impuesto por la vista y ofrecerlo sería
contradictorio.

### 3.3 Tabla

Columnas: **#** · **Cliente** · **Mesa** · **Restaurante** · **Fecha y
hora** · **Comensales** · **Estado** · **⋮**.

El menú `⋮` reutiliza el componente `ActionMenu` de la fase de restaurantes y
recoge lo que hoy hay repartido en la fila: ver detalles, editar, cambiar
estado (respetando la matriz de transiciones del backend) y eliminar.

Paginación con el componente `Pagination` ya existente: tamaños 10/25/50/100,
por defecto 25.

### 3.4 Estados de la interfaz

Los mismos que en las otras tres: esqueleto en la primera carga,
`.app-card.is-refreshing` en las siguientes para que el buscador no pierda el
foco, aviso de vacío distinguiendo «no hay nada» de «no hay resultados para
este filtro», y retroceso automático de página si la actual queda vacía tras
borrar.

### 3.5 Calendario

Deja de filtrar la lista general. Pasa a tener su propia consulta por día:
las reservas de esa fecha y, si hay uno elegido, de ese restaurante. Sin
paginar, porque un día es un volumen acotado por naturaleza. Se recarga al
cambiar de fecha o de restaurante.

### 3.6 Lo que no se toca

Asistente de nueva reserva, alta rápida de cliente y los modales de crear,
editar y eliminar se quedan como están. El fichero apenas baja de tamaño,
pero el cambio queda acotado y verificable.

## 4. Frontend — Inicio

Cambio de **fuente de datos, no de interfaz**. Ningún KPI cambia de
definición ni de aspecto.

- Los contadores pasan a salir de `/reservations/stats`.
- Las listas visibles pasan a salir de `view=hoy` y `view=solicitudes` con
  `size` acotado.
- El sondeo cada 60 segundos deja de arrastrar la base de datos entera.

## 5. Servicios del frontend

`reservationService.js`:

- `getReservations({ page, size, view, search, restaurantId, status, date,
  sort, direction })` devuelve el sobre paginado.
- `getReservationStats({ restaurantId })`.
- `getReservationsByDate({ date, restaurantId })` para el calendario.

Las funciones de crear, actualizar, eliminar y cambiar estado no cambian.

## 6. Pruebas

**Backend.** Las cinco vistas y sus criterios exactos; la composición de
vista con filtros; la búsqueda por nombre, email y número de mesa; el 400 del
orden inválido y del estado inválido; el recorte de `size` a 100; el alcance
por rol, incluido un `EMPLOYEE` sin asignaciones que no ve nada; y las seis
cifras de `/stats`. Más las pruebas unitarias de `ReservationView` y
`ReservationSortField`.

**Frontend.** Pruebas nuevas del listado: paginación, cambio de pestaña,
retardo del buscador, cifras que no cambian al filtrar. Y hay que
**actualizar el mock de `Reservations.wizard.test.jsx`**, que hoy devuelve un
array y pasaría a recibir un sobre paginado.

## 7. Lo que no se implementa

No se inventa nada que el modelo no tenga. En concreto, y por si se echa en
falta: no existe origen de la reserva (web, teléfono, mostrador), ni importe,
ni número de comensales realmente atendidos, ni valoración. Nada de eso se
añade.

Los desplegables de restaurante siguen pidiendo `getRestaurants({ size: 500 })`.
Es deuda transversal, ya anotada en los tres specs anteriores, y merece su
propia fase junto con el resto de consumidores.

## 8. Commits

1. El spec.
2. Backend: proyección, vistas, filtros, orden, alcance y `/stats`.
3. Frontend: pantalla de reservas.
4. Frontend: Inicio.
5. Pruebas.
