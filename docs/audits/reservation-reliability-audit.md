# Auditoría de fiabilidad del sistema de reservas

**Fecha:** 2026-07-15
**Ámbito:** flujo completo de reservas (backend `restaurante_manage/`, frontend `restaurante-frontend/`), datos demo, consistencia entre pantallas, validaciones, concurrencia, errores de API y persistencia.
**Método:** investigación de solo lectura con tres agentes en paralelo (backend, frontend, datos/tests) y verificación manual cruzada de los hallazgos críticos y de las contradicciones entre informes. No se ha modificado ningún archivo de código.

Clasificación de cada hallazgo: **gravedad** (CRÍTICO / ALTO / MEDIO / BAJO) y **estado** (✅ problema confirmado leyendo el código, ⚠️ posible riesgo, ✔️ código correcto, ❓ no verificable sin ejecutar).

---

## 1. Resumen ejecutivo

El núcleo del sistema de reservas es **más sólido de lo esperado**: no existe ninguna creación automática de reservas en producción, no hay datos mock en el frontend, el solape de mesa/fecha/hora está protegido en tres capas (servicio, índice único en MySQL, handler 409), el scoping multi-tenant se aplica en todas las operaciones sobre la reserva, y los datos persisten correctamente cuando la aplicación se despliega sin perfil contra MySQL real (Flyway + `ddl-auto: validate`).

Sin embargo, hay **2 problemas críticos confirmados**:

1. **`docker-compose.yml` arranca la API con perfil `dev`**: usa H2 en memoria, ignora por completo el MySQL que el propio compose levanta, siembra 7 reservas demo (2 con fecha de hoy) y usuarios `admin123` en cada arranque, y **pierde todas las reservas reales al reiniciar el contenedor**. Es la única explicación plausible de "aparecen reservas que nadie creó" y "los datos no persisten tras reiniciar": ocurre siempre que se ejecuta con perfil `dev` o con este compose.
2. **Una reserva puede apuntar a una mesa de otro restaurante/tenant**: ni `create` ni `update` comprueban que la mesa pertenezca al restaurante de la reserva, lo que rompe el aislamiento multi-tenant (un admin del tenant A puede ocupar huecos de mesas del tenant B).

Y **4 problemas de gravedad alta**: el `customerId` tampoco tiene scoping; `PUT /reservations/{id}` permite cambiar el `status` saltándose la máquina de estados (y el mapper silencia estados inválidos convirtiéndolos en `PENDING`); el endpoint público de reservas no tiene rate limiting ni protección contra duplicados; y en el frontend un fallo de red al cargar clientes se disfraza de "No hay clientes" y bloquea la creación de reservas.

La consistencia entre Inicio, Reservas y Plano de sala es razonable (misma fuente de verdad: la API; re-fetch al navegar y tras cada mutación), con divergencias menores de criterio en los KPI de "pendientes" y en el significado de "Eliminar" (que en realidad cancela).

---

## 2. Diagrama textual del flujo de reservas

### Estados y transiciones (implementación actual)

```
                    (formulario público / panel)
                              │
                              ▼
                          PENDING ──────────────┐
                              │                 │
              PATCH /status CONFIRMED           │ PATCH /status CANCELLED
              (única transición con guarda:     │ o DELETE /reservations/{id}
               solo desde PENDING; verifica     │ (sin guarda de origen;
               solape + capacidad; asigna       │  libera y desasigna mesa;
               mesa si falta; mesa→RESERVED;    │  email de cancelación)
               email de confirmación)           │
                              │                 ▼
                              ▼             CANCELLED
                         CONFIRMED
                          │       │
             * → COMPLETED│       │* → NO_SHOW
             (sin guarda; libera mesa en ambos casos)
```

⚠️ Las transiciones marcadas `*` no validan el estado de origen: son posibles `CANCELLED → COMPLETED`, `COMPLETED → NO_SHOW` y `CONFIRMED → PENDING` (esta última deja la mesa en `RESERVED` huérfana hasta que el scheduler de 15 min la corrija).

### Flujos y componentes

