package com.restaurante.common.exception;

import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import lombok.Getter;

/**
 * El tenant intenta usar una funcionalidad que su plan no incluye.
 *
 * Es distinto de AccessDeniedException a propósito: allí el problema es QUIÉN
 * eres (rol), aquí es QUÉ ha contratado tu empresa. El frontend necesita
 * distinguirlos para mostrar un diálogo de mejora de plan en vez de un error.
 */
@Getter
public class PlanUpgradeRequiredException extends RuntimeException {

    public static final String CODE = "PLAN_UPGRADE_REQUIRED";

    private final Feature feature;
    private final PlanCode requiredPlan;

    public PlanUpgradeRequiredException(Feature feature, PlanCode requiredPlan, String message) {
        super(message);
        this.feature = feature;
        this.requiredPlan = requiredPlan;
    }
}
