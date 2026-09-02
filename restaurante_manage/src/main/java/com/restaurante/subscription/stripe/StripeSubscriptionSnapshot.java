package com.restaurante.subscription.stripe;

/**
 * Foto del estado de una suscripción en Stripe, sin tipos de la librería, para
 * que el resto del sistema no dependa de stripe-java.
 *
 * Las marcas de tiempo son épocas en SEGUNDOS, tal y como las devuelve Stripe.
 */
public record StripeSubscriptionSnapshot(
        String subscriptionId,
        String customerId,
        String priceId,
        String status,
        Long currentPeriodStart,
        Long currentPeriodEnd,
        Long trialEnd,
        boolean cancelAtPeriodEnd
) {}
