# Configuración de horarios de servicio por restaurante

**Fecha:** 2026-07-31
**Estado:** aprobado por el usuario, pendiente de plan de implementación

## Objetivo

Sustituir la ventana horaria única de cada restaurante (`openingTime`/`closingTime`) por
periodos de servicio configurables por día de la semana, y exponer esa configuración en
una pantalla propia dentro de la sección de Restaurantes ya existente.

Los periodos guardados pasan a decidir qué franjas horarias se ofrecen, tanto en el
formulario público de reservas como en la creación privada desde el panel.

## Situación de partida

- `Restaurant` tiene `openingTime` y `closingTime` planos, más
  `defaultReservationDurationMinutes` (por defecto 90).
- `AvailabilityService.generarFranjas(restaurant, date)` genera la rejilla recorriendo
  esa única ventana en saltos de `app.reservations.slot-interval-minutes`, mientras la
  reserva completa quepa antes del cierre. Es la autoridad única de disponibilidad:
  `getTimeSlots` la usa, y de ella cuelgan el endpoint privado
  `GET /api/v1/availability/time-slots` y el público
  `GET /api/v1/public/restaurants/{id}/time-slots`.
- `RestaurantController` ya expone `PUT /api/v1/restaurants/{id}` con
  `@PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")` y
  `currentUserService.validateRestaurantAccess(id)` dentro del servicio.
- `Restaurants.jsx` (967 líneas) es una tabla con acciones por fila: copiar enlace
  público, editar (abre un modal con todos los campos, escritos inline en el JSX) y
  eliminar.
- `MANAGER` no tiene `VIEW_RESTAURANTS` en `config/permissions.js`, así que hoy solo
  `ADMIN` y `SUPER_ADMIN` llegan a esa pantalla.
- El proyecto monta `BrowserRouter` en `main.jsx`; no usa data router.
- `floorplan/` es el precedente de sub-recurso por restaurante: paquete propio,
  `GET`/`PUT` bajo `/restaurants/{id}/...`, y un `replaceElements` idempotente.

## Decisiones tomadas

| Decisión | Elegido | Motivo |
|---|---|---|
| Relación con la edición actual | La pantalla sustituye al modal de edición | Un único sitio para editar un restaurante existente; el modal queda solo para crear |
| Alcance de permisos | El mismo que hoy, sin ampliar | No toca el mapa de permisos ni el alcance de MANAGER |
| Periodos que cruzan medianoche | No permitidos | Coherente con el comportamiento actual, ya documentado como fuera de alcance |
| Modelo de datos | Entidad relacional propia | Integridad en BD, ids por periodo, encaja con el patrón de `floorplan/` |
| Forma de guardar | Reemplazo de la semana entera en un `PUT` | Encaja con un botón "Guardar" único y con el aviso de cambios sin guardar |
| Día cerrado | Día sin periodos | Evita un flag `closed` redundante que pueda contradecir a la lista |

## Modelo de datos

Entidad `ServicePeriod` en un paquete nuevo `serviceperiod/`, con la estructura habitual
del proyecto (`controller/`, `service/`, `repository/`, `entity/`, `dto/`).

Tabla `service_periods` (migración `V8__add_service_periods.sql`, siguiente versión
libre):

| Columna | Tipo | Notas |
|---|---|---|
| `id` | BIGINT AUTO_INCREMENT | PK |
| `restaurant_id` | BIGINT NOT NULL | FK a `restaurants(id)` |
| `day_of_week` | VARCHAR(20) NOT NULL | `@Enumerated(EnumType.STRING)` sobre `java.time.DayOfWeek` (`MONDAY`…`SUNDAY`), convención ya usada en `Reservation` y `FloorPlanElement` |
| `start_time` | TIME NOT NULL | |
| `end_time` | TIME NOT NULL | |
| `name` | VARCHAR(50) NULL | Opcional ("Comidas", "Cenas"). Ninguna lógica depende de su valor |
| `created_at`, `updated_at`, `deleted`, `deleted_at` | | Heredados de `BaseEntity` |

