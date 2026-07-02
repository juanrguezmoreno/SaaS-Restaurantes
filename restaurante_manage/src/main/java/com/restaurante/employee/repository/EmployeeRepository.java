package com.restaurante.employee.repository;

import com.restaurante.employee.entity.Employee;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public interface EmployeeRepository extends JpaRepository<Employee, Long> {

    Optional<Employee> findByIdAndDeletedFalse(Long id);

    List<Employee> findByRestaurantIdAndDeletedFalse(Long restaurantId);

    Optional<Employee> findByUserIdAndDeletedFalse(Long userId);

    List<Employee> findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds);

    Optional<Employee> findByEmailAndDeletedFalse(String email);

    boolean existsByEmailAndDeletedFalse(String email);

    @Query("SELECT e FROM Employee e JOIN e.restaurants r WHERE r.id IN :restaurantIds AND e.deleted = false")
    List<Employee> findByRestaurantsIdInAndDeletedFalse(@Param("restaurantIds") Set<Long> restaurantIds);

    @Query("SELECT e FROM Employee e WHERE e.deleted = false")
    List<Employee> findAllNotDeleted();

    @Query("SELECT e FROM Employee e LEFT JOIN FETCH e.restaurants WHERE e.id = :id AND e.deleted = false")
    Optional<Employee> findByIdWithRestaurants(@Param("id") Long id);
}