| Flujo | Frontend (componente → servicio) | Endpoint | Backend (controlador → servicio → repositorio) | Tablas |
|---|---|---|---|---|
| 1. Crear desde panel (modal) | `Reservations.jsx` (modal 1932-2177) → `reservationService.createReservation` | `POST /api/v1/reservations` | `ReservationController.create:97` → `ReservationService.create:190` → `findActiveConflicts`, `save` | `reservations`, `dining_tables` |
| 1b. Crear desde wizard 5 pasos | `Reservations.jsx:2180-2603` (envía `status: 'CONFIRMED'`, línea 667) + `api.post('/availability/tables')` (597) | ídem + `POST /api/v1/availability/tables` | ídem + `AvailabilityController` → `AvailabilityService.checkAvailability:38` | ídem |
| 2. Crear desde formulario público (QR) | `PublicReservation.jsx` → `publicReservationService` (`publicAxios`, sin JWT) | `POST /api/v1/public/restaurants/{id}/reservation-requests` | `PublicReservationController:37` → `PublicReservationService.createReservationRequest:55` (siempre `PENDING`, sin mesa; busca/crea `Customer` por email dentro del restaurante) | `reservations`, `customers` |
| 3. Recepción de solicitudes pendientes | `Reservations.jsx:1100-1235` (banner "Solicitudes Pendientes") | `GET /api/v1/reservations?size=9999` | `ReservationController.findAll:37` → `ReservationService.findAll:51` (scoping por `getVisibleRestaurantIds()`) | `reservations` |
| 4. Aceptar solicitud | Botón Aceptar (`Reservations.jsx:1167`) → `updateReservationStatus` | `PATCH /api/v1/reservations/{id}/status` (`CONFIRMED`) | `ReservationController.updateStatus:114` → `ReservationService.updateStatus:344` (guarda PENDING→CONFIRMED:363; auto-asigna mesa; re-verifica solape:401) | `reservations`, `dining_tables` |
| 5. Rechazar solicitud | Botón Rechazar (`Reservations.jsx:1186`) → `updateReservationStatus` | `PATCH .../status` (`CANCELLED`) | ídem, rama CANCELLED (libera mesa, email) | ídem |
| 6. Confirmar reserva | Dropdown de estado (`Reservations.jsx:413-436`) o drawer del plano | `PATCH .../status` | ídem | ídem |
| 7. Cancelar | Dropdown (`PATCH` `CANCELLED`) **o** botón "Cancelar reserva" del drawer (`TableDrawer.jsx:249-261` → `DELETE`) **o** modal "Eliminar" (`Reservations.jsx:807` → `DELETE`) | `PATCH .../status` o `DELETE /api/v1/reservations/{id}` | `DELETE` → `ReservationController.cancel:124` → **`ReservationService.cancel:457` — NO borra, pone `CANCELLED`** | ídem |
| 8. Editar | Modal editar (`Reservations.jsx`) o drawer → `updateReservation` | `PUT /api/v1/reservations/{id}` | `ReservationController.update:105` → `ReservationService.update:271` → `ReservationMapper.updateEntity:67` | ídem |
| 9. Eliminar (soft delete) | **No existe en la UI** (el botón "Eliminar" cancela, ver 7) | **No expuesto por HTTP** | `ReservationService.delete:487` existe pero ningún controlador lo llama | — |
| 10a. Consulta Inicio | `Inicio.jsx` (+ `useAllTables`) — KPIs 100% calculados en cliente | `GET /reservations?size=9999`, `GET /restaurants`, `GET /restaurants/{id}/tables` | `ReservationService.findAll` | `reservations`, `dining_tables` |
| 10b. Consulta Reservas | `Reservations.jsx` (tabs, banner, stats) | `GET /reservations?size=9999` | ídem | `reservations` |
| 10c. Calendario | Vista `calendar` **dentro** de `Reservations.jsx:1678-1822` (no es página aparte; comparte el array `reservations`) | — | — | — |
| 10d. Plano de sala | `FloorPlan.jsx` + `TableDrawer.jsx` → `getReservationsByRestaurantAndDate(id, hoy)` | `GET /api/v1/restaurants/{id}/reservations?date=` | `RestaurantReservationController:30` → `ReservationService.findByRestaurantIdAndDate:179` | `reservations` |

**Nota:** no existe paquete `dashboard` en el backend (pese a lo que indica CLAUDE.md); todos los KPI de Inicio se calculan en el navegador. Extras del flujo: `TableStatusScheduler` (cada 15 min corrige mesas `RESERVED` sin reserva activa), `DataInitializer` (misma corrección al arrancar, corre en **todos** los perfiles), `ReservationEmailListener` (emails AFTER_COMMIT + @Async, nunca rompen la transacción).

---

## 3. Causas raíz confirmadas

