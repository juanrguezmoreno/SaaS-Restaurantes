package com.restaurante.restaurant.repository;

import com.restaurante.restaurant.entity.Restaurant;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public interface RestaurantRepository extends JpaRepository<Restaurant, Long> {

    Optional<Restaurant> findByIdAndDeletedFalse(Long id);

    Page<Restaurant> findAllByDeletedFalse(Pageable pageable);

    List<Restaurant> findByTenantIdAndDeletedFalse(Long tenantId);

    Page<Restaurant> findByTenantIdAndDeletedFalse(Long tenantId, Pageable pageable);

    // Consultas para filtrar por IDs de restaurantes visibles

    @Query("SELECT r FROM Restaurant r WHERE r.id IN :ids AND r.deleted = false")
    List<Restaurant> findByIdInAndDeletedFalse(Set<Long> ids);

    @Query("SELECT r FROM Restaurant r WHERE r.id IN :ids AND r.deleted = false")
    Page<Restaurant> findByIdInAndDeletedFalse(Set<Long> ids, Pageable pageable);

    @Query("SELECT r FROM Restaurant r WHERE r.tenant.id = :tenantId AND r.id IN :ids AND r.deleted = false")
    List<Restaurant> findByTenantIdAndIdInAndDeletedFalse(Long tenantId, Set<Long> ids);

    @Query("SELECT r FROM Restaurant r WHERE r.tenant.id = :tenantId AND r.id IN :ids AND r.deleted = false")
    Page<Restaurant> findByTenantIdAndIdInAndDeletedFalse(Long tenantId, Set<Long> ids, Pageable pageable);
}
