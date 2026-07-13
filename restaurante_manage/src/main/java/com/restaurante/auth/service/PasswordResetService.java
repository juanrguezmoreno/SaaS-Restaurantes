package com.restaurante.auth.service;

import com.restaurante.auth.entity.PasswordResetToken;
import com.restaurante.auth.repository.PasswordResetTokenRepository;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.notification.event.PasswordResetEmailData;
import com.restaurante.notification.event.PasswordResetRequestedEvent;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.LocalDateTime;
import java.util.Base64;
import java.util.List;
import java.util.Optional;

/**
 * Recuperación de contraseña por email. Separado de AuthService: distinta
 * superficie de seguridad (sin autenticación previa) y distinto ciclo de vida.
 */
@Service
@Slf4j
public class PasswordResetService {

    private static final SecureRandom SECURE_RANDOM = new SecureRandom();
    private static final int TOKEN_BYTES = 32;
    private static final String GENERIC_TOKEN_ERROR = "El enlace no es válido o ha caducado";

    private final UserRepository userRepository;
    private final PasswordResetTokenRepository passwordResetTokenRepository;
    private final PasswordEncoder passwordEncoder;
    private final ApplicationEventPublisher eventPublisher;
    private final long tokenExpirationMinutes;
    private final String frontendBaseUrl;

    public PasswordResetService(UserRepository userRepository,
                                 PasswordResetTokenRepository passwordResetTokenRepository,
                                 PasswordEncoder passwordEncoder,
                                 ApplicationEventPublisher eventPublisher,
                                 @Value("${app.password-reset.token-expiration-minutes:30}") long tokenExpirationMinutes,
                                 @Value("${app.frontend.base-url:http://localhost:5173}") String frontendBaseUrl) {
        this.userRepository = userRepository;
        this.passwordResetTokenRepository = passwordResetTokenRepository;
        this.passwordEncoder = passwordEncoder;
        this.eventPublisher = eventPublisher;
        this.tokenExpirationMinutes = tokenExpirationMinutes;
        this.frontendBaseUrl = frontendBaseUrl;
    }

    /**
     * Nunca revela si el email existe: si no hay usuario (o está deshabilitado),
     * no hace nada. El controlador responde siempre el mismo mensaje neutro.
     */
    @Transactional
    public void requestReset(String email) {
        Optional<User> userOpt = userRepository.findByEmailAndDeletedFalse(email);
        if (userOpt.isEmpty() || !userOpt.get().isEnabled()) {
            log.debug("Solicitud de recuperación para un email sin cuenta activa asociada");
            return;
        }
        User user = userOpt.get();

        invalidateActiveTokens(user.getId());

        String rawToken = generateRawToken();
        PasswordResetToken resetToken = new PasswordResetToken();
        resetToken.setUser(user);
        resetToken.setTokenHash(hash(rawToken));
        resetToken.setExpiresAt(LocalDateTime.now().plusMinutes(tokenExpirationMinutes));
        passwordResetTokenRepository.save(resetToken);

        String resetLink = frontendBaseUrl + "/reset-password?token=" + rawToken;
        String userName = (user.getFirstName() != null ? user.getFirstName() : user.getUsername());

        eventPublisher.publishEvent(new PasswordResetRequestedEvent(
                new PasswordResetEmailData(user.getEmail(), userName, resetLink, tokenExpirationMinutes)));

        log.info("Token de recuperación generado para el usuario #{}", user.getId());
    }

    @Transactional
    public void resetPassword(String rawToken, String newPassword) {
        PasswordResetToken resetToken = passwordResetTokenRepository
                .findByTokenHashAndDeletedFalse(hash(rawToken))
                .orElseThrow(() -> new BadRequestException(GENERIC_TOKEN_ERROR));

        if (resetToken.getUsedAt() != null || resetToken.getExpiresAt().isBefore(LocalDateTime.now())) {
            throw new BadRequestException(GENERIC_TOKEN_ERROR);
        }

        User user = resetToken.getUser();
        user.setPassword(passwordEncoder.encode(newPassword));
        userRepository.save(user);

        resetToken.setUsedAt(LocalDateTime.now());
        passwordResetTokenRepository.save(resetToken);

        log.info("Contraseña restablecida para el usuario #{}", user.getId());
    }

    private void invalidateActiveTokens(Long userId) {
        List<PasswordResetToken> activeTokens =
                passwordResetTokenRepository.findByUserIdAndUsedAtIsNullAndDeletedFalse(userId);
        LocalDateTime now = LocalDateTime.now();
        activeTokens.forEach(t -> t.setUsedAt(now));
        passwordResetTokenRepository.saveAll(activeTokens);
    }

    private String generateRawToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        SECURE_RANDOM.nextBytes(bytes);
        return Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private String hash(String rawToken) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hashBytes = digest.digest(rawToken.getBytes(StandardCharsets.UTF_8));
            StringBuilder sb = new StringBuilder(hashBytes.length * 2);
            for (byte b : hashBytes) {
                sb.append(String.format("%02x", b));
            }
            return sb.toString();
        } catch (NoSuchAlgorithmException e) {
            // SHA-256 es un algoritmo estándar de la JVM; nunca debería faltar.
            throw new IllegalStateException("SHA-256 no disponible en esta JVM", e);
        }
    }
}
