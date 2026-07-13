# Recuperación de contraseña — Diseño

**Fecha:** 2026-07-13 · **Estado:** aprobado por Juan

## Objetivo

Permitir a cualquier usuario del panel restablecer su contraseña mediante un enlace
de un solo uso enviado por email, sin revelar si una cuenta existe.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Almacenamiento del token | Tabla `password_reset_tokens` guardando **hash SHA-256**, nunca el token en claro |
| Generación | `SecureRandom` 32 bytes → Base64 URL-safe (~43 chars) |
| Un solo uso | Columna `used_at`; al generar un token nuevo se invalidan los vivos del usuario |
| Expiración | `app.password-reset.token-expiration-minutes` ← `PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES` (default 30) |
| Anti-enumeración | `forgot-password` responde siempre 200 con mensaje neutro; errores de token unificados en un mensaje genérico |
| Email | Evento Spring + listener `@Async` + `EmailService.sendPasswordReset` + plantilla `mail/password-reset.html` |
| Dev sin SMTP | Con `app.mail.enabled=false` el log incluye el enlace completo para completar el flujo localmente |
| Enlace | `{app.frontend.base-url}/reset-password?token=...` ← `FRONTEND_URL` (default `http://localhost:5173`) |

## Backend (paquete `auth`, sin paquete nuevo)

- `auth/entity/PasswordResetToken`: `id`, `tokenHash` (único), `user` (ManyToOne LAZY),
  `expiresAt`, `usedAt`; extiende `BaseEntity`. Migración Flyway **V5** con índice por `token_hash`.
- `auth/repository/PasswordResetTokenRepository`.
- `auth/service/PasswordResetService` (separado de `AuthService`):
  - `requestReset(email)`: usuario por email (`deletedFalse` + `enabled`); si no existe,
    retorno silencioso. Si existe: invalida tokens vivos, crea token, publica
    `PasswordResetRequestedEvent` (snapshot: email, nombre, enlace).
  - `resetPassword(token, newPassword)`: hash del token → busca → valida no usado y no
    expirado → `passwordEncoder.encode` → marca `usedAt`. Cualquier fallo →
    `BadRequestException("El enlace no es válido o ha caducado")`.
- Endpoints en `AuthController` (constantes en `Constants.java`), ambos `permitAll` y en Swagger:
  - `POST /api/v1/auth/forgot-password` `{email}` → siempre 200: «Si existe una cuenta
    asociada a este correo, recibirás instrucciones.»
  - `POST /api/v1/auth/reset-password` `{token, newPassword}` → 200 o 400 genérico.
    Validación de `newPassword`: misma regla que el registro (`@Size(min = 8, max = 100)`).

## Email

`notification/`: `PasswordResetRequestedEvent` (record con snapshot) +
`PasswordResetEmailListener` `@Async @EventListener` (no requiere AFTER_COMMIT: el envío
depende solo del token ya persistido; se mantiene el patrón listener por coherencia).
`EmailService.sendPasswordReset(PasswordResetEmailData)` + plantilla
`resources/mail/password-reset.html` (mismo estilo que las de reserva). Placeholders:
`{{userName}}`, `{{resetLink}}`, `{{expirationMinutes}}`.
Con `app.mail.enabled=false`, el log de omisión incluye el enlace completo.

## Frontend

- `Login.jsx`: enlace «¿Has olvidado tu contraseña?» → `/forgot-password`.
- `ForgotPassword.jsx` (ruta pública): campo email; tras enviar muestra siempre el mensaje neutro.
- `ResetPassword.jsx` (ruta pública, lee `?token=`): nueva contraseña + confirmación
  (coinciden, mínimo 8); éxito → confirmación + botón a login; error → mensaje genérico
  con enlace a `/forgot-password`.
- Llamadas con `publicAxios` (nuevo `src/services/passwordResetService.js`).
- Mismo estilo visual que Login.

## Tests

`PasswordResetServiceTest` (Mockito): genera y persiste hash (no el token), invalida
anteriores, rechaza token inexistente/expirado/usado con el mensaje genérico, actualiza
password con el encoder, email inexistente no lanza ni publica evento.
`EmailServiceTest`: render de la plantilla nueva. Solo tests focalizados.

## Riesgos aceptados (fuera de alcance)

- Sin rate-limiting en `forgot-password` (spam de emails posible).
- Los JWT activos no se invalidan al cambiar la contraseña (stateless; requeriría versionado).
- Sin job de limpieza de tokens caducados (volumen ínfimo).
