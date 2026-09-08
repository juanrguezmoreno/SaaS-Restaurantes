package com.restaurante.employee.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.employee.dto.EmployeeMapper;
import com.restaurante.employee.dto.EmployeeRequest;
import com.restaurante.employee.dto.EmployeeResponse;
import com.restaurante.employee.entity.Employee;
import com.restaurante.employee.repository.EmployeeRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.subscription.service.EntitlementService;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

/**
 * P0-1: un usuario tenant-scoped no puede escalar privilegios al crear un empleado
 * con acceso al sistema. {@code EmployeeService.create} debe aplicar una whitelist
 * explícita de roles asignables:
 *   - SUPER_ADMIN: puede asignar ADMIN, MANAGER, EMPLOYEE.
 *   - ADMIN (y cualquier no-SUPER_ADMIN): solo MANAGER, EMPLOYEE.
 *   - Nadie puede asignar SUPER_ADMIN por este flujo.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class EmployeeServiceTest {

    @Mock private EmployeeRepository employeeRepository;
    @Mock private RestaurantRepository restaurantRepository;
    @Mock private UserRepository userRepository;
    @Mock private RoleRepository roleRepository;
    @Mock private TenantRepository tenantRepository;
    @Mock private PasswordEncoder passwordEncoder;
    @Mock private EmployeeMapper employeeMapper;
    @Mock private CurrentUserService currentUserService;
    // No hace falta stub: por defecto no hace nada (no lanza), como si hubiera cuota libre.
    @Mock private EntitlementService entitlementService;

    @InjectMocks private EmployeeService service;

    private static final Long RESTAURANT_ID = 1L;
    private static final Long TENANT_ID = 1L;

    @BeforeEach
    void setUp() {
        Restaurant restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);
        Tenant tenant = new Tenant();
        tenant.setId(TENANT_ID);

        // Camino común de create() con acceso al sistema
        when(employeeRepository.existsByEmailAndDeletedFalse(anyString())).thenReturn(false);
        when(userRepository.existsByEmailAndDeletedFalse(anyString())).thenReturn(false);
        when(userRepository.existsByUsernameAndDeletedFalse(anyString())).thenReturn(false);
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        when(employeeMapper.toEntity(any(EmployeeRequest.class))).thenReturn(new Employee());
        when(employeeMapper.toResponse(any())).thenReturn(new EmployeeResponse());
        when(currentUserService.getCurrentTenantId()).thenReturn(TENANT_ID);
        when(tenantRepository.findByIdAndDeletedFalse(TENANT_ID)).thenReturn(Optional.of(tenant));
        when(passwordEncoder.encode(anyString())).thenReturn("HASH");
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        when(employeeRepository.save(any(Employee.class))).thenAnswer(inv -> inv.getArgument(0));
        lenient().when(roleRepository.findByName(any(RoleName.class))).thenAnswer(inv -> {
            Role r = new Role();
            r.setName(inv.getArgument(0));
            return Optional.of(r);
        });
    }

    private EmployeeRequest systemUserRequest(String systemRole) {
        EmployeeRequest req = new EmployeeRequest();
        req.setFirstName("Nuevo");
        req.setPosition("Camarero");
        req.setEmail("nuevo@example.com");
        req.setRestaurantIds(Set.of(RESTAURANT_ID));
        req.setCreateUser(true);
        req.setSystemRole(systemRole);
        return req;
    }

    @Test
    void create_denegadoSiAdminIntentaCrearSuperAdmin() {
        when(currentUserService.isSuperAdmin()).thenReturn(false); // el creador es ADMIN

        assertThrows(AccessDeniedException.class,
                () -> service.create(systemUserRequest("SUPER_ADMIN")));
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void create_denegadoSiAdminIntentaCrearAdmin() {
        when(currentUserService.isSuperAdmin()).thenReturn(false); // el creador es ADMIN

        assertThrows(AccessDeniedException.class,
                () -> service.create(systemUserRequest("ADMIN")));
        verify(userRepository, never()).save(any(User.class));
    }

    @Test
    void create_permitidoSiAdminCreaManager() {
        when(currentUserService.isSuperAdmin()).thenReturn(false);

        assertDoesNotThrow(() -> service.create(systemUserRequest("MANAGER")));
        verify(userRepository).save(any(User.class));
    }

    @Test
    void create_permitidoSiSuperAdminCreaAdmin() {
        when(currentUserService.isSuperAdmin()).thenReturn(true);

        assertDoesNotThrow(() -> service.create(systemUserRequest("ADMIN")));
        verify(userRepository).save(any(User.class));
    }

    @Test
    void create_denegadoSiSuperAdminIntentaCrearOtroSuperAdmin() {
        when(currentUserService.isSuperAdmin()).thenReturn(true);

        assertThrows(AccessDeniedException.class,
                () -> service.create(systemUserRequest("SUPER_ADMIN")));
        verify(userRepository, never()).save(any(User.class));
    }
}
