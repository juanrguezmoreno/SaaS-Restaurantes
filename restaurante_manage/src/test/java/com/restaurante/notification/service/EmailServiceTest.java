package com.restaurante.notification.service;

import com.resend.core.exception.ResendException;
import com.restaurante.notification.event.PasswordResetEmailData;
import com.restaurante.notification.event.ReservationEmailData;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Tests del EmailService sobre el transporte Resend (API HTTPS).
 * Se mockea ResendMailClient: aquí se verifica la lógica de negocio del
 * servicio (guardas, render de plantillas, asuntos, resiliencia a errores
 * del proveedor), no el SDK.
 */
@ExtendWith(MockitoExtension.class)
class EmailServiceTest {

    @Mock private ResendMailClient mailClient;

    private static final String FROM = "no-reply@test.com";

    private EmailService service(boolean enabled) {
        return new EmailService(mailClient, enabled, FROM);
    }

    private ReservationEmailData data(String email) {
        return new ReservationEmailData(email, "Ana García", "La Buena Mesa",
                "31/12/2026", "21:30", 4, "Mesa 7");
    }

    private PasswordResetEmailData passwordResetData(String email) {
        return new PasswordResetEmailData(email, "Ana García",
                "http://localhost:5173/reset-password?token=abc123", 30);
    }

    // ─── MAIL_ENABLED=false ─────────────────────────────────────────────────

    @Test
    void send_noEnviaSiMailEnabledEsFalse() throws Exception {
        service(false).sendReservationConfirmed(data("ana@example.com"));

        verify(mailClient, never()).send(anyString(), anyString(), anyString(), anyString());
    }

    @Test
    void sendPasswordReset_noEnviaSiMailEnabledEsFalse() throws Exception {
        service(false).sendPasswordReset(passwordResetData("ana@example.com"));

        verify(mailClient, never()).send(anyString(), anyString(), anyString(), anyString());
    }

    // ─── Recuperación de contraseña ─────────────────────────────────────────

    @Test
    void sendPasswordReset_construyeElCorreoCorrectamente() throws Exception {
        when(mailClient.send(anyString(), anyString(), anyString(), anyString())).thenReturn("email-id-1");

        service(true).sendPasswordReset(passwordResetData("ana@example.com"));

        ArgumentCaptor<String> html = ArgumentCaptor.forClass(String.class);
        verify(mailClient).send(org.mockito.ArgumentMatchers.eq(FROM),
                org.mockito.ArgumentMatchers.eq("ana@example.com"),
                org.mockito.ArgumentMatchers.eq("Restablecer tu contraseña"),
                html.capture());
        String content = html.getValue();
        assertTrue(content.contains("Ana García"));
        assertTrue(content.contains("http://localhost:5173/reset-password?token=abc123"));
        assertTrue(content.contains("30"));
        assertFalse(content.contains("{{"));
    }

    // ─── Emails de reserva ──────────────────────────────────────────────────

    @Test
    void sendReservationConfirmed_construyeElCorreoCorrectamente() throws Exception {
        when(mailClient.send(anyString(), anyString(), anyString(), anyString())).thenReturn("email-id-2");

        service(true).sendReservationConfirmed(data("ana@example.com"));

        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        ArgumentCaptor<String> html = ArgumentCaptor.forClass(String.class);
        verify(mailClient).send(org.mockito.ArgumentMatchers.eq(FROM),
                org.mockito.ArgumentMatchers.eq("ana@example.com"),
                subject.capture(), html.capture());
        assertEquals("Reserva confirmada — La Buena Mesa", subject.getValue());
        String content = html.getValue();
        assertTrue(content.contains("Ana García"));
        assertTrue(content.contains("La Buena Mesa"));
        assertTrue(content.contains("31/12/2026"));
        assertTrue(content.contains("21:30"));
        assertTrue(content.contains("Mesa 7"));
        assertFalse(content.contains("{{"));
    }

    @Test
    void sendReservationCancelled_construyeElCorreoCorrectamente() throws Exception {
        when(mailClient.send(anyString(), anyString(), anyString(), anyString())).thenReturn("email-id-3");

        service(true).sendReservationCancelled(data("ana@example.com"));

        ArgumentCaptor<String> subject = ArgumentCaptor.forClass(String.class);
        verify(mailClient).send(anyString(), anyString(), subject.capture(), anyString());
        assertEquals("Reserva cancelada — La Buena Mesa", subject.getValue());
    }

    @Test
    void send_noEnviaSiElClienteNoTieneEmail() throws Exception {
        service(true).sendReservationCancelled(data(null));

        verify(mailClient, never()).send(anyString(), anyString(), anyString(), anyString());
    }

    // ─── Errores del proveedor ──────────────────────────────────────────────

    @Test
    void send_noPropagaLaExcepcionSiElProveedorFalla() throws Exception {
        when(mailClient.send(anyString(), anyString(), anyString(), anyString()))
                .thenThrow(new ResendException("api key inválida"));

        assertDoesNotThrow(() -> service(true).sendReservationConfirmed(data("ana@example.com")));
    }

    @Test
    void sendPasswordReset_noPropagaLaExcepcionSiElProveedorFalla() throws Exception {
        when(mailClient.send(anyString(), anyString(), anyString(), anyString()))
                .thenThrow(new ResendException("cuota excedida"));

        assertDoesNotThrow(() -> service(true).sendPasswordReset(passwordResetData("ana@example.com")));
    }
}
