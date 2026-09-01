package com.restaurante.subscription.catalog;

import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.Resource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Fija la matriz plan x feature. Si alguien cambia el catálogo sin querer, este
 * test rompe la build: es la protección contra que los planes se desvíen de lo
 * que se vende.
 */
class PlanCatalogTest {

    @Test
    @DisplayName("NORMAL no incluye ninguna feature de pago")
    void normalNoTieneFeaturesPro() {
        assertTrue(PlanCatalog.get(PlanCode.NORMAL).features().isEmpty());
        for (Feature feature : Feature.values()) {
            assertFalse(PlanCatalog.hasFeature(PlanCode.NORMAL, feature),
                    "NORMAL no debería incluir " + feature);
        }
    }

    @Test
    @DisplayName("PRO incluye todas las features declaradas")
    void proIncluyeTodasLasFeatures() {
        for (Feature feature : Feature.values()) {
            assertTrue(PlanCatalog.hasFeature(PlanCode.PRO, feature),
                    "PRO debería incluir " + feature);
        }
    }

    @Test
    @DisplayName("NORMAL limita a 1 local y 5 cuentas")
    void limitesDeNormal() {
        PlanLimits limites = PlanCatalog.limits(PlanCode.NORMAL);
        assertEquals(1, limites.maxRestaurants());
        assertEquals(5, limites.maxUserAccounts());
        assertFalse(limites.isUnlimited(Resource.RESTAURANT));
        assertFalse(limites.isUnlimited(Resource.USER_ACCOUNT));
        assertEquals(1, limites.limitFor(Resource.RESTAURANT));
        assertEquals(5, limites.limitFor(Resource.USER_ACCOUNT));
    }

    @Test
    @DisplayName("PRO es ilimitado en locales y cuentas")
    void limitesDePro() {
        PlanLimits limites = PlanCatalog.limits(PlanCode.PRO);
        assertNull(limites.maxRestaurants());
        assertNull(limites.maxUserAccounts());
        assertTrue(limites.isUnlimited(Resource.RESTAURANT));
        assertTrue(limites.isUnlimited(Resource.USER_ACCOUNT));
    }

    @Test
    @DisplayName("Todo plan del enum tiene definición en el catálogo")
    void todoPlanEstaDefinido() {
        for (PlanCode code : PlanCode.values()) {
            assertNotNull(PlanCatalog.get(code), "Falta la definición de " + code);
            assertNotNull(PlanCatalog.get(code).displayName());
            assertFalse(PlanCatalog.get(code).displayName().isBlank());
        }
        assertEquals(PlanCode.values().length, PlanCatalog.all().size());
    }

    @Test
    @DisplayName("El plan mínimo para cualquier feature es PRO")
    void planMinimoParaFeature() {
        for (Feature feature : Feature.values()) {
            assertEquals(PlanCode.PRO, PlanCatalog.minimumPlanFor(feature));
        }
    }

    @Test
    @DisplayName("El catálogo es inmutable: no se puede alterar desde fuera")
    void catalogoInmutable() {
        assertThrows(UnsupportedOperationException.class,
                () -> PlanCatalog.get(PlanCode.NORMAL).features().add(Feature.EXPORT_DATA));
        assertThrows(UnsupportedOperationException.class,
                () -> PlanCatalog.all().remove(PlanCode.PRO));
    }
}
