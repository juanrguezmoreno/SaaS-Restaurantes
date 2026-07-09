# Especificación: Simplificación del SaaS Restaurant Manager

**Fecha:** 2026-07-09
**Estado:** Aprobado (diseño validado en conversación, tras auditoría de los agentes back/front/test)

## Objetivo

Reducir complejidad real del producto eliminando/fusionando funcionalidad redundante o sin valor,
sin romper: login/JWT, roles, restaurantes, clientes, empleados, mesas, reservas, plano interactivo,
arquitectura multi-tenant.

## Contexto (hallazgos de la auditoría previa)

- No existe "analítica" como paquete backend separado: toda la lógica de KPIs vive en `dashboard/`,
  pero el frontend **no llama a ninguno de sus 3 endpoints** (calcula todo en cliente) y
  `reservations-by-day` ni siquiera está implementado (`return List.of()`).
- Notificaciones **no existen en backend**; en frontend son 100% cliente, no persisten, no son
  accionables (solo navegan a otra página al pulsarlas).
- El backend del plano ya es agnóstico de vista (un único endpoint de layout); no hay duplicación
  real backend en plano. La duplicación está en frontend: `FloorPlan.jsx` tiene 3 sub-vistas
  (`visual`/`compact`/`interactive`) en un único componente/ruta.
- `fix-table-statuses` (`POST /reservations/maintenance/fix-table-statuses`) es admin-only,
  idempotente, y **nunca se expuso en el frontend**. El hueco real es la ausencia de un
  `@Scheduled` que lo dispare solo.
- Bug encontrado durante la auditoría (fuera de la lista original, aprobado para incluir):
  `AvailabilityService.checkAvailability()` solo mira reservas `CONFIRMED`, mientras que la
  regla real de solape (RES-03, `ReservationService`) también bloquea por `PENDING`. Resultado:
  la disponibilidad pública puede mostrar como libre una mesa que el backend rechazará al reservar.

## Fuera de alcance (YAGNI)

- Persistencia de notificaciones en backend (se descarta explícitamente: se opta por fusionar
  las heurísticas útiles en "Requiere atención" en vez de construir un centro de notificaciones real).
- Redimensionado/rotación libre en el plano, tipos de elemento nuevos — no forma parte de esta tarea.
- Cualquier cambio en `Tables.jsx` (CRUD estructural) — no es redundante con el plano.

---

## 1. Backend

### 1.1 Eliminar paquete `dashboard/`

Eliminar por completo `controller/DashboardController.java`, `service/DashboardService.java` y sus
DTOs (`DashboardSummary`, `ReservationStats`, etc.). Sin consumidor conocido (confirmado por grep
en frontend), sin tests, con lógica incompleta.

### 1.2 Eliminar código muerto en `ReservationRepository`

Quitar los 6 métodos sin ningún caller (verificado por grep + tests):
`countByRestaurantAndDate`, `countByRestaurantIdAndStatusAndDeletedFalse`,
`findByCustomerIdAndRestaurantIdIn...OrderByReservationDateDescReservationTimeDesc`,
`findByRestaurantIdAndReservationDateAndDeletedFalse`,
`countByRestaurantIdAndReservationDateAndDeletedFalse`,
`findByDiningTableIdAndReservationDateAndDeletedFalse`.

### 1.3 `GET /api/v1/reservations/my`

Antes de tocarlo: grep en frontend para confirmar que nadie lo llama. Si está sin uso (como indica
la auditoría), eliminar el endpoint stub. Si apareciera un uso real, implementarlo correctamente
reutilizando `ReservationService.findByCustomerId` (ya existe, solo falta exponerlo) en vez de
dejarlo devolviendo lista vacía.

### 1.4 Fix de disponibilidad pública (bug)

