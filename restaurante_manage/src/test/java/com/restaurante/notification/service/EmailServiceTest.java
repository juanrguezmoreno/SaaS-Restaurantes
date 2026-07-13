package com.restaurante.notification.service;

import com.restaurante.notification.event.PasswordResetEmailData;
import com.restaurante.notification.event.ReservationEmailData;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EmailServiceTest {

    @Mock private JavaMailSender mailSender;

    private MimeMessage mimeMessage;

    @BeforeEach
    void setUp() {
        mimeMessage = new MimeMessage((Session) null);
    }

    private ReservationEmailData data(String email) {
        return new ReservationEmailData(email, "Ana García", "La Buena Mesa",
                "31/12/2026", "21:30", 4, "Mesa 7");
    }

    @Test
    void sendReservationConfirmed_renderizaLaPlantillaYEnviaElEmail() throws Exception {
        when(mailSender.createMimeMessage()).thenReturn(mimeMessage);
        EmailService service = new EmailService(mailSender, true, "no-reply@test.com");

        service.sendReservationConfirmed(data("ana@example.com"));

        verify(mailSender).send(mimeMessage);
        String content = (String) mimeMessage.getContent();
        assertTrue(content.contains("Ana García"));
        assertTrue(content.contains("La Buena Mesa"));
        assertTrue(content.contains("31/12/2026"));
        assertTrue(content.contains("21:30"));
        assertTrue(content.contains("Mesa 7"));
        assertFalse(content.contains("{{"));
    }

    @Test
    void send_noEnviaSiMailEnabledEsFalse() {
        EmailService service = new EmailService(mailSender, false, "no-reply@test.com");

        service.sendReservationConfirmed(data("ana@example.com"));

        verify(mailSender, never()).createMimeMessage();
        verify(mailSender, never()).send(any(MimeMessage.class));
    }

    @Test
    void send_noEnviaSiElClienteNoTieneEmail() {
        EmailService service = new EmailService(mailSender, true, "no-reply@test.com");

        service.sendReservationCancelled(data(null));

        verify(mailSender, never()).createMimeMessage();
    }

    @Test
    void send_noPropagaLaExcepcionSiFallaElEnvio() {
        when(mailSender.createMimeMessage()).thenReturn(mimeMessage);
        doThrow(new MailSendException("fallo SMTP")).when(mailSender).send(any(MimeMessage.class));
        EmailService service = new EmailService(mailSender, true, "no-reply@test.com");

        assertDoesNotThrow(() -> service.sendReservationConfirmed(data("ana@example.com")));
    }

    // ─── sendPasswordReset ──────────────────────────────────────────────────

    private PasswordResetEmailData passwordResetData(String email) {
        return new PasswordResetEmailData(email, "Ana García",
                "http://localhost:5173/reset-password?token=abc123", 30);
    }

    @Test
    void sendPasswordReset_renderizaLaPlantillaYEnviaElEmail() throws Exception {
        when(mailSender.createMimeMessage()).thenReturn(mimeMessage);
        EmailService service = new EmailService(mailSender, true, "no-reply@test.com");

        service.sendPasswordReset(passwordResetData("ana@example.com"));

        verify(mailSender).send(mimeMessage);
        String content = (String) mimeMessage.getContent();
        assertTrue(content.contains("Ana García"));
        assertTrue(content.contains("http://localhost:5173/reset-password?token=abc123"));
        assertTrue(content.contains("30"));
        assertFalse(content.contains("{{"));
    }

    @Test
    void sendPasswordReset_noEnviaSiMailEnabledEsFalse() {
        EmailService service = new EmailService(mailSender, false, "no-reply@test.com");

        service.sendPasswordReset(passwordResetData("ana@example.com"));

        verify(mailSender, never()).createMimeMessage();
        verify(mailSender, never()).send(any(MimeMessage.class));
    }
}