| # | Causa raíz | Explica |
|---|---|---|
| 1 | **Perfil `dev` en `docker-compose.yml` (línea 15)** → H2 en memoria + `create-drop` + `data.sql` (7 reservas demo, 2 con `CURRENT_DATE`) + `DemoDataInitializer` | Reservas "fantasma" que nadie creó, reservas pasadas con aspecto de datos corruptos, pérdida total de datos al reiniciar, credenciales demo `admin123` |
| 2 | **Referencias (`diningTableId`, `customerId`) cargadas solo por id, sin comprobar pertenencia** al restaurante/tenant de la reserva | Rotura del aislamiento multi-tenant en las referencias (el acceso a la *reserva* sí está protegido) |
| 3 | **`ReservationRequest.status` es un `String` libre compartido por POST y PUT**, y el mapper silencia valores inválidos | Salto de la máquina de estados vía `PUT`, estados inconsistentes entre reserva y mesa, creación directa en `COMPLETED`/`CANCELLED` |
| 4 | **El flujo público crea `PENDING` sin mesa, y el índice único V4 solo cubre reservas con mesa** | Duplicados ilimitados en el flujo público; sin rate limiting, spam posible |
| 5 | **Patrón `catch → lista vacía` en varios fetch del frontend** | Errores de red presentados como estados de negocio ("No hay clientes", plano sin reservas) |
| 6 | **Sin concepto de duración de reserva** (solape = igualdad exacta de `reservationTime`) | 20:00 y 20:15 conviven en la misma mesa; decisión de modelo de negocio nunca tomada explícitamente |

---

## 4. Problemas críticos

### C1. `docker-compose.yml` usa perfil `dev`: datos volátiles + reservas demo — ✅ confirmado (verificado manualmente)
- **Archivo:** `restaurante_manage/docker-compose.yml:15` (`SPRING_PROFILES_ACTIVE=dev`).
- **Comportamiento:** el perfil dev sobreescribe el datasource a `jdbc:h2:mem:restaurant_dev` (`application-dev.yml:3`) con `ddl-auto: create-drop`. La API dockerizada **nunca escribe en el MySQL del compose** (cuyo volumen `mysql-data` es persistente pero queda vacío). Cada arranque ejecuta `data.sql` (`spring.sql.init.mode=always`, `application-dev.yml:28-30`): 3 restaurantes demo, 14 mesas, 7 clientes y **7 reservas demo** (`data.sql:180-265`), de las cuales **2 usan `CURRENT_DATE`** (líneas 187 y 246: reservas `CONFIRMED` "de hoy" a las 19:00 y 15:00) y 5 tienen fechas hardcodeadas ya pasadas. `DemoDataInitializer` además borra y recrea 7 usuarios con contraseña `admin123` (`DemoDataInitializer.java:104-108`).
- **Impacto:** si este compose se usa como despliegue, reiniciar el contenedor = pérdida total de reservas reales + reaparición de reservas demo. Cumple exactamente los síntomas de "reservas creadas automáticamente" y "datos que no persisten".
- **Fallo encadenado:** aunque se quitara el perfil, falta `DB_URL` — el default `jdbc:mysql://localhost:3307` no resuelve al servicio `db:3306` desde dentro del contenedor. Se pasan `DB_USERNAME`/`DB_PASSWORD` que el perfil dev ni siquiera usa.
- **En cambio** ✔️: arrancando **sin perfil** contra MySQL real: `sql.init.mode=never`, `DemoDataInitializer` inactivo (`@Profile("dev")`), Flyway gestiona el esquema, `ddl-auto=validate`. Sin datos demo y con persistencia correcta. Es la única vía fiable hoy.

### C2. Mesa de otro restaurante/tenant asignable a una reserva — ✅ confirmado (verificado manualmente)
- **Archivos:** `ReservationService.java:217-219` (create) y `:284-286` (update).
- **Comportamiento:** la mesa se carga con `diningTableRepository.findByIdAndDeletedFalse(id)` y **en ningún punto se comprueba que `table.getRestaurant()` coincida con el restaurante de la reserva**. Un ADMIN/MANAGER del tenant A puede crear una reserva en su restaurante apuntando a una mesa del tenant B (conociendo o adivinando el id): ocupa el hueco de la mesa ajena (el solape se evalúa contra ella) y al confirmar la pone en `RESERVED`.
- **Impacto:** rotura del aislamiento multi-tenant, el invariante central del SaaS.

---

## 5. Problemas importantes (ALTO)

### A1. `customerId` sin scoping de restaurante/tenant — ✅ confirmado
`ReservationService.create:202-203` y `update:277-281` cargan el `Customer` solo por id. Se puede vincular un cliente de otro tenant a una reserva propia (y ese email recibe la confirmación). Mismo patrón que C2.

### A2. `PUT /reservations/{id}` salta la máquina de estados — ✅ confirmado
`ReservationRequest.status` es `String` libre. Con `"status":"CONFIRMED"` sobre una `PENDING`, el bloque de disponibilidad de `update()` (`ReservationService.java:289`) se evalúa con el estado *antiguo* y se omite; `ReservationMapper.updateEntity:67-73` escribe `CONFIRMED` directamente: **sin verificación de capacidad, sin marcar la mesa `RESERVED`, sin email**. Además `toEntity:45-53` convierte silenciosamente cualquier estado inválido en `PENDING` (sin 400), y el POST del panel permite crear directamente en `COMPLETED`/`NO_SHOW`/`CANCELLED`.

