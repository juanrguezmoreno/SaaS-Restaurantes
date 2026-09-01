package com.restaurante.subscription.repository;

import com.restaurante.subscription.entity.ProcessedStripeEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ProcessedStripeEventRepository extends JpaRepository<ProcessedStripeEvent, Long> {

    boolean existsByStripeEventId(String stripeEventId);
}
