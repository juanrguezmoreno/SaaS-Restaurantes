package com.restaurante.employee.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.employee.dto.EmployeeMapper;
import com.restaurante.employee.dto.EmployeeRequest;
import com.restaurante.employee.dto.EmployeeResponse;
import com.restaurante.employee.entity.Employee;
import com.restaurante.employee.enums.EmployeeStatus;
import com.restaurante.employee.repository.EmployeeRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.Collections;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class EmployeeService {

    private static final Logger log = LoggerFactory.getLogger(EmployeeService.class);

    private final EmployeeRepository employeeRepository;
    private final RestaurantRepository restaurantRepository;
    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final TenantRepository tenantRepository;
    private final PasswordEncoder passwordEncoder;
    private final EmployeeMapper employeeMapper;
    private final CurrentUserService currentUserService;

    /**
     * Lista todos los empleados visibles para el usuario actual,
     * aplicando filtros multi-tenant y por restaurantes asignados.
     */
    public List<EmployeeResponse> findAll() {
        List<Employee> allEmployees = employeeRepository.findAllNotDeleted();

        // SUPER_ADMIN: ve todos los empleados
        if (currentUserService.isSuperAdmin()) {
            return allEmployees.stream()
                    .map(employeeMapper::toResponse)
                    .collect(Collectors.toList());
        }

        Long currentTenantId = currentUserService.getCurrentTenantId();
        if (currentTenantId == null) {
            return Collections.emptyList();
        }

        // Obtener los IDs de restaurantes visibles
        List<Long> visibleRestaurantIds = currentUserService.getVisibleRestaurantIds();

        // Filtrar empleados: deben trabajar en al menos un restaurante visible
        return allEmployees.stream()
                .filter(emp -> emp.getRestaurants() != null
                        && emp.getRestaurants().stream()
                                .anyMatch(r -> !r.getDeleted()
                                        && r.getTenant() != null
                                        && currentTenantId.equals(r.getTenant().getId())
                                        && (visibleRestaurantIds.isEmpty()
                                                || visibleRestaurantIds.contains(r.getId()))))
                .map(employeeMapper::toResponse)
                .collect(Collectors.toList());
    }

    /**
     * Busca empleados por restaurante (legacy, mantiene compatibilidad).
     */
    public List<EmployeeResponse> findByRestaurantId(Long restaurantId) {
        currentUserService.validateRestaurantAccess(restaurantId);
        return employeeRepository.findByRestaurantIdAndDeletedFalse(restaurantId).stream()
                .map(employeeMapper::toResponse)
                .collect(Collectors.toList());
    }

    /**
     * Obtiene un empleado por ID con validación de acceso.
     */
    public EmployeeResponse findById(Long id) {
        Employee employee = employeeRepository.findByIdWithRestaurants(id)
                .orElseThrow(() -> new ResourceNotFoundException("Empleado", "id", id));
        validateEmployeeAccess(employee);
        return employeeMapper.toResponse(employee);
    }

    /**
     * Crea un empleado (con o sin acceso al sistema).
     */
    @Transactional
    public EmployeeResponse create(EmployeeRequest request) {
        // 1. Validar email único
        String email = request.getEmail() != null ? request.getEmail().trim().toLowerCase() : null;
        if (email != null && !email.isEmpty()) {
            if (employeeRepository.existsByEmailAndDeletedFalse(email)) {
                throw new BadRequestException("Ya existe un empleado con ese email.");
            }
            if (userRepository.existsByEmailAndDeletedFalse(email)) {
                throw new BadRequestException("Ya existe un usuario con ese email.");
            }
        }

        // 2. Validar y obtener restaurantes
        Set<Long> restaurantIds = request.getRestaurantIds() != null ? request.getRestaurantIds() : Collections.emptySet();
        if (restaurantIds.isEmpty()) {
            throw new BadRequestException("Debe asignar al menos un restaurante.");
        }

        Set<Restaurant> restaurants = new HashSet<>();
        for (Long restId : restaurantIds) {
            currentUserService.validateRestaurantAccess(restId);
            Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restId)
                    .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restId));
            restaurants.add(restaurant);
        }

        // 3. Crear el Employee
        Employee employee = employeeMapper.toEntity(request);
        employee.setRestaurants(restaurants);
        // Legacy: asignar el primer restaurante como principal
        Restaurant firstRestaurant = restaurants.iterator().next();
        employee.setRestaurant(firstRestaurant);

        // 4. Si createUser=true, crear también el User
        if (Boolean.TRUE.equals(request.getCreateUser())) {
            if (email == null || email.isEmpty()) {
                throw new BadRequestException("El email es obligatorio para crear acceso al sistema.");
            }

            String systemRole = request.getSystemRole() != null ? request.getSystemRole() : "EMPLOYEE";
            String username = email.split("@")[0];

            // Asegurar username único
            String finalUsername = username;
            int suffix = 1;
            while (userRepository.existsByUsernameAndDeletedFalse(finalUsername)) {
                finalUsername = username + suffix;
                suffix++;
            }

            // Determinar tenant
            Tenant tenant = null;
            Long currentTenantId = currentUserService.getCurrentTenantId();
            if (currentTenantId != null) {
                tenant = tenantRepository.findByIdAndDeletedFalse(currentTenantId)
                        .orElse(null);
            }

            // Resolver rol
            String fullRoleName = "ROLE_" + systemRole.toUpperCase();
            Role role;
            try {
                RoleName rn = RoleName.valueOf(fullRoleName);
                role = roleRepository.findByName(rn)
                        .orElseThrow(() -> new RuntimeException("Rol " + fullRoleName + " no encontrado"));
            } catch (IllegalArgumentException e) {
                role = roleRepository.findByName(RoleName.ROLE_EMPLOYEE)
                        .orElseThrow(() -> new RuntimeException("Rol ROLE_EMPLOYEE no encontrado"));
            }

            // Generar contraseña
            String defaultPassword = "admin123";

            // Crear User
            User user = new User();
            user.setUsername(finalUsername);
            user.setEmail(email);
            user.setPassword(passwordEncoder.encode(defaultPassword));
            user.setFirstName(request.getFirstName());
            user.setLastName(request.getLastName());
            user.setPhone(request.getPhone());
            user.setEnabled(true);
            user.setTenant(tenant);
            user.setRestaurant(firstRestaurant);
            user.setRoles(Set.of(role));
            user.setAssignedRestaurants(restaurants);

            User savedUser = userRepository.save(user);
            employee.setUser(savedUser);
            employee.setHasSystemAccess(true);
            employee.setSystemRole(systemRole);

            log.info("Empleado con acceso al sistema creado: username={}, email={}, role={}",
                    finalUsername, email, systemRole);
        }

        // 5. Guardar empleado
        Employee saved = employeeRepository.save(employee);
        return employeeMapper.toResponse(saved);
    }

    /**
     * Actualiza un empleado existente.
     */
    @Transactional
    public EmployeeResponse update(Long id, EmployeeRequest request) {
        Employee employee = employeeRepository.findByIdWithRestaurants(id)
                .orElseThrow(() -> new ResourceNotFoundException("Empleado", "id", id));
        validateEmployeeAccess(employee);

        // Si cambia el email, verificar unicidad
        String newEmail = request.getEmail() != null ? request.getEmail().trim().toLowerCase() : null;
        if (newEmail != null && !newEmail.equals(employee.getEmail())) {
            if (employeeRepository.existsByEmailAndDeletedFalse(newEmail)) {
                throw new BadRequestException("Ya existe un empleado con ese email.");
            }
            if (userRepository.existsByEmailAndDeletedFalse(newEmail)) {
                throw new BadRequestException("Ya existe un usuario con ese email.");
            }
        }

        // Actualizar restaurantes si se proporcionan
        if (request.getRestaurantIds() != null && !request.getRestaurantIds().isEmpty()) {
            Set<Restaurant> restaurants = new HashSet<>();
            for (Long restId : request.getRestaurantIds()) {
                currentUserService.validateRestaurantAccess(restId);
                Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restId)
                        .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restId));
                restaurants.add(restaurant);
            }
            employee.setRestaurants(restaurants);
            employee.setRestaurant(restaurants.iterator().next());
        }

        employeeMapper.updateEntity(employee, request);
        Employee saved = employeeRepository.save(employee);
        return employeeMapper.toResponse(saved);
    }

    /**
     * Activa o desactiva un empleado.
     */
    @Transactional
    public EmployeeResponse toggleActive(Long id, boolean active) {
        Employee employee = employeeRepository.findByIdWithRestaurants(id)
                .orElseThrow(() -> new ResourceNotFoundException("Empleado", "id", id));
        validateEmployeeAccess(employee);

        employee.setActive(active);

        // Si tiene usuario asociado, deshabilitar/habilitar también
        if (employee.getUser() != null) {
            employee.getUser().setEnabled(active);
            userRepository.save(employee.getUser());
        }

        Employee saved = employeeRepository.save(employee);
        return employeeMapper.toResponse(saved);
    }

    /**
     * Elimina un empleado (soft delete).
     */
    @Transactional
    public void delete(Long id) {
        Employee employee = employeeRepository.findByIdWithRestaurants(id)
                .orElseThrow(() -> new ResourceNotFoundException("Empleado", "id", id));
        validateEmployeeAccess(employee);
        employee.setDeleted(true);
        employee.setDeletedAt(LocalDateTime.now());
        employeeRepository.save(employee);
    }

    /**
     * Valida que el usuario actual tenga acceso al empleado
     * (mismo tenant y restaurante visible).
     */
    private void validateEmployeeAccess(Employee employee) {
        if (currentUserService.isSuperAdmin()) {
            return;
        }

        Long currentTenantId = currentUserService.getCurrentTenantId();
        if (currentTenantId == null) {
            throw new com.restaurante.common.exception.AccessDeniedException(
                    "No tiene permiso para acceder a este empleado");
        }

        // Verificar que al menos un restaurante del empleado pertenece al tenant y es visible
        boolean hasAccess = employee.getRestaurants() != null
                && employee.getRestaurants().stream()
                        .anyMatch(r -> r.getTenant() != null
                                && currentTenantId.equals(r.getTenant().getId())
                                && currentUserService.canAccessRestaurant(r.getId()));

        if (!hasAccess) {
            // Fallback: verificar restaurante legacy
            if (employee.getRestaurant() != null
                    && employee.getRestaurant().getTenant() != null
                    && currentTenantId.equals(employee.getRestaurant().getTenant().getId())
                    && currentUserService.canAccessRestaurant(employee.getRestaurant().getId())) {
                hasAccess = true;
            }
        }

        if (!hasAccess) {
            throw new com.restaurante.common.exception.AccessDeniedException(
                    "No tiene permiso para acceder a este empleado");
        }
    }
}
