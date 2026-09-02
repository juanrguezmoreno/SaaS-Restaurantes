package com.restaurante.subscription.stripe;

/**
 * Única puerta de salida hacia Stripe. Todo lo demás del sistema habla con esta
 * interfaz, nunca con la librería directamente: así los tests usan la
 * implementación falsa y no se hace ni una llamada de red ni un cobro real.
 */
public interface StripeGateway {

    /** Crea el cliente en Stripe con el tenant en metadata. Devuelve su id. */
    String createCustomer(Long tenantId, String tenantName, String email);

    /** Crea la sesión de pago alojada. Devuelve la URL a la que redirigir. */
    String createCheckoutSession(String customerId, Long tenantId, String priceId,
                                 Integer trialDays, String successUrl, String cancelUrl);

    /** Crea la sesión del portal de cliente. Devuelve la URL. */
    String createPortalSession(String customerId, String returnUrl);

    /** Cambia el precio (el plan) de una suscripción viva, con prorrateo. */
    StripeSubscriptionSnapshot updateSubscriptionPrice(String subscriptionId, String newPriceId);

    /** Cancela: al final del periodo, o de inmediato si atPeriodEnd es false. */
    StripeSubscriptionSnapshot cancelSubscription(String subscriptionId, boolean atPeriodEnd);

    /** Deshace una cancelación programada. */
    StripeSubscriptionSnapshot reactivateSubscription(String subscriptionId);

    /** Relee la suscripción desde Stripe. Se usa para reconciliar. */
    StripeSubscriptionSnapshot fetchSubscription(String subscriptionId);
}
