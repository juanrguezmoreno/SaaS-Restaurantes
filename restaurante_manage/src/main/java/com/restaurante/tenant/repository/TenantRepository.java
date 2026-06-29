package com.restaurante.tenant.repository;

import com.restaurante.tenant.entity.Tenant;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface TenantRepository extends JpaRepository<Tenant, Long> {

    Optional<Tenant> findBySlugAndDeletedFalse(String slug);

    Optional<Tenant> findByIdAndDeletedFalse(Long id);
}
