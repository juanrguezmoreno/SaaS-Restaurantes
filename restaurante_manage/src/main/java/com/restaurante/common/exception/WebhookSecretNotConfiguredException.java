package com.restaurante.common.exception;

/**
 * El endpoint de webhooks de Stripe está activo pero STRIPE_WEBHOOK_SECRET no
 * está configurado, así que no se puede verificar ninguna firma.
 *
 * A diferencia de {@link InvalidWebhookSignatureException}, esto NO es un
 * intento de ataque: la petición de Stripe es perfectamente legítima, el fallo
 * es nuestro (un despliegue incompleto). Se modela aparte para que el handler
 * responda 503 en vez de 400: así Stripe reintenta el evento y, en cuanto se
 * configure el secreto, el estado de pago del inquilino se acaba aplicando en
 * vez de perderse.
 */
public class WebhookSecretNotConfiguredException extends RuntimeException {

    public static final String CODE = "BILLING_NOT_CONFIGURED";

    public WebhookSecretNotConfiguredException(String message) {
        super(message);
    }
}
