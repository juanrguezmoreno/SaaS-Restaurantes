package com.restaurante.user.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.DuplicateResourceException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.dto.UserMapper;
import com.restaurante.user.dto.UserRequest;
import com.restaurante.user.dto.UserResponse;
import com.restaurante.user.dto.UserUpdateRequest;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final TenantRepository tenantRepository;
    private final RestaurantRepository restaurantRepository;
    private final PasswordEncoder passwordEncoder;
    private final UserMapper userMapper;
    private final CurrentUserService currentUserService;

    public Page<UserResponse> findAll(Pageable pageable) {
        // SUPER_ADMIN: ve todos los usuarios
        if (currentUserService.isSuperAdmin()) {
            return userRepository.findAllByDeletedFalse(pageable)
                    .map(userMapper::toResponse);
        }

        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId == null) {
            return Page.empty();
        }

        List<User> allUsers = userRepository.findAllByDeletedFalse();
        List<User> tenantUsers = allUsers.stream()
                .filter(u -> u.getTenant() != null && u.getTenant().getId().equals(tenantId))
                .collect(Collectors.toList());

        List<User> visibleUsers;
        if (currentUserService.isAdmin()) {
            // ADMIN: todos los usuarios del tenant
            visibleUsers = tenantUsers;
        } else {
            // MANAGER (u otro rol no-admin con acceso de lectura): solo usuarios
            // cuyo restaurante principal o asignado esté dentro de sus restaurantes visibles.
            List<Long> visibleRestaurantIds = currentUserService.getVisibleRestaurantIds();
            visibleUsers = tenantUsers.stream()
                    .filter(u -> userMatchesVisibleRestaurants(u, visibleRestaurantIds))
                    .collect(Collectors.toList());
        }

        List<UserResponse> filtered = visibleUsers.stream()
                .map(userMapper::toResponse)
                .collect(Collectors.toList());

        int start = (int) pageable.getOffset();
        int end = Math.min(start + pageable.getPageSize(), filtered.size());
        return new PageImpl<>(
                filtered.subList(Math.min(start, filtered.size()), end),
                pageable,
                filtered.size()
        );
    }

    private boolean userMatchesVisibleRestaurants(User user, List<Long> visibleRestaurantIds) {
        // Lista vacía = "sin filtro de ID" (ADMIN/MANAGER sin asignaciones ven todo el tenant)
        if (visibleRestaurantIds.isEmpty()) {
            return true;
        }
        if (user.getRestaurant() != null && visibleRestaurantIds.contains(user.getRestaurant().getId())) {
            return true;
        }
        return user.getAssignedRestaurants() != null && user.getAssignedRestaurants().stream()
                .anyMatch(r -> visibleRestaurantIds.contains(r.getId()));
    }

    public UserResponse findById(Long id) {
        User user = userRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", id));
        assertCanManageUser(user);

        // SEC-02: MANAGER solo puede ver el detalle de usuarios visibles según sus
        // restaurantes asignados, igual que en findAll (misma frontera de autorización
        // para el listado y el detalle).
        if (!currentUserService.isSuperAdmin() && !currentUserService.isAdmin()) {
            List<Long> visibleRestaurantIds = currentUserService.getVisibleRestaurantIds();
            if (!userMatchesVisibleRestaurants(user, visibleRestaurantIds)) {
                throw new AccessDeniedException("No tiene permiso para gestionar este usuario");
            }
        }

        return userMapper.toResponse(user);
    }

    /**
     * Autoriza que el usuario autenticado pueda gestionar (ver/editar/eliminar)
     * al usuario objetivo. Misma regla en findById/update/delete (SEC-01):
     * <ul>
     *   <li>SUPER_ADMIN: acceso global.</li>
     *   <li>Resto: solo usuarios de su MISMO inquilino, y NUNCA una cuenta SUPER_ADMIN.</li>
     * </ul>
     * Un SUPER_ADMIN no tiene tenant, por lo que la comprobación de inquilino ya
     * lo bloquea; el check explícito de rol lo hace evidente y a prueba de futuro.
     */
    private void assertCanManageUser(User target) {
        if (currentUserService.isSuperAdmin()) {
            return;
        }

        boolean targetIsSuperAdmin = target.getRoles() != null && target.getRoles().stream()
                .anyMatch(r -> r.getName() == RoleName.ROLE_SUPER_ADMIN);

        Long tenantId = currentUserService.getCurrentTenantId();
        boolean sameTenant = tenantId != null
                && target.getTenant() != null
                && tenantId.equals(target.getTenant().getId());

        if (targetIsSuperAdmin || !sameTenant) {
            throw new AccessDeniedException("No tiene permiso para gestionar este usuario");
        }
    }

    public UserResponse findByUsername(String username) {
        User user = userRepository.findByUsernameAndDeletedFalse(username)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario", "username", username));
        return userMapper.toResponse(user);
    }

    @Transactional
    public UserResponse create(UserRequest request) {
        validateUniqueFields(request);

        boolean isSuperAdmin = currentUserService.isSuperAdmin();

        // SEC-01: un no-SUPER_ADMIN no puede crear usuarios en otro inquilino
        // ni otorgar el rol SUPER_ADMIN (escalada de privilegios).
        if (!isSuperAdmin) {
            Long callerTenantId = currentUserService.getCurrentTenantId();
            if (request.getTenantId() != null && !request.getTenantId().equals(callerTenantId)) {
                throw new AccessDeniedException("No puede crear usuarios en otro inquilino");
            }
            if (requestsSuperAdminRole(request.getRoles())) {
                throw new AccessDeniedException("No puede asignar el rol SUPER_ADMIN");
            }
        }

        User user = userMapper.toEntity(request);
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setRoles(resolveRoles(request.getRoles()));

        // Asignar tenant
        if (isSuperAdmin && request.getTenantId() != null) {
            Tenant tenant = tenantRepository.findByIdAndDeletedFalse(request.getTenantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant", "id", request.getTenantId()));
            user.setTenant(tenant);
        } else if (!isSuperAdmin) {
            // No-SUPER_ADMIN: el tenant siempre es el del usuario actual, se ignora
            // cualquier tenantId del request (ya validado que coincide o es null).
            Long currentTenantId = currentUserService.getCurrentTenantId();
            if (currentTenantId != null) {
                Tenant tenant = tenantRepository.findByIdAndDeletedFalse(currentTenantId)
                        .orElse(null);
                user.setTenant(tenant);
            }
        }

        // Asignar restaurante (validando que el usuario actual tenga acceso a él)
        if (request.getRestaurantId() != null) {
            if (!isSuperAdmin) {
                currentUserService.validateRestaurantAccess(request.getRestaurantId());
            }
            Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(request.getRestaurantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", request.getRestaurantId()));
            user.setRestaurant(restaurant);
        }

        // Restaurantes asignados (multi-tenant): cada ID se valida contra el
        // acceso del usuario actual, nunca se confía en el valor del cliente.
        if (request.getRestaurantIds() != null && !request.getRestaurantIds().isEmpty()) {
            Set<Restaurant> assigned = new HashSet<>();
            for (Long restId : request.getRestaurantIds()) {
                if (!isSuperAdmin) {
                    currentUserService.validateRestaurantAccess(restId);
                }
                Restaurant r = restaurantRepository.findByIdAndDeletedFalse(restId)
                        .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restId));
                assigned.add(r);
            }
            user.setAssignedRestaurants(assigned);
        }

        User saved = userRepository.save(user);
        return userMapper.toResponse(saved);
    }

    private boolean requestsSuperAdminRole(Set<String> roleNames) {
        return roleNames != null && roleNames.stream()
                .anyMatch(name -> ("ROLE_" + name.toUpperCase())
                        .equals(RoleName.ROLE_SUPER_ADMIN.name()));
    }

    @Transactional
    public UserResponse update(Long id, UserUpdateRequest request) {
        User user = userRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", id));

        // SEC-01: solo se puede editar un usuario del propio inquilino (o SUPER_ADMIN global).
        assertCanManageUser(user);

        boolean isSuperAdmin = currentUserService.isSuperAdmin();

        if (!user.getUsername().equals(request.getUsername())
                && userRepository.existsByUsernameAndDeletedFalse(request.getUsername())) {
            throw new DuplicateResourceException(
                    "El username '" + request.getUsername() + "' ya está en uso");
        }
        if (!user.getEmail().equals(request.getEmail())
                && userRepository.existsByEmailAndDeletedFalse(request.getEmail())) {
            throw new DuplicateResourceException(
                    "El email '" + request.getEmail() + "' ya está en uso");
        }

        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        user.setFirstName(request.getFirstName());
        user.setLastName(request.getLastName());
        // El teléfono no forma parte del formulario de Empleados; solo se actualiza
        // si el caller lo informa explícitamente, para no perderlo en ediciones parciales.
        if (request.getPhone() != null) {
            user.setPhone(request.getPhone());
        }

        // USR-04: contraseña opcional — solo se re-cifra si viene informada.
        if (request.getPassword() != null && !request.getPassword().isBlank()) {
            user.setPassword(passwordEncoder.encode(request.getPassword()));
        }

        if (request.getRoles() != null) {
            // Un no-SUPER_ADMIN no puede elevar a nadie a SUPER_ADMIN.
            if (!isSuperAdmin && requestsSuperAdminRole(request.getRoles())) {
                throw new AccessDeniedException("No puede asignar el rol SUPER_ADMIN");
            }
            user.setRoles(resolveRoles(request.getRoles()));
        }

        // El cambio de inquilino queda reservado a SUPER_ADMIN.
        if (request.getTenantId() != null) {
            if (!isSuperAdmin) {
                throw new AccessDeniedException("No puede cambiar el inquilino de un usuario");
            }
            Tenant tenant = tenantRepository.findByIdAndDeletedFalse(request.getTenantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant", "id", request.getTenantId()));
            user.setTenant(tenant);
        }

        // Actualizar restaurante si se proporcionó (validando acceso).
        if (request.getRestaurantId() != null) {
            if (!isSuperAdmin) {
                currentUserService.validateRestaurantAccess(request.getRestaurantId());
            }
            Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(request.getRestaurantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", request.getRestaurantId()));
            user.setRestaurant(restaurant);
        }

        if (request.getRestaurantIds() != null && !request.getRestaurantIds().isEmpty()) {
            Set<Restaurant> assigned = new HashSet<>();
            for (Long restId : request.getRestaurantIds()) {
                if (!isSuperAdmin) {
                    currentUserService.validateRestaurantAccess(restId);
                }
                Restaurant r = restaurantRepository.findByIdAndDeletedFalse(restId)
                        .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restId));
                assigned.add(r);
            }
            user.setAssignedRestaurants(assigned);
        }

        User saved = userRepository.save(user);
        return userMapper.toResponse(saved);
    }

    @Transactional
    public void delete(Long id) {
        User user = userRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", id));
        // SEC-01: mismo control de acceso que en update.
        assertCanManageUser(user);
        user.setEnabled(false);
        user.setDeleted(true);
        user.setDeletedAt(LocalDateTime.now());
        userRepository.save(user);
    }

    public UserResponse getCurrentUser(String username) {
        return findByUsername(username);
    }

    private void validateUniqueFields(UserRequest request) {
        if (userRepository.existsByUsernameAndDeletedFalse(request.getUsername())) {
            throw new DuplicateResourceException(
                    "El username '" + request.getUsername() + "' ya está en uso");
        }
        if (userRepository.existsByEmailAndDeletedFalse(request.getEmail())) {
            throw new DuplicateResourceException(
                    "El email '" + request.getEmail() + "' ya está en uso");
        }
    }

    private Set<Role> resolveRoles(Set<String> roleNames) {
        if (roleNames == null || roleNames.isEmpty()) {
            Set<Role> defaultRole = new HashSet<>();
            defaultRole.add(roleRepository.findByName(RoleName.ROLE_CLIENT)
                    .orElseThrow(() -> new RuntimeException("Rol ROLE_CLIENT no encontrado")));
            return defaultRole;
        }

        Set<Role> roles = new HashSet<>();
        for (String name : roleNames) {
            RoleName roleName;
            try {
                roleName = RoleName.valueOf("ROLE_" + name.toUpperCase());
            } catch (IllegalArgumentException e) {
                throw new IllegalArgumentException("Rol inválido: " + name);
            }
            Role role = roleRepository.findByName(roleName)
                    .orElseThrow(() -> new RuntimeException("Rol " + roleName + " no encontrado"));
            roles.add(role);
        }
        return roles;
    }
}
