package com.restaurante.subscription.catalog;

import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Fuente única de verdad de qué incluye cada plan.
 *
 * Vive en código y no en base de datos a propósito: con ddl-auto=validate, una
 * tabla plan_features mal sembrada dejaría a TODOS los tenants sin ninguna
 * feature, convirtiendo un fallo de datos en una caída del producto. Además, un
 * catálogo en código se fija con un test (PlanCatalogTest); una fila, no.
 *
 * Añadir un plan o una feature no requiere tocar ningún servicio: basta con el
 * enum y una entrada aquí.
 */
public final class PlanCatalog {

    private PlanCatalog() {
        throw new UnsupportedOperationException("Clase de utilidad, no instanciable");
    }

    private static final Map<PlanCode, PlanDefinition> CATALOGO = Map.of(
            PlanCode.NORMAL, new PlanDefinition(
                    PlanCode.NORMAL,
                    "Normal",
                    EnumSet.noneOf(Feature.class),
                    new PlanLimits(1, 5)
            ),
            PlanCode.PRO, new PlanDefinition(
                    PlanCode.PRO,
                    "Pro",
                    EnumSet.allOf(Feature.class),
                    PlanLimits.unlimited()
            )
    );

    public static PlanDefinition get(PlanCode code) {
        return CATALOGO.get(code);
    }

    public static Map<PlanCode, PlanDefinition> all() {
        return CATALOGO;
    }

    public static boolean hasFeature(PlanCode code, Feature feature) {
        PlanDefinition definicion = CATALOGO.get(code);
        return definicion != null && definicion.features().contains(feature);
    }

    public static PlanLimits limits(PlanCode code) {
        PlanDefinition definicion = CATALOGO.get(code);
        return definicion != null ? definicion.limits() : new PlanLimits(0, 0);
    }

    /**
     * Plan más barato que incluye la feature. Se usa para decirle al usuario a
     * qué tiene que subir, en vez de dejarlo adivinando.
     */
    public static PlanCode minimumPlanFor(Feature feature) {
        for (PlanCode code : PlanCode.values()) {
            if (hasFeature(code, feature)) {
                return code;
            }
        }
        return PlanCode.PRO;
    }
}
