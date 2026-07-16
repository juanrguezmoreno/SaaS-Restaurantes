package com.restaurante.publicapi.ratelimit;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class PublicReservationRateLimiterTest {

    @Test
    void permiteHastaElLimiteYLuegoLoRechaza() {
        PublicReservationRateLimiter limiter = new PublicReservationRateLimiter();
        String ip = "203.0.113.10";

        for (int i = 0; i < 5; i++) {
            assertTrue(limiter.tryAcquire(ip), "La solicitud " + (i + 1) + " debería permitirse");
        }
        assertFalse(limiter.tryAcquire(ip), "La 6ª solicitud debería rechazarse");
    }

    @Test
    void ipsDistintasTienenLimitesIndependientes() {
        PublicReservationRateLimiter limiter = new PublicReservationRateLimiter();

        for (int i = 0; i < 5; i++) {
            limiter.tryAcquire("203.0.113.10");
        }
        assertFalse(limiter.tryAcquire("203.0.113.10"));
        assertTrue(limiter.tryAcquire("203.0.113.20"));
    }
}
