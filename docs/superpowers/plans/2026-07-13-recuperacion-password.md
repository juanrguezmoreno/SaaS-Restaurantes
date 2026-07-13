# Recuperación de contraseña — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restablecimiento de contraseña por email con token de un solo uso, hash SHA-256 en BD, expiración configurable y respuesta anti-enumeración.

**Architecture:** Nueva entidad `PasswordResetToken` (Flyway V5) + `PasswordResetService` en el paquete `auth`. El servicio publica `PasswordResetRequestedEvent`; un listener `@Async` delega en `EmailService` (plantilla nueva). Frontend: dos páginas públicas (`/forgot-password`, `/reset-password?token=`) con el estilo de Login.

**Tech Stack:** Spring Boot 3.3 / Java 21, Flyway (MySQL), JUnit 5 + Mockito; React 19 + react-router v7, `publicAxios`.

**Spec:** docs/superpowers/specs/2026-07-13-recuperacion-password-design.md

## Global Constraints

- Español en código, comentarios y textos. **Sin commits ni push** (restricción explícita del usuario para esta sesión).
- Solo tests focalizados (`mvn test -Dtest=...`), nunca la suite completa.
- `forgot-password` responde siempre 200 neutro; errores de `reset-password` unificados en «El enlace no es válido o ha caducado».
- Token: `SecureRandom` 32 bytes → Base64 URL-safe; en BD solo SHA-256 hex. Un solo uso; generar uno nuevo invalida los vivos.
- Expiración: `app.password-reset.token-expiration-minutes` ← `PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES`, default 30.
- Enlace: `{app.frontend.base-url}/reset-password?token=...`; `app.frontend.base-url` ← `FRONTEND_URL`, default `http://localhost:5173`.
- Con `app.mail.enabled=false` el log debe incluir el enlace completo (pruebas locales sin SMTP).
- `newPassword`: `@NotBlank @Size(min = 8, max = 100)` (igual que `RegisterRequest`).
- No tocar `AuthService.login/register` ni el flujo de notificaciones de reserva.

---

## Task 1: Backend — entidad, migración V5 y repositorio

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/auth/entity/PasswordResetToken.java`
- Create: `restaurante_manage/src/main/resources/db/migration/V5__password_reset_tokens.sql`
- Create: `restaurante_manage/src/main/java/com/restaurante/auth/repository/PasswordResetTokenRepository.java`

**Interfaces (produce):**
- Entidad: `tokenHash` (String, único, 64 chars), `user` (ManyToOne LAZY, not null), `expiresAt` (LocalDateTime), `usedAt` (LocalDateTime, null = vivo); extiende `BaseEntity`.
- Repo: `Optional<PasswordResetToken> findByTokenHashAndDeletedFalse(String)`; `List<PasswordResetToken> findByUserIdAndUsedAtIsNullAndDeletedFalse(Long)`.
- V5: tabla `password_reset_tokens` con columnas BaseEntity (`deleted`, `created_at`, `deleted_at`, `updated_at`) + FK a `users` + UNIQUE en `token_hash`, estilo V1 (utf8mb4_unicode_ci).

- [ ] Crear entidad, migración y repositorio. Verificar compilación: `mvn -q compile`.

## Task 2: Backend — evento, listener, plantilla y EmailService

**Files:**
- Create: `notification/event/PasswordResetEmailData.java` — record `(String userEmail, String userName, String resetLink, long expirationMinutes)`.
- Create: `notification/event/PasswordResetRequestedEvent.java` — record de un campo.
- Create: `notification/listener/PasswordResetEmailListener.java` — `@Component`, método `@Async @EventListener` que delega en `emailService.sendPasswordReset(event.data())`.
- Create: `resources/mail/password-reset.html` — mismo estilo que reservation-confirmed (cabecera azul `#0d6efd`), placeholders `{{userName}}`, `{{resetLink}}`, `{{expirationMinutes}}`; botón-enlace + URL en texto plano de respaldo.
- Modify: `notification/service/EmailService.java` — nuevo `sendPasswordReset(PasswordResetEmailData)`; en la rama `mailEnabled=false` de este flujo el log incluye el enlace completo.
- Test: ampliar `EmailServiceTest` con render de la plantilla nueva (placeholders sustituidos) y skip con enlace logueado cuando `enabled=false`.

