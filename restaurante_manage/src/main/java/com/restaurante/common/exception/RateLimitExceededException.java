package com.restaurante.common.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Se lanza cuando un cliente supera el límite de solicitudes permitido
 * (HTTP 429). Ej.: demasiadas solicitudes de reserva pública desde la misma IP.
 */
@ResponseStatus(HttpStatus.TOO_MANY_REQUESTS)
public class RateLimitExceededException extends RuntimeException {

    public RateLimitExceededException(String message) {
        super(message);
    }
}
