package com.restaurante.customer.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.dto.CustomerMapper;
import com.restaurante.customer.dto.CustomerRequest;
import com.restaurante.customer.dto.CustomerResponse;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.reservation.dto.ReservationMapper;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;

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
}
