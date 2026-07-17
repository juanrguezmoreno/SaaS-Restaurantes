package com.restaurante.publicapi.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.publicapi.dto.PublicReservationRequest;
import com.restaurante.publicapi.dto.PublicReservationResponse;
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
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PublicReservationServiceTest {

    private static final Long RESTAURANT_ID = 1L;
    private static final Long CUSTOMER_ID = 20L;
    private static final LocalDate DATE = LocalDate.now().plusDays(1);
    private static final LocalTime TIME = LocalTime.of(21, 0);

    @Mock private RestaurantRepository restaurantRepository;
    @Mock private CustomerRepository customerRepository;
    @Mock private ReservationRepository reservationRepository;

    @InjectMocks private PublicReservationService service;

    private Restaurant restaurant;
    private Customer customer;

    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);
        restaurant.setName("La Buena Mesa");
        restaurant.setPublicBookingEnabled(true);

        customer = new Customer();
        customer.setId(CUSTOMER_ID);
        customer.setRestaurant(restaurant);
        customer.setFirstName("Ana");
        customer.setLastName("García");
        customer.setEmail("ana@example.com");

        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        when(customerRepository.findFirstByEmailAndRestaurantIdAndDeletedFalse("ana@example.com", RESTAURANT_ID))
                .thenReturn(Optional.of(customer));
    }

    private PublicReservationRequest request() {
        PublicReservationRequest req = new PublicReservationRequest();
        req.setCustomerName("Ana García");
        req.setPhone("555-000-0000");
        req.setEmail("ana@example.com");
        req.setReservationDate(DATE);
        req.setReservationTime(TIME);
        req.setPartySize(2);
        return req;
    }

    @Test
    void createReservationRequest_creaPendingSinMesaCuandoNoHayDuplicado() {
        when(reservationRepository.existsByCustomerIdAndReservationDateAndReservationTimeAndStatusInAndDeletedFalse(
                eq(CUSTOMER_ID), eq(DATE), eq(TIME), any())).thenReturn(false);
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> {
            Reservation r = inv.getArgument(0);
            r.setId(100L);
            return r;
        });

        PublicReservationResponse response = service.createReservationRequest(RESTAURANT_ID, request());

        assertEquals("PENDING", response.getStatus());
        verify(reservationRepository).save(any(Reservation.class));
    }

    @Test
    void createReservationRequest_rechazaDuplicadoExacto() {
        when(reservationRepository.existsByCustomerIdAndReservationDateAndReservationTimeAndStatusInAndDeletedFalse(
                eq(CUSTOMER_ID), eq(DATE), eq(TIME), any())).thenReturn(true);

        assertThrows(ConflictException.class, () -> service.createReservationRequest(RESTAURANT_ID, request()));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void createReservationRequest_rechazaSiElRestauranteNoAceptaReservasPublicas() {
        restaurant.setPublicBookingEnabled(false);

        assertThrows(BadRequestException.class, () -> service.createReservationRequest(RESTAURANT_ID, request()));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void createReservationRequest_lanza404SiElRestauranteNoExiste() {
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.empty());

        assertThrows(ResourceNotFoundException.class, () -> service.createReservationRequest(RESTAURANT_ID, request()));
    }
}
