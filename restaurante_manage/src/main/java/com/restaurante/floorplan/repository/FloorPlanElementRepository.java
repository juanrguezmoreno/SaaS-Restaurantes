package com.restaurante.floorplan.repository;

import com.restaurante.floorplan.entity.FloorPlanElement;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface FloorPlanElementRepository extends JpaRepository<FloorPlanElement, Long> {

    List<FloorPlanElement> findByRestaurantIdAndDeletedFalse(Long restaurantId);
}