`AvailabilityService.checkAvailability()` deja de usar
`ReservationRepository.findConfirmedByTableIdAndDateAndTime` y reutiliza la misma regla RES-03
(`findActiveConflicts`, que ya bloquea por `PENDING`+`CONFIRMED`) usada en
`ReservationService.isTableAvailableForReservation()`. Si esa lógica no está expuesta como método
reutilizable, extraerla a un único punto (p.ej. `ReservationRepository.findActiveConflicts` ya
existe — `AvailabilityService` debe llamarlo directamente en vez de duplicar la query).

**Cambio de comportamiento intencional:** la web pública mostrará menos mesas como disponibles que
antes (las que tengan una reserva `PENDING` ahora bloquean). Es la corrección de una divergencia de
reglas de negocio, no un efecto secundario no deseado.

### 1.5 `fix-table-statuses` automático

- Confirmado en código (`ReservationService.fixTableStatuses`, líneas 590-622): la rama
  `restaurantId == null` **no llama a `CurrentUserService`**, por lo que es segura de invocar sin
  contexto HTTP/JWT.
- Añadir un método `@Scheduled(fixedDelay = ...)` (cada 15 minutos, configurable vía
  `application.yml`) en un componente nuevo, p.ej. `reservation/scheduler/TableStatusScheduler.java`,
  que llama a `reservationService.fixTableStatuses(null)`.
- El endpoint `POST /reservations/maintenance/fix-table-statuses` se mantiene tal cual (admin-only,
  manual, red de seguridad para soporte). No se expone en frontend.

---

## 2. Frontend

### 2.1 Fusión Dashboard + Analítica → `Inicio.jsx`

- Nueva página `src/pages/Inicio.jsx` (sustituye a `Dashboard.jsx` como contenido; `Analytics.jsx`
  se elimina y su contenido se integra aquí).
- Secciones, en este orden:
  1. **KPIs operativos** (reservas hoy, pendientes, ocupación, próxima reserva) — de Dashboard.
  2. **Agenda de hoy** — de Dashboard.
  3. **Requiere atención** — de Dashboard, ampliada con las heurísticas útiles de
     `notificationService.js` (ver 2.2).
  4. **Tendencias y estadísticas** (selector de restaurante/periodo, gráficos por día/hora punta,
     rankings de mesas/clientes, insights) — de Analytics, como sección visualmente diferenciada
     (p.ej. tab o bloque con separador) dentro de la misma página.
- **Permisos**: la sección 4 se gatea con el permiso equivalente al actual `VIEW_ANALYTICS`
  (EMPLOYEE no la ve). El resto de la página usa el permiso actual de `VIEW_DASHBOARD` (todos los
  roles). Una sola ruta, contenido condicional por rol — no se pierde granularidad de permisos
  existente en `src/config/permissions.js`.
- **Rutas**: `/inicio` es la ruta canónica. `/dashboard` y `/analytics` quedan como `<Navigate>`
  redirect a `/inicio` (compatibilidad con enlaces existentes). `Sidebar.jsx` apunta solo a `/inicio`.
- Reutilizar el patrón "restaurantes → mesas por restaurante" vía el hook nuevo `useAllTables()`
  (ver 2.4) en vez de duplicarlo otra vez dentro de `Inicio.jsx`.

### 2.2 Notificaciones → integradas, sistema standalone eliminado

- Eliminar: `src/components/NotificationBell.jsx`, `src/components/NotificationPanel.jsx`,
  `src/pages/Notifications.jsx`, `src/context/NotificationContext.jsx`.
- Eliminar su uso en `src/components/Navbar.jsx` (línea 89, `<NotificationBell />`, y su import).
- Eliminar la ruta `/notifications` de `App.jsx` y cualquier referencia en `PermissionRoute.jsx`.
- Las heurísticas con valor operativo real de `notificationService.js` (próxima reserva <60min,
  mesas en mantenimiento, sin mesas disponibles, solicitudes pendientes) se reutilizan como
  función de cálculo para la sección "Requiere atención" de `Inicio.jsx`. Las heurísticas
  puramente decorativas (cliente frecuente, "hora punta prevista") se descartan salvo que encajen
  de forma natural en la sección de tendencias (2.1.4).
