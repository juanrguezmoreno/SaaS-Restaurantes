package com.restaurante.common.exception;

/**
 * La firma de un webhook de Stripe no valida, o no se puede verificar porque el
 * secreto del endpoint no está configurado.
 *
 * Es una incidencia de seguridad, no un error de negocio: quien la provoca está
 * intentando cambiar el estado de pago de un inquilino sin ser Stripe.
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
