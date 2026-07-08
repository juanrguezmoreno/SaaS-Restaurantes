package com.restaurante.reservation.service;

import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.dto.ReservationMapper;
import com.restaurante.reservation.dto.ReservationRequest;
import com.restaurante.reservation.dto.ReservationResponse;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class ReservationServiceTest {

    private static final Long RESTAURANT_ID = 1L;
    private static final Long TABLE_ID = 10L;
    private static final Long CUSTOMER_ID = 20L;
    private static final LocalDate DATE = LocalDate.of(2026, 12, 31);
    private static final LocalTime TIME = LocalTime.of(21, 0);

    @Mock private ReservationRepository reservationRepository;
    @Mock private CustomerRepository customerRepository;
    @Mock private RestaurantRepository restaurantRepository;
    @Mock private DiningTableRepository diningTableRepository;
    @Mock private ReservationMapper reservationMapper;
    @Mock private CurrentUserService currentUserService;

    @InjectMocks private ReservationService service;

    private Restaurant restaurant;
    private DiningTable table;
    private Customer customer;

    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);

        table = new DiningTable();
        table.setId(TABLE_ID);
        table.setTableNumber("1");
        table.setCapacity(4);

        customer = new Customer();
        customer.setId(CUSTOMER_ID);

        when(customerRepository.findByIdAndDeletedFalse(CUSTOMER_ID)).thenReturn(Optional.of(customer));
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        when(diningTableRepository.findByIdAndDeletedFalse(TABLE_ID)).thenReturn(Optional.of(table));
    }

    private ReservationRequest request() {
        ReservationRequest req = new ReservationRequest();
        req.setCustomerId(CUSTOMER_ID);
        req.setRestaurantId(RESTAURANT_ID);
        req.setDiningTableId(TABLE_ID);
        req.setReservationDate(DATE);
        req.setReservationTime(TIME);
        req.setPartySize(2);
        return req;
    }

    /** El mapper produce una entidad PENDING con los datos del request. */
    private void stubMapperPending() {
        when(reservationMapper.toEntity(any(ReservationRequest.class))).thenAnswer(inv -> {
            Reservation r = new Reservation();
            r.setReservationDate(DATE);
            r.setReservationTime(TIME);
            r.setPartySize(2);
            r.setStatus(ReservationStatus.PENDING);
            return r;
        });
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
    }

    @Test
    void create_rechazaReservaSolapadaEnLaMismaMesaFechaHora() {
        stubMapperPending();
        // Ya existe una reserva activa (PENDING/CONFIRMED) en ese hueco
        Reservation existente = new Reservation();
        existente.setId(99L);
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, null))
                .thenReturn(List.of(existente));

        ConflictException ex = assertThrows(ConflictException.class,
                () -> service.create(request()));
        assertTrue(ex.getMessage().contains("reserva activa"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void create_permiteReservaSiElHuecoEstaLibre() {
        stubMapperPending();
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, null))
                .thenReturn(List.of());

        assertDoesNotThrow(() -> service.create(request()));
        verify(reservationRepository).save(any(Reservation.class));
    }
}
