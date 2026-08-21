# Panel escalable de reservas — plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** que la pantalla de reservas pagine, busque, filtre y ordene en el servidor, y que Inicio deje de descargar la tabla entera cada minuto.

**Architecture:** una proyección JPQL sustituye al mapper que provocaba `3 × N` consultas; cinco vistas cerradas (`solicitudes`, `hoy`, `proximas`, `historial`, `todas`) traducen a SQL los criterios que hoy aplica el navegador; una consulta agregada alimenta tarjetas y contadores. El frontend pasa de una llamada `size=9999` a una consulta por vista, más una consulta por día para el calendario.

**Tech Stack:** Spring Boot 3.3 / Java 21 / Maven / H2 en tests · React 19 / Vite / Vitest / Testing Library.

Spec: [`docs/superpowers/specs/2026-08-21-panel-reservas-escalable-design.md`](../specs/2026-08-21-panel-reservas-escalable-design.md)

## Global Constraints

- Código, comentarios, mensajes de commit y texto visible **en español**.
- Commits con Conventional Commits: `feat(reservation): ...`, `test(reservation): ...`.
- **Prohibido**: `git push`, push forzado, crear pull request, merge remoto, publicar en GitHub, desplegar en Vercel o Railway, tocar ramas remotas. Permitido: `status`, `diff`, `log`, `add`, `commit`.
- **Prohibido** arrancar el backend con `-Dspring-boot.run.profiles=dev`: borra los datos reales del usuario.
- No inventar entidades ni campos. En reservas **no existen** origen de la reserva, importe, comensales atendidos ni valoración.
- No desactivar comprobaciones para ocultar errores. No tocar variables de entorno ni exponer secretos.
- No borrar cambios locales ajenos a la tarea.
- Rutas y roles se referencian desde `common/util/Constants.java`, no en línea.
- Todas las consultas filtran `deleted = false`.
- El alcance multi-tenant se resuelve **siempre** por `CurrentUserService.getVisibleRestaurantIds()`.
- Tope de página `MAX_PAGE_SIZE = 100`, por defecto 25, como en las otras tres pantallas.
- La verificación final exige: `mvn -o test` verde, `pnpm lint` limpio, `pnpm test` verde y `pnpm build` correcto.

## Estructura de ficheros

| Fichero | Responsabilidad |
|---|---|
| `reservation/dto/ReservationView.java` (nuevo) | Lista cerrada de vistas y sus criterios |
| `reservation/dto/ReservationSortField.java` (nuevo) | Lista cerrada de campos de orden |
| `reservation/dto/ReservationListItem.java` (nuevo) | Proyección plana, compatible en JSON con `ReservationResponse` |
| `reservation/dto/ReservationStats.java` (nuevo) | Las seis cifras |
| `reservation/repository/ReservationRepository.java` | + `searchForList`, + `statsForList` |
| `reservation/service/ReservationService.java` | + `findAllForList`, + `stats`; sustituye las cuatro ramas de `findAll` |
| `reservation/controller/ReservationController.java` | Nuevos parámetros, `/stats`, orden validado, tope de tamaño |
| `services/reservationService.js` | `getReservations` paginado, `getReservationStats`, `getReservationsByDate` |
| `pages/Reservations.jsx` | Cinco pestañas, una tabla paginada, calendario con consulta propia |
| `pages/Inicio.jsx` | Cambia la fuente de datos, no la interfaz |

---

### Task 1: Listas cerradas de vista y orden

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationView.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationSortField.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/reservation/dto/ReservationViewTest.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/reservation/dto/ReservationSortFieldTest.java`

**Interfaces:**
- Produces: `ReservationView.from(String) -> ReservationView` (nunca nulo; en blanco → `TODAS`), `ReservationView.getValue() -> String`, `ReservationView.allowedValues() -> String`.
- Produces: `ReservationSortField.from(String) -> ReservationSortField` (en blanco → `DATE`), `getProperties() -> List<String>`, `getField() -> String`, `allowedValues() -> String`.
- Consumes: `com.restaurante.common.exception.BadRequestException` (ya existe, se traduce a 400 en `GlobalExceptionHandler`).

- [ ] **Step 1: Escribir los tests que fallan**

`ReservationViewTest.java`:

```java
package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Lista cerrada de vistas del panel de reservas. */
class ReservationViewTest {

    @Test
    void aceptaElNombrePublico() {
        assertThat(ReservationView.from("solicitudes")).isEqualTo(ReservationView.SOLICITUDES);
        assertThat(ReservationView.from("hoy")).isEqualTo(ReservationView.HOY);
        assertThat(ReservationView.from("proximas")).isEqualTo(ReservationView.PROXIMAS);
        assertThat(ReservationView.from("historial")).isEqualTo(ReservationView.HISTORIAL);
        assertThat(ReservationView.from("todas")).isEqualTo(ReservationView.TODAS);
    }

    @Test
    void aceptaElNombreDelEnumYlasTildes() {
        assertThat(ReservationView.from("PROXIMAS")).isEqualTo(ReservationView.PROXIMAS);
        // La pestaña se llama «Próximas»: si alguien manda la tilde, no es un error.
        assertThat(ReservationView.from("próximas")).isEqualTo(ReservationView.PROXIMAS);
    }

    @Test
    void sinValorMuestraTodas() {
        assertThat(ReservationView.from(null)).isEqualTo(ReservationView.TODAS);
        assertThat(ReservationView.from("   ")).isEqualTo(ReservationView.TODAS);
    }

