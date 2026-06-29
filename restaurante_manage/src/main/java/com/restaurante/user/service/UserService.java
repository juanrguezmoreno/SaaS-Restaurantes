package com.restaurante.user.service;

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
            return userRepository.findAll(pageable)
                    .map(userMapper::toResponse);
        }

        // ADMIN: ve solo usuarios de su tenant
        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId != null) {
            // En una implementación real, se filtraría por tenant en la BD
            // Para este demo, filtramos en memoria
            List<User> allUsers = userRepository.findAll();
            List<UserResponse> filtered = allUsers.stream()
                    .filter(u -> u.getTenant() != null && u.getTenant().getId().equals(tenantId))
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

        return Page.empty();
    }

    public UserResponse findById(Long id) {
        User user = userRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", id));

        // Verificar acceso por tenant
        if (!currentUserService.isSuperAdmin()) {
            Long tenantId = currentUserService.getCurrentTenantId();
            if (tenantId == null || user.getTenant() == null
                    || !tenantId.equals(user.getTenant().getId())) {
                throw new com.restaurante.common.exception.AccessDeniedException(
                        "No tiene permiso para acceder a este usuario");
            }
        }

        return userMapper.toResponse(user);
    }

    public UserResponse findByUsername(String username) {
        User user = userRepository.findByUsernameAndDeletedFalse(username)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario", "username", username));
        return userMapper.toResponse(user);
    }

    @Transactional
    public UserResponse create(UserRequest request) {
        validateUniqueFields(request);

        User user = userMapper.toEntity(request);
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setRoles(resolveRoles(request.getRoles()));

        // Asignar tenant
        if (request.getTenantId() != null) {
            Tenant tenant = tenantRepository.findByIdAndDeletedFalse(request.getTenantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant", "id", request.getTenantId()));
            user.setTenant(tenant);
        } else if (!currentUserService.isSuperAdmin()) {
            // Si no es SUPER_ADMIN, asignar el tenant del usuario actual
            Long currentTenantId = currentUserService.getCurrentTenantId();
            if (currentTenantId != null) {
                Tenant tenant = tenantRepository.findByIdAndDeletedFalse(currentTenantId)
                        .orElse(null);
                user.setTenant(tenant);
            }
        }

        // Asignar restaurante
        if (request.getRestaurantId() != null) {
            Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(request.getRestaurantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", request.getRestaurantId()));
            user.setRestaurant(restaurant);
        }

        User saved = userRepository.save(user);
        return userMapper.toResponse(saved);
    }

    @Transactional
    public UserResponse update(Long id, UserRequest request) {
        User user = userRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", id));

        if (!user.getUsername().equals(request.getUsername())) {
            validateUniqueFields(request);
        }

        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        user.setFirstName(request.getFirstName());
        user.setLastName(request.getLastName());
        user.setPhone(request.getPhone());

        if (request.getPassword() != null && !request.getPassword().isBlank()) {
            user.setPassword(passwordEncoder.encode(request.getPassword()));
        }

        if (request.getRoles() != null) {
            user.setRoles(resolveRoles(request.getRoles()));
        }

        // Actualizar tenant si se proporcionó
        if (request.getTenantId() != null) {
            Tenant tenant = tenantRepository.findByIdAndDeletedFalse(request.getTenantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant", "id", request.getTenantId()));
            user.setTenant(tenant);
        }

        // Actualizar restaurante si se proporcionó
        if (request.getRestaurantId() != null) {
            Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(request.getRestaurantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", request.getRestaurantId()));
            user.setRestaurant(restaurant);
        }

        User saved = userRepository.save(user);
        return userMapper.toResponse(saved);
    }

    @Transactional
    public void delete(Long id) {
        User user = userRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", id));
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
