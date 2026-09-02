package com.restaurante.subscription.controller;

import com.restaurante.common.util.Constants;
import com.restaurante.subscription.service.StripeWebhookService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RestController;

/**
 * Receptor de webhooks de Stripe.
 *
 * Devuelve texto plano y recibe el cuerpo como String SIN deserializar: la firma
 * de Stripe se calcula sobre los bytes exactos del payload, así que si Jackson lo
 * convierte a objeto y lo vuelve a serializar, la verificación falla SIEMPRE.
 *
 * Por el mismo motivo la respuesta no usa el envoltorio ApiResponse: a Stripe le
 * basta con el código de estado.
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@Tag(name = "Webhooks", description = "Recepción de eventos de Stripe")
public class StripeWebhookController {

    private final StripeWebhookService stripeWebhookService;

    @PostMapping(Constants.STRIPE_WEBHOOK_PATH)
    @Operation(summary = "Recibir un evento de Stripe (firma obligatoria)")
    public ResponseEntity<String> receive(
            @RequestBody String payload,
            @RequestHeader(value = StripeWebhookService.SIGNATURE_HEADER, required = false)
            String signature) {

        if (signature == null || signature.isBlank()) {
            log.warn("[Seguridad] Webhook de Stripe sin cabecera de firma; rechazado");
            return ResponseEntity.badRequest().body("missing signature");
        }

        stripeWebhookService.handle(payload, signature);
        // 200 siempre que se haya procesado o ignorado a conciencia. Un fallo
        // transitorio propio se propaga como 500 para que Stripe reintente.
        return ResponseEntity.ok("ok");
    }
}