- [ ] TDD: test primero (`mvn test -Dtest=EmailServiceTest`), implementar, verde.

## Task 3: Backend — PasswordResetService + DTOs + endpoints + config

**Files:**
- Create: `auth/dto/ForgotPasswordRequest.java` — `email` `@NotBlank @Email`.
- Create: `auth/dto/ResetPasswordRequest.java` — `token` `@NotBlank`; `newPassword` `@NotBlank @Size(min=8,max=100)`.
- Create: `auth/service/PasswordResetService.java`:
  - `requestReset(String email)`: `userRepository.findByEmailAndDeletedFalse` + `isEnabled`; si no → return silencioso (log debug). Si sí → marcar `usedAt=now` en tokens vivos, generar token (`SecureRandom`/Base64 URL-safe sin padding), guardar SHA-256 hex, publicar `PasswordResetRequestedEvent` con enlace `frontendBaseUrl + "/reset-password?token=" + token`.
  - `resetPassword(String token, String newPassword)`: hash → `findByTokenHashAndDeletedFalse` → validar `usedAt == null` y `expiresAt` futuro → `user.setPassword(encoder.encode(...))` → `usedAt = now`. Fallos → `BadRequestException("El enlace no es válido o ha caducado")`.
  - Config por constructor: `@Value("${app.password-reset.token-expiration-minutes:30}")`, `@Value("${app.frontend.base-url:http://localhost:5173}")`.
- Modify: `common/util/Constants.java` — `FORGOT_PASSWORD_PATH = "/forgot-password"`, `RESET_PASSWORD_PATH = "/reset-password"`.
- Modify: `auth/controller/AuthController.java` — dos `@PostMapping` con `@Operation` Swagger; `forgot-password` siempre `200` con el mensaje neutro.
- Modify: `security/config/SecurityConfig.java` — `permitAll` para ambos POST.
- Modify: `application.yml` — bloque `app.password-reset.token-expiration-minutes` y `app.frontend.base-url`.
- Modify: `.env.example` — `PASSWORD_RESET_TOKEN_EXPIRATION_MINUTES`, `FRONTEND_URL`.
- Test: Create `auth/service/PasswordResetServiceTest.java` (Mockito): persiste hash y no el token; invalida tokens vivos previos; email inexistente/deshabilitado → ni guarda ni publica; token inexistente/expirado/usado → `BadRequestException` con mensaje genérico; éxito → encoder llamado y `usedAt` marcado.

- [ ] TDD: tests primero (`mvn test -Dtest=PasswordResetServiceTest`), implementar, verde.

## Task 4: Frontend — servicio, páginas y rutas

**Files:**
- Create: `src/services/passwordResetService.js` — `requestPasswordReset(email)` y `resetPassword(token, newPassword)` con `publicAxios`, patrón `handleError` del servicio público existente.
- Create: `src/pages/ForgotPassword.jsx` — estilo/estructura de Login; formulario email; tras enviar (éxito o error de red igual) muestra el mensaje neutro; enlace de vuelta a login.
- Create: `src/pages/ResetPassword.jsx` — lee `?token=` (`useSearchParams`); sin token → estado de enlace inválido; formulario nueva contraseña + confirmación (coinciden, min 8, validación local); éxito → confirmación + botón a login; 400 → «El enlace no es válido o ha caducado» + enlace a `/forgot-password`.
- Modify: `src/pages/Login.jsx` — enlace «¿Has olvidado tu contraseña?» → `/forgot-password`.
- Modify: `src/App.jsx` — rutas públicas `/forgot-password` y `/reset-password` junto a `/login`.

- [ ] Implementar y verificar con `pnpm lint`.

## Task 5: Verificación manual end-to-end sin SMTP

- [ ] Arrancar backend dev (puerto libre), `POST /auth/forgot-password` con email demo → 200 neutro; copiar enlace del log.
- [ ] `POST /auth/reset-password` con el token del enlace + contraseña nueva → 200; login con la nueva contraseña → 200; login con la antigua → 401.
- [ ] Reusar el mismo token → 400 genérico. Email inexistente → 200 neutro sin log de envío.
- [ ] Sin commits en toda la sesión.
