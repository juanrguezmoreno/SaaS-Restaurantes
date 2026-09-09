package com.restaurante.subscription.catalog;

import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;

import java.util.Set;

/**
 * Definición completa de un plan: qué incluye y cuánto deja hacer.
 * El nombre comercial vive aquí para que la interfaz no lo reinvente.
 */
public record PlanDefinition(
        PlanCode code,
        String displayName,
        Set<Feature> features,
        PlanLimits limits
) {
    public PlanDefinition {
        features = Set.copyOf(features); // inmutable
    }
}
