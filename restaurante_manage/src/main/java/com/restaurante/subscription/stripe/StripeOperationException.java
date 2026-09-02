package com.restaurante.subscription.stripe;

/** Fallo al hablar con Stripe. Se traduce a 502 en el manejador global. */
public class StripeOperationException extends RuntimeException {
    public StripeOperationException(String message, Throwable cause) {
        super(message, cause);
    }
}