### A3. Flujo público sin rate limiting ni protección de duplicados — ✅ confirmado
- `PublicReservationService.createReservationRequest:55-101` valida restaurante, flag `publicBookingEnabled`, formato del DTO y fecha futura — pero no hay captcha, ni límite por IP, ni comprobación de solicitud duplicada (grep de RateLimit/bucket4j/captcha: 0 resultados).
- El índice único `uk_reservations_active_slot` (V4) usa una columna generada sobre la mesa asignada: las reservas `PENDING` **sin mesa** (todas las públicas) quedan fuera → duplicados ilimitados. El botón del formulario público sí se deshabilita en vuelo (`PublicReservation.jsx:557-570`), pero eso es solo frontend.
- **Impacto:** cualquiera puede inundar la BD de reservas PENDING y clientes basura para cualquier restaurante con `publicBookingEnabled=true` (valor por defecto).

### A4. Fallo de `GET /customers` se disfraza de "No hay clientes" y bloquea la creación — ✅ confirmado
`Reservations.jsx:160-170`: `catch { setCustomers([]) }` → `noCustomers=true` → banner "No hay clientes disponibles. Cree un cliente antes de registrar una reserva" y botón "Nueva Reserva" **deshabilitado** (912-933). Un fallo de red se presenta como estado de negocio y bloquea la funcionalidad principal.

### A5. Sin concepto de duración: "solape" = igualdad exacta de hora — ⚠️ posible riesgo (decisión de producto)
`ReservationRepository.findActiveConflicts` (`ReservationRepository.java:58-65`) compara `r.reservationTime = :time`. Dos reservas a las 20:00 y 20:15 en la misma mesa **no** conflictúan. Si el modelo de negocio asume franjas (lo habitual en restauración), esto produce dobles reservas efectivas. No es un bug de implementación sino una decisión nunca tomada; requiere decisión del propietario del producto antes de tocar código.

---

## 6. Problemas de gravedad media

