package com.restaurante.subscription.dto;

import java.time.LocalDateTime;

/**
 * Estado de facturación del tenant. Sólo para ADMIN y SUPER_ADMIN.
 * No incluye identificadores de Stripe: al cliente le basta con saber si su
 * suscripción está enlazada, no con qué id.
 */
public record SubscriptionResponse(
        String plan,
        String planName,
        String status,
        LocalDateTime currentPeriodEnd,
        LocalDateTime trialEnd,
        boolean cancelAtPeriodEnd,
        boolean legacyGrant,
        boolean stripeLinked
) {}
