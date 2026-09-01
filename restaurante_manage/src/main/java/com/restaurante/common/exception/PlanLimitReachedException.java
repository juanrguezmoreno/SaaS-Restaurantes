package com.restaurante.common.exception;

import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.Resource;
import lombok.Getter;

/**
 * El tenant ha alcanzado la cuota de su plan para un recurso (locales, cuentas).
 * Lleva el detalle numérico para que la interfaz pueda decir "1 de 1" en lugar
 * de un mensaje genérico.
 */
@Getter
public class PlanLimitReachedException extends RuntimeException {

    public static final String CODE = "PLAN_LIMIT_REACHED";

    private final Resource resource;
    private final int limit;
    private final long current;
    private final PlanCode requiredPlan;

    public PlanLimitReachedException(Resource resource, int limit, long current,
                                     PlanCode requiredPlan, String message) {
        super(message);
        this.resource = resource;
        this.limit = limit;
        this.current = current;
        this.requiredPlan = requiredPlan;
    }
}
