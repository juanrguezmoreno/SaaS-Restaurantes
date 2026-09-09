package com.restaurante.subscription.stripe;

import com.restaurante.subscription.enums.PlanCode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

class StripePropertiesTest {

    private StripeProperties conPrecios(String normal, String pro) {
        StripeProperties propiedades = new StripeProperties();
        propiedades.setPriceNormalMonthly(normal);
        propiedades.setPriceProMonthly(pro);
        return propiedades;
    }

    @Test
    @DisplayName("Resuelve el identificador de precio de cada plan")
    void resuelvePreciosPorPlan() {
        StripeProperties propiedades = conPrecios("price_normal", "price_pro");
        assertEquals("price_normal", propiedades.priceIdFor(PlanCode.NORMAL));
        assertEquals("price_pro", propiedades.priceIdFor(PlanCode.PRO));
    }

    @Test
    @DisplayName("Resuelve el plan a partir del precio: es así como se deduce el plan de Stripe")
    void resuelvePlanPorPrecio() {
        StripeProperties propiedades = conPrecios("price_normal", "price_pro");
        assertEquals(Optional.of(PlanCode.NORMAL), propiedades.planForPrice("price_normal"));
        assertEquals(Optional.of(PlanCode.PRO), propiedades.planForPrice("price_pro"));
        // Un precio desconocido NUNCA debe adivinar un plan: se ignora el evento.
        assertEquals(Optional.empty(), propiedades.planForPrice("price_desconocido"));
        assertEquals(Optional.empty(), propiedades.planForPrice(null));
    }

    @Test
    @DisplayName("Sin clave secreta o sin precios, el cobro queda deshabilitado en vez de roto")
    void deshabilitadoSinConfiguracion() {
        StripeProperties sinNada = new StripeProperties();
        assertFalse(sinNada.isEnabled());

        StripeProperties soloClave = conPrecios(null, null);
        soloClave.setSecretKey("clave-de-prueba-no-stripe");
        assertFalse(soloClave.isEnabled());

        StripeProperties completa = conPrecios("price_normal", "price_pro");
        completa.setSecretKey("clave-de-prueba-no-stripe");
        assertTrue(completa.isEnabled());
    }
}
