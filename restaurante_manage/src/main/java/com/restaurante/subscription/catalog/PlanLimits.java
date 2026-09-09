package com.restaurante.subscription.catalog;

import com.restaurante.subscription.enums.Resource;

/**
 * Límites de un plan. {@code null} significa ilimitado (no cero, no -1: null es
 * el único valor que no se puede confundir con un límite real).
 */
public record PlanLimits(Integer maxRestaurants, Integer maxUserAccounts) {

    public static PlanLimits unlimited() {
        return new PlanLimits(null, null);
    }

    public Integer limitFor(Resource resource) {
        return switch (resource) {
            case RESTAURANT -> maxRestaurants;
            case USER_ACCOUNT -> maxUserAccounts;
        };
    }

    public boolean isUnlimited(Resource resource) {
        return limitFor(resource) == null;
    }
}
