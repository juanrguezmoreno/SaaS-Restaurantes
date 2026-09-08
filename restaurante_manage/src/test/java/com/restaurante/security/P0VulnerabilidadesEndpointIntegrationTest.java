package com.restaurante.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.security.jwt.JwtTokenProvider;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Tests de INTEGRACIÓN a nivel HTTP (MockMvc) que blindan contra la reaparición de las
 * tres vulnerabilidades P0 ya corregidas. Se ejerce la cadena real de seguridad:
 * JwtAuthenticationFilter -> CustomUserDetailsService -> CurrentUserService (sin mocks),
 * usando JWTs firmados de verdad y datos multi-tenant sembrados en H2.
 *
 * <ul>
 *   <li>P0-1: un ADMIN no puede escalar privilegios asignando ROLE_SUPER_ADMIN
 *       al crear un empleado con acceso al sistema (POST /employees).</li>
 *   <li>P0-2: un ADMIN no puede crear un cliente en un restaurante de otro tenant
 *       (POST /customers, escritura cross-tenant).</li>
 *   <li>P0-4: un usuario tenant-scoped no puede ejecutar el mantenimiento global
 *       de estados de mesa (POST /reservations/maintenance/fix-table-statuses).</li>
 * </ul>
 *
 * Se ejecuta bajo el perfil {@code dev} (H2 en memoria) — seguro para {@code mvn test}.
 * Los datos se siembran una sola vez ({@code PER_CLASS} + guarda) con identificadores
 * únicos con sufijo "sectest" para no colisionar con los datos demo de {@code data.sql}.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class P0VulnerabilidadesEndpointIntegrationTest {

    private static final String EMPLOYEES_PATH = "/api/v1/employees";
    private static final String CUSTOMERS_PATH = "/api/v1/customers";
    private static final String FIX_TABLE_STATUSES_PATH = "/api/v1/reservations/maintenance/fix-table-statuses";

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JwtTokenProvider jwtTokenProvider;
    @Autowired private TenantRepository tenantRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private RoleRepository roleRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private DiningTableRepository diningTableRepository;
    @Autowired private SubscriptionRepository subscriptionRepository;

    private boolean seeded = false;

    // IDs de restaurantes de cada tenant
    private Long restaurantAId;
    private Long restaurantBId;

    // JWTs firmados de verdad
    private String tokenAdminA;
    private String tokenSuperAdmin;

    @BeforeEach
    void seed() {
        if (seeded) {
            return;
        }

        Role roleAdmin = roleRepository.findByName(RoleName.ROLE_ADMIN)
                .orElseThrow(() -> new IllegalStateException("ROLE_ADMIN no sembrado (data.sql)"));
        Role roleSuperAdmin = roleRepository.findByName(RoleName.ROLE_SUPER_ADMIN)
                .orElseThrow(() -> new IllegalStateException("ROLE_SUPER_ADMIN no sembrado (data.sql)"));

        // ── Tenant A + Restaurante A ──────────────────────────────────────
        Tenant tenantA = new Tenant();
        tenantA.setName("Tenant A sectest");
        tenantA.setSlug("tenant-a-sectest");
        tenantA.setActive(true);
        tenantA = tenantRepository.save(tenantA);

        // Plan PRO para el tenant A: estos tests ejercitan escalada de privilegios
        // (P0-1) y aislamiento multi-tenant (P0-2), no límites de plan, así que se
        // les da cuota de sobra para no chocar con EntitlementService.requireCapacity.
        Subscription suscripcionA = new Subscription();
        suscripcionA.setTenant(tenantA);
        suscripcionA.setPlanCode(PlanCode.PRO);
        suscripcionA.setStatus(SubscriptionStatus.ACTIVE);
        subscriptionRepository.save(suscripcionA);

        Restaurant restaurantA = new Restaurant();
        restaurantA.setName("Restaurante A sectest");
        restaurantA.setTenant(tenantA);
        restaurantA.setDefaultReservationDurationMinutes(90);
        restaurantA = restaurantRepository.save(restaurantA);
        restaurantAId = restaurantA.getId();

        // ── Tenant B + Restaurante B ──────────────────────────────────────
        Tenant tenantB = new Tenant();
        tenantB.setName("Tenant B sectest");
        tenantB.setSlug("tenant-b-sectest");
        tenantB.setActive(true);
        tenantB = tenantRepository.save(tenantB);

        Restaurant restaurantB = new Restaurant();
        restaurantB.setName("Restaurante B sectest");
        restaurantB.setTenant(tenantB);
        restaurantB.setDefaultReservationDurationMinutes(90);
        restaurantB = restaurantRepository.save(restaurantB);
        restaurantBId = restaurantB.getId();

        // Una mesa RESERVED en el restaurante A para que el mantenimiento tenga algo que revisar.
        DiningTable mesaA = new DiningTable();
        mesaA.setRestaurant(restaurantA);
        mesaA.setTableNumber("A1");
        mesaA.setCapacity(4);
        mesaA.setStatus(TableStatus.RESERVED);
        diningTableRepository.save(mesaA);

        // ── ADMIN_A (tenant A, ROLE_ADMIN) ────────────────────────────────
        // Sin restaurante principal (restaurant = null) para que en CustomerService.create
        // se use el restaurantId del request y se ejercite validateRestaurantAccess (P0-2).
        // El restaurante A se asigna en assignedRestaurants para reflejar la asignación.
        User adminA = new User();
        adminA.setUsername("admin.a.sectest");
        adminA.setEmail("admin.a@sectest.com");
        adminA.setPassword("seed-no-login");
        adminA.setFirstName("Admin");
        adminA.setLastName("Sectest A");
        adminA.setEnabled(true);
        adminA.setTenant(tenantA);
        adminA.setRestaurant(null);
        adminA.setAssignedRestaurants(new HashSet<>(Set.of(restaurantA)));
        adminA.setRoles(new HashSet<>(Set.of(roleAdmin)));
        adminA = userRepository.save(adminA);

        // ── SUPER_ADMIN (sin tenant, ROLE_SUPER_ADMIN) ────────────────────
        User superAdmin = new User();
        superAdmin.setUsername("super.admin.sectest");
        superAdmin.setEmail("super.admin@sectest.com");
        superAdmin.setPassword("seed-no-login");
        superAdmin.setFirstName("Super");
        superAdmin.setLastName("Sectest");
        superAdmin.setEnabled(true);
        superAdmin.setTenant(null);
        superAdmin.setRestaurant(null);
        superAdmin.setAssignedRestaurants(new HashSet<>());
        superAdmin.setRoles(new HashSet<>(Set.of(roleSuperAdmin)));
        superAdmin = userRepository.save(superAdmin);

        // JWTs reales (las colecciones roles/assignedRestaurants están inicializadas en memoria).
        tokenAdminA = jwtTokenProvider.generateToken(adminA);
        tokenSuperAdmin = jwtTokenProvider.generateToken(superAdmin);

        seeded = true;
    }

    private String bearer(String token) {
        return "Bearer " + token;
    }

    private String json(Map<String, Object> body) throws Exception {
        return objectMapper.writeValueAsString(body);
    }

    // ════════════════════════════════════════════════════════════════════
    //  P0-1: escalada de privilegios al crear empleado con acceso al sistema
    // ════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("P0-1: ADMIN no puede crear un empleado con systemRole SUPER_ADMIN (403 y no se crea el usuario)")
    void adminNoPuedeAsignarRolSuperAdminAlCrearEmpleado() throws Exception {
        String emailAtaque = "escalada.superadmin@sectest.com";

        Map<String, Object> body = new HashMap<>();
        body.put("createUser", true);
        body.put("systemRole", "SUPER_ADMIN");
        body.put("email", emailAtaque);
        body.put("firstName", "Intruso");
        body.put("position", "Camarero");
        body.put("restaurantIds", List.of(restaurantAId));

        mockMvc.perform(post(EMPLOYEES_PATH)
                        .header("Authorization", bearer(tokenAdminA))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(body)))
                .andExpect(status().isForbidden());

        // El intento no debe haber persistido ningún usuario con ese email (menos aún SUPER_ADMIN).
        assertFalse(userRepository.findByEmailAndDeletedFalse(emailAtaque).isPresent(),
                "No debe existir ningún usuario tras el intento de escalada de privilegios");
    }

    @Test
    @DisplayName("P0-1: ADMIN sí puede crear un empleado con systemRole MANAGER en su restaurante (201)")
    void adminPuedeCrearEmpleadoManagerEnSuRestaurante() throws Exception {
        Map<String, Object> body = new HashMap<>();
        body.put("createUser", true);
        body.put("systemRole", "MANAGER");
        body.put("email", "nuevo.manager@sectest.com");
        body.put("firstName", "Nuevo");
        body.put("lastName", "Manager");
        body.put("position", "Encargado");
        body.put("restaurantIds", List.of(restaurantAId));

        mockMvc.perform(post(EMPLOYEES_PATH)
                        .header("Authorization", bearer(tokenAdminA))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(body)))
                .andExpect(status().isCreated());
    }

    // ════════════════════════════════════════════════════════════════════
    //  P0-2: escritura cross-tenant al crear cliente
    // ════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("P0-2: ADMIN no puede crear un cliente en un restaurante de otro tenant (403 y no se crea)")
    void adminNoPuedeCrearClienteEnRestauranteDeOtroTenant() throws Exception {
        String emailCliente = "cliente.crosstenant@sectest.com";

        Map<String, Object> body = new HashMap<>();
        body.put("restaurantId", restaurantBId); // restaurante de OTRO tenant
        body.put("firstName", "Cliente");
        body.put("lastName", "Ajeno");
        body.put("email", emailCliente);

        mockMvc.perform(post(CUSTOMERS_PATH)
                        .header("Authorization", bearer(tokenAdminA))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(body)))
                .andExpect(status().isForbidden());

        assertFalse(customerRepository.existsByEmailAndDeletedFalse(emailCliente),
                "No debe crearse el cliente en el restaurante de otro tenant");
    }

    @Test
    @DisplayName("P0-2: ADMIN sí puede crear un cliente en su propio restaurante (201)")
    void adminPuedeCrearClienteEnSuRestaurante() throws Exception {
        String emailCliente = "cliente.propio@sectest.com";

        Map<String, Object> body = new HashMap<>();
        body.put("restaurantId", restaurantAId); // su propio restaurante
        body.put("firstName", "Cliente");
        body.put("lastName", "Propio");
        body.put("email", emailCliente);

        mockMvc.perform(post(CUSTOMERS_PATH)
                        .header("Authorization", bearer(tokenAdminA))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(json(body)))
                .andExpect(status().isCreated());

        assertTrue(customerRepository.existsByEmailAndDeletedFalse(emailCliente),
                "El cliente debe crearse en el restaurante propio (camino legítimo)");
    }

    // ════════════════════════════════════════════════════════════════════
    //  P0-4: mantenimiento global de estados de mesa
    // ════════════════════════════════════════════════════════════════════

    @Test
    @DisplayName("P0-4: ADMIN no puede ejecutar el mantenimiento global sin restaurantId (403)")
    void adminNoPuedeEjecutarMantenimientoGlobalSinRestaurantId() throws Exception {
        mockMvc.perform(post(FIX_TABLE_STATUSES_PATH)
                        .header("Authorization", bearer(tokenAdminA)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("P0-4: ADMIN no puede ejecutar el mantenimiento en un restaurante de otro tenant (403)")
    void adminNoPuedeEjecutarMantenimientoEnRestauranteDeOtroTenant() throws Exception {
        mockMvc.perform(post(FIX_TABLE_STATUSES_PATH)
                        .param("restaurantId", restaurantBId.toString())
                        .header("Authorization", bearer(tokenAdminA)))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("P0-4: SUPER_ADMIN sí puede ejecutar el mantenimiento global sin restaurantId (200)")
    void superAdminPuedeEjecutarMantenimientoGlobal() throws Exception {
        mockMvc.perform(post(FIX_TABLE_STATUSES_PATH)
                        .header("Authorization", bearer(tokenSuperAdmin)))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("P0-4: ADMIN sí puede ejecutar el mantenimiento en su propio restaurante (200)")
    void adminPuedeEjecutarMantenimientoEnSuRestaurante() throws Exception {
        mockMvc.perform(post(FIX_TABLE_STATUSES_PATH)
                        .param("restaurantId", restaurantAId.toString())
                        .header("Authorization", bearer(tokenAdminA)))
                .andExpect(status().isOk());
    }
}
