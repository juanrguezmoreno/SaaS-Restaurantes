package com.restaurante.common.exception;

import com.restaurante.common.dto.ApiResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.AuthenticationException;

import static org.junit.jupiter.api.Assertions.*;

class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    // API-02: un fallo de autenticación debe traducirse a 401, no a 500.
    @Test
    void authenticationException_devuelve401ConMensajeClaro() {
        AuthenticationException ex = new BadCredentialsException("Bad credentials");

        ResponseEntity<ApiResponse<Void>> response = handler.handleAuthenticationException(ex);

        assertEquals(HttpStatus.UNAUTHORIZED, response.getStatusCode());
        assertNotNull(response.getBody());
        assertFalse(response.getBody().isSuccess());
        assertEquals("Credenciales incorrectas", response.getBody().getMessage());
    }

    // RES-03: la excepción de conflicto se mapea a 409.
    @Test
    void conflictException_devuelve409() {
        ResponseEntity<ApiResponse<Void>> response =
                handler.handleConflictException(new ConflictException("Mesa ocupada"));

        assertEquals(HttpStatus.CONFLICT, response.getStatusCode());
        assertEquals("Mesa ocupada", response.getBody().getMessage());
    }
}
