package com.restaurante.reservation.scheduler;

import com.restaurante.reservation.service.ReservationService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Corrige automáticamente los estados de mesa obsoletos (RESERVED sin
 * reserva CONFIRMED activa) para que nadie tenga que invocar el
 * mantenimiento manual desde Swagger.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class TableStatusScheduler {

    private final ReservationService reservationService;

    @Scheduled(fixedDelayString = "${app.maintenance.table-status-fix-delay-ms:900000}")
    public void runScheduledFix() {
        int fixed = reservationService.fixTableStatuses(null);
        if (fixed > 0) {
            log.info("[MANTENIMIENTO-AUTO] {} mesas corregidas automáticamente a AVAILABLE", fixed);
        }
    }
}
