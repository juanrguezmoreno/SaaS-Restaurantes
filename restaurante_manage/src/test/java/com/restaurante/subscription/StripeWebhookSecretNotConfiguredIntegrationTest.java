package com.restaurante.subscription;

import com.restaurante.subscription.repository.ProcessedStripeEventRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Caso "fail closed sin secreto configurado", en una clase aparte porque
 * {@link StripeWebhookEndpointIntegrationTest} fija app.stripe.webhook-secret
 * para el resto de sus tests y no se puede vaciar sólo para uno.
 *
 * Sin STRIPE_WEBHOOK_SECRET, la petición de Stripe es intachable pero el
 * despliegue está incompleto: debe responder 503 (para que Stripe reintente),
 * nunca 400, y no debe registrar ni aplicar nada.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@TestPropertySource(properties = {
        "app.stripe.secret-key=clave-de-prueba",
        "app.stripe.webhook-secret=",
        "app.stripe.price-normal-monthly=price_normal_test",
        "app.stripe.price-pro-monthly=price_pro_test",
        "app.stripe.trial-days=14"
})
class StripeWebhookSecretNotConfiguredIntegrationTest {

    private static final String RUTA = "/api/v1/webhooks/stripe";

    @Autowired private MockMvc mockMvc;
    @Autowired private ProcessedStripeEventRepository processedStripeEventRepository;

    @BeforeEach
    void limpiarBitacora() {
        processedStripeEventRepository.deleteAll();
    }

    @Test
    @DisplayName("Sin STRIPE_WEBHOOK_SECRET configurado se responde 503 y no se cambia nada")
    void sinSecretoConfiguradoDevuelve503() throws Exception {
        String cuerpo = """
            {"id":"evt_sin_secreto","object":"event","type":"customer.subscription.updated",
             "created":1750000000,"data":{"object":{"id":"sub_x","object":"subscription"}}}
            """;

        mockMvc.perform(post(RUTA)
                        .header("Stripe-Signature", "t=1,v1=loQueSea")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isServiceUnavailable());

        assertEquals(0, processedStripeEventRepository.count());
    }
}
