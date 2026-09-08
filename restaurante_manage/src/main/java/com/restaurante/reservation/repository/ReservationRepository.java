package com.restaurante.reservation.repository;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import com.restaurante.customer.dto.CustomerReservationStats;
import com.restaurante.reservation.dto.ReservationListItem;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;

@Repository
public interface ReservationRepository extends JpaRepository<Reservation, Long> {

    /**
     * Reservas por cliente (total y fecha de la última) para un conjunto de
     * clientes, en una sola consulta.
     *
     * <p>Se excluyen las canceladas y las borradas: lo que interesa aquí es si
     * el cliente vino de verdad y cuándo fue la última vez.</p>
     */
    @Query("""
            SELECT r.customer.id AS customerId,
                   COUNT(r) AS totalReservations,
                   MAX(r.reservationDate) AS lastReservationDate
            FROM Reservation r
            WHERE r.deleted = false
              AND r.customer.id IN :customerIds
              AND r.status <> com.restaurante.reservation.enums.ReservationStatus.CANCELLED
            GROUP BY r.customer.id
            """)
    List<CustomerReservationStats> findStatsByCustomerIds(@Param("customerIds") Set<Long> customerIds);

    Optional<Reservation> findByIdAndDeletedFalse(Long id);

    Page<Reservation> findAllByDeletedFalse(Pageable pageable);

    List<Reservation> findByCustomerIdAndDeletedFalse(Long customerId);

    List<Reservation> findByRestaurantIdAndDeletedFalse(Long restaurantId);

    Page<Reservation> findByRestaurantIdAndDeletedFalse(Long restaurantId, Pageable pageable);

