package com.restaurante.common.config;

import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

/**
 * Inicializador que corrige estados inconsistentes de mesas al arrancar.
 * Si una mesa está RESERVED pero no tiene ninguna reserva CONFIRMED activa/futura,
 * la cambia a AVAILABLE.
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class DataInitializer implements CommandLineRunner {

    private final DiningTableRepository diningTableRepository;
    private final ReservationRepository reservationRepository;

    @Override
    @Transactional
    public void run(String... args) {
        fixStaleReservedTables();
    }

    private void fixStaleReservedTables() {
        List<DiningTable> reservedTables = diningTableRepository.findByStatusAndDeletedFalse(TableStatus.RESERVED);

        if (reservedTables.isEmpty()) {
            log.info("[DataInitializer] No hay mesas RESERVED que corregir.");
            return;
        }

        LocalDate today = LocalDate.now();
        LocalTime now = LocalTime.now();
        int fixedCount = 0;

        for (DiningTable table : reservedTables) {
            List<Reservation> activeConfirmed = reservationRepository
                    .findActiveConfirmedByTableId(table.getId(), today, now);

            if (activeConfirmed.isEmpty()) {
                table.setStatus(TableStatus.AVAILABLE);
                diningTableRepository.save(table);
                fixedCount++;
                log.warn("[DataInitializer] Mesa {} (ID={}) corregida: RESERVED → AVAILABLE (sin reservas CONFIRMED activas)",
                        table.getTableNumber(), table.getId());
            } else {
                log.info("[DataInitializer] Mesa {} (ID={}) mantiene RESERVED — tiene {} reserva(s) CONFIRMED activa(s)",
                        table.getTableNumber(), table.getId(), activeConfirmed.size());
            }
        }

        if (fixedCount > 0) {
            log.info("[DataInitializer] Corrección completada: {} mesas liberadas a AVAILABLE", fixedCount);
        }
    }
}
