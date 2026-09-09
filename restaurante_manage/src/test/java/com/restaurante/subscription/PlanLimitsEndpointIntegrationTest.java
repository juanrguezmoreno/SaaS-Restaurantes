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
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class PlanLimitsEndpointIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JwtTokenProvider jwtTokenProvider;
    @Autowired private TenantRepository tenantRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private RoleRepository roleRepository;
    @Autowired private SubscriptionRepository subscriptionRepository;

    private Tenant tenantNormal;
    private Restaurant restauranteNormal;
    private String tokenAdminNormal;
    private String tokenAdminPro;

    @BeforeEach
    void sembrarDatos() {
        // El nombre del tenant también es único en BD: cada @Test reejecuta este
        // @BeforeEach sobre el mismo contexto/H2, así que necesita su propio sufijo
        // igual que el slug, o el segundo test de la clase choca con el primero.
        long sufijoNormal = System.nanoTime();
        long sufijoPro = System.nanoTime();
        tenantNormal = crearTenant("Plan Normal SA " + sufijoNormal, "plan-normal-sa-" + sufijoNormal);
        Tenant tenantPro = crearTenant("Plan Pro SA " + sufijoPro, "plan-pro-sa-" + sufijoPro);

        crearSuscripcion(tenantNormal, PlanCode.NORMAL, SubscriptionStatus.ACTIVE);
        crearSuscripcion(tenantPro, PlanCode.PRO, SubscriptionStatus.ACTIVE);

        // El tenant NORMAL arranca ya en su límite: 1 local.
        restauranteNormal = crearRestaurante("Local Unico", tenantNormal);
        crearRestaurante("Local Pro 1", tenantPro);
        crearRestaurante("Local Pro 2", tenantPro);

        tokenAdminNormal = jwtTokenProvider.generateToken(
                crearAdmin("admin.normal", "admin.normal@test.com", tenantNormal));
        tokenAdminPro = jwtTokenProvider.generateToken(
                crearAdmin("admin.pro", "admin.pro@test.com", tenantPro));
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

    private User crearAdmin(String username, String email, Tenant tenant) {
        Role rolAdmin = roleRepository.findByName(RoleName.ROLE_ADMIN).orElseThrow();
        User usuario = new User();
        usuario.setUsername(username + "." + System.nanoTime());
        usuario.setEmail(System.nanoTime() + email);
        usuario.setPassword("irrelevante");
        usuario.setEnabled(true);
        usuario.setTenant(tenant);
        usuario.setRoles(new HashSet<>(Set.of(rolAdmin)));
        return userRepository.save(usuario);
    }

    private String cuerpoRestaurante(String nombre) throws Exception {
        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("name", nombre);
        cuerpo.put("address", "Calle Falsa 123");
        cuerpo.put("phone", "600000000");
        cuerpo.put("email", "nuevo@test.com");
        cuerpo.put("capacity", 50);
        return objectMapper.writeValueAsString(cuerpo);
    }

    @Test
    @DisplayName("NORMAL en su límite no puede crear un segundo local: 403 PLAN_LIMIT_REACHED")
    void normalNoPuedeCrearSegundoLocal() throws Exception {
        mockMvc.perform(post("/api/v1/restaurants")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoRestaurante("Local Prohibido")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.code").value("PLAN_LIMIT_REACHED"))
                .andExpect(jsonPath("$.data.resource").value("RESTAURANT"))
                .andExpect(jsonPath("$.data.limit").value(1))
                .andExpect(jsonPath("$.data.requiredPlan").value("PRO"));
    }

    @Test
    @DisplayName("PRO puede crear locales sin límite")
    void proPuedeCrearMasLocales() throws Exception {
        mockMvc.perform(post("/api/v1/restaurants")
                        .header("Authorization", "Bearer " + tokenAdminPro)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoRestaurante("Local Pro 3")))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("NORMAL no puede crear la sexta cuenta de usuario")
    void normalNoPuedeCrearSextaCuenta() throws Exception {
        // Ya existe admin.normal; se añaden 4 más hasta llegar al tope de 5.
        for (int i = 1; i <= 4; i++) {
            crearAdmin("relleno" + i, "relleno" + i + "@test.com", tenantNormal);
        }

        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("username", "sexto");
        cuerpo.put("email", "sexto@test.com");
        cuerpo.put("password", "Password123!");
        cuerpo.put("firstName", "Sexto");
        cuerpo.put("lastName", "Usuario");
        cuerpo.put("roles", Set.of("ROLE_EMPLOYEE"));

        mockMvc.perform(post("/api/v1/users")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(cuerpo)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLAN_LIMIT_REACHED"))
                .andExpect(jsonPath("$.data.resource").value("USER_ACCOUNT"))
                .andExpect(jsonPath("$.data.limit").value(5));
    }

    @Test
    @DisplayName("NORMAL en su límite no puede registrar una sexta cuenta vía /auth/register")
    void normalNoPuedeRegistrarSextaCuentaViaAuthRegister() throws Exception {
        // Ya existe admin.normal; se añaden 4 más hasta llegar al tope de 5.
        for (int i = 1; i <= 4; i++) {
            crearAdmin("relleno" + i, "relleno" + i + "@test.com", tenantNormal);
        }

        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("name", "sexto.register");
        cuerpo.put("email", "sexto.register@test.com");
        cuerpo.put("password", "Password123!");
        cuerpo.put("role", "EMPLOYEE");
        cuerpo.put("restaurantId", restauranteNormal.getId());

        mockMvc.perform(post("/api/v1/auth/register")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(cuerpo)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLAN_LIMIT_REACHED"))
                .andExpect(jsonPath("$.data.resource").value("USER_ACCOUNT"))
                .andExpect(jsonPath("$.data.limit").value(5));
    }

    @Test
    @DisplayName("NORMAL en su límite no puede crear un empleado con acceso al sistema (createUser=true)")
    void normalNoPuedeCrearEmpleadoConAccesoSistemaEnSuLimite() throws Exception {
        // Ya existe admin.normal; se añaden 4 más hasta llegar al tope de 5.
        for (int i = 1; i <= 4; i++) {
            crearAdmin("relleno" + i, "relleno" + i + "@test.com", tenantNormal);
        }

        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("firstName", "Sexto");
        cuerpo.put("lastName", "Empleado");
        cuerpo.put("email", "sexto.empleado@test.com");
        cuerpo.put("position", "Camarero");
        cuerpo.put("restaurantIds", Set.of(restauranteNormal.getId()));
        cuerpo.put("createUser", true);
        cuerpo.put("systemRole", "EMPLOYEE");

        mockMvc.perform(post("/api/v1/employees")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(cuerpo)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLAN_LIMIT_REACHED"))
                .andExpect(jsonPath("$.data.resource").value("USER_ACCOUNT"))
                .andExpect(jsonPath("$.data.limit").value(5));
    }
}
