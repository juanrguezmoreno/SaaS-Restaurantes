package com.restaurante.subscription.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.common.util.Constants;
import com.restaurante.subscription.dto.*;
import com.restaurante.subscription.enums.Resource;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.subscription.service.EffectiveSubscription;
import com.restaurante.subscription.service.EntitlementService;
import com.restaurante.subscription.service.PlanReconciliationService;
import com.restaurante.subscription.service.SubscriptionService;
import com.restaurante.subscription.stripe.StripeProperties;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Facturación y suscripción del tenant del usuario autenticado.
 *
 * El tenant NUNCA llega por parámetro ni por cuerpo: siempre sale del token, a
 * través de CurrentUserService. Aceptarlo del cliente sería permitir consultar y
 * modificar la suscripción de otra empresa.
 */
@RestController
@RequestMapping(Constants.BILLING_PATH)
@RequiredArgsConstructor
@Tag(name = "Facturación", description = "Planes, suscripción y pagos del inquilino")
public class BillingController {

    private final EntitlementService entitlementService;
    private final SubscriptionRepository subscriptionRepository;
    private final CurrentUserService currentUserService;
    private final StripeProperties stripeProperties;
    private final SubscriptionService subscriptionService;
    private final PlanReconciliationService planReconciliationService;

    @GetMapping(Constants.BILLING_PLANS_SUBPATH)
    @Operation(summary = "Catálogo de planes disponibles")
    public ResponseEntity<ApiResponse<List<PlanResponse>>> plans() {
        return ResponseEntity.ok(ApiResponse.success(SubscriptionMapper.toPlanList()));
    }

    /**
     * Lo que el tenant tiene contratado. Accesible a cualquier rol autenticado:
     * la interfaz lo necesita para decidir qué pinta bloqueado. No expone ningún
     * dato de facturación.
     */
    @GetMapping(Constants.BILLING_ENTITLEMENTS_SUBPATH)
    @Operation(summary = "Funcionalidades y límites del inquilino actual")
    public ResponseEntity<ApiResponse<EntitlementsResponse>> entitlements() {
        Long tenantId = currentUserService.getCurrentTenantId();
        EffectiveSubscription efectiva = entitlementService.resolve(tenantId);

        Map<String, Long> uso = new HashMap<>();
        uso.put(Resource.RESTAURANT.name(),
                entitlementService.currentUsage(tenantId, Resource.RESTAURANT));
        uso.put(Resource.USER_ACCOUNT.name(),
                entitlementService.currentUsage(tenantId, Resource.USER_ACCOUNT));

        return ResponseEntity.ok(ApiResponse.success(
                SubscriptionMapper.toEntitlements(efectiva, uso, stripeProperties.isEnabled())));
    }

    /**
     * Estado de facturación. Restringido a ADMIN y SUPER_ADMIN: un empleado no
     * tiene por qué saber si su empresa tiene un pago pendiente.
     */
    @GetMapping(Constants.BILLING_SUBSCRIPTION_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Estado de la suscripción del inquilino")
    public ResponseEntity<ApiResponse<SubscriptionResponse>> subscription() {
        Long tenantId = currentUserService.getCurrentTenantId();
        return ResponseEntity.ok(ApiResponse.success(
                subscriptionRepository.findByTenantIdAndDeletedFalse(tenantId)
                        .map(SubscriptionMapper::toResponse)
                        .orElseGet(SubscriptionMapper::empty)));
    }

    @PostMapping(Constants.BILLING_CHECKOUT_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Iniciar la contratación de un plan")
    public ResponseEntity<ApiResponse<BillingSessionResponse>> checkout(
            @Valid @RequestBody CheckoutRequest request) {
        String url = subscriptionService.createCheckoutSession(request.getPlanCode());
        return ResponseEntity.ok(ApiResponse.success(new BillingSessionResponse(url)));
    }

    @PostMapping(Constants.BILLING_PORTAL_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Abrir el portal de cliente de Stripe")
    public ResponseEntity<ApiResponse<BillingSessionResponse>> portal() {
        return ResponseEntity.ok(ApiResponse.success(
                new BillingSessionResponse(subscriptionService.createPortalSession())));
    }

    @PostMapping(Constants.BILLING_CHANGE_PLAN_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Cambiar de plan")
    public ResponseEntity<ApiResponse<SubscriptionResponse>> changePlan(
            @Valid @RequestBody CheckoutRequest request) {
        return ResponseEntity.ok(ApiResponse.success(
                "Plan actualizado", subscriptionService.changePlan(request.getPlanCode())));
    }

    @PostMapping(Constants.BILLING_CANCEL_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Cancelar la suscripción")
    public ResponseEntity<ApiResponse<SubscriptionResponse>> cancel(
            @RequestBody(required = false) CancelSubscriptionRequest request) {
        boolean alFinalDelPeriodo = request == null || request.isAtPeriodEnd();
        return ResponseEntity.ok(ApiResponse.success(
                "Suscripción cancelada", subscriptionService.cancel(alFinalDelPeriodo)));
    }

    @PostMapping(Constants.BILLING_REACTIVATE_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Deshacer una cancelación programada")
    public ResponseEntity<ApiResponse<SubscriptionResponse>> reactivate() {
        return ResponseEntity.ok(ApiResponse.success(
                "Suscripción reactivada", subscriptionService.reactivate()));
    }

    @PostMapping(Constants.BILLING_ACTIVE_RESTAURANT_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Elegir qué local queda operativo con el plan actual")
    public ResponseEntity<ApiResponse<Void>> activeRestaurant(
            @Valid @RequestBody ActiveRestaurantRequest request) {
        planReconciliationService.chooseActiveRestaurant(
                currentUserService.getCurrentTenantId(), request.getRestaurantId());
        return ResponseEntity.ok(ApiResponse.success("Local activo actualizado", null));
    }
}