Índice por `(restaurant_id, day_of_week)`. El borrado es lógico, como en el resto del
proyecto: todas las consultas filtran `deleted = false`.

`openingTime` y `closingTime` **no se eliminan ni se modifican**: siguen siendo el
fallback y los sigue editando el apartado de Información.

## Semántica del fallback

Es la regla que evita la ambigüedad de "no tiene periodos" y debe implementarse
literalmente así:

- **Restaurante con cero periodos vivos en toda la semana** → se comporta exactamente
  como hoy: la rejilla se genera desde `openingTime`/`closingTime` (o, si son nulos, los
  valores por defecto de `application.yml`) para cualquier día. Su pantalla de
  configuración muestra un aviso indicando que usa el horario general.
- **Restaurante con al menos un periodo vivo en cualquier día** → la configuración por
  periodos está activa. Un día concreto sin periodos significa **cerrado**, y devuelve
  cero franjas. No hay fallback por día.

Sin esta regla, un restaurante configurado de lunes a viernes dejaría sábado y domingo
indefinidos: no se podría distinguir "cerrado el fin de semana" de "usa el horario
general el fin de semana".

Dos consecuencias que se derivan de la regla y que la interfaz debe reflejar:

- **Activar la configuración es un acto de toda la semana.** Mientras el restaurante esté
  en fallback, marcar un día como cerrado no produce ningún cambio observable: sigue sin
  tener periodos y, por tanto, sigue en fallback todos los días. Para cerrar un día
  concreto hay que haber definido antes los periodos de los demás. El aviso de la
  pantalla debe explicar que, al añadir el primer periodo, la configuración pasa a regir
  la semana completa y los días que queden vacíos se considerarán cerrados.
- **Vaciar la semana devuelve al fallback.** Si se eliminan todos los periodos de todos
  los días, el restaurante vuelve a comportarse con `openingTime`/`closingTime` y la
  pantalla vuelve a mostrar el aviso. Es reversible y no requiere ninguna acción
  adicional.

## API

Rutas nuevas, calcadas del patrón de `floorplan/`:

```
GET /api/v1/restaurants/{restaurantId}/service-periods
PUT /api/v1/restaurants/{restaurantId}/service-periods
```

Subpath declarado como constante en `Constants.java`
(`SERVICE_PERIODS_SUBPATH = "/service-periods"`), como exige la convención del proyecto.

**Autorización de ambos verbos:** `@PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")`
en el controlador y `currentUserService.validateRestaurantAccess(restaurantId)` como
primera línea del servicio. Es exactamente la misma pareja que protege el
`PUT /api/v1/restaurants/{id}` existente. Ocultar el botón en el frontend no cuenta como
protección: el backend rechaza por su cuenta.

El flujo público **no** consume estos endpoints. Sigue usando
`GET /api/v1/public/restaurants/{id}/time-slots`, que hereda la configuración a través de
`AvailabilityService`.

### `ServicePeriodRequest`

`id` (nullable), `dayOfWeek`, `startTime`, `endTime`, `name` (nullable).

### `ServicePeriodResponse`

`id`, `dayOfWeek`, `startTime`, `endTime`, `name`. No expone `restaurantId` ni campos de
auditoría: el restaurante ya está en la ruta.

### Semántica del `PUT`

Reemplaza la semana completa, de forma idempotente, igual que
`FloorPlanElementService.replaceElements`:

- Petición con `id` → actualiza el periodo existente.
- Petición sin `id` → crea uno nuevo.
- Periodo existente no incluido en el payload → borrado lógico.
- Un `id` que no pertenezca a ese restaurante → `BadRequestException` (400). Esta es la
  defensa concreta contra modificar periodos de otro restaurante manipulando el payload.

Devuelve la lista resultante ya ordenada.

## Validación

Toda en el backend, dentro del servicio, antes de persistir nada:

1. `dayOfWeek`, `startTime` y `endTime` obligatorios.
2. `endTime` estrictamente posterior a `startTime`. Cubre a la vez el caso de inicio
   igual a fin y el de fin anterior al inicio, y es lo que impide los periodos que
   cruzan medianoche.
