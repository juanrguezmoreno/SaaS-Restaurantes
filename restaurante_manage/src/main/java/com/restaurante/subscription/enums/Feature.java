package com.restaurante.subscription.enums;

/**
 * Capacidades que un plan puede incluir. Son cosas que el TENANT contrata, no
 * permisos del usuario: eso último son los roles, y se comprueban aparte.
 */
public enum Feature {
    /** Más de un restaurante por tenant. */
    MULTI_RESTAURANT,
    /** Estadísticas con histórico completo, más allá de los últimos 7 días. */
    ADVANCED_ANALYTICS,
    /** Exportación de datos a CSV. */
    EXPORT_DATA,
    /** Reservada para el futuro editor de roles. Declarada, aún sin consumidor. */
    ADVANCED_PERMISSIONS,
    /** Reservada. Declarada, aún sin consumidor. */
    AUTOMATIONS,
    /** Reservada. Declarada, aún sin consumidor. */
    CUSTOMER_REMINDERS
}
