package com.restaurante.availability.service;

import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class AvailabilityService {

    private final DiningTableRepository diningTableRepository;
    private final ReservationRepository reservationRepository;

    /**
     * Verifica disponibilidad real de mesas para una fecha y hora determinadas.
     *
     * Una mesa está disponible si:
     * - NO está en estado MAINTENANCE
     * - Su capacidad es >= partySize
     * - NO tiene ninguna reserva CONFIRMED en la misma fecha y hora
     *
     * Las reservas PENDING, CANCELLED, COMPLETED y NO_SHOW NO bloquean disponibilidad.
     */
    public List<AvailableTableResponse> checkAvailability(AvailabilityRequest request) {
        Long restaurantId = request.getRestaurantId();
        LocalDate date = request.getDate();
        LocalTime time = request.getTime();

        // Obtener todas las mesas activas del restaurante
        List<DiningTable> allTables = diningTableRepository
                .findByRestaurantIdAndDeletedFalse(restaurantId);

        log.debug("Verificando disponibilidad: restaurante={}, fecha={}, hora={}, comensales={}",
                restaurantId, date, time, request.getPartySize());

        List<AvailableTableResponse> available = allTables.stream()
                // 1. No está en mantenimiento
                .filter(table -> table.getStatus() != TableStatus.MAINTENANCE)
                // 2. Capacidad suficiente
                .filter(table -> request.getPartySize() == null
                        || table.getCapacity() >= request.getPartySize())
                // 3. Sin reservas CONFIRMED conflictivas en la misma fecha/hora
                .filter(table -> {
                    List<Reservation> conflicts = reservationRepository
                            .findConfirmedByTableIdAndDateAndTime(table.getId(), date, time);
                    return conflicts.isEmpty();
                })
                .map(table -> {
                    log.debug("Mesa disponible: id={}, número={}, capacidad={}",
                            table.getId(), table.getTableNumber(), table.getCapacity());
                    return new AvailableTableResponse(
                            table.getId(),
                            table.getTableNumber(),
                            table.getCapacity(),
                            table.getLocation()
                    );
                })
                .collect(Collectors.toList());

        log.info("Disponibilidad para restaurante {}: {} mesas disponibles de {}",
                restaurantId, available.size(), allTables.size());

        return available;
    }
}