| # | Hallazgo | Archivo(s) | Estado |
|---|---|---|---|
| M1 | Transiciones sin guarda de origen: `CANCELLED→COMPLETED`, `COMPLETED→NO_SHOW`, y `CONFIRMED→PENDING` (deja la mesa `RESERVED` huérfana hasta que el scheduler de 15 min la corrija) | `ReservationService.updateStatus:344-451` | ✅ confirmado |
| M2 | `AvailabilityRequest.time` es opcional (sin `@NotNull`): con `time=null` el JPQL no casa ninguna reserva → **todas las mesas aparecen disponibles ignorando todas las reservas** | `AvailabilityRequest.java:16`, `AvailabilityService.java:38-79` | ⚠️ posible riesgo |
| M3 | Fallback de disponibilidad del wizard: si `POST /availability/tables` falla o no se reconoce el formato, lista todas las mesas `AVAILABLE` con capacidad suficiente **ignorando reservas existentes**, y el wizard crea con `status:'CONFIRMED'`. Mitigado: el backend re-valida solape (409) y capacidad (400) al crear — no hay doble reserva silenciosa, pero el usuario elige mesas que luego fallan | `Reservations.jsx:596-617, 667` (verificado manualmente) | ✅ confirmado (impacto degradado a UX por la validación backend) |
| M4 | Capacidad de mesa no validada para reservas `PENDING` con mesa (solo se valida al pasar a `CONFIRMED`); hora ya pasada del día actual aceptada (`@FutureOrPresent` solo valida la fecha); horario de apertura/cierre no validado | `ReservationService.create:217-236`, `ReservationRequest.java:31` | ✅ confirmado (ausencia) |
| M5 | Una `CONFIRMED` deja de "proteger" su mesa en cuanto pasa la hora (`findActiveConfirmedByTableId` exige `reservationTime >= now`): el scheduler puede poner la mesa `AVAILABLE` con los comensales sentados | `ReservationService`/`ReservationRepository` | ⚠️ posible riesgo operativo |
| M6 | Handler 500 devuelve `"Error interno del servidor: " + ex.getMessage()` — puede filtrar detalles internos (SQL, clases) | `GlobalExceptionHandler.java:151` | ✅ confirmado |
| M7 | **"Eliminar" no elimina: cancela.** El modal "Eliminar reserva" (`Reservations.jsx:807`) y el botón "Cancelar reserva" del drawer (`TableDrawer.jsx:249-261`) llaman a `DELETE /reservations/{id}`, que ejecuta `ReservationService.cancel` (pone `CANCELLED`). Verificado manualmente: **no hay pérdida de datos** (el hallazgo inicial del agente frontend era incorrecto en su consecuencia), pero la etiqueta engaña al usuario: la reserva "eliminada" reaparece como Cancelada en historial y KPIs. `ReservationService.delete` (soft delete real) no está expuesto | `ReservationController.cancel:124-128`, `Reservations.jsx:457,807,2648`, `TableDrawer.jsx:253` | ✅ confirmado |
| M8 | Tres criterios distintos de "pendientes": KPI de Inicio = PENDING hoy/futuras (`reservationHelpers.js:112-118`); banner "Solicitudes Pendientes" = **todas** las PENDING incluidas pasadas (`Reservations.jsx:229-232`); tabla "Pendientes de Confirmar" = PENDING hoy/futuras (277-285). Con una PENDING pasada, tres cifras distintas | ver archivos citados | ✅ confirmado |
| M9 | Dropdown "Cambiar estado" en filas de tabla sin protección in-flight: clics rápidos envían varios `PATCH /status` (posibles emails duplicados) | `Reservations.jsx:413-436` | ✅ confirmado |
| M10 | Mensaje "Reserva rechazada. El cliente será notificado." incondicional (aunque el cliente no tenga email) | `Reservations.jsx:843-844` | ✅ confirmado |
| M11 | Bugs de zona horaria del frontend, **latentes en España** (UTC+1/+2), activos con clientes en husos UTC-negativos: (a) `min` del input de fecha del wizard usa `toISOString()` → fecha UTC (`Reservations.jsx:2330`); (b) `formatDate` usa `new Date('YYYY-MM-DD')` → medianoche UTC, puede mostrar el día anterior (`Reservations.jsx:302-311`); (c) navegación del calendario mezcla `new Date(str)` (UTC) con `getDate()/setDate()` (local): botón "día siguiente" atascado en UTC- (`Reservations.jsx:1684-1723`) | `Reservations.jsx` | ✅ confirmado (latente) |
| M12 | Más `catch → []` que ocultan errores: restaurantes (`Reservations.jsx:148-158`), mesas del modal editar (188-197), elementos y reservas del plano (`FloorPlan.jsx:120-127, 304-305` — el plano se muestra sin reservas de hoy y sin aviso), mesas por restaurante (`useAllTables.js:30-39` — KPI "Estado de sala" con subconjunto), y `extractData` con fallback final `return []` ante formato no reconocido (`apiHelpers.js:10-38`) | ver citas | ✅ confirmado |
| M13 | `DataInitializer` corre **en todos los perfiles** (sin `@Profile`) y muta mesas al arrancar (`RESERVED`→`AVAILABLE` si no hay CONFIRMED activa). Intencional y coherente con el scheduler, y la TZ está fijada a Europe/Madrid en la JVM (`RestaurantManageApplication.java:19`, verificado — el riesgo UTC señalado inicialmente está mitigado), pero es código que escribe en producción sin ningún test | `common/config/DataInitializer.java:37-68` | ⚠️ posible riesgo |
| M14 | Estado Libre/Reservada/Ocupada del plano es **manual** (`table.status`), no derivado de reservas; confirmar desde backend sí pone `RESERVED` y cancelar libera, pero un estado puesto a mano queda hasta que el scheduler (15 min) lo corrija, y el KPI "Estado de sala" de Inicio se calcula sobre esos estados manuales | `FloorPlan.jsx:195-229`, `Inicio.jsx:141-150` | ⚠️ posible riesgo (mitigado por scheduler) |
| M15 | Reservas demo de `data.sql` (solo perfil dev): 2 con `CURRENT_DATE` que "aparecen solas" cada arranque y 5 con fechas pasadas hardcodeadas con aspecto de datos corruptos | `data.sql:180-265` | ✅ confirmado (solo dev) |

---

## 7. Problemas menores (BAJO)

| # | Hallazgo | Archivo(s) | Estado |
|---|---|---|---|
| B1 | `data-dev.sql` es código muerto (Spring no lo carga: `sql.init.platform` no está definido) y el comentario de `V2__seed_roles.sql:4` dice que los datos demo viven ahí (es falso: viven en `data.sql`) | `data-dev.sql`, `V2__seed_roles.sql` | ✅ confirmado |
| B2 | Fuga de listener en Inicio: se registra una arrow anónima en `visibilitychange` pero el cleanup elimina otra función → listeners acumulados con StrictMode (solo GETs duplicados) | `Inicio.jsx:103-127` | ✅ confirmado |
| B3 | Dropdown de estado manipula el DOM a mano (`classList.toggle`, `document.querySelector`) — frágil | `Reservations.jsx:385-388, 427-431` | ✅ confirmado |
| B4 | El wizard escribe la nota por defecto `'Reserva creada desde flujo inteligente'` en datos reales | `Reservations.jsx:666` | ✅ confirmado |
| B5 | `POST /reservations` y `DELETE /reservations/{id}` sin `@PreAuthorize` explícito (mitigado por el scoping del servicio: cualquier autenticado con acceso al restaurante) | `ReservationController.java:97, 124` | ⚠️ posible riesgo |
| B6 | Sin tope superior de `partySize` en el panel (el público sí tiene `@Max(50)`) | `ReservationRequest.java:38` | ✅ confirmado (ausencia) |
| B7 | Cancelar dos veces devuelve 200 (sin guarda, pero email idempotente — inocuo) | `ReservationService.cancel:457-481` | ✔️ correcto funcionalmente |
| B8 | Dev/H2 sin el índice único V4 (Flyway deshabilitado en dev): la red de seguridad anti-carrera solo existe en prod MySQL — divergencia dev/prod | `application-dev.yml:25-26`, `V4__unique_active_reservation_slot.sql` | ⚠️ posible riesgo (solo dev) |
| B9 | `RestaurantManageApplicationTests` (`@SpringBootTest` + perfil dev) acoplado a toda la siembra demo: si `data.sql` se rompe, cae el test de contexto | `RestaurantManageApplicationTests.java` | ⚠️ posible riesgo |
| B10 | No se comprueba `response.success === false` en el frontend (se asume éxito si axios no lanza) — hoy inocuo porque el backend usa códigos HTTP | `apiHelpers.js` | ⚠️ posible riesgo |
| B11 | `checkAvailability` en `Reservations.jsx:597` usa `api.post` directo saltándose la convención de `src/services/` | `Reservations.jsx:597` | ✅ confirmado (estilo) |

