package com.restaurante.reservation.service;

import com.restaurante.availability.service.AvailabilityService;
import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.security.userdetails.UserPrincipal;
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
import java.time.LocalDateTime;
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
    @Mock private AvailabilityService availabilityService;

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
        table.setRestaurant(restaurant);

        customer = new Customer();
        customer.setId(CUSTOMER_ID);
        customer.setFirstName("Ana");
        customer.setLastName("García");
        customer.setEmail("ana@example.com");
        customer.setRestaurant(restaurant);

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
        doThrow(new ConflictException("La mesa 1 ya tiene una reserva que solapa con la franja solicitada."))
                .when(availabilityService).assertNoOverlap(table, DATE, TIME, null);

        ConflictException ex = assertThrows(ConflictException.class,
                () -> service.create(request()));
        assertTrue(ex.getMessage().contains("solapa"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void create_permiteReservaSiElHuecoEstaLibre() {
        stubMapperPending();

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
        otraMesa.setRestaurant(restaurant);
        when(diningTableRepository.findByIdAndDeletedFalse(otraMesaId)).thenReturn(Optional.of(otraMesa));

        stubMapperPending();
        doThrow(new ConflictException("La mesa 1 ya tiene una reserva que solapa."))
                .when(availabilityService).assertNoOverlap(eq(table), any(), any(), any());

        ReservationRequest req = request();
        req.setDiningTableId(otraMesaId);

        assertDoesNotThrow(() -> service.create(req));
        verify(reservationRepository).save(any(Reservation.class));
        verify(availabilityService, never()).assertNoOverlap(eq(table), any(), any(), any());
    }

    @Test
    void create_rechazaMesaDeOtroRestaurante() {
        Restaurant otroRestaurante = new Restaurant();
        otroRestaurante.setId(2L);
        otroRestaurante.setName("Otro Restaurante");

        DiningTable mesaAjena = new DiningTable();
        mesaAjena.setId(TABLE_ID);
        mesaAjena.setTableNumber("1");
        mesaAjena.setCapacity(4);
        mesaAjena.setRestaurant(otroRestaurante);
        when(diningTableRepository.findByIdAndDeletedFalse(TABLE_ID)).thenReturn(Optional.of(mesaAjena));

        stubMapperPending();

        com.restaurante.common.exception.BadRequestException ex = assertThrows(
                com.restaurante.common.exception.BadRequestException.class,
                () -> service.create(request()));
        assertTrue(ex.getMessage().toLowerCase().contains("no pertenece"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void update_rechazaMesaDeOtroRestaurante() {
        Restaurant otroRestaurante = new Restaurant();
        otroRestaurante.setId(2L);
        otroRestaurante.setName("Otro Restaurante");

        DiningTable mesaAjena = new DiningTable();
        mesaAjena.setId(TABLE_ID);
        mesaAjena.setTableNumber("1");
        mesaAjena.setCapacity(4);
        mesaAjena.setRestaurant(otroRestaurante);
        when(diningTableRepository.findByIdAndDeletedFalse(TABLE_ID)).thenReturn(Optional.of(mesaAjena));

        Reservation reservaExistente = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reservaExistente));

        ReservationRequest req = request();

        com.restaurante.common.exception.BadRequestException ex = assertThrows(
                com.restaurante.common.exception.BadRequestException.class,
                () -> service.update(5L, req));
        assertTrue(ex.getMessage().toLowerCase().contains("no pertenece"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void update_rechazaCapacidadInsuficienteAunqueLaReservaSeaPending() {
        DiningTable mesaPequena = new DiningTable();
        mesaPequena.setId(TABLE_ID);
        mesaPequena.setTableNumber("1");
        mesaPequena.setCapacity(2);
        mesaPequena.setRestaurant(restaurant);
        when(diningTableRepository.findByIdAndDeletedFalse(TABLE_ID)).thenReturn(Optional.of(mesaPequena));

        Reservation reservaExistente = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reservaExistente));

        ReservationRequest req = request();
        req.setPartySize(6);

        com.restaurante.common.exception.BadRequestException ex = assertThrows(
                com.restaurante.common.exception.BadRequestException.class,
                () -> service.update(5L, req));
        assertTrue(ex.getMessage().toLowerCase().contains("capacidad"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void update_limpiaHoldExpiresAtCaducadoAlAsignarMesaManualmente() {
        // Solicitud PENDING cuyo bloqueo provisional ya caducó (p.ej. el scheduler
        // ya lo dejó en el pasado) y sin mesa; el personal edita la reserva desde
        // el panel privado y le asigna mesa manualmente. Editar la solicitud es
        // gestionarla, así que debe limpiarse holdExpiresAt igual que en updateStatus.
        Reservation reservaExistente = reservaPendienteSinMesa(70L);
        reservaExistente.setHoldExpiresAt(LocalDateTime.now().minusHours(1));
        when(reservationRepository.findByIdAndDeletedFalse(70L)).thenReturn(Optional.of(reservaExistente));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.update(70L, request());

        ArgumentCaptor<Reservation> captor = ArgumentCaptor.forClass(Reservation.class);
        verify(reservationRepository).save(captor.capture());
        assertNull(captor.getValue().getHoldExpiresAt());
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
    void updateStatus_rechazaConfirmarSiNoHayMesaDisponibleParaAutoAsignar() {
        Reservation reserva = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reserva));
        when(availabilityService.assignFirstAvailableTable(restaurant, DATE, TIME, 2, 5L))
                .thenReturn(Optional.empty());

        assertThrows(com.restaurante.common.exception.BadRequestException.class,
                () -> service.updateStatus(5L, "CONFIRMED"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void updateStatus_confirmaYAsignaMesaCuandoElHuecoEstaLibre() {
        Reservation reserva = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reserva));
        when(availabilityService.assignFirstAvailableTable(restaurant, DATE, TIME, 2, 5L))
                .thenReturn(Optional.of(table));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        assertDoesNotThrow(() -> service.updateStatus(5L, "CONFIRMED"));
        assertEquals(ReservationStatus.CONFIRMED, reserva.getStatus());
        assertEquals(table, reserva.getDiningTable());
        verify(availabilityService).assertNoOverlap(table, DATE, TIME, 5L);
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
        when(availabilityService.isTableAvailable(table, DATE, TIME, 2, null)).thenReturn(true);

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
        when(availabilityService.assignFirstAvailableTable(restaurant, DATE, TIME, 2, 5L))
                .thenReturn(Optional.of(table));
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
    void updateStatus_noPublicaReservationCancelledEventSiYaEstabaCancelada() {
        Reservation reserva = reservaPendienteSinMesa(8L);
        reserva.setStatus(ReservationStatus.CANCELLED);
        reserva.setDiningTable(null);
        when(reservationRepository.findByIdAndDeletedFalse(8L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(8L, "CANCELLED");

        verify(eventPublisher, never()).publishEvent(any(ReservationCancelledEvent.class));
    }

    @Test
    void delete_marcaLaReservaComoBorradaYLiberaLaMesaSiNoEstaCanceladaNiCompletada() {
        Reservation reserva = reservaPendienteSinMesa(40L);
        reserva.setStatus(ReservationStatus.CONFIRMED);
        reserva.setDiningTable(table);
        when(reservationRepository.findByIdAndDeletedFalse(40L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.findActiveConfirmedByTableId(eq(TABLE_ID), any(LocalDate.class), any(LocalTime.class)))
                .thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));

        service.delete(40L);

        assertTrue(reserva.getDeleted());
        assertNotNull(reserva.getDeletedAt());
    }

    @Test
    void create_rechazaClienteDeOtroRestaurante() {
        Restaurant otroRestaurante = new Restaurant();
        otroRestaurante.setId(2L);
        otroRestaurante.setName("Otro Restaurante");

        Customer clienteAjeno = new Customer();
        clienteAjeno.setId(CUSTOMER_ID);
        clienteAjeno.setFirstName("Ana");
        clienteAjeno.setLastName("García");
        clienteAjeno.setEmail("ana@example.com");
        clienteAjeno.setRestaurant(otroRestaurante);
        when(customerRepository.findByIdAndDeletedFalse(CUSTOMER_ID)).thenReturn(Optional.of(clienteAjeno));

        stubMapperPending();

        com.restaurante.common.exception.BadRequestException ex = assertThrows(
                com.restaurante.common.exception.BadRequestException.class,
                () -> service.create(request()));
        assertTrue(ex.getMessage().toLowerCase().contains("no pertenece"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void update_rechazaClienteDeOtroRestauranteAlCambiarDeCliente() {
        Restaurant otroRestaurante = new Restaurant();
        otroRestaurante.setId(2L);
        otroRestaurante.setName("Otro Restaurante");

        Long otroClienteId = 21L;
        Customer clienteAjeno = new Customer();
        clienteAjeno.setId(otroClienteId);
        clienteAjeno.setFirstName("Luis");
        clienteAjeno.setLastName("Ruiz");
        clienteAjeno.setEmail("luis@example.com");
        clienteAjeno.setRestaurant(otroRestaurante);
        when(customerRepository.findByIdAndDeletedFalse(otroClienteId)).thenReturn(Optional.of(clienteAjeno));

        Reservation reservaExistente = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reservaExistente));

        ReservationRequest req = request();
        req.setCustomerId(otroClienteId);
        req.setDiningTableId(null);

        com.restaurante.common.exception.BadRequestException ex = assertThrows(
                com.restaurante.common.exception.BadRequestException.class,
                () -> service.update(5L, req));
        assertTrue(ex.getMessage().toLowerCase().contains("no pertenece"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    // ─── Matriz de transiciones de estado ─────────────────────────────────

    @Test
    void updateStatus_rechazaConfirmarUnaReservaCancelada() {
        Reservation reserva = reservaPendienteSinMesa(30L);
        reserva.setStatus(ReservationStatus.CANCELLED);
        when(reservationRepository.findByIdAndDeletedFalse(30L)).thenReturn(Optional.of(reserva));

        assertThrows(com.restaurante.common.exception.BadRequestException.class,
                () -> service.updateStatus(30L, "CONFIRMED"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void updateStatus_rechazaCompletarUnaReservaCancelada() {
        Reservation reserva = reservaPendienteSinMesa(31L);
        reserva.setStatus(ReservationStatus.CANCELLED);
        when(reservationRepository.findByIdAndDeletedFalse(31L)).thenReturn(Optional.of(reserva));

        assertThrows(com.restaurante.common.exception.BadRequestException.class,
                () -> service.updateStatus(31L, "COMPLETED"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void updateStatus_rechazaNoShowDesdeCompleted() {
        Reservation reserva = reservaPendienteSinMesa(32L);
        reserva.setStatus(ReservationStatus.COMPLETED);
        when(reservationRepository.findByIdAndDeletedFalse(32L)).thenReturn(Optional.of(reserva));

        assertThrows(com.restaurante.common.exception.BadRequestException.class,
                () -> service.updateStatus(32L, "NO_SHOW"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void updateStatus_rechazaVolverAPendingDesdeConfirmed() {
        Reservation reserva = reservaPendienteSinMesa(33L);
        reserva.setStatus(ReservationStatus.CONFIRMED);
        reserva.setDiningTable(table);
        when(reservationRepository.findByIdAndDeletedFalse(33L)).thenReturn(Optional.of(reserva));

        assertThrows(com.restaurante.common.exception.BadRequestException.class,
                () -> service.updateStatus(33L, "PENDING"));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void updateStatus_permiteCancelarDosVeces() {
        Reservation reserva = reservaPendienteSinMesa(34L);
        reserva.setStatus(ReservationStatus.CANCELLED);
        when(reservationRepository.findByIdAndDeletedFalse(34L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        assertDoesNotThrow(() -> service.updateStatus(34L, "CANCELLED"));
    }

    @Test
    void create_rechazaCapacidadInsuficienteAunqueLaReservaSeaPending() {
        DiningTable mesaPequena = new DiningTable();
        mesaPequena.setId(TABLE_ID);
        mesaPequena.setTableNumber("1");
        mesaPequena.setCapacity(2);
        mesaPequena.setRestaurant(restaurant);
        when(diningTableRepository.findByIdAndDeletedFalse(TABLE_ID)).thenReturn(Optional.of(mesaPequena));

        // El mapper debe respetar el partySize del request
        when(reservationMapper.toEntity(any(ReservationRequest.class))).thenAnswer(inv -> {
            ReservationRequest req = inv.getArgument(0);
            Reservation r = new Reservation();
            r.setReservationDate(req.getReservationDate());
            r.setReservationTime(req.getReservationTime());
            r.setPartySize(req.getPartySize());
            r.setStatus(ReservationStatus.PENDING);
            return r;
        });
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));

        ReservationRequest req = request();
        req.setPartySize(6);

        assertThrows(com.restaurante.common.exception.BadRequestException.class,
                () -> service.create(req));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    @Test
    void create_rechazaHoraYaPasadaHoy() {
        // Se calcula como LocalDateTime y luego se separa en fecha/hora: restar
        // horas directamente sobre LocalTime.now() "envuelve" cerca de
        // medianoche (p.ej. a las 00:08, minusHours(1) da 23:08, que en
        // realidad es una hora futura del mismo LocalDate.now()).
        java.time.LocalDateTime haceUnaHora = java.time.LocalDateTime.now().minusHours(1);

        when(reservationMapper.toEntity(any(ReservationRequest.class))).thenAnswer(inv -> {
            Reservation r = new Reservation();
            r.setReservationDate(haceUnaHora.toLocalDate());
            r.setReservationTime(haceUnaHora.toLocalTime());
            r.setPartySize(2);
            r.setStatus(ReservationStatus.PENDING);
            return r;
        });

        ReservationRequest req = request();
        req.setReservationDate(haceUnaHora.toLocalDate());
        req.setReservationTime(haceUnaHora.toLocalTime());

        assertThrows(com.restaurante.common.exception.BadRequestException.class,
                () -> service.create(req));
        verify(reservationRepository, never()).save(any(Reservation.class));
    }

    // ─── P0-4: mantenimiento fix-table-statuses ─────────────────────────────

    @Test
    void fixTableStatuses_denegadoParaUsuarioTenantScopedSinRestaurantId() {
        // Un ADMIN/MANAGER (principal presente, no SUPER_ADMIN) no puede convertir
        // la ausencia de restaurantId en una operación global sobre otros tenants.
        when(currentUserService.getCurrentPrincipal()).thenReturn(mock(UserPrincipal.class));
        when(currentUserService.isSuperAdmin()).thenReturn(false);

        assertThrows(AccessDeniedException.class, () -> service.fixTableStatuses(null));
        verify(diningTableRepository, never()).findByStatusAndDeletedFalse(any());
    }

    @Test
    void fixTableStatuses_globalPermitidoParaSuperAdmin() {
        when(currentUserService.getCurrentPrincipal()).thenReturn(mock(UserPrincipal.class));
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        when(diningTableRepository.findByStatusAndDeletedFalse(TableStatus.RESERVED))
                .thenReturn(List.of());

        assertDoesNotThrow(() -> service.fixTableStatuses(null));
        verify(diningTableRepository).findByStatusAndDeletedFalse(TableStatus.RESERVED);
    }

    @Test
    void fixTableStatuses_globalPermitidoParaSchedulerSinPrincipal() {
        // El job automático corre sin usuario autenticado (principal null) → global permitido.
        when(currentUserService.getCurrentPrincipal()).thenReturn(null);
        when(diningTableRepository.findByStatusAndDeletedFalse(TableStatus.RESERVED))
                .thenReturn(List.of());

        assertDoesNotThrow(() -> service.fixTableStatuses(null));
        verify(diningTableRepository).findByStatusAndDeletedFalse(TableStatus.RESERVED);
    }

    @Test
    void fixTableStatuses_conRestaurantIdValidaAcceso() {
        when(diningTableRepository.findByRestaurantIdAndStatusAndDeletedFalse(RESTAURANT_ID, TableStatus.RESERVED))
                .thenReturn(List.of());

        assertDoesNotThrow(() -> service.fixTableStatuses(RESTAURANT_ID));
        verify(currentUserService).validateRestaurantAccess(RESTAURANT_ID);
        verify(diningTableRepository, never()).findByStatusAndDeletedFalse(any());
    }

    // ─── Task 6: liberación de bloqueos provisionales ─────────────────────

    @Test
    void updateStatus_limpiaHoldExpiresAtAlConfirmar() {
        Reservation reserva = reservaPendienteSinMesa(50L);
        reserva.setHoldExpiresAt(LocalDateTime.now().plusHours(1));
        when(reservationRepository.findByIdAndDeletedFalse(50L)).thenReturn(Optional.of(reserva));
        when(availabilityService.assignFirstAvailableTable(restaurant, DATE, TIME, 2, 50L))
                .thenReturn(Optional.of(table));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(50L, "CONFIRMED");

        assertNull(reserva.getHoldExpiresAt());
    }

    @Test
    void updateStatus_limpiaHoldExpiresAtAlCancelar() {
        Reservation reserva = reservaPendienteSinMesa(51L);
        reserva.setStatus(ReservationStatus.CONFIRMED);
        reserva.setDiningTable(table);
        reserva.setHoldExpiresAt(LocalDateTime.now().minusMinutes(5));
        when(reservationRepository.findByIdAndDeletedFalse(51L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.findActiveConfirmedByTableId(eq(TABLE_ID), any(LocalDate.class), any(LocalTime.class)))
                .thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(51L, "CANCELLED");

        assertNull(reserva.getHoldExpiresAt());
    }

    @Test
    void updateStatus_limpiaHoldExpiresAtAlCancelarAunqueYaNoTengaMesa() {
        // Solicitud pública cuyo bloqueo ya había caducado y perdido la mesa
        // (p.ej. el scheduler ya la soltó); igualmente debe limpiarse el
        // marcador de bloqueo al cancelar, aunque no haya mesa que liberar.
        Reservation reserva = reservaPendienteSinMesa(52L);
        reserva.setDiningTable(null);
        reserva.setHoldExpiresAt(LocalDateTime.now().minusHours(2));
        when(reservationRepository.findByIdAndDeletedFalse(52L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(52L, "CANCELLED");

        assertNull(reserva.getHoldExpiresAt());
    }

    @Test
    void updateStatus_limpiaHoldExpiresAtAlCompletar() {
        Reservation reserva = reservaPendienteSinMesa(53L);
        reserva.setStatus(ReservationStatus.CONFIRMED);
        reserva.setDiningTable(table);
        reserva.setHoldExpiresAt(LocalDateTime.now().minusMinutes(5));
        when(reservationRepository.findByIdAndDeletedFalse(53L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.findActiveConfirmedByTableId(eq(TABLE_ID), any(LocalDate.class), any(LocalTime.class)))
                .thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(53L, "COMPLETED");

        assertNull(reserva.getHoldExpiresAt());
    }

    @Test
    void updateStatus_limpiaHoldExpiresAtAlMarcarNoShow() {
        Reservation reserva = reservaPendienteSinMesa(54L);
        reserva.setStatus(ReservationStatus.CONFIRMED);
        reserva.setDiningTable(table);
        reserva.setHoldExpiresAt(LocalDateTime.now().minusMinutes(5));
        when(reservationRepository.findByIdAndDeletedFalse(54L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.findActiveConfirmedByTableId(eq(TABLE_ID), any(LocalDate.class), any(LocalTime.class)))
                .thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(54L, "NO_SHOW");

        assertNull(reserva.getHoldExpiresAt());
    }

    // ─── Task 6: releaseExpiredHolds (scheduler de liberación) ────────────

    @Test
    void releaseExpiredHolds_liberaLaMesaYConservaElMarcadorDeCaducidad() {
        Reservation reserva = reservaPendienteSinMesa(60L);
        reserva.setDiningTable(table);
        LocalDateTime caducado = LocalDateTime.now().minusMinutes(1);
        reserva.setHoldExpiresAt(caducado);
        when(reservationRepository.findExpiredHolds(any(LocalDateTime.class))).thenReturn(List.of(reserva));
        when(reservationRepository.findActiveConfirmedByTableId(eq(TABLE_ID), any(LocalDate.class), any(LocalTime.class)))
                .thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));

        int liberados = service.releaseExpiredHolds();

        assertEquals(1, liberados);
        assertNull(reserva.getDiningTable());
        assertEquals(caducado, reserva.getHoldExpiresAt());
        assertEquals(ReservationStatus.PENDING, reserva.getStatus());
        verify(diningTableRepository).save(argThat(t -> t.getStatus() == TableStatus.AVAILABLE));
    }

    @Test
    void releaseExpiredHolds_sinBloqueosCaducadosNoHaceNada() {
        when(reservationRepository.findExpiredHolds(any(LocalDateTime.class))).thenReturn(List.of());

        int liberados = service.releaseExpiredHolds();

        assertEquals(0, liberados);
        verify(reservationRepository, never()).save(any(Reservation.class));
    }
}
