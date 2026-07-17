package com.restaurante.publicapi.ratelimit;

import org.springframework.stereotype.Component;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayDeque;
import java.util.Deque;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Límite simple en memoria para el flujo público de reservas (sin autenticación):
 * como máximo {@value #MAX_REQUESTS} solicitudes cada {@value #WINDOW_MINUTES}
 * minutos por IP. Suficiente para frenar spam básico sin añadir infraestructura
 * (Redis, bucket4j, etc.) a un SaaS de este tamaño.
 */
@Component
public class PublicReservationRateLimiter {

    private static final int MAX_REQUESTS = 5;
    private static final long WINDOW_MINUTES = 10;

    private final ConcurrentHashMap<String, Deque<Instant>> requestsByIp = new ConcurrentHashMap<>();

    public synchronized boolean tryAcquire(String clientIp) {
        Instant now = Instant.now();
        Instant windowStart = now.minus(WINDOW_MINUTES, ChronoUnit.MINUTES);

        Deque<Instant> timestamps = requestsByIp.computeIfAbsent(clientIp, k -> new ArrayDeque<>());
        while (!timestamps.isEmpty() && timestamps.peekFirst().isBefore(windowStart)) {
            timestamps.pollFirst();
        }

        if (timestamps.size() >= MAX_REQUESTS) {
            return false;
        }

        timestamps.addLast(now);
        return true;
    }
}