---

## 8. Archivos afectados

**Backend:**
- `restaurante_manage/docker-compose.yml` — C1
- `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java` — C2, A1, A2, M1, M4
- `restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationMapper.java` — A2
- `restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationRequest.java` — A2, M4, B6
- `restaurante_manage/src/main/java/com/restaurante/publicapi/service/PublicReservationService.java` — A3
- `restaurante_manage/src/main/java/com/restaurante/availability/dto/AvailabilityRequest.java` — M2
- `restaurante_manage/src/main/java/com/restaurante/common/exception/GlobalExceptionHandler.java` — M6
- `restaurante_manage/src/main/resources/data.sql`, `data-dev.sql`, `db/migration/V2__seed_roles.sql` — M15, B1

**Frontend:**
- `restaurante-frontend/src/pages/Reservations.jsx` — A4, M3, M8–M11, B3, B4, B11
- `restaurante-frontend/src/pages/FloorPlan.jsx`, `src/components/TableDrawer.jsx` — M7, M12, M14
- `restaurante-frontend/src/pages/Inicio.jsx`, `src/hooks/useAllTables.js`, `src/services/apiHelpers.js`, `src/lib/reservationHelpers.js` — M8, M12, B2

---

## 9. Plan de corrección ordenado (con riesgos de cada cambio)

> Ningún cambio añade funcionalidad nueva ni toca el diseño visual. El plano de sala solo se toca en etiquetas/semántica de cancelación si se aprueba M7.

### Bloque 1 — Críticos (hacer primero)

1. **C1 — Arreglar `docker-compose.yml`**: eliminar `SPRING_PROFILES_ACTIVE=dev`, añadir `DB_URL=jdbc:mysql://db:3306/restaurant_db?...` (mismos parámetros que `application.yml`).
   *Riesgo:* bajo. Quien usara el compose como demo rápida perderá los datos demo (documentar `mvn spring-boot:run -Dspring-boot.run.profiles=dev` como alternativa). Primer arranque contra MySQL vacío: Flyway aplica V1–V5 — verificar.
2. **C2 — Validar pertenencia de la mesa** en `create` y `update`: si `table.restaurant.id != resolvedRestaurantId` → 400 ("La mesa no pertenece al restaurante indicado").
   *Riesgo:* bajo. Podría romper datos ya inconsistentes (reservas existentes con mesa ajena) — solo afecta a nuevas escrituras, no a lecturas.
3. **A1 — Validar pertenencia del cliente** en `create` y `update` (cliente debe pertenecer al mismo restaurante, coherente con cómo el flujo público busca clientes por email+restaurante).
   *Riesgo:* medio. Hay que confirmar el modelo real de `Customer` (¿por restaurante o por tenant?) antes de elegir la regla; una regla demasiado estricta rompería el flujo del panel si los clientes son por tenant.

### Bloque 2 — Altos

4. **A2 — Cerrar la máquina de estados**: (a) el mapper rechaza estados inválidos con 400 en vez de silenciarlos; (b) `PUT` no permite cambiar `status` (ignorarlo o 400 si difiere — el cambio de estado ya tiene su endpoint `PATCH` con las guardas); (c) restringir el `status` inicial del POST a `PENDING`/`CONFIRMED`.
   *Riesgo:* medio. El wizard envía `status:'CONFIRMED'` en el POST (mantener soportado) y el modal de edición del panel puede estar enviando `status` en el PUT — **revisar y ajustar el frontend a la vez** para no romper la edición.
