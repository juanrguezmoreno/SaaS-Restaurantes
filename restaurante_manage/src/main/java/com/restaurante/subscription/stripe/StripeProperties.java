package com.restaurante.subscription.stripe;

import com.restaurante.subscription.enums.PlanCode;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Configuración de Stripe. Ningún valor se escribe en el repositorio: todos
 * llegan por variable de entorno.
 *
 * Si falta la clave o los precios, isEnabled() devuelve false y los endpoints de
 * cobro responden que la facturación no está configurada, en lugar de estallar.
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "app.stripe")
public class StripeProperties {

    private String secretKey;
    private String webhookSecret;
    private String priceNormalMonthly;
    private String priceProMonthly;
    private int trialDays = 14;

    public boolean isEnabled() {
        return tieneValor(secretKey)
                && tieneValor(priceNormalMonthly)
                && tieneValor(priceProMonthly);
    }

    public String priceIdFor(PlanCode plan) {
        return switch (plan) {
            case NORMAL -> priceNormalMonthly;
            case PRO -> priceProMonthly;
        };
    }

    /**
     * Deduce el plan a partir del identificador de precio. Es el camino por el que
     * se decide el plan tras un webhook: nunca se confía en lo que pidió el
     * usuario, sólo en lo que Stripe dice que está cobrando.
     *
     * Un precio desconocido devuelve vacío: mejor ignorar el evento que adivinar.
     */
    public Optional<PlanCode> planForPrice(String priceId) {
        if (!tieneValor(priceId)) {
            return Optional.empty();
        }
        if (priceId.equals(priceNormalMonthly)) {
            return Optional.of(PlanCode.NORMAL);
        }
        if (priceId.equals(priceProMonthly)) {
            return Optional.of(PlanCode.PRO);
        }
        return Optional.empty();
    }

    private boolean tieneValor(String valor) {
        return valor != null && !valor.isBlank();
    }
}
