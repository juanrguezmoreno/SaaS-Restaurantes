package com.restaurante.customer.service;

import com.restaurante.common.exception.DuplicateResourceException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.dto.CustomerListItem;
import com.restaurante.customer.dto.CustomerMapper;
import com.restaurante.customer.dto.CustomerRequest;
import com.restaurante.customer.dto.CustomerReservationStats;
import com.restaurante.customer.dto.CustomerResponse;
import com.restaurante.customer.dto.CustomerSegment;
import com.restaurante.customer.dto.CustomerStats;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.reservation.dto.ReservationMapper;
import com.restaurante.reservation.dto.ReservationResponse;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class CustomerService {

    private final CustomerRepository customerRepository;
    private final UserRepository userRepository;
    private final RestaurantRepository restaurantRepository;
    private final CustomerMapper customerMapper;
    private final CurrentUserService currentUserService;
    private final ReservationRepository reservationRepository;
    private final ReservationMapper reservationMapper;

    /**
     * Lista clientes con filtros opcionales de texto, restaurante y segmento.
     *
     * <p>El alcance multi-tenant se resuelve aquí y se aplica siempre en la
     * consulta: pedir un {@code restaurantId} fuera del alcance del usuario
     * devuelve vacío, nunca datos de otro tenant.</p>
     *
     * <p>Los segmentos se resuelven en la base de datos. Antes se calculaban en
     * el navegador sobre la lista completa, de modo que al paginar habrían pasado
     * a filtrar solo la página.</p>
     *
     * @param search       texto libre sobre nombre completo, email o teléfono.
     * @param restaurantId restringe a un restaurante concreto, si se indica.
     * @param segment      segmento de clientela, o {@code null} para no filtrar.
     */
    @Transactional(readOnly = true)
    public Page<CustomerListItem> findAll(Pageable pageable, String search, Long restaurantId,
                                         CustomerSegment segment) {
        Set<Long> scope = resolveVisibleRestaurantIds();
        boolean unrestricted = scope == null;

        // Alcance vacío: el usuario no ve ningún restaurante.
        if (!unrestricted && scope.isEmpty()) {
            return Page.empty(pageable);
        }

        Page<CustomerListItem> page = customerRepository.searchForList(
                unrestricted,
                unrestricted ? Set.of(-1L) : scope,
                restaurantId,
                normalizeSearch(search),
                segment == CustomerSegment.RECURRENTES,
                segment == CustomerSegment.NUEVOS ? startOfCurrentMonth() : null,
                segment == CustomerSegment.SIN_VENIR ? inactiveThreshold() : null,
                pageable);

        return enrichListWithReservationStats(page);
    }

    /**
     * Cifras de las tarjetas, con una sola consulta agregada y en el mismo
     * alcance que el listado.
     */
    @Transactional(readOnly = true)
    public CustomerStats stats(Long restaurantId) {
        Set<Long> scope = resolveVisibleRestaurantIds();
        boolean unrestricted = scope == null;

        if (!unrestricted && scope.isEmpty()) {
            return CustomerStats.builder().build();
        }

        List<Object[]> rows = customerRepository.statsForList(
                unrestricted,
                unrestricted ? Set.of(-1L) : scope,
                restaurantId,
                startOfCurrentMonth(),
                inactiveThreshold());

        if (rows == null || rows.isEmpty() || rows.get(0) == null) {
            return CustomerStats.builder().build();
        }

        Object[] row = rows.get(0);
        return CustomerStats.builder()
                .total(toLong(row, 0))
                .recurrentes(toLong(row, 1))
                .nuevosEsteMes(toLong(row, 2))
                .sinVenir(toLong(row, 3))
                .build();
    }

    /** Primer instante del mes en curso, para el segmento de altas recientes. */
    private LocalDateTime startOfCurrentMonth() {
        return LocalDate.now().withDayOfMonth(1).atStartOfDay();
    }

    /**
     * Frontera de «sin venir»: tres meses atrás. Se calcula aquí y viaja como
     * parámetro para que H2 y MySQL den el mismo resultado.
     */
    private LocalDate inactiveThreshold() {
        return LocalDate.now().minusMonths(3);
    }

    private long toLong(Object[] row, int index) {
        if (row.length <= index || row[index] == null) {
            return 0L;
        }
        return ((Number) row[index]).longValue();
    }

    /**
     * Rellena el total de reservas y la fecha de la última para toda la página
     * del listado, con UNA sola consulta agregada.
     */
    private Page<CustomerListItem> enrichListWithReservationStats(Page<CustomerListItem> page) {
        Set<Long> customerIds = page.getContent().stream()
                .map(CustomerListItem::getId)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toSet());

        if (customerIds.isEmpty()) {
            return page;
        }

        Map<Long, CustomerReservationStats> statsById = reservationRepository
                .findStatsByCustomerIds(customerIds).stream()
                .collect(Collectors.toMap(CustomerReservationStats::getCustomerId, s -> s));

        page.getContent().forEach(customer -> {
            CustomerReservationStats stats = statsById.get(customer.getId());
            if (stats != null) {
                customer.setTotalReservations(stats.getTotalReservations());
                customer.setLastReservationDate(stats.getLastReservationDate());
            }
        });

        return page;
    }

    /**
     * Rellena el total de reservas y la fecha de la última para toda la página
     * con UNA sola consulta agregada, en vez de una por cliente.
     */
    private Page<CustomerResponse> enrichWithReservationStats(Page<CustomerResponse> page) {
        Set<Long> customerIds = page.getContent().stream()
                .map(CustomerResponse::getId)
                .filter(java.util.Objects::nonNull)
                .collect(Collectors.toSet());

        if (customerIds.isEmpty()) {
            return page;
        }

        Map<Long, CustomerReservationStats> statsById = reservationRepository
                .findStatsByCustomerIds(customerIds).stream()
                .collect(Collectors.toMap(CustomerReservationStats::getCustomerId, s -> s));

        page.getContent().forEach(customer -> {
            CustomerReservationStats stats = statsById.get(customer.getId());
            if (stats != null) {
                customer.setTotalReservations(stats.getTotalReservations());
                customer.setLastReservationDate(stats.getLastReservationDate());
            }
        });

        return page;
    }

    /**
     * Convierte el texto de búsqueda en un patrón LIKE en minúsculas.
     * Devuelve {@code null} cuando no hay nada que buscar, que es como la
     * consulta entiende "sin filtro".
     */
    private String normalizeSearch(String search) {
        if (search == null || search.isBlank()) {
            return null;
        }
        // Se escapan los comodines para que un '%' escrito por el usuario se
        // busque literalmente en vez de convertir la consulta en "todo".
        String escaped = search.trim().toLowerCase()
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
        return "%" + escaped + "%";
    }

    /**
     * Restaurantes visibles para el usuario actual.
     *
     * @return {@code null} si no hay restricción (SUPER_ADMIN ve todo); en caso
     *         contrario el conjunto de IDs visibles, que puede venir vacío
     *         cuando el usuario no tiene acceso a ninguno.
     */
    private Set<Long> resolveVisibleRestaurantIds() {
        List<Long> visibleIds = currentUserService.getVisibleRestaurantIds();

        // [-1] es el convenio de CurrentUserService para "no ve nada".
        if (visibleIds.size() == 1 && visibleIds.get(0) == -1L) {
            return Set.of();
        }

        // Asignaciones explícitas.
        if (!visibleIds.isEmpty()) {
            return Set.copyOf(visibleIds);
        }

        if (currentUserService.isSuperAdmin()) {
            return null;
        }

        // ADMIN/MANAGER sin asignaciones: todos los restaurantes de su tenant.
        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId != null) {
            return restaurantRepository.findByTenantIdAndDeletedFalse(tenantId)
                    .stream().map(Restaurant::getId).collect(Collectors.toSet());
        }

        // Último recurso: el restaurante asignado directamente al usuario.
        Long ownRestaurantId = currentUserService.getCurrentRestaurantId();
        if (ownRestaurantId != null) {
            return Set.of(ownRestaurantId);
        }

        return Set.of();
    }

    public CustomerResponse findById(Long id) {
        Customer customer = customerRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Cliente", "id", id));
        currentUserService.validateRestaurantAccess(customer.getRestaurant().getId());
        return customerMapper.toResponse(customer);
    }

    @Transactional
    public CustomerResponse create(CustomerRequest request) {
        if (customerRepository.existsByEmailAndDeletedFalse(request.getEmail())) {
            throw new DuplicateResourceException(
                    "El email '" + request.getEmail() + "' ya está registrado como cliente");
        }

        Customer customer = customerMapper.toEntity(request);

        // Asignar restaurante: usar el del usuario autenticado o el del request
        Long authRestaurantId = currentUserService.getCurrentRestaurantId();
        final Long targetRestaurantId = authRestaurantId != null ? authRestaurantId : request.getRestaurantId();
        if (targetRestaurantId == null) {
            throw new IllegalArgumentException("No se pudo determinar el restaurante para el cliente");
        }
        // P0-2: el usuario debe tener acceso al restaurante destino (evita escritura
        // cross-tenant al enviar un restaurantId de otro tenant). Coherente con update().
        currentUserService.validateRestaurantAccess(targetRestaurantId);
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(targetRestaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", targetRestaurantId));
        customer.setRestaurant(restaurant);

        if (request.getUserId() != null) {
            User user = userRepository.findByIdAndDeletedFalse(request.getUserId())
                    .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", request.getUserId()));
            customer.setUser(user);
        }

        Customer saved = customerRepository.save(customer);
        return customerMapper.toResponse(saved);
    }

    @Transactional
    public CustomerResponse update(Long id, CustomerRequest request) {
        Customer customer = customerRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Cliente", "id", id));
        currentUserService.validateRestaurantAccess(customer.getRestaurant().getId());

        if (!customer.getEmail().equals(request.getEmail())
                && customerRepository.existsByEmailAndDeletedFalse(request.getEmail())) {
            throw new DuplicateResourceException(
                    "El email '" + request.getEmail() + "' ya está registrado como cliente");
        }

        customerMapper.updateEntity(customer, request);

        if (request.getUserId() != null) {
            User user = userRepository.findByIdAndDeletedFalse(request.getUserId())
                    .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", request.getUserId()));
            customer.setUser(user);
        }

        Customer saved = customerRepository.save(customer);
        return customerMapper.toResponse(saved);
    }

    public List<ReservationResponse> getReservationHistory(Long id) {
        Customer customer = customerRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Cliente", "id", id));
        currentUserService.validateRestaurantAccess(customer.getRestaurant().getId());

        return reservationRepository.findByCustomerIdAndDeletedFalse(id).stream()
                .sorted(Comparator.comparing(r -> r.getReservationDate().atTime(r.getReservationTime()),
                        Comparator.reverseOrder()))
                .map(reservationMapper::toResponse)
                .collect(Collectors.toList());
    }

    @Transactional
    public void delete(Long id) {
        Customer customer = customerRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Cliente", "id", id));
        currentUserService.validateRestaurantAccess(customer.getRestaurant().getId());
        customer.setDeleted(true);
        customer.setDeletedAt(LocalDateTime.now());
        customerRepository.save(customer);
    }
}
