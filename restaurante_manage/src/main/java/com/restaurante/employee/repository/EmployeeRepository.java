package com.restaurante.employee.repository;

import com.restaurante.employee.entity.Employee;
import org.springframework.data.jpa.repository.JpaRepository;
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
}
