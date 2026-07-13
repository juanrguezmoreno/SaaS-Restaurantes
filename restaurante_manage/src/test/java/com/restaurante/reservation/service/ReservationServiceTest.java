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
import com.restaurante.notification.event.ReservationCancelledEvent;
import com.restaurante.notification.event.ReservationConfirmedEvent;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;

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
    @Mock private ApplicationEventPublisher eventPublisher;

    @InjectMocks private ReservationService service;

    private Restaurant restaurant;
    private DiningTable table;
    private Customer customer;

    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);
        restaurant.setName("La Buena Mesa");

        table = new DiningTable();
        table.setId(TABLE_ID);
        table.setTableNumber("1");
        table.setCapacity(4);

        customer = new Customer();
        customer.setId(CUSTOMER_ID);
        customer.setFirstName("Ana");
        customer.setLastName("García");
        customer.setEmail("ana@example.com");

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

    @Test
    void create_permiteReservaEnOtraMesaALaMismaHora() {
        Long otraMesaId = 11L;
        DiningTable otraMesa = new DiningTable();
        otraMesa.setId(otraMesaId);
        otraMesa.setTableNumber("2");
        otraMesa.setCapacity(4);
        when(diningTableRepository.findByIdAndDeletedFalse(otraMesaId)).thenReturn(Optional.of(otraMesa));

        stubMapperPending();
        // La mesa 1 está ocupada, pero se pide la mesa 2, que está libre
        when(reservationRepository.findActiveConflicts(eq(TABLE_ID), eq(DATE), eq(TIME), any()))
                .thenReturn(List.of(new Reservation()));
        when(reservationRepository.findActiveConflicts(eq(otraMesaId), eq(DATE), eq(TIME), any()))
                .thenReturn(List.of());

        ReservationRequest req = request();
        req.setDiningTableId(otraMesaId);

        assertDoesNotThrow(() -> service.create(req));
        verify(reservationRepository).save(any(Reservation.class));
    }

    // ─── RES-03: confirmar una reserva tampoco puede pisar un hueco ocupado ───

    /** Reserva PENDING sin mesa asignada, lista para confirmar. */
    private Reservation reservaPendienteSinMesa(Long id) {
        Reservation r = new Reservation();
        r.setId(id);
        r.setCustomer(customer);
        r.setRestaurant(restaurant);
        r.setReservationDate(DATE);
        r.setReservationTime(TIME);
        r.setPartySize(2);
        r.setStatus(ReservationStatus.PENDING);
        return r;
    }

    @Test
    void updateStatus_noConfirmaSiLaUnicaMesaTieneOtraReservaActivaEnElHueco() {
        Reservation reserva = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reserva));
        when(diningTableRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(table));
        // La única mesa ya tiene una reserva activa (p.ej. PENDING) en ese hueco
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, 5L))
                .thenReturn(List.of(new Reservation()));

        assertThrows(com.restaurante.common.exception.BadRequestException.class,
                () -> service.updateStatus(5L, "CONFIRMED"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void updateStatus_confirmaYAsignaMesaCuandoElHuecoEstaLibre() {
        Reservation reserva = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reserva));
        when(diningTableRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(table));
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, 5L))
                .thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        assertDoesNotThrow(() -> service.updateStatus(5L, "CONFIRMED"));
        assertEquals(ReservationStatus.CONFIRMED, reserva.getStatus());
        assertEquals(table, reserva.getDiningTable());
    }

    @Test
    void findByRestaurantIdAndDate_validaAccesoYDelegaEnElRepositorio() {
        LocalDate fecha = LocalDate.of(2026, 12, 31);
        Reservation reserva = new Reservation();
        reserva.setRestaurant(restaurant);
        reserva.setDiningTable(table);
        reserva.setCustomer(customer);
        reserva.setReservationDate(fecha);
        reserva.setReservationTime(TIME);
        reserva.setPartySize(2);
        reserva.setStatus(ReservationStatus.CONFIRMED);

        when(reservationRepository.findByRestaurantIdAndReservationDateAndDeletedFalse(RESTAURANT_ID, fecha))
                .thenReturn(List.of(reserva));
        ReservationResponse response = new ReservationResponse();
        when(reservationMapper.toResponse(reserva)).thenReturn(response);

        List<ReservationResponse> resultado = service.findByRestaurantIdAndDate(RESTAURANT_ID, fecha);

        assertEquals(1, resultado.size());
        assertSame(response, resultado.get(0));
        verify(currentUserService).validateRestaurantAccess(RESTAURANT_ID);
    }

    @Test
    void findByRestaurantIdAndDate_propagaAccessDeniedSiNoTieneAcceso() {
        LocalDate fecha = LocalDate.of(2026, 12, 31);
        doThrow(new org.springframework.security.access.AccessDeniedException("sin acceso"))
                .when(currentUserService).validateRestaurantAccess(RESTAURANT_ID);

        assertThrows(org.springframework.security.access.AccessDeniedException.class,
                () -> service.findByRestaurantIdAndDate(RESTAURANT_ID, fecha));

        verify(reservationRepository, never())
                .findByRestaurantIdAndReservationDateAndDeletedFalse(any(), any());
    }

    // ─── Notificaciones por email: publicación de eventos ─────────────────

    @Test
    void create_publicaReservationConfirmedEventSiSeCreaConfirmada() {
        when(reservationMapper.toEntity(any(ReservationRequest.class))).thenAnswer(inv -> {
            Reservation r = new Reservation();
            r.setReservationDate(DATE);
            r.setReservationTime(TIME);
            r.setPartySize(2);
            r.setStatus(ReservationStatus.CONFIRMED);
            return r;
        });
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, null)).thenReturn(List.of());

        service.create(request());

        ArgumentCaptor<ReservationConfirmedEvent> captor = ArgumentCaptor.forClass(ReservationConfirmedEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
        assertEquals("ana@example.com", captor.getValue().data().customerEmail());
    }

    @Test
    void updateStatus_publicaReservationConfirmedEventAlConfirmar() {
        Reservation reserva = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reserva));
        when(diningTableRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(table));
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, 5L)).thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(5L, "CONFIRMED");

        ArgumentCaptor<ReservationConfirmedEvent> captor = ArgumentCaptor.forClass(ReservationConfirmedEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
    }

    @Test
    void updateStatus_publicaReservationCancelledEventAlCancelar() {
        Reservation reserva = reservaPendienteSinMesa(6L);
        reserva.setStatus(ReservationStatus.CONFIRMED);
        reserva.setDiningTable(table);
        when(reservationRepository.findByIdAndDeletedFalse(6L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.findActiveConfirmedByTableId(eq(TABLE_ID), any(LocalDate.class), any(LocalTime.class)))
                .thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(6L, "CANCELLED");

        ArgumentCaptor<ReservationCancelledEvent> captor = ArgumentCaptor.forClass(ReservationCancelledEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
    }

    @Test
    void cancel_publicaReservationCancelledEvent() {
        Reservation reserva = reservaPendienteSinMesa(7L);
        reserva.setStatus(ReservationStatus.CONFIRMED);
        reserva.setDiningTable(table);
        when(reservationRepository.findByIdAndDeletedFalse(7L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.findActiveConfirmedByTableId(eq(TABLE_ID), any(LocalDate.class), any(LocalTime.class)))
                .thenReturn(List.of());

        service.cancel(7L);

        ArgumentCaptor<ReservationCancelledEvent> captor = ArgumentCaptor.forClass(ReservationCancelledEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
    }
}
