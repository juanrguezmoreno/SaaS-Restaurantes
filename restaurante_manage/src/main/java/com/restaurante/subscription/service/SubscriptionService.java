package com.restaurante.subscription.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.subscription.dto.SubscriptionMapper;
import com.restaurante.subscription.dto.SubscriptionResponse;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.subscription.stripe.StripeGateway;
import com.restaurante.subscription.stripe.StripeProperties;
import com.restaurante.subscription.stripe.StripeSubscriptionSnapshot;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.entity.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * Ciclo de vida de la suscripción de un tenant.
 *
 * Regla que gobierna toda la clase: el estado y el plan guardados sólo cambian a
 * partir de lo que dice Stripe (una instantánea devuelta por la API, o un
 * webhook firmado). Nunca a partir de lo que pide el cliente.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubscriptionService {

    private final SubscriptionRepository subscriptionRepository;
    private final TenantRepository tenantRepository;
    private final CurrentUserService currentUserService;
    private final StripeGateway stripeGateway;
    private final StripeProperties stripeProperties;
    private final PlanReconciliationService planReconciliationService;

    @Value("${app.frontend.base-url}")
    private String frontendBaseUrl;

    /** Suscripción del tenant del usuario actual, creándola vacía si no existe. */
    @Transactional
    public Subscription currentSubscription() {
        Long tenantId = requireTenantId();
        return subscriptionRepository.findByTenantIdAndDeletedFalse(tenantId)
                .orElseGet(() -> crearSuscripcionInicial(tenantId));
    }

    private Long requireTenantId() {
        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId == null) {
            // El SUPER_ADMIN es el dueño del SaaS: no tiene inquilino ni suscripción.
            throw new BadRequestException(currentUserService.isSuperAdmin()
                    ? "El superadministrador no tiene una suscripción propia"
                    : "Tu usuario no está asociado a ningún inquilino");
        }
        return tenantId;
    }

    private Subscription crearSuscripcionInicial(Long tenantId) {
        Tenant tenant = tenantRepository.findByIdAndDeletedFalse(tenantId)
                .orElseThrow(() -> new BadRequestException("El inquilino no existe"));
        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(PlanCode.NORMAL);
        // INCOMPLETE: sin acceso hasta que Stripe confirme un pago.
        suscripcion.setStatus(SubscriptionStatus.INCOMPLETE);
        return subscriptionRepository.save(suscripcion);
    }

    private void requireBillingConfigured() {
        if (!stripeProperties.isEnabled()) {
            throw new BadRequestException(
                    "La facturación no está configurada en este entorno");
        }
    }

    @Transactional
    public String createCheckoutSession(PlanCode planCode) {
        requireBillingConfigured();
        Subscription suscripcion = currentSubscription();

        if (suscripcion.getStripeCustomerId() == null) {
            User usuario = currentUserService.getCurrentUser();
            String customerId = stripeGateway.createCustomer(
                    suscripcion.getTenant().getId(),
                    suscripcion.getTenant().getName(),
                    usuario.getEmail());
            suscripcion.setStripeCustomerId(customerId);
            subscriptionRepository.save(suscripcion);
        }

        // El precio SIEMPRE se resuelve aquí, nunca llega del cliente.
        String priceId = stripeProperties.priceIdFor(planCode);
        int diasPrueba = suscripcion.getTrialEnd() == null ? stripeProperties.getTrialDays() : 0;

        return stripeGateway.createCheckoutSession(
                suscripcion.getStripeCustomerId(),
                suscripcion.getTenant().getId(),
                priceId,
                diasPrueba,
                frontendBaseUrl + "/settings/billing?checkout=success",
                frontendBaseUrl + "/settings/billing?checkout=cancel");
    }

    @Transactional(readOnly = true)
    public String createPortalSession() {
        requireBillingConfigured();
        Subscription suscripcion = subscriptionRepository
                .findByTenantIdAndDeletedFalse(requireTenantId())
                .orElseThrow(() -> new BadRequestException("Todavía no tienes una suscripción"));

        if (suscripcion.getStripeCustomerId() == null) {
            throw new BadRequestException(
                    "Todavía no tienes un método de pago registrado. Contrata un plan primero.");
        }
        return stripeGateway.createPortalSession(
                suscripcion.getStripeCustomerId(), frontendBaseUrl + "/settings/billing");
    }

    @Transactional
    public SubscriptionResponse changePlan(PlanCode nuevoPlan) {
        requireBillingConfigured();
        Subscription suscripcion = currentSubscription();

        if (suscripcion.getStripeSubscriptionId() == null) {
            throw new BadRequestException(
                    "No tienes una suscripción activa que cambiar. Contrata un plan primero.");
        }
        if (nuevoPlan == suscripcion.getPlanCode()) {
            throw new BadRequestException("Ya tienes contratado ese plan");
        }

        StripeSubscriptionSnapshot instantanea = stripeGateway.updateSubscriptionPrice(
                suscripcion.getStripeSubscriptionId(), stripeProperties.priceIdFor(nuevoPlan));
        applySnapshot(suscripcion, instantanea, LocalDateTime.now());
        Subscription guardada = subscriptionRepository.save(suscripcion);
        // El plan acaba de cambiar: ajustar qué locales quedan operativos.
        // Nunca borra datos, sólo alterna activeUnderPlan.
        planReconciliationService.reconcile(guardada.getTenant().getId());
        return SubscriptionMapper.toResponse(guardada);
    }

    @Transactional
    public SubscriptionResponse cancel(boolean atPeriodEnd) {
        requireBillingConfigured();
        Subscription suscripcion = currentSubscription();

        if (suscripcion.getStripeSubscriptionId() == null) {
            throw new BadRequestException("No tienes una suscripción activa que cancelar");
        }

        StripeSubscriptionSnapshot instantanea = stripeGateway.cancelSubscription(
                suscripcion.getStripeSubscriptionId(), atPeriodEnd);
        applySnapshot(suscripcion, instantanea, LocalDateTime.now());
        Subscription guardada = subscriptionRepository.save(suscripcion);
        // El plan acaba de cambiar: ajustar qué locales quedan operativos.
        // Nunca borra datos, sólo alterna activeUnderPlan.
        planReconciliationService.reconcile(guardada.getTenant().getId());
        return SubscriptionMapper.toResponse(guardada);
    }

    @Transactional
    public SubscriptionResponse reactivate() {
        requireBillingConfigured();
        Subscription suscripcion = currentSubscription();

        if (suscripcion.getStripeSubscriptionId() == null) {
            throw new BadRequestException("No tienes una suscripción que reactivar");
        }
        if (!suscripcion.isCancelAtPeriodEnd()) {
            throw new BadRequestException("Tu suscripción no está pendiente de cancelación");
        }

        StripeSubscriptionSnapshot instantanea =
                stripeGateway.reactivateSubscription(suscripcion.getStripeSubscriptionId());
        applySnapshot(suscripcion, instantanea, LocalDateTime.now());
        Subscription guardada = subscriptionRepository.save(suscripcion);
        // El plan acaba de cambiar: ajustar qué locales quedan operativos.
        // Nunca borra datos, sólo alterna activeUnderPlan.
        planReconciliationService.reconcile(guardada.getTenant().getId());
        return SubscriptionMapper.toResponse(guardada);
    }

    /**
     * Vuelca en la entidad lo que Stripe dice que es verdad.
     *
     * El plan se deduce del precio: si el precio no está en la configuración, el
     * plan NO se toca. Es preferible conservar el último plan conocido a adivinar
     * uno y conceder o quitar acceso por error.
     *
     * eventoEn permite descartar eventos fuera de orden (Stripe no garantiza el
     * orden de entrega). Los llamadores de la API pasan LocalDateTime.now().
     */
    public void applySnapshot(Subscription suscripcion,
                              StripeSubscriptionSnapshot instantanea,
                              LocalDateTime eventoEn) {
        if (instantanea == null) {
            return;
        }

        suscripcion.setStripeSubscriptionId(instantanea.subscriptionId());
        if (instantanea.customerId() != null) {
            suscripcion.setStripeCustomerId(instantanea.customerId());
        }
        if (instantanea.priceId() != null) {
            suscripcion.setStripePriceId(instantanea.priceId());
            stripeProperties.planForPrice(instantanea.priceId())
                    .ifPresentOrElse(
                            suscripcion::setPlanCode,
                            () -> log.warn("Precio desconocido {} en la suscripción {}:"
                                            + " se conserva el plan {}",
                                    instantanea.priceId(), instantanea.subscriptionId(),
                                    suscripcion.getPlanCode()));
        }
        suscripcion.setStatus(SubscriptionStatus.fromStripe(instantanea.status()));
        suscripcion.setCurrentPeriodStart(aFechaLocal(instantanea.currentPeriodStart()));
        suscripcion.setCurrentPeriodEnd(aFechaLocal(instantanea.currentPeriodEnd()));
        suscripcion.setTrialEnd(aFechaLocal(instantanea.trialEnd()));
        suscripcion.setCancelAtPeriodEnd(instantanea.cancelAtPeriodEnd());
        suscripcion.setLastStripeEventAt(eventoEn);
        // Al entrar en el circuito de cobro real, deja de ser una concesión.
        suscripcion.setLegacyGrant(false);
    }

    private LocalDateTime aFechaLocal(Long epocaEnSegundos) {
        if (epocaEnSegundos == null || epocaEnSegundos == 0L) {
            return null;
        }
        return LocalDateTime.ofInstant(
                Instant.ofEpochSecond(epocaEnSegundos), ZoneId.systemDefault());
    }
}