3. Sin solapes entre periodos del mismo día. Dos periodos se solapan cuando
   `inicioA < finB && inicioB < finA`. Un duplicado exacto es un solape total, así que
   cae bajo esta misma regla y no necesita una comprobación aparte.
4. `name` opcional; se recorta y, si queda vacío, se guarda como `null`. Máximo 50
   caracteres.
5. Los ids del payload deben pertenecer al restaurante de la ruta.

Los periodos se persisten y se devuelven ordenados por `(dayOfWeek, startTime)`.

El mensaje de error de solape debe nombrar el día y las horas implicadas, para que el
frontend pueda mostrarlo tal cual: los errores 4xx del backend ya se muestran
directamente al usuario en este proyecto.

## Generación de franjas

Único punto de cambio en la disponibilidad: el método privado
`AvailabilityService.generarFranjas(Restaurant, LocalDate)`.

Comportamiento nuevo:

1. Cargar los periodos vivos del restaurante (una sola consulta para toda la semana; con
   ella se resuelve a la vez el filtrado por día y la detección de "cero periodos").
2. Si la lista está vacía → comportamiento actual íntegro (ventana
   `openingTime`–`closingTime`, con los valores por defecto de configuración si son
   nulos).
3. Si no está vacía → filtrar por `date.getDayOfWeek()`. Si ese día no tiene periodos,
   devolver lista vacía (día cerrado).
4. Para cada periodo del día, ordenados por hora de inicio, generar franjas desde su
   inicio en saltos de `slotIntervalMinutes` mientras
   `inicioFranja + defaultReservationDurationMinutes <= finPeriodo`. Una reserva debe
   caber entera dentro del **mismo** periodo: no se permite que empiece en uno y termine
   en otro, ni que ocupe el hueco entre dos.
5. Concatenar las franjas de todos los periodos del día en una única lista ordenada.
6. Se mantiene la regla actual de omitir las franjas ya pasadas cuando la fecha es hoy.

El bucle debe seguir trabajando en minutos desde medianoche (enteros), no sumando sobre
`LocalTime`, por el motivo ya documentado en ese método: `LocalTime.plusMinutes` da la
vuelta a medianoche sin avisar y la condición de parada podría no alcanzarse nunca.

`getTimeSlots` **no cambia de firma ni de contrato**. Como es el único generador de
rejillas y de él dependen tanto el endpoint privado como el público, ambos flujos heredan
la configuración sin tocar ningún otro endpoint. `AvailabilityService` sigue siendo la
autoridad única de disponibilidad.

`AvailabilityService` pasa a depender de `ServicePeriodRepository`. Su constructor ya es
explícito (no usa `@RequiredArgsConstructor`), así que se añade el parámetro ahí.

## Frontend

### Ruta

`/restaurants/:restaurantId/configuracion`, dentro del layout protegido, envuelta en
`PermissionRoute` con `PERMISSIONS.MANAGE_RESTAURANTS`.

El segmento de recurso va en inglés (`/restaurants`, como el resto de rutas del
proyecto) y el de acción en español, siguiendo el precedente de `/inicio`.

### Acción contextual

En cada fila de `Restaurants.jsx`, el botón del lápiz pasa a ser un botón de engranaje
titulado **"Configurar restaurante"** que navega a la ruta anterior. Deja de abrir el
modal.

El modal de `Restaurants.jsx` queda **solo para crear** un restaurante nuevo. Todo el
estado y los handlers que hoy existen únicamente para el modo edición se retiran.

### Pantalla `RestaurantSettings.jsx`

Cabecera con el nombre del restaurante que se está configurando y un botón claro para
volver a Restaurantes. Debajo, dos apartados reales y nada más:

**1. Información.** Renderiza `RestaurantInfoForm`, el componente extraído de los campos
que hoy están inline en el modal: nombre, capacidad, teléfono, dirección, email, hora de
apertura, hora de cierre, duración de reserva y descripción. Guarda con el
`PUT /api/v1/restaurants/{id}` existente. No se crea ningún endpoint nuevo ni se duplica
el formulario: el modal de crear y esta pantalla renderizan el mismo componente.

