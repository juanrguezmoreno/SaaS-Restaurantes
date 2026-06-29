package com.restaurante.restaurant.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.dto.RestaurantMapper;
import com.restaurante.restaurant.dto.RestaurantRequest;
import com.restaurante.restaurant.dto.RestaurantResponse;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.entity.User;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class RestaurantService {

    private final RestaurantRepository restaurantRepository;
    private final RestaurantMapper restaurantMapper;
    private final CurrentUserService currentUserService;
    private final TenantRepository tenantRepository;

    public Page<RestaurantResponse> findAll(Pageable pageable) {
        // Obtener los IDs de restaurantes visibles según el rol y asignaciones
        List<Long> visibleIds = currentUserService.getVisibleRestaurantIds();

        // Si la lista contiene -1L, significa "sin acceso a ninguno"
        if (visibleIds.size() == 1 && visibleIds.get(0) == -1L) {
            return Page.empty();
        }

        // Si la lista NO está vacía, filtrar solo esos IDs
        if (!visibleIds.isEmpty()) {
            return restaurantRepository.findByIdInAndDeletedFalse(Set.copyOf(visibleIds), pageable)
                    .map(restaurantMapper::toResponse);
        }

        // Lista vacía = "sin filtro de ID" -> aplicar filtro por rol
        // SUPER_ADMIN: ve todos los restaurantes
        if (currentUserService.isSuperAdmin()) {
            return restaurantRepository.findAllByDeletedFalse(pageable)
                    .map(restaurantMapper::toResponse);
        }

        // ADMIN/MANAGER sin asignaciones: ve solo restaurantes de su tenant
        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId != null) {
            return restaurantRepository.findByTenantIdAndDeletedFalse(tenantId, pageable)
                    .map(restaurantMapper::toResponse);
        }

        // Usuario sin tenant: no ve restaurantes
        return Page.empty();
    }

    public RestaurantResponse findById(Long id) {
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", id));

        // Si el usuario está autenticado, validar acceso
        if (currentUserService.getCurrentPrincipal() != null) {
            currentUserService.validateRestaurantAccess(id);
        }
        // Si no está autenticado (público), permitir acceso solo a restaurantes activos
        // Los endpoints públicos usan su propio flujo, así que esto está bien para GET protegido

        return restaurantMapper.toResponse(restaurant);
    }

    @Transactional
    public RestaurantResponse create(RestaurantRequest request) {
        Restaurant restaurant = restaurantMapper.toEntity(request);

        // Asignar tenant: usar el del usuario autenticado
        User currentUser = currentUserService.getCurrentUser();
        if (currentUser.getTenant() != null) {
            restaurant.setTenant(currentUser.getTenant());
        } else if (currentUserService.isSuperAdmin() && request.getTenantId() != null) {
            // SUPER_ADMIN puede crear restaurantes en cualquier tenant
            Tenant tenant = tenantRepository.findByIdAndDeletedFalse(request.getTenantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant", "id", request.getTenantId()));
            restaurant.setTenant(tenant);
        }

        Restaurant saved = restaurantRepository.save(restaurant);
        return restaurantMapper.toResponse(saved);
    }

    @Transactional
    public RestaurantResponse update(Long id, RestaurantRequest request) {
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", id));
        currentUserService.validateRestaurantAccess(id);
        restaurantMapper.updateEntity(restaurant, request);
        Restaurant saved = restaurantRepository.save(restaurant);
        return restaurantMapper.toResponse(saved);
    }

    @Transactional
    public void delete(Long id) {
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", id));
        currentUserService.validateRestaurantAccess(id);
        restaurant.setDeleted(true);
        restaurant.setDeletedAt(LocalDateTime.now());
        restaurantRepository.save(restaurant);
    }
}
