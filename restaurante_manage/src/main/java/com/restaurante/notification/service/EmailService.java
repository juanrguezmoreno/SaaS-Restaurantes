package com.restaurante.notification.service;

import com.restaurante.notification.event.ReservationEmailData;
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

    public EmailService(JavaMailSender mailSender,
                         @Value("${app.mail.enabled:false}") boolean mailEnabled,
                         @Value("${app.mail.from}") String mailFrom) {
        this.mailSender = mailSender;
        this.mailEnabled = mailEnabled;
        this.mailFrom = mailFrom;
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
