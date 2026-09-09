package com.restaurante.common.exception;

/**
 * La firma de un webhook de Stripe no valida, o el cuerpo ni siquiera es un
 * evento de Stripe.
 *
 * Es una incidencia de seguridad, no un error de negocio: quien la provoca está
 * intentando cambiar el estado de pago de un inquilino sin ser Stripe. El caso
 * de secreto no configurado NO usa esta excepción, ver
 * {@link WebhookSecretNotConfiguredException}: ahí el problema es nuestro, no
 * del emisor de la petición.
 */
public class InvalidWebhookSignatureException extends RuntimeException {

    public static final String CODE = "INVALID_SIGNATURE";

    public InvalidWebhookSignatureException(String message) {
        super(message);
    }

    public InvalidWebhookSignatureException(String message, Throwable cause) {
        super(message, cause);
    }
}
