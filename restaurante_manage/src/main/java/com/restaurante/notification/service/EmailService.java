package com.restaurante.notification.service;

import com.restaurante.notification.event.PasswordResetEmailData;
import com.restaurante.notification.event.ReservationEmailData;
import jakarta.annotation.PostConstruct;
import jakarta.mail.internet.MimeMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Envía los emails de confirmación y cancelación de reserva. Nunca propaga
 * excepciones: un fallo de envío no debe afectar a la operación de negocio
 * que lo originó (ver notification.listener.ReservationEmailListener).
 */
@Service
@Slf4j
public class EmailService {

    private final JavaMailSender mailSender;
    private final boolean mailEnabled;
    private final String mailFrom;

    // Inyectado por campo (no por constructor) para no cambiar la firma
    // pública que ya usan los tests existentes — solo se usa para el
    // diagnóstico de arranque en validateMailConfig().
    @Value("${spring.mail.host:}")
    private String mailHost;

    public EmailService(JavaMailSender mailSender,
                         @Value("${app.mail.enabled:false}") boolean mailEnabled,
                         @Value("${app.mail.from}") String mailFrom) {
        this.mailSender = mailSender;
        this.mailEnabled = mailEnabled;
        this.mailFrom = mailFrom;
    }

    /**
     * app.mail.enabled=true con MAIL_HOST vacío no falla al arrancar (Spring
     * crea el JavaMailSender igualmente) pero todo envío fallará en runtime.
     * Se avisa alto y claro al arrancar en vez de descubrirlo solo al fallar
     * el primer envío real.
     */
    @PostConstruct
    void validateMailConfig() {
        if (mailEnabled && (mailHost == null || mailHost.isBlank())) {
            log.error("Configuración de email inválida: app.mail.enabled=true pero MAIL_HOST no está definido. "
                    + "Los envíos de email fallarán hasta que se configure MAIL_HOST "
                    + "(y MAIL_USERNAME/MAIL_PASSWORD si el servidor SMTP requiere autenticación).");
        }
    }

    public void sendPasswordReset(PasswordResetEmailData data) {
        String subject = "Restablecer tu contraseña";
        if (data.userEmail() == null || data.userEmail().isBlank()) {
            log.info("Usuario sin email — se omite el envío de recuperación de contraseña");
            return;
        }
        if (!mailEnabled) {
            // El enlace se loguea completo para poder probar el flujo en local sin SMTP real.
            log.info("[app.mail.enabled=false] Se omite el envío real. Asunto: '{}', destinatario: {}, enlace: {}",
                    subject, data.userEmail(), data.resetLink());
            return;
        }
        try {
            String html = renderPasswordResetTemplate(data);
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, "UTF-8");
            helper.setFrom(mailFrom);
            helper.setTo(data.userEmail());
            helper.setSubject(subject);
            helper.setText(html, true);
            mailSender.send(message);
            log.info("Email '{}' enviado a {}", subject, data.userEmail());
        } catch (Exception e) {
            log.error("Error al enviar email '{}' a {}: {}", subject, data.userEmail(), e.getMessage(), e);
        }
    }

    private String renderPasswordResetTemplate(PasswordResetEmailData data) throws IOException {
        ClassPathResource resource = new ClassPathResource("mail/password-reset.html");
        String template;
        try (InputStream is = resource.getInputStream()) {
            template = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        return template
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
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, "UTF-8");
            helper.setFrom(mailFrom);
            helper.setTo(data.customerEmail());
            helper.setSubject(subject);
            helper.setText(html, true);
            mailSender.send(message);
            log.info("Email '{}' enviado a {}", subject, data.customerEmail());
        } catch (Exception e) {
            log.error("Error al enviar email '{}' a {}: {}", subject, data.customerEmail(), e.getMessage(), e);
        }
    }

    private String renderTemplate(String templateName, ReservationEmailData data) throws IOException {
        ClassPathResource resource = new ClassPathResource("mail/" + templateName);
        String template;
        try (InputStream is = resource.getInputStream()) {
            template = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        return template
                .replace("{{customerName}}", data.customerName())
                .replace("{{restaurantName}}", data.restaurantName())
                .replace("{{date}}", data.date())
                .replace("{{time}}", data.time())
                .replace("{{partySize}}", String.valueOf(data.partySize()))
                .replace("{{tableInfo}}", data.tableInfo());
    }
}