- Si `notificationService.js` queda reducido a solo lo reutilizado, puede quedarse donde está o
  moverse junto a `Inicio.jsx`; decisión de implementación, no de diseño.

### 2.3 Plano de mesas → solo vista interactiva

- En `src/pages/FloorPlan.jsx`: eliminar el estado `viewMode` y las ramas de render `visual` y
  `compact`. La vista `interactive` (canvas, `FloorPlanCanvas.jsx`) pasa a ser la única, sin
  selector de vista.
- Mantener el modal compartido de detalle de mesa (cambio de estado, ver capacidad/ubicación,
  navegación a reservas) que ya usan las tres vistas.
- No tocar `Tables.jsx` (CRUD estructural, permisos y propósito distintos).

### 2.4 Limpieza técnica

- Extraer `extractData`/`extractArray` (duplicado en `restaurantService.js`, `tableService.js`,
  `customerService.js`, `employeeService.js`, `reservationService.js`, `floorPlanService.js`,
  y reimplementado inline en `Dashboard.jsx`/`Analytics.jsx`/`NotificationContext.jsx`) a
  `src/lib/apiHelpers.js`. Actualizar los 9 call sites (los de contexto/páginas eliminados en 2.1/2.2
  ya no necesitan la copia inline).
- Extraer el patrón "cargar restaurantes → por cada uno `GET /restaurants/{id}/tables`" (triplicado
  en Dashboard/Analytics/NotificationContext, todos eliminados o fusionados en 2.1/2.2) a un hook
  compartido `src/hooks/useAllTables.js`, usado por `Inicio.jsx`.

---

## 3. Riesgos y mitigación

| Riesgo | Mitigación |
|---|---|
| EMPLOYEE pierde/gana acceso a contenido al fusionar Dashboard+Analítica | Gating por sección dentro de la misma página, no por ruta; probar con los 4 roles |
| Eliminar `NotificationContext` rompe algo no detectado (p.ej. otro componente que use `useNotifications`) | Grep final de `useNotifications`/`NotificationContext` antes de borrar; smoke test de `Navbar` tras el cambio |
| Fix de disponibilidad pública cambia qué mesas se ven como libres en la web pública | Es corrección de un bug real (evita 409 sorpresa al reservar); documentar en el commit como cambio de comportamiento intencional |
| Job `@Scheduled` corrigiendo mesas cada 15 min sin supervisión humana | Reutiliza lógica ya idempotente y ya probada manualmente; loggea cada corrección (`[MANTENIMIENTO]`) |
| `GET /reservations/my` podría tener un consumidor no detectado por la auditoría previa | Verificar con grep antes de eliminar; si aparece uso, implementar en vez de eliminar |
| Cero tests frontend hoy → cambios de UI sin red de seguridad automatizada | Smoke tests manuales dirigidos (ver plan de pruebas) tras cada bloque de cambios |

## 4. Plan de pruebas (agente test)

1. `mvn test` completo tras los cambios backend (debe seguir en verde, 29+ tests).
2. Login con cada rol (SUPER_ADMIN/ADMIN/MANAGER/EMPLOYEE).
3. Carga de `/inicio` con cada rol — verificar que la sección "Tendencias" está oculta a EMPLOYEE
   y visible al resto.
4. Creación de reserva, incluyendo caso de solape (debe seguir devolviendo 409).
5. Creación/edición de mesa.
6. Plano interactivo: mover mesa, guardar layout, ver estado/capacidad, gestionar ocupación.
7. Navegación completa: sidebar, breadcrumbs, sin rutas rotas (`/dashboard` y `/analytics` deben
   redirigir a `/inicio`; `/notifications` ya no debe existir).
8. Verificar manualmente que el job `@Scheduled` corrige una mesa `RESERVED` sin reserva activa
   (se puede forzar con datos demo y logs `[MANTENIMIENTO]`).
