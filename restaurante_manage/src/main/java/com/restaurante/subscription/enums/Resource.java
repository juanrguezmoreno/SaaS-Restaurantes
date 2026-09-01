package com.restaurante.subscription.enums;

/**
 * Ejes de cuota que un plan puede limitar. Cada uno se cuenta de una forma
 * distinta (ver EntitlementService), por eso son un enum y no un String.
 */
public enum Resource {
    /** Restaurantes vivos y activos bajo el plan. */
    RESTAURANT,
    /** Cuentas de usuario vivas del tenant (no fichas de empleado). */
    USER_ACCOUNT
}
