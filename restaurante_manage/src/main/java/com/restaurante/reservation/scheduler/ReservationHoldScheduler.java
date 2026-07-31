package com.restaurante.reservation.scheduler;

import com.restaurante.reservation.service.ReservationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Suelta la mesa de las solicitudes públicas cuyo bloqueo provisional ha
 * caducado. Es solo higiene de datos, para que el panel no muestre una mesa
 * que ya no está retenida: el cálculo de disponibilidad descarta los bloqueos
 * caducados en el mismo instante en que vencen, sin esperar a este job.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class ReservationHoldScheduler {

    private final ReservationService reservationService;

    @Scheduled(fixedDelayString = "${app.reservations.hold-release-delay-ms:60000}")
    public void releaseExpiredHolds() {
        int liberados = reservationService.releaseExpiredHolds();
        if (liberados > 0) {
            log.info("[BLOQUEOS] {} bloqueos provisionales caducados liberados", liberados);
        }
    }
}
