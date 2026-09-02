package com.restaurante.subscription.dto;

import java.util.Set;

/** Un plan del catálogo, tal y como se le muestra al usuario. Sin price_id. */
public record PlanResponse(
        String code,
        String name,
        Set<String> features,
        Integer maxRestaurants,
        Integer maxUserAccounts
) {}
