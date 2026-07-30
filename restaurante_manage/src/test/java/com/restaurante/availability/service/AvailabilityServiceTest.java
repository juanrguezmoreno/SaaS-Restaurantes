package com.restaurante.availability.service;

import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AvailabilityServiceTest {

    private static final Long RESTAURANT_ID = 1L;
    private static final Long TABLE_ID = 10L;
    private static final LocalDate DATE = LocalDate.of(2026, 12, 31);
    private static final LocalTime TIME = LocalTime.of(21, 0);
    private static final int DURATION_MINUTES = 90;

    @Mock private DiningTableRepository diningTableRepository;
    @Mock private ReservationRepository reservationRepository;

    @InjectMocks private AvailabilityService service;

    private Restaurant restaurant;
    private DiningTable table;

    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);
        restaurant.setName("La Buena Mesa");
        restaurant.setDefaultReservationDurationMinutes(DURATION_MINUTES);

        table = new DiningTable();
        table.setId(TABLE_ID);
        table.setTableNumber("1");
        table.setCapacity(4);
        table.setStatus(TableStatus.AVAILABLE);
        table.setRestaurant(restaurant);

        when(diningTableRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(table));
        when(diningTableRepository.findByIdAndDeletedFalseForUpdate(TABLE_ID))
                .thenReturn(Optional.of(table));
    }

    private AvailabilityRequest request() {
        return new AvailabilityRequest(RESTAURANT_ID, DATE, TIME, 2);
    }

    private Reservation reservaActiva(LocalDate fecha, LocalTime hora, ReservationStatus estado) {
        Reservation r = new Reservation();
        r.setReservationDate(fecha);
        r.setReservationTime(hora);
        r.setStatus(estado);
        return r;
    }

    // ─── checkAvailability (endpoint público de disponibilidad) ───────────

    @Test
    void checkAvailability_excluyeMesaConReservaEnHuecoQueSolapaPorDuracion() {
        // Reserva a las 20:30 (30 min antes de las 21:00 solicitadas); con
        // 90 min de duración, 20:30-22:00 solapa con 21:00-22:30.
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(20, 30), ReservationStatus.PENDING)));

        List<AvailableTableResponse> result = service.checkAvailability(request());

        assertTrue(result.isEmpty(), "Una reserva 30 min antes con 90 min de duración debe solapar");
    }

    @Test
    void checkAvailability_incluyeMesaSinConflictosActivos() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of());

        List<AvailableTableResponse> result = service.checkAvailability(request());

        assertEquals(1, result.size());
        assertEquals(TABLE_ID, result.get(0).getTableId());
    }

    // ─── isTableAvailable / hasOverlap: casos de solape requeridos ────────

    @Test
    void isTableAvailable_rechazaReservaA30MinDeDiferencia_menosQueLaDuracion() {
        // Caso 1: 20:00-21:30 existente; se pide 20:30-22:00 → solapan (30 min < 90 min)
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(20, 0), ReservationStatus.CONFIRMED)));

        boolean disponible = service.isTableAvailable(table, DATE, LocalTime.of(20, 30), 2, null);

        assertFalse(disponible);
    }

    @Test
    void isTableAvailable_permiteReservaConsecutivaExactaAlLimiteDeLaDuracion() {
        // Caso 3: 20:00-21:30 existente; se pide 21:30-23:00 → NO solapan (exactamente 90 min de diferencia)
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(20, 0), ReservationStatus.CONFIRMED)));

        boolean disponible = service.isTableAvailable(table, DATE, LocalTime.of(21, 30), 2, null);

        assertTrue(disponible);
    }

    @Test
    void isTableAvailable_detectaSolapeQueCruzaMedianoche() {
        // Reserva a las 23:30 (dura hasta la 01:00 del día siguiente); se pide
        // la misma mesa a las 00:15 del día siguiente → debe solapar.
        LocalDate diaSiguiente = DATE.plusDays(1);
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE, diaSiguiente.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(23, 30), ReservationStatus.CONFIRMED)));

        boolean disponible = service.isTableAvailable(table, diaSiguiente, LocalTime.of(0, 15), 2, null);

        assertFalse(disponible);
    }

    @Test
    void isTableAvailable_rechazaSiCapacidadInsuficiente() {
        boolean disponible = service.isTableAvailable(table, DATE, TIME, 6, null);
        assertFalse(disponible);
    }

    @Test
    void isTableAvailable_rechazaSiLaMesaEstaEnMantenimiento() {
        table.setStatus(TableStatus.MAINTENANCE);
        boolean disponible = service.isTableAvailable(table, DATE, TIME, 2, null);
        assertFalse(disponible);
    }

    @Test
    void isTableAvailable_excludeReservationIdIgnoraLaPropiaReserva() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), 99L))
                .thenReturn(List.of());

        boolean disponible = service.isTableAvailable(table, DATE, TIME, 2, 99L);

        assertTrue(disponible);
    }

    // ─── assertNoOverlap: bloqueo pesimista + 409 ─────────────────────────

    @Test
    void assertNoOverlap_lanzaConflictExceptionSiHaySolape() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, LocalTime.of(20, 30), ReservationStatus.PENDING)));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> service.assertNoOverlap(table, DATE, TIME, null));
        assertTrue(ex.getMessage().contains("solapa"));
    }

    @Test
    void assertNoOverlap_adquiereElBloqueoPesimistaAntesDeComprobar() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of());

        service.assertNoOverlap(table, DATE, TIME, null);

        org.mockito.Mockito.verify(diningTableRepository).findByIdAndDeletedFalseForUpdate(TABLE_ID);
    }

    @Test
    void assertNoOverlap_noLanzaSiNoHaySolape() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of());

        assertDoesNotThrow(() -> service.assertNoOverlap(table, DATE, TIME, null));
    }

    // ─── assignFirstAvailableTable ────────────────────────────────────────

    @Test
    void assignFirstAvailableTable_devuelveLaMesaSiEstaLibre() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of());

        Optional<DiningTable> resultado = service.assignFirstAvailableTable(restaurant, DATE, TIME, 2, null);

        assertTrue(resultado.isPresent());
        assertEquals(TABLE_ID, resultado.get().getId());
    }

    @Test
    void assignFirstAvailableTable_devuelveVacioSiNingunaEstaLibre() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, TIME, ReservationStatus.CONFIRMED)));

        Optional<DiningTable> resultado = service.assignFirstAvailableTable(restaurant, DATE, TIME, 2, null);

        assertTrue(resultado.isEmpty());
    }

    // ─── Bloqueo provisional (hold) de solicitudes públicas ──────────────

    private Reservation reservaConHold(LocalTime hora, LocalDateTime holdExpiresAt) {
        Reservation r = reservaActiva(DATE, hora, ReservationStatus.PENDING);
        r.setHoldExpiresAt(holdExpiresAt);
        return r;
    }

    @Test
    void isTableAvailable_holdVivoOcupaLaMesa() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaConHold(TIME, LocalDateTime.now().plusHours(6))));

        assertFalse(service.isTableAvailable(table, DATE, TIME, 2, null),
                "Un bloqueo provisional vivo debe ocupar la mesa");
    }

    @Test
    void isTableAvailable_holdCaducadoNoOcupaLaMesa() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaConHold(TIME, LocalDateTime.now().minusMinutes(1))));

        assertTrue(service.isTableAvailable(table, DATE, TIME, 2, null),
                "Un bloqueo provisional caducado debe liberar la mesa");
    }

    @Test
    void isTableAvailable_reservaSinHoldSiempreOcupa() {
        when(reservationRepository.findActiveByTableAndDateBetween(TABLE_ID, DATE.minusDays(1), DATE.plusDays(1), null))
                .thenReturn(List.of(reservaActiva(DATE, TIME, ReservationStatus.PENDING)));

        assertFalse(service.isTableAvailable(table, DATE, TIME, 2, null),
                "Una reserva sin bloqueo (creada desde el panel) ocupa sin límite de tiempo");
    }
}