5. **A3 — Flujo público**: comprobación de duplicado exacto (misma email+restaurante+fecha+hora con PENDING activa → 409) + rate limiting simple por IP (filtro en memoria; sin infraestructura nueva).
   *Riesgo:* bajo. Falsos positivos de rate limit tras NAT corporativo — umbral generoso.
6. **A4 + M12 — Frontend: dejar de disfrazar errores**: en los `catch → []` distinguir "lista vacía real" de "error de carga" (estado `loadError` + banner de reintento; no bloquear "Nueva Reserva" por un fallo de red).
   *Riesgo:* bajo. Solo manejo de errores; sin cambio visual estructural.
7. **A5 — Duración de reservas**: **requiere decisión de producto** (¿franja de 90/120 min? ¿configurable por restaurante?). No se implementa nada sin esa decisión; si se aprueba, afecta a `findActiveConflicts`, V4 y disponibilidad — es el cambio de mayor calado del plan.

### Bloque 3 — Medios

8. **M1** — Guardas de transición completas en `updateStatus` (matriz explícita de transiciones válidas; `CONFIRMED→PENDING` debe liberar la mesa si se permite).
   *Riesgo:* medio — puede rechazar flujos que hoy "funcionan" por accidente; definir la matriz con el propietario.
9. **M2** — `@NotNull` en `AvailabilityRequest.time`. *Riesgo:* bajo — verificar que ningún caller envíe `time` nulo (el wizard siempre lo envía).
10. **M3** — Eliminar el fallback de disponibilidad del wizard (si la API falla → error y reintento, nunca lista inventada) y mover la llamada a `availabilityService`. *Riesgo:* bajo.
11. **M4** — Validar capacidad también para PENDING con mesa, y fecha+hora pasada combinadas. *Riesgo:* bajo. (Horario de apertura: opcional, decisión de producto.)
12. **M6** — Mensaje genérico en el handler 500 (detalle solo al log). *Riesgo:* nulo.
13. **M7** — Renombrar "Eliminar" → "Cancelar" en el modal de Reservas (y unificar textos del drawer), o exponer el soft delete real si se quiere eliminar de verdad — decisión de producto; el renombrado es lo mínimo honesto. *Riesgo:* nulo (texto).
14. **M8** — Unificar el criterio de "pendientes" usando `reservationHelpers` en las tres vistas. *Riesgo:* bajo — decidir si las PENDING pasadas deben verse en el banner (probablemente sí, pero contadas aparte).
15. **M9/M10** — Estado in-flight en el dropdown de cambio de estado; mensaje de notificación condicionado a que el cliente tenga email. *Riesgo:* nulo.
16. **M11** — Corregir los tres puntos de TZ del frontend (usar `getLocalTodayString()` y parseo local consistente). *Riesgo:* nulo en España, corrige internacional.

### Bloque 4 — Bajos (limpieza)

17. **B1** — Borrar `data-dev.sql` y corregir el comentario de V2. **B2** — cleanup correcto del listener. **B4** — nota por defecto vacía. **B6** — `@Max` en panel. **M15** — regenerar fechas de `data.sql` dinámicamente o reducir reservas demo. *Riesgo:* nulo.

---

## 10. Pruebas necesarias

**Estado actual** ✔️: 61 tests backend, todos con H2 embebida o Mockito — **no pueden tocar la BD de desarrollo/producción** (verificado). Buena cobertura del solape (servicio + repositorio + handler 409). **Cero tests frontend** (no hay infraestructura).

**Huecos y propuesta priorizada:**

| Prioridad | Test | Verifica |
|---|---|---|
| CRÍTICO | `PublicReservationServiceTest` (nuevo) | El flujo QR (superficie pública sin JWT) no tiene ni un test: PENDING sin mesa, `publicBookingEnabled=false` → 400, restaurante inexistente → 404, cliente reutilizado solo dentro del mismo restaurante, duplicado → 409 (tras el fix A3) |
| CRÍTICO | Ampliar `ReservationServiceTest`: scoping de `findAll`/`findByCustomerId` | Las 3 ramas de `getVisibleRestaurantIds()` (`[-1]`→vacío, lista concreta, vacía→tenant); mutaciones sobre reserva no visible → `AccessDeniedException` |
| CRÍTICO | Tests de regresión de C2/A1 (tras el fix) | Mesa de otro restaurante → 400; cliente de otro restaurante → 400 |
| CRÍTICO | `ReservationControllerIntegrationTest` (MockMvc + H2) | POST solapado → HTTP 409 con `ApiResponse` extremo a extremo; POST válido → 201 |
| ALTO | Matriz de transiciones en `ReservationServiceTest` (tras el fix M1/A2) | Estado inválido → 400; `CANCELLED` no reconfirma; `COMPLETED`/`NO_SHOW` liberan mesa; `PUT` no cambia estado |
| ALTO | `DataInitializerTest` | Código que escribe en prod en cada arranque, hoy sin ningún test |
| ALTO | Ampliar `ReservationRepositoryTest` | `findByRestaurantIdInAndDeletedFalse` paginado excluye borradas y restaurantes fuera del set |
| MEDIO | `AvailabilityServiceTest` ampliado | `time` obligatorio (tras M2), mesas soft-deleted excluidas, filtro por capacidad |
| MEDIO | `PublicReservationControllerTest` (validación) | `@FutureOrPresent`, `@Max(50)`, email inválido → 400 |
| MEDIO | Testcontainers-MySQL solo para Flyway (opcional; único punto que H2 no puede validar) | V1–V5 aplican en BD vacía; el índice V4 rechaza el segundo INSERT activo en el mismo hueco |

