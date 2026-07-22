package com.restaurante.reservation.repository;

import java.time.LocalDate;
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

import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;

@Repository
public interface ReservationRepository extends JpaRepository<Reservation, Long> {

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
}
