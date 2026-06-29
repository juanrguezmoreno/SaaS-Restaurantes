package com.restaurante.customer.repository;

import com.restaurante.customer.entity.Customer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public interface CustomerRepository extends JpaRepository<Customer, Long> {

    Optional<Customer> findByIdAndDeletedFalse(Long id);

    Page<Customer> findAllByDeletedFalse(Pageable pageable);

    Page<Customer> findByRestaurantIdAndDeletedFalse(Long restaurantId, Pageable pageable);

    List<Customer> findAllByRestaurantIdAndDeletedFalse(Long restaurantId);

    Page<Customer> findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds, Pageable pageable);

    List<Customer> findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds);

    Optional<Customer> findByEmailAndDeletedFalse(String email);

    Optional<Customer> findByUserIdAndDeletedFalse(Long userId);

    boolean existsByEmailAndDeletedFalse(String email);
}
