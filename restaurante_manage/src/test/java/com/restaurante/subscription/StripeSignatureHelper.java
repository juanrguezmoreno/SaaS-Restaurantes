package com.restaurante.subscription;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

/**
 * Construye la cabecera Stripe-Signature igual que la genera Stripe:
 * HMAC-SHA256 de "<timestamp>.<payload>" con el secreto del endpoint.
 * Permite probar la verificación de firma sin tocar la red.
 */
final class StripeSignatureHelper {

    private StripeSignatureHelper() {
    }

    static String firmar(String payload, String secreto, long marcaTemporal) throws Exception {
        String contenido = marcaTemporal + "." + payload;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secreto.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] hash = mac.doFinal(contenido.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : hash) {
            hex.append(String.format("%02x", b));
        }
        return "t=" + marcaTemporal + ",v1=" + hex;
    }
}
