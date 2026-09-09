package com.restaurante.subscription.dto;

import com.restaurante.subscription.catalog.PlanCatalog;
import com.restaurante.subscription.catalog.PlanDefinition;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.service.EffectiveSubscription;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

public final class SubscriptionMapper {

    private SubscriptionMapper() {
        throw new UnsupportedOperationException("Clase de utilidad, no instanciable");
    }

    public static List<PlanResponse> toPlanList() {
        return PlanCatalog.all().values().stream()
                .map(SubscriptionMapper::toPlanResponse)
                .sorted((a, b) -> a.code().compareTo(b.code()))
                .toList();
    }

    private static PlanResponse toPlanResponse(PlanDefinition definicion) {
        return new PlanResponse(
                definicion.code().name(),
                definicion.displayName(),
                definicion.features().stream().map(Feature::name).collect(Collectors.toSet()),
                definicion.limits().maxRestaurants(),
                definicion.limits().maxUserAccounts()
        );
    }

    public static EntitlementsResponse toEntitlements(EffectiveSubscription efectiva,
                                                      Map<String, Long> uso,
                                                      boolean billingConfigured) {
        Map<String, Object> limites = new HashMap<>();
        limites.put("maxRestaurants", efectiva.limits().maxRestaurants());
        limites.put("maxUserAccounts", efectiva.limits().maxUserAccounts());

        return new EntitlementsResponse(
                efectiva.plan() != null ? efectiva.plan().name() : null,
                efectiva.hasAccess(),
                efectiva.status() != null ? efectiva.status().name() : null,
                efectiva.features().stream().map(Feature::name).collect(Collectors.toSet()),
                limites,
                uso,
                billingConfigured
        );
    }

    public static SubscriptionResponse toResponse(Subscription suscripcion) {
        PlanCode plan = suscripcion.getPlanCode();
        return new SubscriptionResponse(
                plan != null ? plan.name() : null,
                plan != null ? PlanCatalog.get(plan).displayName() : null,
                suscripcion.getStatus() != null ? suscripcion.getStatus().name() : null,
                suscripcion.getCurrentPeriodEnd(),
                suscripcion.getTrialEnd(),
                suscripcion.isCancelAtPeriodEnd(),
                suscripcion.isLegacyGrant(),
                suscripcion.getStripeSubscriptionId() != null
        );
    }

    /** Tenant sin suscripción: se responde con un estado vacío, no con un 404. */
    public static SubscriptionResponse empty() {
        return new SubscriptionResponse(null, null, null, null, null, false, false, false);
    }
}
