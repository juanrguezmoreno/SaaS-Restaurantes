package com.restaurante.customer.service;

import com.restaurante.common.exception.DuplicateResourceException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.dto.CustomerMapper;
import com.restaurante.customer.dto.CustomerRequest;
import com.restaurante.customer.dto.CustomerResponse;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
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

import java.time.LocalDateTime;
import java.util.List;
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

    public Page<CustomerResponse> findAll(Pageable pageable) {
        // Obtener IDs de restaurantes visibles según rol y asignaciones
        List<Long> visibleIds = currentUserService.getVisibleRestaurantIds();

        // Si contiene -1L, sin acceso a ninguno
        if (visibleIds.size() == 1 && visibleIds.get(0) == -1L) {
            return Page.empty();
        }

        // Si hay IDs específicos, filtrar por ellos
        if (!visibleIds.isEmpty()) {
            return customerRepository.findByRestaurantIdInAndDeletedFalse(Set.copyOf(visibleIds), pageable)
                    .map(customerMapper::toResponse);
        }

        // SUPER_ADMIN: ve todos los clientes
        if (currentUserService.isSuperAdmin()) {
            return customerRepository.findAllByDeletedFalse(pageable)
                    .map(customerMapper::toResponse);
        }

        // ADMIN/MANAGER sin asignaciones: filtrar por restaurantes del tenant
        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId != null) {
            Set<Long> restaurantIds = restaurantRepository.findByTenantIdAndDeletedFalse(tenantId)
                    .stream().map(Restaurant::getId).collect(Collectors.toSet());
            if (restaurantIds.isEmpty()) {
                return Page.empty();
            }
            return customerRepository.findByRestaurantIdInAndDeletedFalse(restaurantIds, pageable)
                    .map(customerMapper::toResponse);
        }

        // Fallback: restaurante asignado directamente
        Long restaurantId = currentUserService.getCurrentRestaurantId();
        if (restaurantId != null) {
            return customerRepository.findByRestaurantIdAndDeletedFalse(restaurantId, pageable)
                    .map(customerMapper::toResponse);
        }

        return Page.empty();
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
