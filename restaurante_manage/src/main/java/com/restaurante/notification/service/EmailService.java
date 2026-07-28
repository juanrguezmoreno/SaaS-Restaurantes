package com.restaurante.notification.service;

import com.restaurante.notification.event.PasswordResetEmailData;
import com.restaurante.notification.event.ReservationEmailData;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Envía los emails transaccionales (recuperación de contraseña, confirmación y
 * cancelación de reserva) a través de la API HTTPS de Resend — Railway bloquea
 * el SMTP saliente, así que aquí no hay JavaMail: solo llamadas HTTPS (443).
 *
 * <p>Nunca propaga excepciones: un fallo de envío no debe afectar a la
 * operación de negocio que lo originó (ver los listeners de notification,
 * que ya ejecutan en @Async + AFTER_COMMIT).</p>
 *
 * <p>Por seguridad, los logs nunca incluyen tokens, enlaces de recuperación
 * ni el cuerpo del email — solo asunto, destinatario y resultado.</p>
 */
@Service
@Slf4j
public class EmailService {

    private final ResendMailClient mailClient;
    private final boolean mailEnabled;
    private final String mailFrom;

    public EmailService(ResendMailClient mailClient,
                        @Value("${app.mail.enabled:false}") boolean mailEnabled,
                        @Value("${app.mail.from}") String mailFrom) {
        this.mailClient = mailClient;
        this.mailEnabled = mailEnabled;
        this.mailFrom = mailFrom;
    }

    /**
     * app.mail.enabled=true sin RESEND_API_KEY no impide arrancar, pero todo
     * envío fallará en runtime. Se avisa alto y claro al arrancar en vez de
     * descubrirlo solo al fallar el primer envío real.
     */
    @PostConstruct
    void validateMailConfig() {
        if (mailEnabled && !mailClient.isConfigured()) {
            log.error("Configuración de email inválida: app.mail.enabled=true pero RESEND_API_KEY no está definida. "
                    + "Los envíos de email fallarán hasta que se configure RESEND_API_KEY.");
        }
    }

    public void sendPasswordReset(PasswordResetEmailData data) {
        String subject = "Restablecer tu contraseña";
        if (data.userEmail() == null || data.userEmail().isBlank()) {
            log.info("Usuario sin email — se omite el envío de recuperación de contraseña");
            return;
        }
        if (!mailEnabled) {
            // No se loguea el enlace: contiene el token de recuperación.
            log.info("[app.mail.enabled=false] Se omite el envío real. Asunto: '{}', destinatario: {}",
                    subject, data.userEmail());
            return;
        }
        try {
            String html = renderPasswordResetTemplate(data);
            String id = mailClient.send(mailFrom, data.userEmail(), subject, html);
            log.info("Email '{}' enviado a {} (Resend id={})", subject, data.userEmail(), id);
        } catch (Exception e) {
            // Solo asunto, destinatario y error del proveedor — nunca el token ni el enlace.
            log.error("Error al enviar email '{}' a {}: {}", subject, data.userEmail(), e.getMessage());
        }
    }

    private String renderPasswordResetTemplate(PasswordResetEmailData data) throws IOException {
        return readTemplate("password-reset.html")
                .replace("{{userName}}", data.userName())
                .replace("{{resetLink}}", data.resetLink())
                .replace("{{expirationMinutes}}", String.valueOf(data.expirationMinutes()));
    }

    public void sendReservationConfirmed(ReservationEmailData data) {
        send(data, "reservation-confirmed.html", "Reserva confirmada — " + data.restaurantName());
    }

    public void sendReservationCancelled(ReservationEmailData data) {
        send(data, "reservation-cancelled.html", "Reserva cancelada — " + data.restaurantName());
    }

    private void send(ReservationEmailData data, String templateName, String subject) {
        if (data.customerEmail() == null || data.customerEmail().isBlank()) {
            log.info("Cliente sin email — se omite el envío de '{}'", subject);
            return;
        }
        if (!mailEnabled) {
            log.info("[app.mail.enabled=false] Se omite el envío real. Asunto: '{}', destinatario: {}",
                    subject, data.customerEmail());
            return;
        }
        try {
            String html = renderTemplate(templateName, data);
            String id = mailClient.send(mailFrom, data.customerEmail(), subject, html);
            log.info("Email '{}' enviado a {} (Resend id={})", subject, data.customerEmail(), id);
        } catch (Exception e) {
            log.error("Error al enviar email '{}' a {}: {}", subject, data.customerEmail(), e.getMessage());
        }
    }

    private String renderTemplate(String templateName, ReservationEmailData data) throws IOException {
        return readTemplate(templateName)
                .replace("{{customerName}}", data.customerName())
                .replace("{{restaurantName}}", data.restaurantName())
                .replace("{{date}}", data.date())
                .replace("{{time}}", data.time())
                .replace("{{partySize}}", String.valueOf(data.partySize()))
                .replace("{{tableInfo}}", data.tableInfo());
    }

    private String readTemplate(String templateName) throws IOException {
        ClassPathResource resource = new ClassPathResource("mail/" + templateName);
        try (InputStream is = resource.getInputStream()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }
}
