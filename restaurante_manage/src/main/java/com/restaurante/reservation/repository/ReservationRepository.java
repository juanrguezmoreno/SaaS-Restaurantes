package com.restaurante.reservation.repository;

import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;

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

    List<Reservation> findByDiningTableIdAndReservationDateAndDeletedFalse(Long diningTableId, LocalDate date);

    long countByRestaurantIdAndReservationDateAndDeletedFalse(Long restaurantId, LocalDate date);

    long countByStatusAndDeletedFalse(ReservationStatus status);

    long countByRestaurantIdAndStatusAndDeletedFalse(Long restaurantId, ReservationStatus status);

    @Query("SELECT r.restaurant.id, COUNT(r) FROM Reservation r WHERE r.reservationDate = :date AND r.deleted = false GROUP BY r.restaurant.id")
    List<Object[]> countByRestaurantAndDate(@Param("date") LocalDate date);

    @Query("SELECT r.diningTable.id, COUNT(r) FROM Reservation r WHERE r.restaurant.id = :restaurantId AND r.deleted = false GROUP BY r.diningTable.id ORDER BY COUNT(r) DESC")
    List<Object[]> findPopularTables(@Param("restaurantId") Long restaurantId);

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
     * Encuentra reservas CONFIRMED para una mesa en una fecha y hora específicas.
     * Usado para verificar conflictos de disponibilidad.
     */
    @Query("SELECT r FROM Reservation r WHERE r.diningTable.id = :tableId " +
           "AND r.deleted = false AND r.status = 'CONFIRMED' " +
           "AND r.reservationDate = :date AND r.reservationTime = :time")
    List<Reservation> findConfirmedByTableIdAndDateAndTime(@Param("tableId") Long tableId,
                                                           @Param("date") LocalDate date,
                                                           @Param("time") LocalTime time);
}
