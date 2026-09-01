package com.restaurante.subscription.service;

import com.restaurante.subscription.catalog.PlanCatalog;
import com.restaurante.subscription.catalog.PlanLimits;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;

import java.time.LocalDateTime;
import java.util.Set;

/**
 * Vista resuelta de la suscripción de un tenant: el plan y el estado ya
 * combinados en la única pregunta que importa, hasAccess.
 */
public record EffectiveSubscription(
        PlanCode plan,
        SubscriptionStatus status,
        boolean hasAccess,
        PlanLimits limits,
        boolean legacyGrant,
        LocalDateTime currentPeriodEnd,
        LocalDateTime trialEnd,
        boolean cancelAtPeriodEnd
) {

    /** Tenant sin suscripción: sin plan, sin features y sin cuota. */
    public static EffectiveSubscription none() {
        return new EffectiveSubscription(
                null, null, false, new PlanLimits(0, 0), false, null, null, false);
    }

    public Set<Feature> features() {
        if (!hasAccess || plan == null) {
            return Set.of();
        }
        return PlanCatalog.get(plan).features();
    }

    public boolean has(Feature feature) {
        return features().contains(feature);
    }
}
