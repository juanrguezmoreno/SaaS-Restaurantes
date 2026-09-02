package com.restaurante.common.exception;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.subscription.stripe.StripeOperationException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.HttpStatusCode;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.lang.NonNull;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.context.request.WebRequest;
import org.springframework.web.servlet.mvc.method.annotation.ResponseEntityExceptionHandler;

import java.util.HashMap;
import java.util.Map;

@RestControllerAdvice
public class GlobalExceptionHandler extends ResponseEntityExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleResourceNotFoundException(ResourceNotFoundException ex) {
        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(BadRequestException.class)
    public ResponseEntity<ApiResponse<Void>> handleBadRequestException(BadRequestException ex) {
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(DuplicateResourceException.class)
    public ResponseEntity<ApiResponse<Void>> handleDuplicateResourceException(DuplicateResourceException ex) {
        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(ConflictException.class)
    public ResponseEntity<ApiResponse<Void>> handleConflictException(ConflictException ex) {
        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(AccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> handleAccessDeniedException(AccessDeniedException ex) {
        return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(ex.getMessage()));
    }

    @ExceptionHandler(org.springframework.security.access.AccessDeniedException.class)
    public ResponseEntity<ApiResponse<Void>> handleSpringSecurityAccessDeniedException(
            org.springframework.security.access.AccessDeniedException ex) {
        return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error("No tiene permisos para realizar esta operación."));
    }

    @Override
    protected ResponseEntity<Object> handleMethodArgumentNotValid(
            MethodArgumentNotValidException ex,
            @NonNull HttpHeaders headers,
            @NonNull HttpStatusCode status,
            @NonNull WebRequest request) {

        Map<String, String> errors = new HashMap<>();
        ex.getBindingResult().getAllErrors().forEach(error -> {
            String fieldName = ((FieldError) error).getField();
            String errorMessage = error.getDefaultMessage();
            errors.put(fieldName, errorMessage);
        });

        ApiResponse<Map<String, String>> response = ApiResponse.<Map<String, String>>builder()
                .success(false)
                .message("Error de validación")
                .data(errors)
                .build();

        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(response);
    }

    @Override
    protected ResponseEntity<Object> handleHttpMessageNotReadable(
            HttpMessageNotReadableException ex,
            @NonNull HttpHeaders headers,
            @NonNull HttpStatusCode status,
            @NonNull WebRequest request) {

        log.error("Error de deserialización JSON: {}", ex.getMessage(), ex);

        String mensaje = "Error al leer la solicitud: formato JSON inválido";
        if (ex.getCause() != null) {
            mensaje += " — " + ex.getCause().getMessage();
        }

        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(mensaje));
    }

    /**
     * API-02: un fallo de autenticación (credenciales incorrectas, usuario
     * deshabilitado, etc.) debe devolver 401, no caer en el handler genérico
     * (que lo convertía en 500). Se usa un mensaje uniforme para no revelar si
     * falló el usuario o la contraseña.
     */
    @ExceptionHandler(org.springframework.security.core.AuthenticationException.class)
    public ResponseEntity<ApiResponse<Void>> handleAuthenticationException(
            org.springframework.security.core.AuthenticationException ex) {
        log.info("Autenticación fallida: {}", ex.getMessage());
        return ResponseEntity
                .status(HttpStatus.UNAUTHORIZED)
                .body(ApiResponse.error("Credenciales incorrectas"));
    }

    /**
     * RES-03: red de seguridad ante condiciones de carrera. Si dos peticiones
     * simultáneas superan la validación de solape del servicio, el índice único
     * uk_reservations_active_slot (V4) rechaza la segunda inserción; se traduce
     * a 409 en lugar de caer en el handler genérico (500).
     */
    @ExceptionHandler(org.springframework.dao.DataIntegrityViolationException.class)
    public ResponseEntity<ApiResponse<Void>> handleDataIntegrityViolation(
            org.springframework.dao.DataIntegrityViolationException ex) {
        String causa = ex.getMostSpecificCause() != null ? ex.getMostSpecificCause().getMessage() : "";
        String mensaje = causa != null && causa.contains("uk_reservations_active_slot")
                ? "La mesa ya tiene una reserva en ese horario"
                : "La operación entra en conflicto con datos existentes";
        log.warn("Violación de integridad de datos: {}", causa);
        return ResponseEntity
                .status(HttpStatus.CONFLICT)
                .body(ApiResponse.error(mensaje));
    }

    @ExceptionHandler(InvalidWebhookSignatureException.class)
    public ResponseEntity<ApiResponse<Void>> handleInvalidWebhookSignature(
            InvalidWebhookSignatureException ex) {
        // 400 a propósito: Stripe NO reintenta los 4xx, y una firma inválida no
        // mejora reintentándola. Se registra como incidencia de seguridad.
        log.warn("[Seguridad] Webhook de Stripe rechazado: {}", ex.getMessage());
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(InvalidWebhookSignatureException.CODE, "Firma inválida"));
    }

    /**
     * El plan del tenant no incluye la función. Se devuelve 403 con código para
     * que el frontend abra el diálogo de mejora de plan en lugar de un error
     * genérico. El mensaje nunca revela datos de facturación.
     */
    @ExceptionHandler(PlanUpgradeRequiredException.class)
    public ResponseEntity<ApiResponse<Map<String, Object>>> handlePlanUpgradeRequired(
            PlanUpgradeRequiredException ex) {
        Map<String, Object> detalle = new HashMap<>();
        detalle.put("feature", ex.getFeature().name());
        detalle.put("requiredPlan", ex.getRequiredPlan().name());
        return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(
                        PlanUpgradeRequiredException.CODE, ex.getMessage(), detalle));
    }

    @ExceptionHandler(PlanLimitReachedException.class)
    public ResponseEntity<ApiResponse<Map<String, Object>>> handlePlanLimitReached(
            PlanLimitReachedException ex) {
        Map<String, Object> detalle = new HashMap<>();
        detalle.put("resource", ex.getResource().name());
        detalle.put("limit", ex.getLimit());
        detalle.put("current", ex.getCurrent());
        detalle.put("requiredPlan", ex.getRequiredPlan().name());
        return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(
                        PlanLimitReachedException.CODE, ex.getMessage(), detalle));
    }

    @ExceptionHandler(RateLimitExceededException.class)
    public ResponseEntity<ApiResponse<Void>> handleRateLimitExceededException(RateLimitExceededException ex) {
        return ResponseEntity
                .status(HttpStatus.TOO_MANY_REQUESTS)
                .body(ApiResponse.error(ex.getMessage()));
    }

    /**
     * Fallo al hablar con Stripe (red, timeout, respuesta de error de la API).
     * Se traduce a 502: el problema es del proveedor de pago, no de la petición.
     */
    @ExceptionHandler(StripeOperationException.class)
    public ResponseEntity<ApiResponse<Void>> handleStripeOperation(
            StripeOperationException ex) {
        // El detalle va al log, no a la respuesta: puede contener identificadores
        // internos de Stripe que no deben salir al cliente.
        log.error("Error al operar con Stripe: {}", ex.getMessage(), ex);
        return ResponseEntity
                .status(HttpStatus.BAD_GATEWAY)
                .body(ApiResponse.error("BILLING_PROVIDER_ERROR",
                        "No se pudo completar la operación de pago. Inténtalo de nuevo."));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleGlobalException(Exception ex) {
        log.error("Error no manejado: {}", ex.getMessage(), ex);
        return ResponseEntity
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error("Error interno del servidor. Si el problema persiste, contacta con soporte."));
    }
}
