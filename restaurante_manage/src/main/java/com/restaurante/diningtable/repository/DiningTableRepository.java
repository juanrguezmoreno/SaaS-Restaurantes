package com.restaurante.diningtable.repository;

import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public interface DiningTableRepository extends JpaRepository<DiningTable, Long> {

    Optional<DiningTable> findByIdAndDeletedFalse(Long id);

    List<DiningTable> findByRestaurantIdAndDeletedFalse(Long restaurantId);

    List<DiningTable> findByRestaurantIdAndStatusAndDeletedFalse(Long restaurantId, TableStatus status);

    List<DiningTable> findByStatusAndDeletedFalse(TableStatus status);

    boolean existsByRestaurantIdAndTableNumberAndDeletedFalse(Long restaurantId, String tableNumber);

    List<DiningTable> findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds);

    long countByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds);
}