    @Test
    void rechazaVistasInventadas() {
        assertThatThrownBy(() -> ReservationView.from("canceladas"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("no válida");
    }

    @Test
    void elMensajeDeErrorEnumeraLasVistasAdmitidas() {
        assertThat(ReservationView.allowedValues())
                .contains("solicitudes", "hoy", "proximas", "historial", "todas");
    }
}
```

`ReservationSortFieldTest.java`:

```java
package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** Lista cerrada de campos de ordenación del listado de reservas. */
class ReservationSortFieldTest {

    @Test
    void aceptaLosCamposPermitidos() {
        assertThat(ReservationSortField.from("id")).isEqualTo(ReservationSortField.ID);
        assertThat(ReservationSortField.from("partySize")).isEqualTo(ReservationSortField.PARTY_SIZE);
        assertThat(ReservationSortField.from("status")).isEqualTo(ReservationSortField.STATUS);
        assertThat(ReservationSortField.from("createdAt")).isEqualTo(ReservationSortField.CREATED_AT);
    }

    @Test
    void laFechaOrdenaPorDiaYluegoPorHora() {
        assertThat(ReservationSortField.from("date").getProperties())
                .containsExactly("reservationDate", "reservationTime");
    }

    @Test
    void sinValorOrdenaPorFecha() {
        assertThat(ReservationSortField.from(null)).isEqualTo(ReservationSortField.DATE);
        assertThat(ReservationSortField.from("  ")).isEqualTo(ReservationSortField.DATE);
    }

    @Test
    void rechazaCamposInternosYFragmentosDeConsulta() {
        assertThatThrownBy(() -> ReservationSortField.from("notes"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("no permitido");

        assertThatThrownBy(() -> ReservationSortField.from("id; DROP TABLE reservations"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void elMensajeDeErrorEnumeraLosCamposAdmitidos() {
        assertThat(ReservationSortField.allowedValues())
                .contains("id", "date", "partySize", "status", "createdAt");
    }
}
```

- [ ] **Step 2: Comprobar que fallan**

Run: `cd restaurante_manage && mvn -o test -Dtest=ReservationViewTest,ReservationSortFieldTest`
Expected: FAIL en compilación — `ReservationView` y `ReservationSortField` no existen.

- [ ] **Step 3: Implementar los dos enums**

`ReservationView.java` — solo la lista cerrada y su resolución. Los criterios de fecha y estado los traduce el servicio (Task 3), porque dependen de `LocalDate.now()`.

```java
package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;

import java.text.Normalizer;
import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * Vistas del panel de reservas. Cada una es una consulta al servidor con unos
 * criterios fijos, los mismos que antes aplicaba el navegador en
 * {@code lib/reservationHelpers.js}.
 */
public enum ReservationView {

    /** PENDING con fecha de hoy en adelante: lo que está por gestionar. */
    SOLICITUDES("solicitudes"),

    /** CONFIRMED de hoy. */
    HOY("hoy"),

    /** CONFIRMED a partir de mañana. */
    PROXIMAS("proximas"),

    /** Estados finales, o pasadas que no sigan pendientes. */
    HISTORIAL("historial"),

    /** Sin criterio: la vista donde mandan los filtros del usuario. */
    TODAS("todas");

    private final String value;

    ReservationView(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * Resuelve el parámetro recibido, aceptando el nombre público
     * ({@code proximas}), el del enum ({@code PROXIMAS}) y la forma con tilde
     * que se lee en la pestaña ({@code próximas}).
     *
     * @return la vista pedida; {@link #TODAS} si no se pide ninguna.
     * @throws BadRequestException si el valor no corresponde a ninguna vista.
     */
    public static ReservationView from(String value) {
        if (value == null || value.isBlank()) {
            return TODAS;
        }
        String normalized = stripAccents(value.trim());
        for (ReservationView candidate : values()) {
            if (candidate.value.equalsIgnoreCase(normalized) || candidate.name().equalsIgnoreCase(normalized)) {
                return candidate;
            }
        }
        throw new BadRequestException("Vista de reservas no válida: '" + value
                + "'. Valores admitidos: " + allowedValues());
    }

    /** Lista legible de vistas, para el mensaje de error. */
    public static String allowedValues() {
        return Arrays.stream(values())
                .map(ReservationView::getValue)
                .collect(Collectors.joining(", "));
    }

    private static String stripAccents(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
    }
}
```

`ReservationSortField.java` — copia la forma de `CustomerSortField`:

```java
package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Lista cerrada de campos por los que se puede ordenar el listado de reservas.
 *
 * <p>Antes el controlador partía la cadena {@code sort} y pasaba el nombre
 * resultante directo a {@code Sort}: {@code ?sort=pepe} no daba 400, reventaba
 * con 500 desde Hibernate.</p>
 */
public enum ReservationSortField {

    ID("id", List.of("id")),
    /** Orden natural del panel: primero el día, luego la hora. */
    DATE("date", List.of("reservationDate", "reservationTime")),
    /** Nombre del cliente; se resuelve por la asociación, que es a-uno. */
    CUSTOMER("customer", List.of("customer.firstName", "customer.lastName")),
    PARTY_SIZE("partySize", List.of("partySize")),
    STATUS("status", List.of("status")),
    CREATED_AT("createdAt", List.of("createdAt"));

    private final String field;
    private final List<String> properties;

    ReservationSortField(String field, List<String> properties) {
        this.field = field;
        this.properties = properties;
    }

    public String getField() {
        return field;
    }

    public List<String> getProperties() {
        return properties;
    }

    /**
     * Resuelve el parámetro recibido, aceptando el nombre público
     * ({@code createdAt}) y el del enum ({@code CREATED_AT}).
     *
     * @throws BadRequestException si el campo no está en la lista permitida.
     */
    public static ReservationSortField from(String value) {
        if (value == null || value.isBlank()) {
            return DATE;
        }
        String normalized = value.trim();
        for (ReservationSortField candidate : values()) {
            if (candidate.field.equalsIgnoreCase(normalized) || candidate.name().equalsIgnoreCase(normalized)) {
                return candidate;
            }
        }
        throw new BadRequestException("Campo de ordenación no permitido: '" + value
                + "'. Valores admitidos: " + allowedValues());
    }

    /** Lista legible de campos permitidos, para el mensaje de error. */
    public static String allowedValues() {
        return Arrays.stream(values())
                .map(ReservationSortField::getField)
                .collect(Collectors.joining(", "));
    }
}
```

- [ ] **Step 4: Comprobar que pasan**

Run: `cd restaurante_manage && mvn -o test -Dtest=ReservationViewTest,ReservationSortFieldTest`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationView.java \
        restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationSortField.java \
        restaurante_manage/src/test/java/com/restaurante/reservation/dto/
git commit -m "feat(reservation): cerrar las listas de vista y de campos de orden"
```

---

### Task 2: Proyección y consultas

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationListItem.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationStats.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java`

**Interfaces:**
- Consumes: nada de la Task 1.
- Produces:
  - `ReservationListItem` con constructor de 17 argumentos en el orden exacto de la consulta, y getters derivados `getCustomerName()` y `getHoldStatus()`.
  - `ReservationStats` (Lombok `@Data @Builder`) con `total, pendientes, hoyConfirmadas, proximasConfirmadas, canceladasFuturas, historial`, todos `long`.
  - `ReservationRepository.searchForList(boolean unrestricted, Set<Long> restaurantIds, Long restaurantId, String search, boolean filterStatuses, Set<ReservationStatus> statuses, LocalDate dateFrom, LocalDate dateTo, boolean historyMode, LocalDate today, Pageable pageable) -> Page<ReservationListItem>`
  - `ReservationRepository.statsForList(boolean unrestricted, Set<Long> restaurantIds, Long restaurantId, LocalDate today) -> List<Object[]>` con la fila `[total, pendientes, hoyConfirmadas, proximasConfirmadas, canceladasFuturas, historial]`.

- [ ] **Step 1: Crear `ReservationListItem`**

Los nombres JSON tienen que coincidir con los de `ReservationResponse`, porque el modal de detalle, el formulario de editar y el asistente leen las filas tal cual.

```java
package com.restaurante.reservation.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

/**
 * Proyección de reserva para el listado.
 *
 * <p>Se construye con una <em>constructor expression</em> de JPQL que trae
 * cliente, restaurante y mesa por {@code JOIN}. Antes el listado pasaba por
 * {@code ReservationMapper.toResponse}, que lee tres asociaciones {@code LAZY}
 * por fila: con {@code size=9999}, decenas de miles de consultas.</p>
 *
 * <p>Los nombres de los campos JSON son los mismos que los de
 * {@link ReservationResponse} a propósito: el modal de detalle y el formulario
 * de edición se abren con los datos de la fila, y así no cambian.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReservationListItem {

    private Long id;

    private Long customerId;

    @JsonIgnore
    private String customerFirstName;

    @JsonIgnore
    private String customerLastName;

    private String customerEmail;

    private Long diningTableId;
    private String tableNumber;

    private Long restaurantId;
    private String restaurantName;

    private LocalDate reservationDate;
    private LocalTime reservationTime;
    private Integer partySize;
    private String status;

    /** Lo necesita el formulario de edición, que se abre con los datos de la fila. */
    private String notes;

    private LocalDateTime holdExpiresAt;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /** Constructor que usa la consulta de listado; el orden importa. */
    public ReservationListItem(Long id,
                               Long customerId,
                               String customerFirstName,
                               String customerLastName,
                               String customerEmail,
                               Long diningTableId,
                               String tableNumber,
                               Long restaurantId,
                               String restaurantName,
                               LocalDate reservationDate,
                               LocalTime reservationTime,
                               Integer partySize,
                               com.restaurante.reservation.enums.ReservationStatus status,
                               String notes,
                               LocalDateTime holdExpiresAt,
                               LocalDateTime createdAt,
                               LocalDateTime updatedAt) {
        this.id = id;
        this.customerId = customerId;
        this.customerFirstName = customerFirstName;
        this.customerLastName = customerLastName;
        this.customerEmail = customerEmail;
        this.diningTableId = diningTableId;
        this.tableNumber = tableNumber;
        this.restaurantId = restaurantId;
        this.restaurantName = restaurantName;
        this.reservationDate = reservationDate;
        this.reservationTime = reservationTime;
        this.partySize = partySize;
        this.status = status != null ? status.name() : null;
        this.notes = notes;
        this.holdExpiresAt = holdExpiresAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    /** Nombre completo del cliente, como lo pinta la tabla. */
    public String getCustomerName() {
        String first = customerFirstName != null ? customerFirstName.trim() : "";
        String last = customerLastName != null ? customerLastName.trim() : "";
        return (first + " " + last).trim();
    }

    /**
     * Estado del bloqueo provisional, con la misma regla que
     * {@code ReservationMapper}: NONE si no hay, ACTIVE si sigue vivo,
     * EXPIRED si ya venció.
     */
    public String getHoldStatus() {
        if (holdExpiresAt == null) {
            return "NONE";
        }
        return holdExpiresAt.isAfter(LocalDateTime.now()) ? "ACTIVE" : "EXPIRED";
    }
}
```

- [ ] **Step 2: Crear `ReservationStats`**

```java
package com.restaurante.reservation.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Cifras del panel de reservas, calculadas con una sola consulta agregada en el
 * alcance del usuario. Alimentan las cuatro tarjetas y los contadores de las
 * cinco pestañas.
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReservationStats {

    /** Todas las reservas visibles, sin filtro de vista. */
    private long total;

    /** PENDING con fecha de hoy en adelante. */
    private long pendientes;

    /** CONFIRMED de hoy. */
    private long hoyConfirmadas;

    /** CONFIRMED a partir de mañana. */
    private long proximasConfirmadas;

    /** CANCELLED con fecha de hoy en adelante; es la cuarta tarjeta actual. */
    private long canceladasFuturas;

    /** Lo que cae en la vista de historial. */
    private long historial;
}
```

- [ ] **Step 3: Añadir las dos consultas al repositorio**

Se añaden a `ReservationRepository`, sin tocar los métodos existentes. Importar `com.restaurante.reservation.dto.ReservationListItem`.

Los estados se comparan con la ruta completa del enum, como ya hace `findStatsByCustomerIds`.

```java
    // ─── Listado del panel ──────────────────────────────────────────────────
    // El listado anterior pasaba por ReservationMapper.toResponse, que lee
    // customer, diningTable y restaurant sobre asociaciones LAZY: tres consultas
    // por fila. Estas dos lo resuelven en la base de datos.

    /**
     * Página del listado con los criterios de vista y los filtros del usuario,
     * siempre acotada al alcance multi-tenant.
     *
     * <p>El alcance no es negociable desde fuera: aunque se pida un
     * {@code restaurantId} concreto, la condición de alcance se sigue aplicando,
     * de modo que pedir un restaurante ajeno devuelve vacío.</p>
     *
     * @param unrestricted  {@code true} solo para SUPER_ADMIN. Con {@code false}
     *                      manda {@code restaurantIds}.
     * @param restaurantIds restaurantes visibles. Nunca nulo ni vacío; se ignora
     *                      cuando {@code unrestricted}.
     * @param restaurantId  filtro opcional por un restaurante concreto.
     * @param search        texto ya normalizado con comodines, o nulo.
     * @param filterStatuses aplicar {@code statuses}; con {@code false} se ignora.
     * @param statuses      estados admitidos. Nunca nulo ni vacío.
     * @param dateFrom      fecha mínima inclusive, o nulo.
     * @param dateTo        fecha máxima inclusive, o nulo.
     * @param historyMode   aplicar el criterio de historial.
     * @param today         fecha de hoy, calculada en el servicio para que H2 y
     *                      MySQL se comporten igual.
     */
    @Query(value = """
            SELECT new com.restaurante.reservation.dto.ReservationListItem(
                       r.id, c.id, c.firstName, c.lastName, c.email,
                       t.id, t.tableNumber, rest.id, rest.name,
                       r.reservationDate, r.reservationTime, r.partySize, r.status,
                       r.notes, r.holdExpiresAt, r.createdAt, r.updatedAt)
            FROM Reservation r
            JOIN r.customer c
            JOIN r.restaurant rest
            LEFT JOIN r.diningTable t
            WHERE r.deleted = false
              AND (:unrestricted = TRUE OR rest.id IN :restaurantIds)
              AND (:restaurantId IS NULL OR rest.id = :restaurantId)
              AND (:search IS NULL
                   OR LOWER(CONCAT(c.firstName, ' ', c.lastName)) LIKE :search ESCAPE '!'
                   OR LOWER(c.email) LIKE :search ESCAPE '!'
                   OR LOWER(t.tableNumber) LIKE :search ESCAPE '!')
              AND (:filterStatuses = FALSE OR r.status IN :statuses)
              AND (:dateFrom IS NULL OR r.reservationDate >= :dateFrom)
              AND (:dateTo IS NULL OR r.reservationDate <= :dateTo)
              AND (:historyMode = FALSE
                   OR r.status IN (com.restaurante.reservation.enums.ReservationStatus.CANCELLED,
                                   com.restaurante.reservation.enums.ReservationStatus.COMPLETED,
                                   com.restaurante.reservation.enums.ReservationStatus.NO_SHOW)
                   OR (r.reservationDate < :today
                       AND r.status <> com.restaurante.reservation.enums.ReservationStatus.PENDING))
            """,
            countQuery = """
            SELECT COUNT(r)
            FROM Reservation r
            JOIN r.customer c
            JOIN r.restaurant rest
            LEFT JOIN r.diningTable t
            WHERE r.deleted = false
              AND (:unrestricted = TRUE OR rest.id IN :restaurantIds)
              AND (:restaurantId IS NULL OR rest.id = :restaurantId)
              AND (:search IS NULL
                   OR LOWER(CONCAT(c.firstName, ' ', c.lastName)) LIKE :search ESCAPE '!'
                   OR LOWER(c.email) LIKE :search ESCAPE '!'
                   OR LOWER(t.tableNumber) LIKE :search ESCAPE '!')
              AND (:filterStatuses = FALSE OR r.status IN :statuses)
              AND (:dateFrom IS NULL OR r.reservationDate >= :dateFrom)
              AND (:dateTo IS NULL OR r.reservationDate <= :dateTo)
              AND (:historyMode = FALSE
                   OR r.status IN (com.restaurante.reservation.enums.ReservationStatus.CANCELLED,
                                   com.restaurante.reservation.enums.ReservationStatus.COMPLETED,
                                   com.restaurante.reservation.enums.ReservationStatus.NO_SHOW)
                   OR (r.reservationDate < :today
                       AND r.status <> com.restaurante.reservation.enums.ReservationStatus.PENDING))
            """)
    Page<ReservationListItem> searchForList(@Param("unrestricted") boolean unrestricted,
                                            @Param("restaurantIds") Set<Long> restaurantIds,
                                            @Param("restaurantId") Long restaurantId,
                                            @Param("search") String search,
                                            @Param("filterStatuses") boolean filterStatuses,
                                            @Param("statuses") Set<ReservationStatus> statuses,
                                            @Param("dateFrom") LocalDate dateFrom,
                                            @Param("dateTo") LocalDate dateTo,
                                            @Param("historyMode") boolean historyMode,
                                            @Param("today") LocalDate today,
                                            Pageable pageable);

    /**
     * Las seis cifras del panel en el mismo alcance, con una sola consulta.
     * Devuelve una fila con {@code [total, pendientes, hoyConfirmadas,
     * proximasConfirmadas, canceladasFuturas, historial]}.
     */
    @Query("""
            SELECT COUNT(r),
                   COALESCE(SUM(CASE WHEN r.status = com.restaurante.reservation.enums.ReservationStatus.PENDING
                                      AND r.reservationDate >= :today THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN r.status = com.restaurante.reservation.enums.ReservationStatus.CONFIRMED
                                      AND r.reservationDate = :today THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN r.status = com.restaurante.reservation.enums.ReservationStatus.CONFIRMED
                                      AND r.reservationDate > :today THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN r.status = com.restaurante.reservation.enums.ReservationStatus.CANCELLED
                                      AND r.reservationDate >= :today THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN r.status IN (com.restaurante.reservation.enums.ReservationStatus.CANCELLED,
                                                       com.restaurante.reservation.enums.ReservationStatus.COMPLETED,
                                                       com.restaurante.reservation.enums.ReservationStatus.NO_SHOW)
                                       OR (r.reservationDate < :today
                                           AND r.status <> com.restaurante.reservation.enums.ReservationStatus.PENDING)
                                      THEN 1 ELSE 0 END), 0)
            FROM Reservation r
            JOIN r.restaurant rest
            WHERE r.deleted = false
              AND (:unrestricted = TRUE OR rest.id IN :restaurantIds)
              AND (:restaurantId IS NULL OR rest.id = :restaurantId)
            """)
    List<Object[]> statsForList(@Param("unrestricted") boolean unrestricted,
                                @Param("restaurantIds") Set<Long> restaurantIds,
                                @Param("restaurantId") Long restaurantId,
                                @Param("today") LocalDate today);
```

- [ ] **Step 4: Comprobar que compila**

Run: `cd restaurante_manage && mvn -o -q compile`
Expected: BUILD SUCCESS. Si falla por `import`, faltan `ReservationListItem`, `LocalDate` o `ReservationStatus` en el repositorio.

Nota sobre el entorno: el procesador de Lombok del IDE está roto (`NoClassDefFoundError: lombok.javac.Javac`). Los errores de getters y builders en el panel de diagnósticos son ruido; **solo `mvn compile` decide**.

- [ ] **Step 5: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationListItem.java \
        restaurante_manage/src/main/java/com/restaurante/reservation/dto/ReservationStats.java \
        restaurante_manage/src/main/java/com/restaurante/reservation/repository/ReservationRepository.java
git commit -m "feat(reservation): proyectar el listado y agregar las cifras en una consulta"
```

---

### Task 3: Servicio, controlador y pruebas de extremo a extremo

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/controller/ReservationController.java:37-87`
- Test: `restaurante_manage/src/test/java/com/restaurante/reservation/controller/ReservationListEndpointIntegrationTest.java`

**Interfaces:**
- Consumes: `ReservationView`, `ReservationSortField` (Task 1); `ReservationListItem`, `ReservationStats`, `searchForList`, `statsForList` (Task 2).
- Produces:
  - `ReservationService.findAllForList(Pageable pageable, ReservationView view, String search, Long restaurantId, ReservationStatus status, LocalDate date) -> Page<ReservationListItem>`
  - `ReservationService.stats(Long restaurantId) -> ReservationStats`
  - `GET /api/v1/reservations` con `page, size, view, search, restaurantId, status, date, sort, direction`
  - `GET /api/v1/reservations/stats?restaurantId=`

- [ ] **Step 1: Añadir al servicio la resolución de alcance y las dos operaciones**

Se añaden métodos nuevos; `findAll(Pageable)` se conserva porque lo usan otras rutas, pero deja de ser la que alimenta el panel.

Piezas privadas a añadir:

```java
    /** Criterios de una vista, ya resueltos contra la fecha de hoy. */
    private record ViewPredicate(boolean filterStatuses,
                                 Set<ReservationStatus> statuses,
                                 LocalDate dateFrom,
                                 LocalDate dateTo,
                                 boolean historyMode) {
    }

    /** Marcador para los parámetros de colección, que JPQL no admite vacíos. */
    private static final Set<ReservationStatus> ANY_STATUS = Set.of(ReservationStatus.PENDING);

    /**
     * Traduce la vista a criterios. Son los mismos que antes aplicaba el
     * navegador en {@code lib/reservationHelpers.js}.
     */
    private ViewPredicate predicateFor(ReservationView view, LocalDate today) {
        return switch (view) {
            case SOLICITUDES -> new ViewPredicate(true, Set.of(ReservationStatus.PENDING), today, null, false);
            case HOY -> new ViewPredicate(true, Set.of(ReservationStatus.CONFIRMED), today, today, false);
            case PROXIMAS -> new ViewPredicate(true, Set.of(ReservationStatus.CONFIRMED), today.plusDays(1), null, false);
            case HISTORIAL -> new ViewPredicate(false, ANY_STATUS, null, null, true);
            case TODAS -> new ViewPredicate(false, ANY_STATUS, null, null, false);
        };
    }
```

`findAllForList` combina la vista con los filtros del usuario. El filtro de estado se **interseca** con el de la vista: si la vista ya fija estados y el usuario pide uno que no está entre ellos, la página sale vacía, que es la respuesta correcta.

```java
    /**
     * Página del panel: la vista fija unos criterios y los filtros del usuario
     * se suman a ellos.
     */
    @Transactional(readOnly = true)
    public Page<ReservationListItem> findAllForList(Pageable pageable,
                                                    ReservationView view,
                                                    String search,
                                                    Long restaurantId,
                                                    ReservationStatus status,
                                                    LocalDate date) {
        Set<Long> scope = resolveVisibleRestaurantIds();
        boolean unrestricted = scope == null;
        if (!unrestricted && scope.isEmpty()) {
            return Page.empty(pageable);
        }

        ViewPredicate predicate = predicateFor(view != null ? view : ReservationView.TODAS, LocalDate.now());

        boolean filterStatuses = predicate.filterStatuses();
        Set<ReservationStatus> statuses = predicate.statuses();
        if (status != null) {
            if (filterStatuses && !statuses.contains(status)) {
                // El estado pedido no cabe en la vista: no hay nada que devolver.
                return Page.empty(pageable);
            }
            filterStatuses = true;
            statuses = Set.of(status);
        }

        LocalDate dateFrom = predicate.dateFrom();
        LocalDate dateTo = predicate.dateTo();
        if (date != null) {
            // La fecha exacta acota el rango de la vista, nunca lo amplía.
            if ((dateFrom != null && date.isBefore(dateFrom)) || (dateTo != null && date.isAfter(dateTo))) {
                return Page.empty(pageable);
            }
            dateFrom = date;
            dateTo = date;
        }

        return reservationRepository.searchForList(
                unrestricted,
                unrestricted ? Set.of(-1L) : scope,
                restaurantId,
                normalizeSearch(search),
                filterStatuses,
                statuses,
                dateFrom,
                dateTo,
                predicate.historyMode(),
                LocalDate.now(),
                pageable);
    }

    /** Las seis cifras del panel, con una sola consulta agregada. */
    @Transactional(readOnly = true)
    public ReservationStats stats(Long restaurantId) {
        Set<Long> scope = resolveVisibleRestaurantIds();
        boolean unrestricted = scope == null;
        if (!unrestricted && scope.isEmpty()) {
            return ReservationStats.builder().build();
        }

        List<Object[]> rows = reservationRepository.statsForList(
                unrestricted,
                unrestricted ? Set.of(-1L) : scope,
                restaurantId,
                LocalDate.now());

        if (rows == null || rows.isEmpty() || rows.get(0) == null) {
            return ReservationStats.builder().build();
        }

        Object[] row = rows.get(0);
        return ReservationStats.builder()
                .total(toLong(row, 0))
                .pendientes(toLong(row, 1))
                .hoyConfirmadas(toLong(row, 2))
                .proximasConfirmadas(toLong(row, 3))
                .canceladasFuturas(toLong(row, 4))
                .historial(toLong(row, 5))
                .build();
    }

    private long toLong(Object[] row, int index) {
        if (row.length <= index || row[index] == null) {
            return 0L;
        }
        return ((Number) row[index]).longValue();
    }

    /**
     * Convierte el texto de búsqueda en un patrón LIKE en minúsculas, escapando
     * los comodines para que un '%' escrito por el usuario se busque literalmente.
     * Devuelve {@code null} cuando no hay nada que buscar.
     */
    private String normalizeSearch(String search) {
        if (search == null || search.isBlank()) {
            return null;
        }
        String escaped = search.trim().toLowerCase()
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
        return "%" + escaped + "%";
    }

    /**
     * Restaurantes visibles para el usuario actual.
     *
     * @return {@code null} si no hay restricción (SUPER_ADMIN); en caso contrario
     *         el conjunto de IDs visibles, que puede venir vacío.
     */
    private Set<Long> resolveVisibleRestaurantIds() {
        List<Long> visibleIds = currentUserService.getVisibleRestaurantIds();

        // [-1] es el convenio de CurrentUserService para "no ve nada".
        if (visibleIds.size() == 1 && visibleIds.get(0) == -1L) {
            return Set.of();
        }
        if (!visibleIds.isEmpty()) {
            return Set.copyOf(visibleIds);
        }
        if (currentUserService.isSuperAdmin()) {
            return null;
        }
        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId != null) {
            return restaurantRepository.findByTenantIdAndDeletedFalse(tenantId)
                    .stream().map(Restaurant::getId).collect(Collectors.toSet());
        }
        Long ownRestaurantId = currentUserService.getCurrentRestaurantId();
        if (ownRestaurantId != null) {
            return Set.of(ownRestaurantId);
        }
        return Set.of();
    }
```

Importar en el servicio: `ReservationListItem`, `ReservationStats`, `ReservationView`.

- [ ] **Step 2: Reescribir el listado del controlador**

Sustituir el bloque `findAll` de `ReservationController.java:37-87` por:

```java
    /** Tope de tamaño de página, para que nadie pida la tabla entera. */
    private static final int MAX_PAGE_SIZE = 100;

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Listar reservas",
            description = "Página de reservas con vista (solicitudes, hoy, proximas, historial, todas), "
                    + "búsqueda por cliente, email o número de mesa, filtros opcionales por restaurante, "
                    + "estado y fecha, y ordenación por un conjunto cerrado de campos: id, date, customer, "
                    + "partySize, status, createdAt. El alcance multi-tenant se aplica siempre.")
    public ResponseEntity<PagedResponse<ReservationListItem>> findAll(
            @RequestParam(defaultValue = Constants.DEFAULT_PAGE) int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(defaultValue = "date") String sort,
            @RequestParam(defaultValue = "desc") String direction,
            @RequestParam(required = false) String view,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long restaurantId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {

        Pageable pageable = buildPageable(page, size, sort, direction);
        Page<ReservationListItem> reservationPage = reservationService.findAllForList(
                pageable, ReservationView.from(view), search, restaurantId, resolveStatus(status), date);

        PagedResponse<ReservationListItem> response = PagedResponse.<ReservationListItem>builder()
                .content(reservationPage.getContent())
                .page(reservationPage.getNumber())
                .size(reservationPage.getSize())
                .totalElements(reservationPage.getTotalElements())
                .totalPages(reservationPage.getTotalPages())
                .last(reservationPage.isLast())
                .first(reservationPage.isFirst())
                .empty(reservationPage.isEmpty())
                .build();

        return ResponseEntity.ok(response);
    }

    @GetMapping("/stats")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Cifras de reservas",
            description = "Total, pendientes, confirmadas de hoy, próximas, canceladas futuras e "
                    + "historial, calculados con una consulta agregada en el alcance del usuario.")
    public ResponseEntity<ApiResponse<ReservationStats>> stats(
            @RequestParam(required = false) Long restaurantId) {
        return ResponseEntity.ok(ApiResponse.success(reservationService.stats(restaurantId)));
    }

    /**
     * Construye la paginación validando lo que llega del cliente. El campo de
     * orden se resuelve contra {@link ReservationSortField}, que es una lista
     * cerrada, en vez de pasarse tal cual a {@code Sort}: eso era lo que
     * convertía un parámetro con una errata en un 500.
     */
    private Pageable buildPageable(int page, int size, String sort, String direction) {
        if (page < 0) {
            throw new BadRequestException("El número de página no puede ser negativo.");
        }
        if (size < 1) {
            throw new BadRequestException("El tamaño de página debe ser al menos 1.");
        }

        Sort.Direction dir = resolveDirection(direction);
        ReservationSortField sortField = ReservationSortField.from(sort);
        Sort orders = Sort.by(sortField.getProperties().stream()
                .map(property -> new Sort.Order(dir, property))
                .toList());

        return PageRequest.of(page, Math.min(size, MAX_PAGE_SIZE), orders);
    }

    private Sort.Direction resolveDirection(String direction) {
        if (direction == null || direction.isBlank() || "desc".equalsIgnoreCase(direction.trim())) {
            return Sort.Direction.DESC;
        }
        if ("asc".equalsIgnoreCase(direction.trim())) {
            return Sort.Direction.ASC;
        }
        throw new BadRequestException("Dirección de ordenación no válida: '" + direction
                + "'. Valores admitidos: asc, desc.");
    }

    /** Estado opcional; un valor desconocido es un 400, no una lista vacía. */
    private ReservationStatus resolveStatus(String status) {
        if (status == null || status.isBlank()) {
            return null;
        }
        try {
            return ReservationStatus.valueOf(status.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Estado no válido: '" + status
                    + "'. Valores admitidos: PENDING, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW.");
        }
    }
```

Importar: `BadRequestException`, `ReservationListItem`, `ReservationSortField`, `ReservationStats`, `ReservationView`, `ReservationStatus`, `LocalDate`, `org.springframework.format.annotation.DateTimeFormat`. Retirar el `import java.util.List` si deja de usarse.

- [ ] **Step 3: Escribir las pruebas de integración**

`ReservationListEndpointIntegrationTest.java`, con `@SpringBootTest`, `@AutoConfigureMockMvc`, `@ActiveProfiles("test")` y **`@Transactional` en la clase** (H2 vive durante todo el contexto; sin esto, el `@BeforeEach` acumula filas y los totales fallan).

Datos: un tenant, dos restaurantes, un cliente por restaurante y reservas fabricadas con fechas relativas a `LocalDate.now()` — una `PENDING` mañana, una `CONFIRMED` hoy, una `CONFIRMED` en tres días, una `CANCELLED` mañana, una `COMPLETED` la semana pasada.

Casos que hay que cubrir, uno por test:

1. `vistaSolicitudesDevuelveSoloPendientesDeHoyEnAdelante`
2. `vistaHoyDevuelveSoloConfirmadasDeHoy`
3. `vistaProximasExcluyeLasDeHoy`
4. `vistaHistorialIncluyeEstadosFinalesYpasadas`
5. `vistaTodasNoFiltra`
6. `vistaDesconocidaDevuelve400`
7. `laBusquedaEncuentraPorNombreDelCliente`
8. `laBusquedaEncuentraPorNumeroDeMesa`
9. `elFiltroDeEstadoSeSumaAlDeLaVista` — `view=hoy&status=PENDING` devuelve vacío
10. `elCampoDeOrdenNoPermitidoDevuelve400` — `?sort=notes`
11. `elTamanoDePaginaSeRecortaACien` — `?size=9999` responde `size=100`
12. `elListadoConservaLosCamposQueUsaElFormulario` — la fila trae `customerId`, `restaurantId`, `diningTableId`, `notes`, `status`, `customerName` y `holdStatus`
13. `unEmpleadoSinAsignacionesNoVeNada`
14. `lasCifrasCuadranConLasVistas` — `/stats` frente al `totalElements` de cada vista
15. `lasCifrasRespetanElFiltroDeRestaurante`

- [ ] **Step 4: Ejecutar toda la batería**

Run: `cd restaurante_manage && mvn -o test`
Expected: BUILD SUCCESS, sin regresiones en los 351 tests previos.

Si ordenar por `customer` produce un `JOIN` duplicado o una consulta mal formada, se retira `CUSTOMER` de `ReservationSortField`, se ajusta su test y **se anota en el resumen final**, como se hizo con el rol en empleados. No se deja pasar un orden que genere SQL inválido.

- [ ] **Step 5: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/reservation/ \
        restaurante_manage/src/test/java/com/restaurante/reservation/
git commit -m "feat(reservation): paginar, buscar y filtrar reservas en la base de datos"
```

---

### Task 4: Servicio del frontend

**Files:**
- Modify: `restaurante-frontend/src/services/reservationService.js:27-39`

**Interfaces:**
- Consumes: `GET /reservations`, `GET /reservations/stats` (Task 3).
- Produces:
  - `getReservations({ page, size, view, search, restaurantId, status, date, sort, direction }) -> Promise<{content, page, size, totalElements, totalPages, first, last, empty}>`
  - `getReservationStats({ restaurantId }) -> Promise<{total, pendientes, hoyConfirmadas, proximasConfirmadas, canceladasFuturas, historial}>`
  - `getReservationsByDate({ date, restaurantId }) -> Promise<Array>`
  - `PAGE_SIZE_OPTIONS = [10, 25, 50, 100]`, `DEFAULT_PAGE_SIZE = 25`

- [ ] **Step 1: Reescribir `getReservations` y añadir las dos funciones nuevas**

Sigue el molde de `customerService.js`: no usa `extractData`, porque descarta los metadatos de paginación, que son justo lo que la pantalla necesita.

```javascript
/** Tamaños de página que ofrece la pantalla de reservas. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Tamaño de página por defecto, alineado con el del backend. */
export const DEFAULT_PAGE_SIZE = 25;

/** Página vacía, para no devolver nunca undefined a la pantalla. */
const emptyPage = (size = DEFAULT_PAGE_SIZE) => ({
  content: [],
  page: 0,
  size,
  totalElements: 0,
  totalPages: 0,
  first: true,
  last: true,
  empty: true,
});

/**
 * Obtiene una página de reservas visibles para el usuario actual.
 *
 * El backend pagina, aplica la vista, busca, filtra y ordena; antes se pedía
 * `size=9999` y las siete vistas de la pantalla se calculaban en el navegador.
 *
 * @param {object} [params]
 * @param {number} [params.page=0]
 * @param {number} [params.size=25]
 * @param {string} [params.view]         - solicitudes | hoy | proximas | historial | todas
 * @param {string} [params.search]       - Cliente, email o número de mesa
 * @param {number} [params.restaurantId]
 * @param {string} [params.status]       - PENDING | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW
 * @param {string} [params.date]         - YYYY-MM-DD
 * @param {string} [params.sort='date']
 * @param {'asc'|'desc'} [params.direction='desc']
 */
export const getReservations = async (params = {}) => {
  const size = params.size ?? DEFAULT_PAGE_SIZE;
  try {
    const query = {
      page: params.page ?? 0,
      size,
      sort: params.sort || 'date',
      direction: params.direction === 'asc' ? 'asc' : 'desc',
    };
    const search = (params.search || '').trim();
    if (search) query.search = search;
    if (params.view) query.view = params.view;
    if (params.restaurantId) query.restaurantId = params.restaurantId;
    if (params.status) query.status = params.status;
    if (params.date) query.date = params.date;

    const response = await api.get(RESOURCE, { params: query });
    const body = response?.data;
    if (!body || !Array.isArray(body.content)) {
      return emptyPage(size);
    }

    return {
      content: body.content,
      page: Number(body.page) || 0,
      size: Number(body.size) || size,
      totalElements: Number(body.totalElements) || 0,
      totalPages: Number(body.totalPages) || 0,
      first: Boolean(body.first),
      last: Boolean(body.last),
      empty: Boolean(body.empty),
    };
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Cifras del panel. Las calcula el backend con una consulta agregada; no se
 * derivan de la página cargada, así que no cambian al filtrar.
 *
 * @param {object} [params]
 * @param {number} [params.restaurantId]
 */
export const getReservationStats = async (params = {}) => {
  try {
    const response = await api.get(`${RESOURCE}/stats`, {
      params: params.restaurantId ? { restaurantId: params.restaurantId } : undefined,
    });
    const body = response?.data;
    const data = body?.data ?? body ?? {};
    return {
      total: Number(data.total) || 0,
      pendientes: Number(data.pendientes) || 0,
      hoyConfirmadas: Number(data.hoyConfirmadas) || 0,
      proximasConfirmadas: Number(data.proximasConfirmadas) || 0,
      canceladasFuturas: Number(data.canceladasFuturas) || 0,
      historial: Number(data.historial) || 0,
    };
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Reservas de un día concreto, para el calendario. Sin paginar: un día es un
 * volumen acotado por naturaleza. Antes el calendario filtraba en el navegador
 * la lista completa.
 *
 * @param {object} params
 * @param {string} params.date          - YYYY-MM-DD
 * @param {number} [params.restaurantId]
 */
export const getReservationsByDate = async ({ date, restaurantId } = {}) => {
  if (!date) return [];
  const page = await getReservations({
    page: 0,
    size: 100,
    date,
    restaurantId,
    sort: 'date',
    direction: 'asc',
  });
  return page.content;
};
```

- [ ] **Step 2: Comprobar que el linter pasa**

Run: `cd restaurante-frontend && pnpm lint`
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add restaurante-frontend/src/services/reservationService.js
git commit -m "feat(frontend): pedir las reservas paginadas y por vista"
```

---

### Task 5: Pantalla de reservas

**Files:**
- Modify: `restaurante-frontend/src/pages/Reservations.jsx`
- Modify: `restaurante-frontend/src/pages/Reservations.wizard.test.jsx` (el mock)
- Test: `restaurante-frontend/src/pages/Reservations.test.jsx` (nuevo)

**Interfaces:**
- Consumes: `getReservations`, `getReservationStats`, `getReservationsByDate`, `PAGE_SIZE_OPTIONS`, `DEFAULT_PAGE_SIZE` (Task 4); `Pagination` y `ActionMenu` de `src/components/`.

⚠️ **El fichero usa CRLF.** Cualquier script de sustitución de texto debe detectarlo (`s.includes('\r\n')`) y unir las cadenas de búsqueda con el salto de línea correcto, o no encontrará nada.

- [ ] **Step 1: Sustituir el bloque de estado de datos**

Retirar `reservations`, `filteredReservations`, `pendingReservations`, `todayReservations`, `upcomingReservations`, `historyReservations`, `calendarReservations` y el objeto `stats` calculado en el navegador. En su lugar:

```javascript
  // ─── Estado del listado ────────────────────────────────────────────────
  const [view, setView] = useState('solicitudes');
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');   // lo que se teclea
  const [search, setSearch] = useState('');             // lo que se consulta
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [pageData, setPageData] = useState(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
```

- [ ] **Step 2: Efecto de retardo del buscador**

Actualiza búsqueda y página **en el mismo render**, para que salga una sola petición:

```javascript
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);
```

- [ ] **Step 3: Efecto de carga de la página**

Con guarda `cancelled` y retroceso si la página queda vacía tras borrar:

```javascript
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setError(null);
      try {
        const data = await getReservations({
          page, size, view, search,
          restaurantId: filterRestaurantId || undefined,
          status: filterStatus || undefined,
          date: filterDate || undefined,
          sort: sortField,
          direction: sortDirection,
        });
        if (cancelled) return;
        if (data.content.length === 0 && data.totalElements > 0 && page > 0) {
          setPage((p) => Math.max(0, Math.min(p - 1, data.totalPages - 1)));
          return;
        }
        setPageData(data);
      } catch (err) {
        if (!cancelled) setError(err?.message || 'Error al cargar las reservas.');
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsInitialLoad(false);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [page, size, view, search, filterRestaurantId, filterStatus, filterDate, sortField, sortDirection, refreshKey]);
```

- [ ] **Step 4: Efecto de cifras**

Depende solo del restaurante y del refresco, **no de la vista ni de los filtros**, para que los números no bailen:

```javascript
  useEffect(() => {
    let cancelled = false;
    setStatsLoading(true);
    getReservationStats({ restaurantId: filterRestaurantId || undefined })
      .then((data) => { if (!cancelled) setStats(data); })
      .catch(() => { if (!cancelled) setStats(null); })
      .finally(() => { if (!cancelled) setStatsLoading(false); });
    return () => { cancelled = true; };
  }, [filterRestaurantId, refreshKey]);
```

- [ ] **Step 5: Efecto del calendario**

Sustituye el `useMemo` de `calendarReservations`:

```javascript
  const [calendarData, setCalendarData] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  useEffect(() => {
    if (viewMode !== 'calendar' || !calendarDate) return undefined;
    let cancelled = false;
    setCalendarLoading(true);
    getReservationsByDate({
      date: calendarDate,
      restaurantId: calendarRestaurantId || undefined,
    })
      .then((rows) => { if (!cancelled) setCalendarData(rows); })
      .catch(() => { if (!cancelled) setCalendarData([]); })
      .finally(() => { if (!cancelled) setCalendarLoading(false); });
    return () => { cancelled = true; };
  }, [viewMode, calendarDate, calendarRestaurantId, refreshKey]);
```

`groupedByHour` pasa a agrupar `calendarData` en vez de `calendarReservations`.

- [ ] **Step 6: Sustituir pestañas, tabla y controles**

Cinco pestañas con su contador tomado de `stats`:

| Pestaña | `view` | Contador |
|---|---|---|
| Solicitudes | `solicitudes` | `stats.pendientes` |
| Hoy | `hoy` | `stats.hoyConfirmadas` |
| Próximas | `proximas` | `stats.proximasConfirmadas` |
| Historial | `historial` | `stats.historial` |
| Todas | `todas` | `stats.total` |

Cambiar de pestaña llama a `setView(v)` **y** `setPage(0)`.

Una sola tabla con columnas **# · Cliente · Mesa · Restaurante · Fecha y hora · Comensales · Estado · ⋮**, alimentada por `pageData?.content ?? []`. Cabeceras ordenables (`date`, `customer`, `partySize`, `status`) con el patrón `sortableHeader` de `Customers.jsx`.

El menú `⋮` usa `ActionMenu` y recoge lo que hoy está repartido por la fila: ver detalles, editar, cambiar estado (respetando la matriz de transiciones del backend) y eliminar. Tras cualquier acción, `setRefreshKey((k) => k + 1)`.

Debajo, `<Pagination>` con `PAGE_SIZE_OPTIONS`; cambiar el tamaño vuelve a la página 0.

Estado y fecha solo se pintan cuando `view === 'todas' || view === 'historial'`. Al salir de esas vistas se limpian (`setFilterStatus('')`, `setFilterDate('')`) para no arrastrar un filtro invisible.

Las cuatro tarjetas se alimentan de `stats`: total, `hoyConfirmadas + proximasConfirmadas`, `pendientes`, `canceladasFuturas`.

- [ ] **Step 7: Retirar el aviso flotante de solicitudes**

Borrar el bloque `{!loading && !error && pendingReservations.length > 0 && (...)}` de las líneas 1154-1283 y los estados `showAllPending` y `setShowAllPending` que solo servían a ese bloque. El contador de la pestaña «Solicitudes» dice lo mismo.

- [ ] **Step 8: Envolver la tarjeta con `is-refreshing`**

Esqueleto solo en `isInitialLoad`; en las recargas, `<div className={`app-card ${loading && !isInitialLoad ? 'is-refreshing' : ''}`}>`, para que el buscador no se desmonte y no pierda el foco.

- [ ] **Step 9: Actualizar el mock del asistente**

En `Reservations.wizard.test.jsx`, `getReservations` devuelve hoy un array. Cambiarlo por el sobre paginado y añadir los mocks de las dos funciones nuevas:

```javascript
  getReservations: vi.fn().mockResolvedValue({
    content: [], page: 0, size: 25, totalElements: 0, totalPages: 0,
    first: true, last: true, empty: true,
  }),
  getReservationStats: vi.fn().mockResolvedValue({
    total: 0, pendientes: 0, hoyConfirmadas: 0,
    proximasConfirmadas: 0, canceladasFuturas: 0, historial: 0,
  }),
  getReservationsByDate: vi.fn().mockResolvedValue([]),
```

- [ ] **Step 10: Escribir `Reservations.test.jsx`**

Un test por comportamiento, con temporizadores reales y `waitFor` (los falsos no accionan bien el retardo):

1. `pide_la_primera_pagina_de_solicitudes_al_montar`
2. `cambiar_de_pestana_consulta_esa_vista_y_vuelve_a_la_pagina_cero`
3. `el_buscador_espera_y_dispara_una_sola_peticion` — afirmar el número de llamadas
4. `cambiar_de_pagina_pide_la_siguiente`
5. `cambiar_el_tamano_de_pagina_vuelve_a_la_primera`
6. `las_cifras_no_cambian_al_cambiar_de_pestana` — `getReservationStats` llamado una sola vez
7. `estado_y_fecha_solo_aparecen_en_todas_e_historial`
8. `muestra_el_aviso_de_sin_resultados_distinguiendolo_del_de_vacio`
9. `el_menu_de_acciones_abre_el_detalle`

Detalles del entorno que ya han mordido antes: `navigator.clipboard` es solo lectura en jsdom, hay que instalarlo con `Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {...} })`; y cuando un texto aparezca más de una vez, acotar con `within(...)` en vez de buscar en todo el documento.

- [ ] **Step 11: Verificar**

Run: `cd restaurante-frontend && pnpm lint && pnpm test && pnpm build`
Expected: linter limpio, todos los tests verdes (incluidos los del asistente), build correcto.

- [ ] **Step 12: Commit**

```bash
git add restaurante-frontend/src/pages/Reservations.jsx \
        restaurante-frontend/src/pages/Reservations.test.jsx \
        restaurante-frontend/src/pages/Reservations.wizard.test.jsx
git commit -m "feat(frontend): panel escalable de reservas con vistas, filtros y paginación"
```

---

### Task 6: Inicio deja de descargar la tabla entera

**Files:**
- Modify: `restaurante-frontend/src/pages/Inicio.jsx:66-93` y los `useMemo` que derivan de `safeReservations`

**Interfaces:**
- Consumes: `getReservations`, `getReservationStats` (Task 4).

Cambia la **fuente de datos, no la interfaz**. Ningún KPI cambia de definición ni de aspecto.

- [ ] **Step 1: Sustituir la carga**

`fetchData` pasa de una llamada `size=9999` a tres peticiones acotadas en paralelo:

```javascript
      const [statsRes, hoyRes, solicitudesRes] = await Promise.allSettled([
        getReservationStats(),
        getReservations({ view: 'hoy', size: 100, sort: 'date', direction: 'asc' }),
        getReservations({ view: 'solicitudes', size: 25, sort: 'date', direction: 'asc' }),
      ]);
```

- [ ] **Step 2: Repartir los datos**

- Los contadores (pendientes, confirmadas de hoy) salen de `statsRes`.
- `todayConfirmedReservations`, `nextReservation` y `urgentReservations` salen de `hoyRes.value.content`, que ya viene filtrado por el servidor: los `useMemo` que llamaban a `filterTodayConfirmedReservations` dejan de necesitar filtrar y pasan a ordenar solo por hora.
- `pendingReservations` sale de `solicitudesRes.value.content`.
- `partialError` se activa si cualquiera de las tres no cumple, con el mismo texto que ahora.

`filterReservationsWithoutTable`, si se usaba sobre la lista completa, pasa a aplicarse sobre las reservas de hoy, que es el único caso operativo en el que Inicio actúa; anotarlo con un comentario en el código.

- [ ] **Step 3: Verificar que el sondeo sigue funcionando**

El intervalo de 60 segundos, el evento `focus` y `visibilitychange` no se tocan: ahora repiten tres consultas acotadas en vez de arrastrar la tabla entera.

- [ ] **Step 4: Verificar**

Run: `cd restaurante-frontend && pnpm lint && pnpm test && pnpm build`
Expected: todo verde. Si hay tests de Inicio que mockeaban `getReservations` con un array, actualizarlos al sobre paginado igual que en el Step 9 de la Task 5.

- [ ] **Step 5: Commit**

```bash
git add restaurante-frontend/src/pages/Inicio.jsx restaurante-frontend/src/pages/Inicio.test.jsx
git commit -m "perf(frontend): acotar las consultas de reservas en Inicio"
```

---

## Verificación final

Antes de dar la tarea por terminada, y sin desactivar ninguna comprobación:

```bash
cd restaurante_manage && mvn -o test
cd ../restaurante-frontend && pnpm lint && pnpm test && pnpm build
git log --oneline -6
git status
```

Los cuatro tienen que salir en verde y `git status` no debe mostrar cambios ajenos a la tarea perdidos.

## Riesgos anotados

- **Orden por `customer`**: si Hibernate genera un `JOIN` duplicado, se retira el campo y se dice en el resumen (Task 3, Step 4).
- **Zona horaria**: `LocalDate.now()` en el servidor usa `Europe/Madrid`, fijado en `RestaurantManageApplication`, así que coincide con la fecha local del navegador para un usuario español. Si algún día se despliega en otra zona, las vistas `hoy` y `proximas` se desplazarían.
- **Desplegables de restaurante**: siguen pidiendo `getRestaurants({ size: 500 })`. Deuda transversal ya anotada en los tres specs anteriores; no entra aquí.
- El usuario tendrá que **reiniciar el backend** (sin el perfil `dev`) para que `/reservations/stats` y los nuevos parámetros se registren.
