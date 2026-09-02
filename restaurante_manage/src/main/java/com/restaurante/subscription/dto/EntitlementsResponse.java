package com.restaurante.subscription.dto;

import java.util.Map;
import java.util.Set;

/**
 * Lo que puede hacer el tenant del usuario actual. Lo consume toda la interfaz y
 * lo puede leer cualquier rol: NO contiene ningún dato de facturación.
 */
public record EntitlementsResponse(
        String plan,
        boolean hasAccess,
        String status,
        Set<String> features,
        Map<String, Object> limits,
        Map<String, Long> usage,
        boolean billingConfigured
) {}
