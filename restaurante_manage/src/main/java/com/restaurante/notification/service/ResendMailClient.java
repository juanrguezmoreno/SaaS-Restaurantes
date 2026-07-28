package com.restaurante.notification.service;

import com.resend.Resend;
import com.resend.core.exception.ResendException;
import com.resend.services.emails.model.CreateEmailOptions;
import com.resend.services.emails.model.CreateEmailResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Wrapper fino sobre el SDK oficial de Resend (envío por API HTTPS, puerto 443).
 * Existe para poder mockear el transporte en tests y para que EmailService no
 * dependa directamente del SDK. La API key viene de la variable de entorno
 * RESEND_API_KEY (propiedad app.mail.resend-api-key) — nunca del código.
 */
@Component
public class ResendMailClient {

    private final String apiKey;

    // Lazy: no se instancia el SDK si el envío de email está deshabilitado.
    private volatile Resend resend;

    public ResendMailClient(@Value("${app.mail.resend-api-key:}") String apiKey) {
        this.apiKey = apiKey;
    }

    public boolean isConfigured() {
        return apiKey != null && !apiKey.isBlank();
    }

    /**
     * Envía un email HTML y devuelve el id asignado por Resend.
     *
     * @throws ResendException si la API rechaza la petición (clave inválida,
     *                         remitente no verificado, cuota excedida, etc.)
     */
    public String send(String from, String to, String subject, String html) throws ResendException {
        CreateEmailOptions options = CreateEmailOptions.builder()
                .from(from)
                .to(to)
                .subject(subject)
                .html(html)
                .build();

        CreateEmailResponse response = client().emails().send(options);
        return response.getId();
    }

    private Resend client() {
        Resend local = resend;
        if (local == null) {
            synchronized (this) {
                if (resend == null) {
                    resend = new Resend(apiKey);
                }
                local = resend;
            }
        }
        return local;
    }
}