    List<Reservation> findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds);

    Page<Reservation> findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds, Pageable pageable);

    List<Reservation> findByRestaurantIdAndReservationDateAndDeletedFalse(Long restaurantId, LocalDate date);

    long countByStatusAndDeletedFalse(ReservationStatus status);

    boolean existsByCustomerIdAndReservationDateAndReservationTimeAndStatusInAndDeletedFalse(
            Long customerId, LocalDate date, LocalTime time, List<ReservationStatus> statuses);

    // ─── Queries para gestión de disponibilidad y liberación de mesas ───

    /**
     * Encuentra reservas CONFIRMED activas o futuras para una mesa.
     * Una reserva es "activa" si su fecha es futura, o si es hoy y la hora aún no ha pasado.
     */
    @Query("SELECT r FROM Reservation r WHERE r.diningTable.id = :tableId " +
           "AND r.deleted = false AND r.status = 'CONFIRMED' " +
           "AND (r.reservationDate > :today OR (r.reservationDate = :today AND r.reservationTime >= :now))")
    List<Reservation> findActiveConfirmedByTableId(@Param("tableId") Long tableId,
                                                   @Param("today") LocalDate today,
                                                   @Param("now") LocalTime now);

    /**
     * Reservas ACTIVAS (PENDING o CONFIRMED, no borradas) de una mesa cuya
     * {@code reservationDate} cae dentro de {@code [from, to]} (ambos inclusive).
     * Usada por {@code AvailabilityService} para calcular solape por intervalo
     * horario (no solo por hora exacta): el rango debe cubrir el día anterior
     * y el siguiente al de la reserva solicitada, para detectar solapes que
     * cruzan medianoche (p.ej. una reserva a las 23:30 con 90 min de duración
     * termina a la 01:00 del día siguiente).
     * {@code excludeId} permite ignorar la propia reserva al editar (null = ninguna).
     */
    @Query("SELECT r FROM Reservation r WHERE r.diningTable.id = :tableId " +
           "AND r.deleted = false AND r.status IN ('PENDING','CONFIRMED') " +
           "AND r.reservationDate BETWEEN :from AND :to " +
           "AND (:excludeId IS NULL OR r.id <> :excludeId)")
    List<Reservation> findActiveByTableAndDateBetween(@Param("tableId") Long tableId,
                                                       @Param("from") LocalDate from,
                                                       @Param("to") LocalDate to,
                                                       @Param("excludeId") Long excludeId);

    /**
     * Solicitudes PENDING cuyo bloqueo provisional ya venció pero que todavía
     * retienen la mesa asignada. Las usa {@code ReservationHoldScheduler} para
     * soltarla; el cálculo de disponibilidad ya las ignora desde el instante
     * mismo de la caducidad, sin esperar al job.
     */
    @Query("SELECT r FROM Reservation r WHERE r.deleted = false " +
           "AND r.status = 'PENDING' AND r.diningTable IS NOT NULL " +
           "AND r.holdExpiresAt IS NOT NULL AND r.holdExpiresAt <= :now")
    List<Reservation> findExpiredHolds(@Param("now") LocalDateTime now);

    // ─── Listado del panel ──────────────────────────────────────────────────
    // El listado anterior pasaba por ReservationMapper.toResponse, que lee
    // customer, diningTable y restaurant sobre asociaciones LAZY: tres consultas
    // por fila. Y las siete vistas de la pantalla se calculaban en el navegador
    // sobre la lista completa. Estas dos consultas hacen ambas cosas en la base
    // de datos.

    /**
     * Página del listado con los criterios de vista y los filtros del usuario,
     * siempre acotada al alcance multi-tenant que resuelve {@code CurrentUserService}.
     *
     * <p>El alcance no es negociable desde fuera: aunque se pida un
     * {@code restaurantId} concreto, la condición de alcance se sigue aplicando,
     * de modo que pedir un restaurante ajeno devuelve vacío en vez de filtrarse.</p>
     *
     * @param unrestricted   {@code true} solo para SUPER_ADMIN, que ve todos los
     *                       tenants. Con {@code false} manda {@code restaurantIds}.
     * @param restaurantIds  restaurantes visibles. Nunca nulo ni vacío; cuando
     *                       {@code unrestricted} es true se ignora su contenido.
     * @param restaurantId   filtro opcional por un restaurante concreto.
     * @param search         texto ya normalizado a minúsculas y con comodines
     *                       ({@code %texto%}), o nulo para no filtrar.
     * @param filterStatuses aplicar {@code statuses}; con {@code false} se ignora.
     * @param statuses       estados admitidos. Nunca nulo ni vacío, porque JPQL
     *                       no admite colecciones vacías como parámetro.
     * @param dateFrom       fecha mínima inclusive, o nulo.
     * @param dateTo         fecha máxima inclusive, o nulo.
     * @param historyMode    aplicar el criterio de historial.
     * @param today          fecha de hoy, calculada en el servicio para que H2 y
     *                       MySQL se comporten igual.
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

    // ─── Exportación CSV (plan Pro) ───────────────────────────────────────

    /**
     * Reservas para exportar a CSV, en el mismo alcance multi-tenant que el
     * resto de consultas del panel.
     *
     * <p>Sigue el convenio de {@code CurrentUserService.getVisibleRestaurantIds()}:
     * {@code restaurantIds} vacío significa "sin filtro de ID" (solo se aplica
     * el filtro de tenant); no vacío filtra por esos restaurantes concretos.
     * {@code tenantId} nulo significa SUPER_ADMIN, sin restricción de tenant.</p>
     *
     * @param tenantId      tenant del usuario, o nulo para SUPER_ADMIN.
     * @param restaurantIds restaurantes visibles; vacío = sin filtro de ID.
     * @param desde         fecha mínima inclusive, o nula para no acotar.
     * @param hasta         fecha máxima inclusive, o nula para no acotar.
     */
    @Query("""
            SELECT r FROM Reservation r
            JOIN FETCH r.customer c
            JOIN FETCH r.restaurant rest
            LEFT JOIN FETCH r.diningTable t
            WHERE r.deleted = false
              AND (:tenantId IS NULL OR rest.tenant.id = :tenantId)
              AND (:restaurantIds IS NULL OR rest.id IN :restaurantIds)
              AND (:desde IS NULL OR r.reservationDate >= :desde)
              AND (:hasta IS NULL OR r.reservationDate <= :hasta)
            ORDER BY r.reservationDate DESC, r.reservationTime DESC
            """)
    List<Reservation> findForExport(@Param("tenantId") Long tenantId,
                                    @Param("restaurantIds") Set<Long> restaurantIds,
                                    @Param("desde") LocalDate desde,
                                    @Param("hasta") LocalDate hasta);
}