**2. Horarios de servicio.** Renderiza `ServiceSchedule`. Si el restaurante tiene cero
periodos, muestra el aviso de que está usando el horario general.

Cada apartado tiene su propio botón "Guardar", deshabilitado mientras no haya cambios
respecto a lo cargado, con estados visibles de guardando, éxito y error.

### Componente `ServiceSchedule.jsx`

Los siete días de la semana, empezando por lunes. Para cada día:

- Lista de sus periodos, cada uno con hora de inicio, hora de fin, nombre opcional y
  botón de eliminar.
- Botón "Añadir servicio".
- Botón para marcar el día como cerrado, que elimina todos sus periodos.
- Un día sin periodos se muestra como "Cerrado", salvo que el restaurante entero esté en
  fallback, en cuyo caso manda el aviso de horario general descrito arriba.
- Acción de copiar los horarios de ese día a otros días, con selección de destinos.

Responsive: en escritorio los periodos de un día se muestran en fila; en móvil se apilan.
Los controles mantienen un objetivo táctil cómodo, como ya hace `TimeSlotSelector`.

### Servicio `servicePeriodService.js`

`getServicePeriods(restaurantId)` y `saveServicePeriods(restaurantId, periods)`, sobre el
cliente autenticado `api`, siguiendo el estilo del resto de servicios (try/catch con
`handleError`).

### Aviso de cambios sin guardar

Cubre dos vías:

- `beforeunload` para cerrar la pestaña o recargar.
- Confirmación propia en el botón "Volver a Restaurantes".

**Límite conocido y aceptado:** navegar mediante el sidebar con cambios pendientes no
queda cubierto. `useBlocker` de react-router exige un data router y este proyecto monta
`BrowserRouter`; migrar a `createBrowserRouter` tocaría el arranque de toda la
aplicación, fuera del alcance de este trabajo.

## Pruebas

### Backend

- Validación: solape, duplicado exacto, inicio igual a fin, fin anterior al inicio, e id
  perteneciente a otro restaurante.
- Integración de acceso: un administrador puede leer y guardar los periodos de su
  restaurante; sin autenticar responde 401; un usuario de otro tenant recibe 403 tanto en
  `GET` como en `PUT`, incluso manipulando el `restaurantId` de la URL.
- Persistencia: los periodos guardados se recuperan correctamente y ordenados; vaciar la
  semana entera devuelve al restaurante al fallback.
- Generación de franjas, en `AvailabilityServiceTest`: día marcado como cerrado devuelve
  cero franjas; no aparecen horas en el hueco entre dos servicios del mismo día; una
  reserva que no cabe entera en el periodo no genera franja; un restaurante sin periodos
  sigue usando el fallback anterior.
- Coherencia público/privado: ambos endpoints de franjas devuelven la misma rejilla para
  el mismo restaurante, fecha y comensales, con periodos configurados.

### Frontend

- `ServiceSchedule`: añadir un periodo, eliminarlo, marcar un día como cerrado y copiar
  los horarios de un día a otros.

## Fuera de alcance

- Periodos que cruzan medianoche.
- Excepciones por fecha concreta (festivos, cierres puntuales, horarios de temporada).
- Duración de reserva distinta por periodo: se sigue usando
  `defaultReservationDurationMinutes` del restaurante.
- Eliminar `openingTime`/`closingTime` del modelo. Se conservan como fallback y se
  seguirán editando desde el apartado de Información.
- Bloquear la navegación por el sidebar con cambios sin guardar.
- Añadir una sección de Ajustes al sidebar: explícitamente descartado.

## Restricciones del encargo

- No hacer commit, no hacer push, no crear Pull Request.
- No añadir secciones vacías ni funcionalidades futuras simuladas: solo los dos apartados
  descritos.
- Mantener el aislamiento entre restaurantes en todo momento.
- Todo el código, los comentarios y los textos de interfaz en español.
