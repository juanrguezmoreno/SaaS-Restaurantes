package com.restaurante.notification.event;

/**
 * Snapshot inmutable de los datos necesarios para el email de recuperación
 * de contraseña. El enlace ya viene resuelto (incluye el token en claro):
 * el listener no debe conocer cómo se construye.
 */
public record PasswordResetEmailData(
        String userEmail,
        String userName,
        String resetLink,
        long expirationMinutes
) {
}
