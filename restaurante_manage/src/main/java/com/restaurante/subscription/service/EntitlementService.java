package com.restaurante.subscription.service;

import com.restaurante.common.exception.PlanLimitReachedException;
import com.restaurante.common.exception.PlanUpgradeRequiredException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.subscription.catalog.PlanCatalog;
import com.restaurante.subscription.catalog.PlanLimits;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.Resource;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Autoridad única sobre qué puede hacer un tenant según su plan.
 *
 * Es a los planes lo que CurrentUserService es al aislamiento multi-tenant: si
 * añades una funcionalidad de pago, la compruebas aquí y en ningún otro sitio.
 *
 * No se cachea a propósito: son consultas por clave indexada, despreciables
 * frente a las que ya hace la aplicación, y una caché introduciría una ventana
 * en la que un tenant que acaba de pagar sigue viendo su plan viejo.
 */
@Service
@RequiredArgsConstructor
public class EntitlementService {

    private final SubscriptionRepository subscriptionRepository;
    private final CurrentUserService currentUserService;
    private final RestaurantRepository restaurantRepository;
    private final UserRepository userRepository;

    @Transactional(readOnly = true)
    public EffectiveSubscription resolve(Long tenantId) {
        if (tenantId == null) {
            return EffectiveSubscription.none();
        }
        return subscriptionRepository.findByTenantIdAndDeletedFalse(tenantId)
                .map(this::toEffective)
                .orElseGet(EffectiveSubscription::none);
    }

    @Transactional(readOnly = true)
    public EffectiveSubscription resolveForCurrentUser() {
        return resolve(currentUserService.getCurrentTenantId());
    }

    private EffectiveSubscription toEffective(Subscription suscripcion) {
        boolean acceso = suscripcion.getStatus() != null && suscripcion.getStatus().grantsAccess();
        PlanLimits limites = acceso
                ? PlanCatalog.limits(suscripcion.getPlanCode())
                : new PlanLimits(0, 0);
        return new EffectiveSubscription(
                suscripcion.getPlanCode(),
                suscripcion.getStatus(),
                acceso,
                limites,
                suscripcion.isLegacyGrant(),
                suscripcion.getCurrentPeriodEnd(),
                suscripcion.getTrialEnd(),
                suscripcion.isCancelAtPeriodEnd()
        );
    }

    @Transactional(readOnly = true)
    public boolean hasFeature(Long tenantId, Feature feature) {
        return resolve(tenantId).has(feature);
    }

    /**
     * Exige que el tenant del usuario actual tenga la feature contratada.
     * El SUPER_ADMIN es el dueño del SaaS: nunca se le limita.
     */
    @Transactional(readOnly = true)
    public void require(Feature feature) {
        if (currentUserService.isSuperAdmin()) {
            return;
        }
        if (!resolveForCurrentUser().has(feature)) {
            PlanCode minimo = PlanCatalog.minimumPlanFor(feature);
            throw new PlanUpgradeRequiredException(feature, minimo,
                    "Esta función requiere el plan " + PlanCatalog.get(minimo).displayName());
        }
    }

    /**
     * Exige que quede cuota del recurso antes de crear uno nuevo.
     * Se llama ANTES de persistir, nunca después.
     */
    @Transactional(readOnly = true)
    public void requireCapacity(Resource resource) {
        if (currentUserService.isSuperAdmin()) {
            return;
        }
        Long tenantId = currentUserService.getCurrentTenantId();
        PlanLimits limites = resolve(tenantId).limits();

        if (limites.isUnlimited(resource)) {
            return;
        }

        int limite = limites.limitFor(resource);
        long usoActual = currentUsage(tenantId, resource);
        if (usoActual >= limite) {
            throw new PlanLimitReachedException(
                    resource, limite, usoActual, PlanCode.PRO, mensajeDeLimite(resource, limite));
        }
    }

    @Transactional(readOnly = true)
    public long currentUsage(Long tenantId, Resource resource) {
        if (tenantId == null) {
            return 0L;
        }
        return switch (resource) {
            case RESTAURANT -> restaurantRepository.countByTenantIdAndDeletedFalse(tenantId);
            case USER_ACCOUNT -> userRepository.countByTenantIdAndDeletedFalse(tenantId);
        };
    }

    private String mensajeDeLimite(Resource resource, int limite) {
        return switch (resource) {
            case RESTAURANT -> limite == 1
                    ? "Tu plan incluye 1 local"
                    : "Tu plan incluye " + limite + " locales";
            case USER_ACCOUNT -> "Tu plan incluye " + limite + " cuentas de usuario";
        };
    }
}
