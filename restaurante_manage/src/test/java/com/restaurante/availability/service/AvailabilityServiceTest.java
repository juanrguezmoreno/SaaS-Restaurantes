package com.restaurante.availability.service;

import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class AvailabilityServiceTest {

    private static final Long RESTAURANT_ID = 1L;
    private static final Long TABLE_ID = 10L;
    private static final LocalDate DATE = LocalDate.of(2026, 12, 31);
    private static final LocalTime TIME = LocalTime.of(21, 0);

    @Mock private DiningTableRepository diningTableRepository;
    @Mock private ReservationRepository reservationRepository;

    @InjectMocks private AvailabilityService service;

    private DiningTable table;

    @BeforeEach
    void setUp() {
        table = new DiningTable();
        table.setId(TABLE_ID);
        table.setTableNumber("1");
        table.setCapacity(4);
        table.setStatus(TableStatus.AVAILABLE);

        when(diningTableRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(table));
    }

    private AvailabilityRequest request() {
        return new AvailabilityRequest(RESTAURANT_ID, DATE, TIME, 2);
    }

    @Test
    void checkAvailability_excluyeMesaConReservaPendienteEnElMismoHueco() {
        // Reserva PENDING (RES-03 la considera activa) en ese hueco
        Reservation pendiente = new Reservation();
        pendiente.setId(99L);
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, null))
                .thenReturn(List.of(pendiente));

        List<AvailableTableResponse> result = service.checkAvailability(request());

        assertTrue(result.isEmpty(),
                "Una mesa con una reserva PENDING en el mismo hueco no debe aparecer como disponible");
    }

    @Test
    void checkAvailability_incluyeMesaSinConflictosActivos() {
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, null))
                .thenReturn(List.of());

        List<AvailableTableResponse> result = service.checkAvailability(request());

        assertEquals(1, result.size());
        assertEquals(TABLE_ID, result.get(0).getTableId());
    }
}
