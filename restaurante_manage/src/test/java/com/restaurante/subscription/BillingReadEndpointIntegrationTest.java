package com.restaurante.subscription;

import com.fasterxml.jackson.databind.ObjectMapper;
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
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashSet;
import java.util.Set;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Endpoints de lectura de facturación: catálogo de planes, entitlements del
 * tenant actual y estado de la suscripción.
 *
 * Separar /entitlements de /subscription es deliberado: un EMPLOYEE necesita
 * saber si pintar un candado, pero no tiene por qué ver el estado de pago de
 * la empresa.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class BillingReadEndpointIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JwtTokenProvider jwtTokenProvider;
    @Autowired private TenantRepository tenantRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private RoleRepository roleRepository;
    @Autowired private SubscriptionRepository subscriptionRepository;

    private String tokenEmpleado;
    private String tokenAdmin;
    private String tokenAdminNormal;

    @BeforeEach
    void sembrarDatos() {
        // El nombre del tenant también es único en BD: cada @Test reejecuta este
        // @BeforeEach sobre el mismo contexto/H2, así que necesita su propio sufijo
        // igual que el slug, o el segundo test de la clase choca con el primero.
        long sufijoPro = System.nanoTime();
        long sufijoNormal = System.nanoTime();
        Tenant tenantPro = crearTenant("Facturacion Pro SA " + sufijoPro, "facturacion-pro-sa-" + sufijoPro);
        Tenant tenantNormal = crearTenant("Facturacion Normal SA " + sufijoNormal, "facturacion-normal-sa-" + sufijoNormal);

        crearSuscripcion(tenantPro, PlanCode.PRO, SubscriptionStatus.ACTIVE);
        crearSuscripcion(tenantNormal, PlanCode.NORMAL, SubscriptionStatus.ACTIVE);

        Restaurant localPro = crearRestaurante("Local Pro", tenantPro);
        crearRestaurante("Local Normal Unico", tenantNormal);

        tokenEmpleado = jwtTokenProvider.generateToken(
                crearUsuario("empleado", "empleado@test.com", tenantPro, RoleName.ROLE_EMPLOYEE, localPro));
        tokenAdmin = jwtTokenProvider.generateToken(
                crearUsuario("admin.pro", "admin.pro@test.com", tenantPro, RoleName.ROLE_ADMIN, null));
        tokenAdminNormal = jwtTokenProvider.generateToken(
                crearUsuario("admin.normal", "admin.normal@test.com", tenantNormal, RoleName.ROLE_ADMIN, null));
    }

    private Tenant crearTenant(String nombre, String slug) {
        Tenant tenant = new Tenant();
        tenant.setName(nombre);
        tenant.setSlug(slug);
        tenant.setActive(true);
        return tenantRepository.save(tenant);
    }

    private void crearSuscripcion(Tenant tenant, PlanCode plan, SubscriptionStatus estado) {
        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(plan);
        suscripcion.setStatus(estado);
        subscriptionRepository.save(suscripcion);
    }

    private Restaurant crearRestaurante(String nombre, Tenant tenant) {
        Restaurant restaurante = new Restaurant();
        restaurante.setName(nombre);
        restaurante.setTenant(tenant);
        restaurante.setActiveUnderPlan(true);
        return restaurantRepository.save(restaurante);
    }

    private User crearUsuario(String username, String email, Tenant tenant, RoleName rol, Restaurant restauranteAsignado) {
        Role role = roleRepository.findByName(rol).orElseThrow();
        User usuario = new User();
        usuario.setUsername(username + "." + System.nanoTime());
        usuario.setEmail(System.nanoTime() + email);
        usuario.setPassword("irrelevante");
        usuario.setEnabled(true);
        usuario.setTenant(tenant);
        usuario.setRoles(new HashSet<>(Set.of(role)));
        if (restauranteAsignado != null) {
            usuario.setAssignedRestaurants(new HashSet<>(Set.of(restauranteAsignado)));
        }
        return userRepository.save(usuario);
    }

    @Test
    @DisplayName("GET /billing/plans devuelve el catálogo sin identificadores de precio")
    void catalogoDePlanes() throws Exception {
        mockMvc.perform(get("/api/v1/billing/plans")
                        .header("Authorization", "Bearer " + tokenEmpleado))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[?(@.code=='NORMAL')].maxRestaurants").value(1))
                .andExpect(jsonPath("$.data[?(@.code=='PRO')].maxRestaurants").value((Object) null))
                // Los price_id nunca salen al cliente.
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("price_"))));
    }

    @Test
    @DisplayName("Un EMPLOYEE puede leer sus entitlements")
    void empleadoLeeEntitlements() throws Exception {
        mockMvc.perform(get("/api/v1/billing/entitlements")
                        .header("Authorization", "Bearer " + tokenEmpleado))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.plan").value("PRO"))
                .andExpect(jsonPath("$.data.hasAccess").value(true))
                .andExpect(jsonPath("$.data.features").isArray())
                .andExpect(jsonPath("$.data.usage.RESTAURANT").exists());
    }

    @Test
    @DisplayName("Un EMPLOYEE NO puede leer el estado de facturación de la empresa")
    void empleadoNoVeFacturacion() throws Exception {
        mockMvc.perform(get("/api/v1/billing/subscription")
                        .header("Authorization", "Bearer " + tokenEmpleado))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Un ADMIN sí ve el estado de facturación de su tenant")
    void adminVeFacturacion() throws Exception {
        mockMvc.perform(get("/api/v1/billing/subscription")
                        .header("Authorization", "Bearer " + tokenAdmin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.plan").value("PRO"))
                .andExpect(jsonPath("$.data.status").value("ACTIVE"))
                .andExpect(jsonPath("$.data.stripeLinked").value(false));
    }

    @Test
    @DisplayName("Un tenant NORMAL ve sus límites y su uso reales")
    void tenantNormalVeSusLimites() throws Exception {
        mockMvc.perform(get("/api/v1/billing/entitlements")
                        .header("Authorization", "Bearer " + tokenAdminNormal))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.plan").value("NORMAL"))
                .andExpect(jsonPath("$.data.features.length()").value(0))
                .andExpect(jsonPath("$.data.limits.maxRestaurants").value(1))
                .andExpect(jsonPath("$.data.usage.RESTAURANT").value(1));
    }

    @Test
    @DisplayName("Sin autenticar no se puede leer nada de facturación")
    void sinTokenNoHayAcceso() throws Exception {
        mockMvc.perform(get("/api/v1/billing/entitlements"))
                .andExpect(status().isUnauthorized());
    }
}