---

## 11. Elementos que ya funcionan correctamente ✔️

1. **No hay creación automática de reservas en producción**: `data.sql` y `DemoDataInitializer` están confinados al perfil `dev`; `DemoDataInitializer` no crea reservas; Flyway solo siembra roles (dato de referencia); no hay `repository.save` fuera de los servicios de negocio e initializers documentados.
2. **No hay datos mock en el frontend**: grep de `mock|demo|fake|sample|dummy` en `src/` → 0 resultados; ningún fallback muestra reservas ficticias.
3. **StrictMode es inofensivo aquí**: no existe ningún POST/PUT/PATCH/DELETE dentro de `useEffect` en el flujo de reservas.
4. **Botones protegidos contra doble click** en todos los puntos principales (crear panel, wizard, público, aceptar/rechazar, eliminar, drawer) — única excepción: el dropdown de estado (M9).
5. **Anti-solape en tres capas** (prod): `assertNoOverlap` en servicio dentro de la transacción, índice único V4 con columna generada en MySQL (defensa real contra race conditions), y `DataIntegrityViolationException` traducida a 409 legible.
6. **Guarda `PENDING → CONFIRMED`**: no se puede confirmar una cancelada por el endpoint `PATCH`.
7. **Scoping multi-tenant de la reserva** aplicado en el 100% de los métodos (`validateRestaurantAccess` + `getVisibleRestaurantIds`); soft delete filtrado en todas las queries del repositorio.
8. **Persistencia en producción correcta**: sin perfil → MySQL + Flyway + `ddl-auto: validate`; `JWT_SECRET` obligatorio (la app no arranca sin él).
9. **Emails robustos**: AFTER_COMMIT + @Async + idempotentes; nunca rompen la transacción; snapshot de datos antes de desasignar la mesa.
10. **`GlobalExceptionHandler`** con códigos 400/401/403/404/409 correctos, formato `ApiResponse` uniforme y mensajes útiles en español (salvo el detalle del 500, M6).
11. **Sin confirmaciones visuales falsas**: todo mensaje de éxito se muestra tras la respuesta del servidor; re-fetch completo tras cada mutación (sin actualizaciones optimistas); Inicio comunica errores parciales y tiene polling de 60 s + refetch al focus.
12. **Fechas enviadas como strings planos** (`YYYY-MM-DD` / `HH:mm:ss`) sin conversión UTC; "hoy" calculado en local en casi todos los puntos; TZ de la JVM fijada explícitamente a Europe/Madrid; el criterio "Reservas hoy" coincide entre Inicio y Reservas.
13. **Tests aislados**: ninguna configuración de test apunta a MySQL; `@DataJpaTest` usa H2 embebida propia.
14. **Flujo público bien diseñado en lo esencial**: siempre `PENDING` sin mesa, clientes buscados/creados por email dentro del restaurante (no cruza tenants), no ecoa identidades almacenadas, límites de longitud en el DTO.
15. **Mecanismos de auto-reparación** de estados de mesa: al arrancar, scheduler cada 15 min, y endpoint manual protegido por rol.

---

## Anexo: contradicciones entre agentes resueltas por verificación manual

| Afirmación | Verificación | Resultado |
|---|---|---|
| "Cancelar en el plano hace DELETE y la reserva desaparece del historial" (agente frontend) | `ReservationController.java:124-128` | **Falso**: `DELETE` ejecuta `cancel()` → `CANCELLED`. El problema real es de etiquetado (M7), no de pérdida de datos |
| "La JVM del contenedor corre en UTC" (agente tests) | `RestaurantManageApplication.java:19` | **Falso**: `TimeZone.setDefault(Europe/Madrid)` antes de arrancar Spring |
| "El fallback del wizard puede producir doble reserva" (agente frontend) | `ReservationService.create:221-235` | **Parcial**: el backend re-valida solape (409) y capacidad al crear CONFIRMED → no hay doble reserva silenciosa en el mismo hueco exacto; queda como problema de UX (M3) y persiste el hueco de duración (A5) |
