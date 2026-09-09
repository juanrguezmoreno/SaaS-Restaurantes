package com.restaurante.subscription.enums;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SubscriptionStatusTest {

    @Test
    @DisplayName("TRIALING, ACTIVE y PAST_DUE conceden acceso")
    void estadosQueDanAcceso() {
        assertTrue(SubscriptionStatus.TRIALING.grantsAccess());
        assertTrue(SubscriptionStatus.ACTIVE.grantsAccess());
        // Un pago fallido suele ser una tarjeta caducada, no un abandono:
        // se conserva el acceso mientras Stripe reintenta.
        assertTrue(SubscriptionStatus.PAST_DUE.grantsAccess());
    }

    @Test
    @DisplayName("CANCELED, UNPAID e INCOMPLETE no conceden acceso")
    void estadosSinAcceso() {
        assertFalse(SubscriptionStatus.CANCELED.grantsAccess());
        assertFalse(SubscriptionStatus.UNPAID.grantsAccess());
        assertFalse(SubscriptionStatus.INCOMPLETE.grantsAccess());
        assertFalse(SubscriptionStatus.INCOMPLETE_EXPIRED.grantsAccess());
    }

    @Test
    @DisplayName("La reserva pública sigue abierta exactamente en los estados con acceso")
    void reservaPublicaSigueLaMismaRegla() {
        for (SubscriptionStatus estado : SubscriptionStatus.values()) {
            assertTrue(estado.grantsAccess() == estado.allowsPublicBooking(),
                    "Divergencia inesperada en " + estado);
        }
    }

    @Test
    @DisplayName("fromStripe mapea los valores de la API de Stripe")
    void mapeoDesdeStripe() {
        assertTrue(SubscriptionStatus.fromStripe("trialing") == SubscriptionStatus.TRIALING);
        assertTrue(SubscriptionStatus.fromStripe("active") == SubscriptionStatus.ACTIVE);
        assertTrue(SubscriptionStatus.fromStripe("past_due") == SubscriptionStatus.PAST_DUE);
        assertTrue(SubscriptionStatus.fromStripe("canceled") == SubscriptionStatus.CANCELED);
        assertTrue(SubscriptionStatus.fromStripe("unpaid") == SubscriptionStatus.UNPAID);
        assertTrue(SubscriptionStatus.fromStripe("incomplete") == SubscriptionStatus.INCOMPLETE);
        assertTrue(SubscriptionStatus.fromStripe("incomplete_expired")
                == SubscriptionStatus.INCOMPLETE_EXPIRED);
        // Un estado desconocido nunca debe conceder acceso por accidente.
        assertTrue(SubscriptionStatus.fromStripe("paused") == SubscriptionStatus.INCOMPLETE);
        assertTrue(SubscriptionStatus.fromStripe(null) == SubscriptionStatus.INCOMPLETE);
    }
}
