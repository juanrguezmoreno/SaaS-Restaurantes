package com.restaurante.availability.service;

import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Autoridad única de disponibilidad de mesas: capacidad, mantenimiento y
 * solape de horario. Tanto el endpoint público de disponibilidad como
 * {@code ReservationService} (crear, editar, confirmar, reasignar) pasan
 * por aquí — ninguna otra clase reimplementa esta lógica.
 *
 * El solape se calcula por INTERVALO horario, no por igualdad exacta de
 * hora: cada reserva ocupa la mesa desde {@code reservationTime} durante
 * {@code Restaurant.defaultReservationDurationMinutes} minutos. Dos reservas
 * de la misma mesa solapan si sus intervalos [inicio, fin) se cruzan.
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class AvailabilityService {

    private final DiningTableRepository diningTableRepository;
    private final ReservationRepository reservationRepository;

    /**
     * Verifica disponibilidad real de mesas para una fecha y hora determinadas.
     * Las reservas CANCELLED, COMPLETED y NO_SHOW NO bloquean disponibilidad.
     */
    public List<AvailableTableResponse> checkAvailability(AvailabilityRequest request) {
        List<DiningTable> allTables = diningTableRepository
                .findByRestaurantIdAndDeletedFalse(request.getRestaurantId());

        log.debug("Verificando disponibilidad: restaurante={}, fecha={}, hora={}, comensales={}",
                request.getRestaurantId(), request.getDate(), request.getTime(), request.getPartySize());

        List<AvailableTableResponse> available = allTables.stream()
                .filter(table -> isTableAvailable(table, request.getDate(), request.getTime(),
                        request.getPartySize(), null))
                .map(table -> new AvailableTableResponse(
                        table.getId(), table.getTableNumber(), table.getCapacity(), table.getLocation()))
                .collect(Collectors.toList());

        log.info("Disponibilidad para restaurante {}: {} mesas disponibles de {}",
                request.getRestaurantId(), available.size(), allTables.size());

        return available;
    }

    /**
     * Verifica si una mesa está disponible para una reserva en una fecha/hora
     * concretas: capacidad suficiente, no está en MAINTENANCE, y no solapa con
     * ninguna otra reserva ACTIVA (PENDING/CONFIRMED) de esa mesa.
     * {@code excludeReservationId} ignora la propia reserva al editar/reconfirmar.
     */
    public boolean isTableAvailable(DiningTable table, LocalDate date, LocalTime time,
                                     Integer partySize, Long excludeReservationId) {
        if (partySize != null && table.getCapacity() < partySize) {
            log.debug("Mesa {} NO disponible: capacidad {} < comensales {}", table.getId(), table.getCapacity(), partySize);
            return false;
        }
        if (table.getStatus() == TableStatus.MAINTENANCE) {
            log.debug("Mesa {} NO disponible: está en MANTENIMIENTO", table.getId());
            return false;
        }
        return !hasOverlap(table, date, time, excludeReservationId);
    }

    /**
     * Lanza {@link ConflictException} (HTTP 409) si la mesa tiene una reserva
     * activa cuyo intervalo horario solapa con el solicitado. Adquiere un
     * bloqueo pesimista sobre la fila de la mesa ANTES de comprobar el solape,
     * para serializar dos transacciones que compitan por la misma mesa
     * (ver Task 4: se combina con aislamiento READ_COMMITTED en el llamador).
     */
    public void assertNoOverlap(DiningTable table, LocalDate date, LocalTime time, Long excludeReservationId) {
        DiningTable lockedTable = diningTableRepository.findByIdAndDeletedFalseForUpdate(table.getId())
                .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", table.getId()));

        if (hasOverlap(lockedTable, date, time, excludeReservationId)) {
            int duration = lockedTable.getRestaurant().getDefaultReservationDurationMinutes();
            throw new ConflictException("La mesa " + lockedTable.getTableNumber()
                    + " ya tiene una reserva que solapa con la franja de " + time + " a "
                    + time.plusMinutes(duration) + " el " + date + ".");
        }
    }

    /**
     * Busca la primera mesa del restaurante disponible para la fecha/hora/comensales
     * indicados. No adquiere bloqueo (solo escaneo de candidatas); el bloqueo se
     * adquiere después, cuando se llama a {@link #assertNoOverlap} sobre la mesa elegida.
     */
    public Optional<DiningTable> assignFirstAvailableTable(Restaurant restaurant, LocalDate date, LocalTime time,
                                                            Integer partySize, Long excludeReservationId) {
        return diningTableRepository.findByRestaurantIdAndDeletedFalse(restaurant.getId()).stream()
                .filter(t -> isTableAvailable(t, date, time, partySize, excludeReservationId))
                .findFirst();
    }

    /**
     * Calcula si el intervalo [time, time+duración) de la mesa solicitada
     * solapa con el de alguna reserva activa existente. Se consultan las
     * reservas de esa mesa en el rango [fecha-1, fecha+1] (no solo el mismo
     * día) para detectar solapes que cruzan medianoche.
     */
    private boolean hasOverlap(DiningTable table, LocalDate date, LocalTime time, Long excludeReservationId) {
        int durationMinutes = table.getRestaurant().getDefaultReservationDurationMinutes();
        LocalDateTime start = LocalDateTime.of(date, time);
        LocalDateTime end = start.plusMinutes(durationMinutes);

        List<Reservation> candidatas = reservationRepository.findActiveByTableAndDateBetween(
                table.getId(), date.minusDays(1), date.plusDays(1), excludeReservationId);

        for (Reservation candidata : candidatas) {
            LocalDateTime otroInicio = LocalDateTime.of(candidata.getReservationDate(), candidata.getReservationTime());
            LocalDateTime otroFin = otroInicio.plusMinutes(durationMinutes);
            if (start.isBefore(otroFin) && otroInicio.isBefore(end)) {
                return true;
            }
        }
        return false;
    }
}
