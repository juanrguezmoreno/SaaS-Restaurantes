package com.restaurante.auth.controller;

import com.restaurante.auth.dto.ForgotPasswordRequest;
import com.restaurante.auth.dto.JwtResponse;
import com.restaurante.auth.dto.LoginRequest;
import com.restaurante.auth.dto.RegisterRequest;
import com.restaurante.auth.dto.ResetPasswordRequest;
import com.restaurante.auth.service.AuthService;
import com.restaurante.auth.service.PasswordResetService;
import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping(Constants.AUTH_PATH)
@RequiredArgsConstructor
@Tag(name = "Autenticación", description = "Inicio de sesión público y registro de usuarios (solo administradores)")
public class AuthController {

    private final AuthService authService;
    private final PasswordResetService passwordResetService;

    @PostMapping("/login")
    @Operation(summary = "Iniciar sesión", description = "Autentica un usuario y devuelve un token JWT")
    public ResponseEntity<ApiResponse<JwtResponse>> login(@Valid @RequestBody LoginRequest request) {
        JwtResponse response = authService.login(request);
        return ResponseEntity.ok(ApiResponse.success("Inicio de sesión exitoso", response));
    }

    @PostMapping("/register")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Registrar usuario", description = "Registra un nuevo usuario dentro del tenant del administrador autenticado")
    public ResponseEntity<ApiResponse<JwtResponse>> register(@Valid @RequestBody RegisterRequest request) {
        JwtResponse response = authService.register(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success("Registro exitoso", response));
    }

    @PostMapping("/forgot-password")
    @Operation(summary = "Solicitar recuperación de contraseña",
            description = "Envía un email con un enlace de recuperación si existe una cuenta asociada al email. "
                    + "Responde siempre igual, exista o no la cuenta, para no revelar qué emails están registrados.")
    public ResponseEntity<ApiResponse<Void>> forgotPassword(@Valid @RequestBody ForgotPasswordRequest request) {
        passwordResetService.requestReset(request.getEmail());
        return ResponseEntity.ok(ApiResponse.success(
                "Si existe una cuenta asociada a este correo, recibirás instrucciones.", null));
    }

    @PostMapping("/reset-password")
    @Operation(summary = "Restablecer contraseña",
            description = "Valida el token de recuperación (de un solo uso) y actualiza la contraseña del usuario.")
    public ResponseEntity<ApiResponse<Void>> resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        passwordResetService.resetPassword(request.getToken(), request.getNewPassword());
        return ResponseEntity.ok(ApiResponse.success("Contraseña actualizada correctamente", null));
    }
}
