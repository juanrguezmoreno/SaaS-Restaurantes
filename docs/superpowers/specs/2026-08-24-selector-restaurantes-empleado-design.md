# Selector de restaurantes con búsqueda en el formulario de empleado

Fecha: 2026-08-24
Estado: aprobado

## 1. Problema

### 1.1 Una rejilla con todos los restaurantes

El formulario de crear y editar empleado pinta **una casilla por restaurante**, dos
por fila, sin filtro ni recorte
(`Employees.jsx`, bloque `safeRestaurants.map`). La lista sale de
`getRestaurants()`, que pide `size=500`.

Con cinco restaurantes se lee bien. Con quinientos, el modal es una pared de
casillas que no se puede recorrer, y se descargan los quinientos cada vez que
se abre la pantalla.

### 1.2 La fila no permite saber qué restaurantes tiene asignados

El formulario de edición se abre con los datos de la fila del listado. La fila
trae `assignedRestaurantIds` y `restaurantNames`, pero **no se corresponden
posición a posición**:

- En `UserService.enrichWithRolesAndRestaurants` los nombres se ordenan
  alfabéticamente (`assignedNamesByUser.values().forEach(Collections::sort)`) y
  los identificadores no.
- Cuando el usuario no tiene asignaciones explícitas, `restaurantNames` cae al
  nombre del restaurante principal, que no está en la lista de identificadores.

Emparejarlas en el navegador daría etiquetas equivocadas: un empleado asignado a
«Sushi Master» podría aparecer etiquetado como «La Casa del Chef». Hoy no se
nota porque la rejilla de casillas solo usa los identificadores y saca cada
nombre del catálogo completo que ya tiene cargado.

### 1.3 La selección vacía significa cosas opuestas y no se dice

Según `CurrentUserService.getVisibleRestaurantIds()`:

| Rol | Sin restaurantes asignados |
|---|---|
| `ADMIN` | Ve todos los del tenant; la asignación no le afecta |
| `MANAGER` | Ve **todos** los del tenant |
| `EMPLOYEE` | **No ve ninguno** |

El formulario no lo indica en ninguna parte. Con una rejilla de casillas al
menos se ve que no hay nada marcado; con un selector con búsqueda, donde el
catálogo no está a la vista, el vacío es todavía menos evidente.

## 2. De dónde salen los datos

`GET /api/v1/admin/restaurants` ya pagina, busca por nombre y acota al tenant, y
está limitado a `SUPER_ADMIN` y `ADMIN`. El formulario de empleado solo lo
abren esos dos roles: `MANAGE_EMPLOYEES` no está en los permisos de `MANAGER`
(`config/permissions.js`), que solo tiene `VIEW_EMPLOYEES`.

Encaja sin tocar el endpoint. Se usa a través de
`getAdminRestaurants({ search, size })`, que ya existe en
`services/adminRestaurantService.js`.

## 3. Backend: un campo nuevo

`AdminUserListItem` gana `assignedRestaurants`, una lista de parejas
`{ id, name }` construida en `UserService.enrichWithRolesAndRestaurants` a
partir de la **misma fila** de `findAssignedRestaurantsByUserIds`, que ya
devuelve `[u.id, ar.id, ar.name]`.

Las parejas se ordenan por nombre **como parejas**, no como dos listas sueltas,
que es exactamente lo que hoy las desincroniza.

`assignedRestaurantIds` y `restaurantNames` se conservan sin cambios: la tabla
del listado usa `restaurantNames` y su comportamiento no se toca. Es un campo
añadido, no un cambio de forma.

## 4. Componente `RestaurantMultiSelect`

Nuevo, en `src/components/RestaurantMultiSelect.jsx`. Una sola
responsabilidad: elegir varios restaurantes.

```
value: Array<{ id, name }>
onChange: (nuevaLista) => void
disabled?: boolean
```

El nombre viaja dentro del valor a propósito: así las etiquetas se pintan
siempre, aunque el restaurante elegido no aparezca en la página de resultados
que se esté mostrando.

