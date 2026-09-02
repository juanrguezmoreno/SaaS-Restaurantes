package com.restaurante.subscription.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.subscription.catalog.PlanLimits;
import com.restaurante.subscription.enums.Resource;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Ajusta los locales de un tenant a los límites de su plan actual.
 *
 * PRINCIPIO INNEGOCIABLE: esta clase nunca borra, nunca marca como eliminado y
 * nunca desactiva cuentas de usuario. Lo único que toca es activeUnderPlan, que
 * es reversible: al recuperar el plan, todo vuelve exactamente como estaba.
 *
 * Criterio de desempate: se conservan activos los locales MÁS ANTIGUOS (menor
 * id). Es determinista y previsible, y el usuario puede cambiarlo después con
 * chooseActiveRestaurant.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PlanReconciliationService {

    private final RestaurantRepository restaurantRepository;
    private final EntitlementService entitlementService;

    @Transactional
    public void reconcile(Long tenantId) {
        if (tenantId == null) {
            return;
        }

        EffectiveSubscription efectiva = entitlementService.resolve(tenantId);
        List<Restaurant> locales =
                restaurantRepository.findByTenantIdAndDeletedFalseOrderByIdAsc(tenantId);

        // Sin acceso (cancelada, impagada): se bloquea todo, pero no se pierde nada.
        if (!efectiva.hasAccess()) {
            locales.forEach(local -> local.setActiveUnderPlan(false));
            restaurantRepository.saveAll(locales);
            log.info("[Plan] Inquilino {} sin suscripción activa: {} locales en solo lectura",
                    tenantId, locales.size());
            return;
        }

        PlanLimits limites = efectiva.limits();
        if (limites.isUnlimited(Resource.RESTAURANT)) {
            locales.forEach(local -> local.setActiveUnderPlan(true));
            restaurantRepository.saveAll(locales);
            log.info("[Plan] Inquilino {} con plan ilimitado: {} locales activos",
                    tenantId, locales.size());
            return;
        }

        int cupo = limites.limitFor(Resource.RESTAURANT);

        // Se respeta la elección previa del usuario si cabe en el cupo; el resto
        // del cupo se rellena con los locales más antiguos.
        List<Restaurant> yaElegidos = locales.stream()
                .filter(local -> Boolean.TRUE.equals(local.getActiveUnderPlan()))
                .limit(cupo)
                .toList();

        int huecosLibres = cupo - yaElegidos.size();
        List<Restaurant> relleno = locales.stream()
                .filter(local -> !yaElegidos.contains(local))
                .limit(huecosLibres)
                .toList();

        for (Restaurant local : locales) {
            boolean activo = yaElegidos.contains(local) || relleno.contains(local);
            local.setActiveUnderPlan(activo);
        }
        restaurantRepository.saveAll(locales);

        log.info("[Plan] Inquilino {} ajustado a un cupo de {}: {} de {} locales activos."
                        + " Ningún dato eliminado.",
                tenantId, cupo, yaElegidos.size() + relleno.size(), locales.size());
    }

    /**
     * El usuario elige qué local quiere mantener operativo. Sólo reordena dentro
     * del cupo; nunca permite superarlo.
     */
    @Transactional
    public void chooseActiveRestaurant(Long tenantId, Long restaurantId) {
        Restaurant elegido = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new BadRequestException("El local no existe"));

        Long tenantDelLocal = elegido.getTenant() != null ? elegido.getTenant().getId() : null;
        if (tenantId == null || !tenantId.equals(tenantDelLocal)) {
            // Aislamiento entre inquilinos: nunca se toca un local ajeno.
            throw new AccessDeniedException("No tiene permiso para acceder a este local");
        }

        EffectiveSubscription efectiva = entitlementService.resolve(tenantId);
        if (!efectiva.hasAccess()) {
            throw new BadRequestException(
                    "Tu suscripción no está activa; no se pueden activar locales");
        }
        PlanLimits limites = efectiva.limits();
        if (limites.isUnlimited(Resource.RESTAURANT)) {
            return; // con plan ilimitado no hay nada que elegir
        }

        List<Restaurant> locales =
                restaurantRepository.findByTenantIdAndDeletedFalseOrderByIdAsc(tenantId);
        int cupo = limites.limitFor(Resource.RESTAURANT);

        // El elegido primero; el resto del cupo, por antigüedad.
        locales.forEach(local -> local.setActiveUnderPlan(false));
        elegido.setActiveUnderPlan(true);
        locales.stream()
                .filter(local -> !local.getId().equals(restaurantId))
                .limit(Math.max(0, cupo - 1))
                .forEach(local -> local.setActiveUnderPlan(true));

        restaurantRepository.saveAll(locales);
        restaurantRepository.save(elegido);
    }
}
