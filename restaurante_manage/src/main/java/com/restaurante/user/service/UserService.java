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
import com.restaurante.user.dto.AdminUserListItem;
import com.restaurante.user.dto.AssignedRestaurant;
import com.restaurante.user.dto.UserMapper;
import com.restaurante.user.dto.UserRequest;
import com.restaurante.user.dto.UserResponse;
import com.restaurante.user.dto.UserStats;
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
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
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

    /**
     * Página de empleados visibles, con búsqueda y filtros opcionales.
     *
     * <p>Antes, para ADMIN y MANAGER, este método traía todos los usuarios,
     * filtraba en memoria y paginaba con {@code subList}: el coste crecía con el
     * total del sistema aunque se pidieran diez. Ahora el alcance, la búsqueda,
     * los filtros y la ordenación se resuelven en la base de datos, y los roles
     * y restaurantes de la página se completan con dos consultas por lotes.</p>
     *
     * @param search texto libre sobre usuario, email, teléfono y nombre completo.
     * @param role   rol exigido, o {@code null} para no filtrar.
     * @param active {@code true}/{@code false} para filtrar por estado de la
     *               cuenta, o {@code null} para no filtrar.
     */
    @Transactional(readOnly = true)
    public Page<AdminUserListItem> findAll(Pageable pageable, String search, RoleName role, Boolean active) {
        UserScope scope = resolveScope();
        if (scope.denied()) {
            return Page.empty(pageable);
        }

        Page<AdminUserListItem> page = userRepository.searchForAdmin(
                scope.unrestricted(),
                scope.tenantId(),
                scope.filterByRestaurants(),
                scope.restaurantIds(),
                role != null,
                role,
                active != null,
                active != null && active,
                normalizeSearch(search),
                pageable);

        return enrichWithRolesAndRestaurants(page);
    }

    /** Métricas del listado, en el mismo alcance y con una consulta agregada. */
    @Transactional(readOnly = true)
    public UserStats stats() {
        UserScope scope = resolveScope();
        if (scope.denied()) {
            return UserStats.builder().build();
        }

        List<Object[]> rows = userRepository.statsForAdmin(
                scope.unrestricted(),
                scope.tenantId(),
                scope.filterByRestaurants(),
                scope.restaurantIds());

        if (rows == null || rows.isEmpty() || rows.get(0) == null) {
            return UserStats.builder().build();
        }

        Object[] row = rows.get(0);
        long total = row[0] != null ? ((Number) row[0]).longValue() : 0L;
        long active = row.length > 1 && row[1] != null ? ((Number) row[1]).longValue() : 0L;

        return UserStats.builder()
                .total(total)
                .active(active)
                .inactive(total - active)
                .build();
    }

    /**
     * Rellena roles y restaurantes de la página con DOS consultas, en lugar de
     * dos por fila como hacía el mapper al recorrer las colecciones.
     *
     * <p>Los restaurantes que se muestran son los asignados explícitamente; si
     * el usuario no tiene ninguno, se cae al principal, que es lo que hacía la
     * tabla antes de este cambio.</p>
     */
    private Page<AdminUserListItem> enrichWithRolesAndRestaurants(Page<AdminUserListItem> page) {
        Set<Long> ids = page.getContent().stream()
                .map(AdminUserListItem::getId)
                .filter(Objects::nonNull)
                .collect(Collectors.toSet());

        if (ids.isEmpty()) {
            return page;
        }

        Map<Long, List<String>> rolesByUser = groupNamesByUserId(
                userRepository.findRoleNamesByUserIds(ids));

        List<Object[]> restaurantRows = userRepository.findAssignedRestaurantsByUserIds(ids);
        Map<Long, List<AssignedRestaurant>> assignedByUser = new HashMap<>();
        if (restaurantRows != null) {
            for (Object[] row : restaurantRows) {
                if (row == null || row.length < 3 || row[0] == null || row[1] == null) {
                    continue;
                }
                Long userId = ((Number) row[0]).longValue();
                Long restaurantId = ((Number) row[1]).longValue();
                String restaurantName = row[2] != null ? String.valueOf(row[2]) : null;
                assignedByUser.computeIfAbsent(userId, key -> new ArrayList<>())
                        .add(new AssignedRestaurant(restaurantId, restaurantName));
            }
        }
        // Se ordena por nombre COMO PAREJAS. Ordenar dos listas por separado era
        // lo que dejaba cada nombre junto al identificador de otro restaurante.
        assignedByUser.values().forEach(lista -> lista.sort(
                Comparator.comparing(AssignedRestaurant::name,
                        Comparator.nullsLast(String::compareToIgnoreCase))));

        page.getContent().forEach(item -> {
            item.setRoles(rolesByUser.getOrDefault(item.getId(), List.of()));

            List<AssignedRestaurant> asignados = assignedByUser.getOrDefault(item.getId(), List.of());
            item.setAssignedRestaurants(asignados);
            item.setAssignedRestaurantIds(asignados.stream()
                    .map(AssignedRestaurant::id)
                    .toList());

            List<String> nombres = asignados.stream()
                    .map(AssignedRestaurant::name)
                    .filter(Objects::nonNull)
                    .toList();
            if (!nombres.isEmpty()) {
                item.setRestaurantNames(nombres);
            } else if (item.getPrimaryRestaurantName() != null) {
                // Sin asignaciones explícitas se cae al restaurante principal, que
                // es lo que mostraba la tabla antes de este cambio.
                item.setRestaurantNames(List.of(item.getPrimaryRestaurantName()));
            } else {
                item.setRestaurantNames(List.of());
            }
        });

        return page;
    }

    /** Agrupa filas {@code [userId, nombre]} por usuario, con nombres ordenados. */
    private Map<Long, List<String>> groupNamesByUserId(List<Object[]> rows) {
        Map<Long, List<String>> grouped = new HashMap<>();
        if (rows == null) {
            return grouped;
        }
        for (Object[] row : rows) {
            if (row == null || row.length < 2 || row[0] == null) {
                continue;
            }
            Long userId = ((Number) row[0]).longValue();
            String name = row[1] != null ? String.valueOf(row[1]) : null;
            if (name != null) {
                grouped.computeIfAbsent(userId, key -> new ArrayList<>()).add(name);
            }
        }
        grouped.values().forEach(java.util.Collections::sort);
        return grouped;
    }

    /**
     * Normaliza el texto de búsqueda como el resto del proyecto: minúsculas y
     * comodines escapados, para que un '%' escrito por el usuario se busque
     * literalmente en vez de convertir la consulta en "todo".
     */
    private String normalizeSearch(String search) {
        if (search == null || search.isBlank()) {
            return null;
        }
        String escaped = search.trim().toLowerCase()
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
        return "%" + escaped + "%";
    }

    /**
     * Traduce las reglas de visibilidad a los parámetros de la consulta.
     *
     * <p>Mantiene exactamente las mismas reglas que tenía el filtrado en
     * memoria: SUPER_ADMIN lo ve todo, ADMIN su cuenta completa, y MANAGER su
     * cuenta acotada a los restaurantes visibles cuando tiene asignaciones.</p>
     */
    private UserScope resolveScope() {
        if (currentUserService.isSuperAdmin()) {
            return new UserScope(true, null, false, PLACEHOLDER_IDS, false);
        }

        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId == null) {
            return new UserScope(false, null, false, PLACEHOLDER_IDS, true);
        }

        if (currentUserService.isAdmin()) {
            return new UserScope(false, tenantId, false, PLACEHOLDER_IDS, false);
        }

        List<Long> visibleRestaurantIds = currentUserService.getVisibleRestaurantIds();
        if (visibleRestaurantIds.isEmpty()) {
            // Sin filtro de restaurante: toda la cuenta.
            return new UserScope(false, tenantId, false, PLACEHOLDER_IDS, false);
        }

        return new UserScope(false, tenantId, true, Set.copyOf(visibleRestaurantIds), false);
    }

    /**
     * Los parámetros de colección de JPQL no admiten nulo ni vacío: cuando no se
     * filtra por restaurante se manda este conjunto inerte, que la consulta
     * ignora por la bandera {@code filterByRestaurants}.
     */
    private static final Set<Long> PLACEHOLDER_IDS = Set.of(-1L);

    /**
     * Alcance resuelto del listado de empleados.
     *
     * @param unrestricted        sin restricción de cuenta (solo SUPER_ADMIN).
     * @param tenantId            cuenta a la que se acota, o nulo.
     * @param filterByRestaurants exigir coincidencia con {@code restaurantIds}.
     * @param restaurantIds       restaurantes visibles; nunca nulo ni vacío.
     * @param denied              el usuario no ve ningún empleado.
     */
    private record UserScope(boolean unrestricted,
                             Long tenantId,
                             boolean filterByRestaurants,
                             Set<Long> restaurantIds,
                             boolean denied) {
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
