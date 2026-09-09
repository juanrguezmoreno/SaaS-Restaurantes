package com.restaurante.subscription.enums;

/**
 * Estados de una suscripción, con la misma nomenclatura que la API de Stripe.
 *
 * INCOMPLETE_EXPIRED no estaba en la especificación original, pero Stripe lo
 * emite: sin él, un webhook real no mapearía y romperíamos la idempotencia.
 */
public enum SubscriptionStatus {

    TRIALING(true),
    ACTIVE(true),
    /**
     * Pago fallido. Conserva el acceso a propósito: casi siempre es una tarjeta
     * caducada, y cortar el servicio dejaría tirados a los clientes finales del
     * restaurante mientras Stripe reintenta el cobro.
     */
    PAST_DUE(true),
    CANCELED(false),
    UNPAID(false),
    INCOMPLETE(false),
    INCOMPLETE_EXPIRED(false);

    private final boolean grantsAccess;

    SubscriptionStatus(boolean grantsAccess) {
        this.grantsAccess = grantsAccess;
    }

    /** ¿Este estado da derecho a las features y los límites del plan? */
    public boolean grantsAccess() {
        return grantsAccess;
    }

    /** ¿La página pública de reservas (QR) sigue aceptando solicitudes? */
    public boolean allowsPublicBooking() {
        return grantsAccess;
    }

    /**
     * Mapea el status textual de Stripe. Un valor desconocido cae en INCOMPLETE:
     * ante la duda, nunca se concede acceso.
     */
    public static SubscriptionStatus fromStripe(String stripeStatus) {
        if (stripeStatus == null) {
            return INCOMPLETE;
        }
        try {
            return valueOf(stripeStatus.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return INCOMPLETE;
        }
    }
}
