package com.restaurante.customer.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.dto.CustomerListItem;
import com.restaurante.customer.dto.CustomerMapper;
import com.restaurante.customer.dto.CustomerRequest;
import com.restaurante.customer.dto.CustomerResponse;
import com.restaurante.customer.dto.CustomerSegment;
import com.restaurante.customer.dto.CustomerStats;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.reservation.dto.ReservationMapper;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.List;
import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

/**
 * P0-2: aislamiento multi-tenant al crear un cliente.
 * {@code CustomerService.create} debe delegar en {@code CurrentUserService.validateRestaurantAccess}
 * sobre el restaurante destino, de modo que un usuario NUNCA pueda crear un cliente
 * en un restaurante al que no tiene acceso (otro tenant).
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class CustomerServiceTest {

    @Mock private CustomerRepository customerRepository;
    @Mock private UserRepository userRepository;
    @Mock private RestaurantRepository restaurantRepository;
    @Mock private CustomerMapper customerMapper;
    @Mock private CurrentUserService currentUserService;
    @Mock private ReservationRepository reservationRepository;
    @Mock private ReservationMapper reservationMapper;

    @InjectMocks private CustomerService service;

    private static final Long OWN_RESTAURANT = 1L;      // restaurante del tenant del usuario
    private static final Long OTHER_RESTAURANT = 99L;    // restaurante de OTRO tenant

    private Restaurant restaurant(Long id) {
        Restaurant r = new Restaurant();
        r.setId(id);
        r.setName("Restaurante " + id);
        return r;
    }

    private CustomerRequest request(Long restaurantId) {
        CustomerRequest req = new CustomerRequest();
        req.setFirstName("Ana");
        req.setLastName("García");
        req.setEmail("ana@example.com");
        req.setRestaurantId(restaurantId);
        return req;
    }

    @Test
    void create_denegadoSiElRestauranteDestinoEsDeOtroTenant() {
        CustomerRequest req = request(OTHER_RESTAURANT);
        when(customerRepository.existsByEmailAndDeletedFalse(req.getEmail())).thenReturn(false);
        when(customerMapper.toEntity(req)).thenReturn(new Customer());
        // El usuario no tiene restaurante principal → se usa el restaurantId del request
        when(currentUserService.getCurrentRestaurantId()).thenReturn(null);
        // Aunque el restaurante exista (es de otro tenant), el acceso debe denegarse
        when(restaurantRepository.findByIdAndDeletedFalse(OTHER_RESTAURANT))
                .thenReturn(Optional.of(restaurant(OTHER_RESTAURANT)));
        doThrow(new AccessDeniedException("No tiene permiso para acceder a los datos de este restaurante"))
                .when(currentUserService).validateRestaurantAccess(OTHER_RESTAURANT);

        assertThrows(AccessDeniedException.class, () -> service.create(req));
        verify(customerRepository, never()).save(any());
    }

    @Test
    void create_permitidoEnRestauranteAccesible() {
        CustomerRequest req = request(OWN_RESTAURANT);
        when(customerRepository.existsByEmailAndDeletedFalse(req.getEmail())).thenReturn(false);
        when(customerMapper.toEntity(req)).thenReturn(new Customer());
        when(currentUserService.getCurrentRestaurantId()).thenReturn(null);
        // validateRestaurantAccess(OWN_RESTAURANT) no lanza → acceso permitido
        when(restaurantRepository.findByIdAndDeletedFalse(OWN_RESTAURANT))
                .thenReturn(Optional.of(restaurant(OWN_RESTAURANT)));
        when(customerRepository.save(any(Customer.class))).thenAnswer(inv -> inv.getArgument(0));
        when(customerMapper.toResponse(any())).thenReturn(new CustomerResponse());

        assertDoesNotThrow(() -> service.create(req));
        verify(currentUserService).validateRestaurantAccess(OWN_RESTAURANT);
        verify(customerRepository).save(any(Customer.class));
    }

    // ─── Búsqueda: alcance y normalización del texto ─────────────────────────
    // La consulta en sí se verifica contra H2 en CustomerSearchRepositoryTest;
    // aquí se comprueba qué argumentos le pasa el servicio.

    /** Atajo: el repositorio devuelve una página vacía para cualquier consulta. */
    private void stubEmptyPage() {
        when(customerRepository.searchForList(anyBoolean(), anySet(), any(), any(),
                anyBoolean(), any(), any(), any()))
                .thenReturn(Page.empty());
    }

    @Test
    void findAll_usuarioSinRestaurantesVisibles_noConsultaSiquieraElRepositorio() {
        // [-1] es el convenio de CurrentUserService para "no ve ningún restaurante"
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(-1L));

        Page<CustomerListItem> result = service.findAll(Pageable.unpaged(), "andrea", null, null);

        assertTrue(result.isEmpty());
        verify(customerRepository, never()).searchForList(anyBoolean(), anySet(), any(), any(),
                anyBoolean(), any(), any(), any());
    }

    @Test
    void findAll_superAdmin_consultaSinRestriccionDeAlcance() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        stubEmptyPage();

        service.findAll(Pageable.unpaged(), null, null, null);

        verify(customerRepository).searchForList(eq(true), anySet(), isNull(), isNull(),
                eq(false), isNull(), isNull(), any());
    }

    @Test
    void findAll_usuarioConAsignaciones_acotaAsusRestaurantes() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(OWN_RESTAURANT));
        stubEmptyPage();

        service.findAll(Pageable.unpaged(), null, null, null);

        verify(customerRepository).searchForList(eq(false), eq(Set.of(OWN_RESTAURANT)), isNull(),
                isNull(), eq(false), isNull(), isNull(), any());
    }

    @Test
    void findAll_normalizaElTextoAminusculasYComodines() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(OWN_RESTAURANT));
        stubEmptyPage();

        service.findAll(Pageable.unpaged(), "  AnDrea  ", null, null);

        verify(customerRepository).searchForList(anyBoolean(), anySet(), isNull(), eq("%andrea%"),
                anyBoolean(), any(), any(), any());
    }

    @Test
    void findAll_textoEnBlancoEquivaleAsinFiltro() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(OWN_RESTAURANT));
        stubEmptyPage();

        service.findAll(Pageable.unpaged(), "   ", null, null);

        verify(customerRepository).searchForList(anyBoolean(), anySet(), isNull(), isNull(),
                anyBoolean(), any(), any(), any());
    }

    @Test
    void findAll_escapaLosComodinesEscritosPorElUsuario() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(OWN_RESTAURANT));
        stubEmptyPage();

        service.findAll(Pageable.unpaged(), "100%", null, null);

        // Sin escapar, '%' convertiría la búsqueda en "devuélvelo todo".
        verify(customerRepository).searchForList(anyBoolean(), anySet(), isNull(), eq("%100!%%"),
                anyBoolean(), any(), any(), any());
    }

    // ─── Segmentos: cada uno activa UN solo parámetro de la consulta ─────────
    // Antes se calculaban en el navegador sobre la lista completa; al paginar
    // habrían pasado a filtrar solo la página.

    @Test
    void findAll_segmentoRecurrentes_activaSoloElContadorDeReservas() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(OWN_RESTAURANT));
        stubEmptyPage();

        service.findAll(Pageable.unpaged(), null, null, CustomerSegment.RECURRENTES);

        verify(customerRepository).searchForList(anyBoolean(), anySet(), isNull(), isNull(),
                eq(true), isNull(), isNull(), any());
    }

    @Test
    void findAll_segmentoNuevos_acotaDesdeElDiaUnoDelMes() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(OWN_RESTAURANT));
        stubEmptyPage();

        service.findAll(Pageable.unpaged(), null, null, CustomerSegment.NUEVOS);

        ArgumentCaptor<LocalDateTime> desde = ArgumentCaptor.forClass(LocalDateTime.class);
        verify(customerRepository).searchForList(anyBoolean(), anySet(), isNull(), isNull(),
                eq(false), desde.capture(), isNull(), any());
        assertEquals(LocalDate.now().withDayOfMonth(1).atStartOfDay(), desde.getValue());
    }

    @Test
    void findAll_segmentoSinVenir_acotaATresMesesAtras() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(OWN_RESTAURANT));
        stubEmptyPage();

        service.findAll(Pageable.unpaged(), null, null, CustomerSegment.SIN_VENIR);

        ArgumentCaptor<LocalDate> limite = ArgumentCaptor.forClass(LocalDate.class);
        verify(customerRepository).searchForList(anyBoolean(), anySet(), isNull(), isNull(),
                eq(false), isNull(), limite.capture(), any());
        assertEquals(LocalDate.now().minusMonths(3), limite.getValue());
    }

    // ─── Cifras de las tarjetas ─────────────────────────────────────────────

    @Test
    void stats_leeLaFilaDeLaConsultaAgregada() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(OWN_RESTAURANT));
        when(customerRepository.statsForList(anyBoolean(), anySet(), any(), any(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{487L, 120L, 33L, 61L}));

        CustomerStats stats = service.stats(null);

        assertEquals(487L, stats.getTotal());
        assertEquals(120L, stats.getRecurrentes());
        assertEquals(33L, stats.getNuevosEsteMes());
        assertEquals(61L, stats.getSinVenir());
    }

    @Test
    void stats_sinAlcanceDevuelveCerosSinConsultar() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(-1L));

        CustomerStats stats = service.stats(null);

        assertEquals(0L, stats.getTotal());
        verify(customerRepository, never()).statsForList(anyBoolean(), anySet(), any(), any(), any());
    }

    @Test
    void stats_filaVaciaDevuelveCeros() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(OWN_RESTAURANT));
        when(customerRepository.statsForList(anyBoolean(), anySet(), any(), any(), any()))
                .thenReturn(List.<Object[]>of());

        CustomerStats stats = service.stats(null);

        assertEquals(0L, stats.getTotal());
        assertEquals(0L, stats.getSinVenir());
    }
}
