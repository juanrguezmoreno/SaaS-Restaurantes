package com.restaurante.common.exception;

import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.ResponseStatus;

/**
 * Se lanza cuando una operación entra en conflicto con el estado actual del
 * recurso (HTTP 409). Ej.: dos reservas activas para la misma mesa, fecha y hora.
 */
@ResponseStatus(HttpStatus.CONFLICT)
public class ConflictException extends RuntimeException {

    public ConflictException(String message) {
        super(message);
    }
}
