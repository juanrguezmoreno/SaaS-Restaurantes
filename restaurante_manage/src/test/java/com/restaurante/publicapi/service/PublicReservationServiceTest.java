package com.restaurante.publicapi.service;

import com.restaurante.availability.service.AvailabilityService;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.diningtable.entity.DiningTable;
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
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;

import java.time.LocalDate;
import java.time.LocalDateTime;
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
    @Mock private AvailabilityService availabilityService;

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
        when(customerRepository.findFirstByEmailAndRestaurantIdAndDeletedFalse("ana@test.com", RESTAURANT_ID))
                .thenReturn(Optional.of(customer));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> {
            Reservation r = inv.getArgument(0);
            r.setId(100L);
            return r;
        });

        // holdExpirationMinutes se inyecta con @Value; en Mockito vale 0 por
        // defecto y el bloqueo caducaría al instante, así que se fija aquí.
        ReflectionTestUtils.setField(service, "holdExpirationMinutes", 720);
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

    private PublicReservationRequest requestValido() {
        PublicReservationRequest request = new PublicReservationRequest();
        request.setCustomerName("Ana García");
        request.setPhone("600123456");
        request.setEmail("ana@test.com");
        request.setReservationDate(LocalDate.now().plusDays(1));
        request.setReservationTime(LocalTime.of(21, 0));
        request.setPartySize(2);
        request.setNotes("");
        return request;
    }

    private DiningTable mesaDisponible() {
        DiningTable mesa = new DiningTable();
        mesa.setId(99L);
        mesa.setTableNumber("5");
        mesa.setCapacity(4);
        mesa.setRestaurant(restaurant);
        return mesa;
    }

    @Test
    void createReservationRequest_creaPendingConMesaRetenidaCuandoNoHayDuplicado() {
        // Antes de Task 5 la solicitud pública se creaba PENDING sin mesa; ahora
        // retiene siempre una mesa compatible (ver createReservationRequest_asignaMesaYBloqueoProvisional).
        when(reservationRepository.existsByCustomerIdAndReservationDateAndReservationTimeAndStatusInAndDeletedFalse(
                eq(CUSTOMER_ID), eq(DATE), eq(TIME), any())).thenReturn(false);
        when(availabilityService.holdFirstAvailableTable(any(), any(), any(), any()))
                .thenReturn(Optional.of(mesaDisponible()));

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

    @Test
    void createReservationRequest_asignaMesaYBloqueoProvisional() {
        // Restaurante con una mesa libre de capacidad 4, reserva mañana a las 21:00.
        when(availabilityService.holdFirstAvailableTable(any(), any(), any(), any()))
                .thenReturn(Optional.of(mesaDisponible()));

        PublicReservationResponse response = service.createReservationRequest(RESTAURANT_ID, requestValido());

        ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
        verify(reservationRepository).save(captor.capture());
        Reservation guardada = captor.getValue();

        assertNotNull(guardada.getDiningTable(), "La solicitud pública debe retener una mesa");
        assertNotNull(guardada.getHoldExpiresAt(), "Debe llevar caducidad de bloqueo");
        assertEquals(ReservationStatus.PENDING, guardada.getStatus());
        assertNotNull(response.getReservationId());
    }

    @Test
    void createReservationRequest_elBloqueoNuncaSobreviveALaHoraDeLaReserva() {
        // Reserva dentro de 2 horas y caducidad configurada en 720 min (12 h):
        // debe recortarse a la hora de inicio de la reserva.
        when(availabilityService.holdFirstAvailableTable(any(), any(), any(), any()))
                .thenReturn(Optional.of(mesaDisponible()));

        LocalDateTime inicio = LocalDateTime.now().plusHours(2).withSecond(0).withNano(0);
        PublicReservationRequest request = requestValido();
        request.setReservationDate(inicio.toLocalDate());
        request.setReservationTime(inicio.toLocalTime());

        service.createReservationRequest(RESTAURANT_ID, request);

        ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
        verify(reservationRepository).save(captor.capture());

        assertEquals(inicio, captor.getValue().getHoldExpiresAt(),
                "Con 12 h de caducidad y la reserva dentro de 2 h, el bloqueo vence al empezar la reserva");
    }

    @Test
    void createReservationRequest_rechazaConflictoSiNingunaMesaAdmiteLaFranja() {
        when(availabilityService.isTableAvailable(any(), any(), any(), any(), any())).thenReturn(false);

        ConflictException ex = assertThrows(ConflictException.class,
                () -> service.createReservationRequest(RESTAURANT_ID, requestValido()));

        assertTrue(ex.getMessage().contains("acaba de ocuparse"));
        verify(reservationRepository, never()).save(any());
    }

    @Test
    void createReservationRequest_rechazaHoraYaPasadaDelDiaDeHoy() {
        PublicReservationRequest request = requestValido();
        request.setReservationDate(LocalDate.now());
        request.setReservationTime(LocalTime.of(0, 1));

        assertThrows(BadRequestException.class,
                () -> service.createReservationRequest(RESTAURANT_ID, request));
    }
}
