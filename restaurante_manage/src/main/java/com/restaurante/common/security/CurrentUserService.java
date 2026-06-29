package com.restaurante.common.security;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.security.userdetails.UserPrincipal;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class CurrentUserService {

    private final UserRepository userRepository;
    private final RestaurantRepository restaurantRepository;

    /**
     * Constante para el rol SUPER_ADMIN.
     */
    public static final String ROLE_SUPER_ADMIN = "ROLE_SUPER_ADMIN";
    public static final String ROLE_ADMIN = "ROLE_ADMIN";
    public static final String ROLE_MANAGER = "ROLE_MANAGER";
    public static final String ROLE_EMPLOYEE = "ROLE_EMPLOYEE";

    /**
     * Obtiene el Authentication del contexto de seguridad actual.
     */
    private Authentication getAuthentication() {
        return SecurityContextHolder.getContext().getAuthentication();
    }

    /**
     * Obtiene el UserPrincipal del usuario autenticado.
     * Retorna null si no hay autenticación (endpoints públicos).
     */
    public UserPrincipal getCurrentPrincipal() {
        Authentication authentication = getAuthentication();
        if (authentication == null || !authentication.isAuthenticated()) {
            return null;
        }
        Object principal = authentication.getPrincipal();
        if (principal instanceof UserPrincipal userPrincipal) {
            return userPrincipal;
        }
        return null;
    }

    /**
     * Obtiene el ID del usuario autenticado.
     * Retorna null si no hay autenticación.
     */
    public Long getCurrentUserId() {
        UserPrincipal principal = getCurrentPrincipal();
        return principal != null ? principal.getId() : null;
    }

    /**
     * Obtiene el username del usuario autenticado.
     * Retorna null si no hay autenticación.
     */
    public String getCurrentUsername() {
        UserPrincipal principal = getCurrentPrincipal();
        return principal != null ? principal.getUsername() : null;
    }

    /**
     * Obtiene el email del usuario autenticado.
     * Retorna null si no hay autenticación.
     */
    public String getCurrentEmail() {
        UserPrincipal principal = getCurrentPrincipal();
        return principal != null ? principal.getEmail() : null;
    }

    /**
     * Obtiene el restaurantId del usuario autenticado.
     * Puede ser null si el usuario no tiene un restaurante principal asignado.
     */
    public Long getCurrentRestaurantId() {
        UserPrincipal principal = getCurrentPrincipal();
        return principal != null ? principal.getRestaurantId() : null;
    }

    /**
     * Obtiene el tenantId del usuario autenticado.
     * Puede ser null si el usuario es SUPER_ADMIN (no tiene tenant).
     */
    public Long getCurrentTenantId() {
        UserPrincipal principal = getCurrentPrincipal();
        return principal != null ? principal.getTenantId() : null;
    }

    /**
     * Obtiene los roles del usuario autenticado.
     * Retorna set vacío si no hay autenticación.
     */
    public Set<String> getCurrentRoles() {
        UserPrincipal principal = getCurrentPrincipal();
        if (principal == null) return Set.of();
        return principal.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.toSet());
    }

    /**
     * Verifica si el usuario autenticado tiene un rol específico.
     * Retorna false si no hay autenticación.
     */
    public boolean hasRole(String role) {
        return getCurrentRoles().contains(role);
    }

    /**
     * Verifica si el usuario autenticado es SUPER_ADMIN (dueño del SaaS).
     * El SUPER_ADMIN puede ver TODOS los datos de todos los tenants.
     */
    public boolean isSuperAdmin() {
        return hasRole(ROLE_SUPER_ADMIN);
    }

    /**
     * Verifica si el usuario autenticado es ADMIN de un tenant.
     * NO incluye SUPER_ADMIN.
     */
    public boolean isAdmin() {
        return hasRole(ROLE_ADMIN);
    }

    /**
     * Verifica si el usuario autenticado es MANAGER.
     */
    public boolean isManager() {
        return hasRole(ROLE_MANAGER);
    }

    /**
     * Verifica si el usuario autenticado es EMPLOYEE.
     */
    public boolean isEmployee() {
        return hasRole(ROLE_EMPLOYEE);
    }

    /**
     * Obtiene la entidad Restaurant del usuario autenticado (su restaurante principal).
     */
    public Restaurant getCurrentRestaurant() {
        Long restaurantId = getCurrentRestaurantId();
        if (restaurantId == null) {
            throw new IllegalStateException("El usuario autenticado no tiene un restaurante asociado");
        }
        return restaurantRepository.findById(restaurantId)
                .orElseThrow(() -> new IllegalStateException("Restaurante no encontrado con id: " + restaurantId));
    }

    /**
     * Obtiene la entidad User completa del usuario autenticado.
     */
    public User getCurrentUser() {
        return userRepository.findById(getCurrentUserId())
                .orElseThrow(() -> new IllegalStateException("Usuario no encontrado"));
    }

    /**
     * Valida que el usuario pueda acceder al restaurantId proporcionado.
     * Lanza AccessDeniedException si no tiene permiso.
     */
    public void validateRestaurantAccess(Long restaurantId) {
        if (!canAccessRestaurant(restaurantId)) {
            throw new AccessDeniedException(
                    "No tiene permiso para acceder a los datos de este restaurante");
        }
    }

    /**
     * Obtiene el tenantId del usuario autenticado.
     * Para SUPER_ADMIN retorna null (no restringe por tenant).
     */
    public Long getTenantIdForCurrentUser() {
        if (isSuperAdmin()) {
            return null; // SUPER_ADMIN no tiene restricción de tenant
        }
        return getCurrentTenantId();
    }

    /**
     * Obtiene los IDs de restaurantes asignados explícitamente al usuario autenticado.
     * Retorna set vacío si no tiene asignaciones o no está autenticado.
     */
    public Set<Long> getAssignedRestaurantIds() {
        UserPrincipal principal = getCurrentPrincipal();
        if (principal == null) {
            return Set.of();
        }
        return principal.getAssignedRestaurantIds();
    }

    /**
     * Obtiene los IDs de restaurantes VISIBLES para el usuario autenticado.
     *
     * Reglas de visibilidad (multi-tenant):
     * - SUPER_ADMIN: puede ver TODOS los restaurantes de todos los tenants
     * - ADMIN: puede ver TODOS los restaurantes de su tenant
     * - MANAGER con asignaciones: solo los restaurantes asignados
     * - MANAGER sin asignaciones: todos los restaurantes de su tenant
     * - EMPLOYEE con asignaciones: solo los restaurantes asignados
     * - EMPLOYEE sin asignaciones: restaurantes de su tenant que coincidan con assignedRestaurants (vacío si no tiene)
     * - CLIENT / no autenticado: retorna lista vacía (no debería llamar este método)
     */
    public List<Long> getVisibleRestaurantIds() {
        if (getCurrentPrincipal() == null) {
            return List.of();
        }

        // SUPER_ADMIN: todos los restaurantes (sin filtrar)
        if (isSuperAdmin()) {
            return List.of(); // lista vacía = "sin filtro" / todos
        }

        Long tenantId = getCurrentTenantId();
        if (tenantId == null) {
            return List.of();
        }

        Set<Long> assignedIds = getAssignedRestaurantIds();

        if (isAdmin()) {
            // ADMIN: todos los restaurantes del tenant
            return List.of(); // lista vacía = sin filtro de ID (solo por tenant)
        }

        if (isManager()) {
            if (!assignedIds.isEmpty()) {
                // MANAGER con asignaciones: solo los asignados
                return List.copyOf(assignedIds);
            }
            // MANAGER sin asignaciones: todos los restaurantes del tenant
            return List.of(); // sin filtro de ID
        }

        if (isEmployee()) {
            if (!assignedIds.isEmpty()) {
                // EMPLOYEE con asignaciones: solo los asignados
                return List.copyOf(assignedIds);
            }
            // EMPLOYEE sin asignaciones: ninguno (o según config)
            return List.of(-1L); // filtro que no coincide con nada
        }

        // Otros roles (CLIENT, etc.): sin acceso
        return List.of(-1L);
    }

    /**
     * Verifica si el usuario autenticado puede acceder al restaurantId dado.
     * Versión mejorada que considera asignaciones explícitas.
     *
     * Reglas completas:
     * - SUPER_ADMIN: acceso total (true)
     * - ADMIN: true si el restaurante pertenece a su tenant
     * - MANAGER: true si el restaurante está en su tenant Y (no tiene asignaciones O el restaurante está asignado)
     * - EMPLOYEE: true si el restaurante está en su tenant Y está asignado
     * - No autenticado: false
     */
    public boolean canAccessRestaurant(Long restaurantId) {
        if (getCurrentPrincipal() == null) {
            return false;
        }
        // SUPER_ADMIN puede acceder a todo
        if (isSuperAdmin()) {
            return true;
        }
        // Obtener datos del restaurante
        Long userTenantId = getCurrentTenantId();
        if (userTenantId == null) {
            return false;
        }
        Restaurant restaurant = restaurantRepository.findById(restaurantId).orElse(null);
        if (restaurant == null || restaurant.getDeleted()) {
            return false;
        }
        Long restaurantTenantId = restaurant.getTenant() != null ? restaurant.getTenant().getId() : null;
        // El restaurante debe pertenecer al mismo tenant
        if (!userTenantId.equals(restaurantTenantId)) {
            return false;
        }
        // ADMIN: acceso a todos los restaurantes del tenant
        if (isAdmin()) {
            return true;
        }
        // MANAGER/EMPLOYEE: verificar asignación explícita
        Set<Long> assignedIds = getAssignedRestaurantIds();
        if (isManager()) {
            // MANAGER sin asignaciones: acceso a todos los del tenant
            if (assignedIds.isEmpty()) {
                return true;
            }
            // MANAGER con asignaciones: solo los asignados
            return assignedIds.contains(restaurantId);
        }
        if (isEmployee()) {
            // EMPLOYEE: solo si está asignado explícitamente
            return assignedIds.contains(restaurantId);
        }
        // Otros roles: sin acceso
        return false;
    }
}