Comportamiento:

- Campo de búsqueda con **350 ms de retardo**, que consulta
  `getAdminRestaurants({ search, size: 10, sort: 'name', direction: 'asc' })`.
- Sin nada escrito, muestra los diez primeros por nombre, para que sea usable
  sin teclear.
- Si el servidor informa de más resultados de los mostrados, se indica
  **«… y N más, afina la búsqueda»**. No hay paginación dentro del desplegable:
  se afina escribiendo.
- Los ya elegidos aparecen marcados en la lista; pulsarlos los quita.
- Las etiquetas se quitan con su botón, con nombre accesible propio
  («Quitar La Casa del Chef»).
- **Teclado**: flechas arriba y abajo para recorrer, Enter para alternar, Esc
  para cerrar y devolver el foco al campo. Cierre al pulsar fuera.
- Estados: cargando, sin resultados, y error de red con botón de reintentar.

Va en React sin dependencias nuevas, con el mismo patrón que `ActionMenu`: el
proyecto solo carga el CSS de Bootstrap, no su JavaScript, así que
`data-bs-toggle` no funcionaría.

Los estilos se añaden a `src/index.css` reutilizando los tokens existentes,
como se hizo con `.action-menu` y `.table-pagination`.

## 5. Aviso de selección vacía

Debajo del selector, **solo cuando no hay ninguno elegido**, y según el rol
seleccionado en el propio formulario:

- `MANAGER` → «Sin restaurantes asignados verá todos los del tenant.»
- `EMPLOYEE` → «Sin restaurantes asignados no podrá ver ningún restaurante.»
- `ADMIN` → «Un administrador ve todos los restaurantes de su tenant; la
  asignación no le afecta.»

Describe la regla que ya aplica `CurrentUserService`. **No cambia ningún
comportamiento y no añade validación**: guardar un empleado sin restaurantes
sigue siendo posible, igual que hoy.

## 6. Cambios en `Employees.jsx`

- `formData.restaurantIds` (números) pasa a `formData.restaurants` (parejas).
- Al enviar se mapea a `restaurantIds`, así que **el contrato con el backend no
  cambia**.
- `handleOpenEdit` precarga desde `emp.assignedRestaurants`.
- `handleOpenCreate` arranca vacío.
- Desaparece la rama de casillas de `handleFormChange` y la rejilla completa.
- La carga de `getRestaurants()` para el formulario deja de hacer falta. Se
  conserva la del **filtro** de la cabecera, que es otra cosa y queda fuera de
  esta tarea.

## 7. Pruebas

**Componente.** Que busque con retardo y dispare una sola petición; que añada y
quite etiquetas; que **conserve las etiquetas de lo ya elegido aunque no
aparezca en los resultados**; el aviso de «y N más»; el recorrido con teclado;
y el estado de error con reintento.

**Página.** Que el formulario de edición precargue las asignaciones desde
`assignedRestaurants`, y que al enviar siga mandando `restaurantIds`. Que el
aviso del vacío cambie con el rol y desaparezca al elegir uno.

**Backend.** Que `assignedRestaurants` empareje bien, con un caso construido a
propósito donde el orden alfabético de los nombres **no** coincide con el orden
de los identificadores: es justo el fallo que hoy pasa desapercibido.

## 8. Lo que no se hace

- No se tocan los desplegables de selección única de Clientes, Reservas, Plano
  ni el filtro de Empleados, que siguen pidiendo `getRestaurants({ size: 500 })`.
  Es la misma deuda de fondo, pero son de selección única y merecen su propia
  pasada.
- No se añade validación nueva.
- No se inventa nada que el modelo no tenga: no hay grupos de restaurantes, ni
  etiquetas, ni zonas geográficas por los que agrupar o filtrar.

## 9. Commits

1. El spec.
2. Backend: `assignedRestaurants` emparejado, con su prueba.
3. Componente `RestaurantMultiSelect` con sus estilos y sus pruebas.
4. `Employees.jsx`: sustituir la rejilla y añadir el aviso, con sus pruebas.
