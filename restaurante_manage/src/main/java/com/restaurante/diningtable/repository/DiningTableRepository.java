package com.restaurante.diningtable.repository;

import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import jakarta.persistence.LockModeType;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public interface DiningTableRepository extends JpaRepository<DiningTable, Long> {

    Optional<DiningTable> findByIdAndDeletedFalse(Long id);

    /**
     * Igual que {@link #findByIdAndDeletedFalse(Long)} pero adquiriendo un
     * bloqueo pesimista de escritura sobre la fila de la mesa. Se usa justo
     * antes de comprobar solape y guardar, para serializar dos transacciones
     * que compitan por la misma mesa (ver AvailabilityService.assertNoOverlap).
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("SELECT t FROM DiningTable t WHERE t.id = :id AND t.deleted = false")
    Optional<DiningTable> findByIdAndDeletedFalseForUpdate(@Param("id") Long id);

    List<DiningTable> findByRestaurantIdAndDeletedFalse(Long restaurantId);

    List<DiningTable> findByRestaurantIdAndStatusAndDeletedFalse(Long restaurantId, TableStatus status);

    List<DiningTable> findByStatusAndDeletedFalse(TableStatus status);

    boolean existsByRestaurantIdAndTableNumberAndDeletedFalse(Long restaurantId, String tableNumber);

    List<DiningTable> findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds);

    long countByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds);

    List<DiningTable> findByRestaurantIdAndIdInAndDeletedFalse(Long restaurantId, List<Long> ids);

    List<DiningTable> findByRestaurantIdAndIdInAndDeletedFalse(Long restaurantId, Set<Long> ids);
}
