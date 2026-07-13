package com.restaurante.auth.service;

import com.restaurante.auth.entity.PasswordResetToken;
import com.restaurante.auth.repository.PasswordResetTokenRepository;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.notification.event.PasswordResetRequestedEvent;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.context.ApplicationEventPublisher;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class PasswordResetServiceTest {

    private static final String EMAIL = "ana@example.com";
    private static final Long USER_ID = 7L;

    @Mock private UserRepository userRepository;
    @Mock private PasswordResetTokenRepository passwordResetTokenRepository;
    @Mock private org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;
    @Mock private ApplicationEventPublisher eventPublisher;

    private PasswordResetService service;
    private User user;

    @BeforeEach
    void setUp() {
        service = new PasswordResetService(
                userRepository, passwordResetTokenRepository, passwordEncoder, eventPublisher,
                30, "http://localhost:5173");

        user = new User();
        user.setId(USER_ID);
        user.setUsername("ana");
        user.setEmail(EMAIL);
        user.setFirstName("Ana");
        user.setEnabled(true);
    }

    // ─── requestReset ───────────────────────────────────────────────────────

    @Test
    void requestReset_generaTokenYPublicaElEventoConElEnlace() {
        when(userRepository.findByEmailAndDeletedFalse(EMAIL)).thenReturn(Optional.of(user));
        when(passwordResetTokenRepository.findByUserIdAndUsedAtIsNullAndDeletedFalse(USER_ID))
                .thenReturn(List.of());

        service.requestReset(EMAIL);

        ArgumentCaptor<PasswordResetToken> tokenCaptor = ArgumentCaptor.forClass(PasswordResetToken.class);
        verify(passwordResetTokenRepository).save(tokenCaptor.capture());
        PasswordResetToken saved = tokenCaptor.getValue();

        assertNotNull(saved.getTokenHash());
        assertEquals(64, saved.getTokenHash().length()); // SHA-256 en hex
        assertEquals(user, saved.getUser());
        assertNotNull(saved.getExpiresAt());

        ArgumentCaptor<PasswordResetRequestedEvent> eventCaptor =
                ArgumentCaptor.forClass(PasswordResetRequestedEvent.class);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        String link = eventCaptor.getValue().data().resetLink();
        assertEquals(EMAIL, eventCaptor.getValue().data().userEmail());
        assertEquals(true, link.startsWith("http://localhost:5173/reset-password?token="));

        // El token en claro del enlace no debe coincidir con el hash guardado.
        String rawTokenFromLink = link.substring(link.indexOf("token=") + "token=".length());
        assertNotEquals(saved.getTokenHash(), rawTokenFromLink);
    }

    @Test
    void requestReset_invalidaLosTokensVivosAnteriores() {
        when(userRepository.findByEmailAndDeletedFalse(EMAIL)).thenReturn(Optional.of(user));
        PasswordResetToken tokenAntiguo = new PasswordResetToken();
        tokenAntiguo.setUser(user);
        tokenAntiguo.setTokenHash("hash-antiguo");
        tokenAntiguo.setExpiresAt(LocalDateTime.now().plusMinutes(30));
        when(passwordResetTokenRepository.findByUserIdAndUsedAtIsNullAndDeletedFalse(USER_ID))
                .thenReturn(List.of(tokenAntiguo));

        service.requestReset(EMAIL);

        assertNotNull(tokenAntiguo.getUsedAt());
        verify(passwordResetTokenRepository).saveAll(List.of(tokenAntiguo));
    }

    @Test
    void requestReset_noHaceNadaSiElEmailNoExiste() {
        when(userRepository.findByEmailAndDeletedFalse(EMAIL)).thenReturn(Optional.empty());

        service.requestReset(EMAIL);

        verify(passwordResetTokenRepository, never()).save(any());
        verify(eventPublisher, never()).publishEvent(any());
    }

    @Test
    void requestReset_noHaceNadaSiElUsuarioEstaDeshabilitado() {
        user.setEnabled(false);
        when(userRepository.findByEmailAndDeletedFalse(EMAIL)).thenReturn(Optional.of(user));

        service.requestReset(EMAIL);

        verify(passwordResetTokenRepository, never()).save(any());
        verify(eventPublisher, never()).publishEvent(any());
    }

    // ─── resetPassword ──────────────────────────────────────────────────────

    private PasswordResetToken tokenParaHash(String hash, LocalDateTime expiresAt, LocalDateTime usedAt) {
        PasswordResetToken token = new PasswordResetToken();
        token.setUser(user);
        token.setTokenHash(hash);
        token.setExpiresAt(expiresAt);
        token.setUsedAt(usedAt);
        return token;
    }

    @Test
    void resetPassword_actualizaLaContraseñaYMarcaElTokenComoUsado() {
        // Capturamos el hash real generado por requestReset para reutilizarlo aquí,
        // ya que resetPassword recibe el token en claro y lo hashea internamente.
        when(userRepository.findByEmailAndDeletedFalse(EMAIL)).thenReturn(Optional.of(user));
        when(passwordResetTokenRepository.findByUserIdAndUsedAtIsNullAndDeletedFalse(USER_ID))
                .thenReturn(List.of());
        ArgumentCaptor<PasswordResetRequestedEvent> eventCaptor =
                ArgumentCaptor.forClass(PasswordResetRequestedEvent.class);
        service.requestReset(EMAIL);
        verify(eventPublisher).publishEvent(eventCaptor.capture());
        String link = eventCaptor.getValue().data().resetLink();
        String rawToken = link.substring(link.indexOf("token=") + "token=".length());

        ArgumentCaptor<PasswordResetToken> savedCaptor = ArgumentCaptor.forClass(PasswordResetToken.class);
        verify(passwordResetTokenRepository).save(savedCaptor.capture());
        String realHash = savedCaptor.getValue().getTokenHash();

        PasswordResetToken persisted = tokenParaHash(realHash, LocalDateTime.now().plusMinutes(10), null);
        when(passwordResetTokenRepository.findByTokenHashAndDeletedFalse(realHash))
                .thenReturn(Optional.of(persisted));
        when(passwordEncoder.encode("NuevaPass123")).thenReturn("hash-bcrypt");

        service.resetPassword(rawToken, "NuevaPass123");

        assertEquals("hash-bcrypt", user.getPassword());
        assertNotNull(persisted.getUsedAt());
        verify(userRepository).save(user);
        verify(passwordResetTokenRepository, times(2)).save(any(PasswordResetToken.class));
    }

    @Test
    void resetPassword_rechazaTokenInexistente() {
        when(passwordResetTokenRepository.findByTokenHashAndDeletedFalse(anyString()))
                .thenReturn(Optional.empty());

        BadRequestException ex = assertThrows(BadRequestException.class,
                () -> service.resetPassword("token-que-no-existe", "NuevaPass123"));
        assertEquals("El enlace no es válido o ha caducado", ex.getMessage());
        verify(passwordEncoder, never()).encode(any());
    }

    @Test
    void resetPassword_rechazaTokenExpirado() {
        PasswordResetToken expirado = tokenParaHash("hash-x", LocalDateTime.now().minusMinutes(1), null);
        when(passwordResetTokenRepository.findByTokenHashAndDeletedFalse(anyString()))
                .thenReturn(Optional.of(expirado));

        assertThrows(BadRequestException.class,
                () -> service.resetPassword("token-expirado", "NuevaPass123"));
        verify(passwordEncoder, never()).encode(any());
    }

    @Test
    void resetPassword_rechazaTokenYaUsado() {
        PasswordResetToken usado = tokenParaHash(
                "hash-x", LocalDateTime.now().plusMinutes(10), LocalDateTime.now().minusMinutes(5));
        when(passwordResetTokenRepository.findByTokenHashAndDeletedFalse(anyString()))
                .thenReturn(Optional.of(usado));

        assertThrows(BadRequestException.class,
                () -> service.resetPassword("token-usado", "NuevaPass123"));
        verify(passwordEncoder, never()).encode(any());
    }
}
