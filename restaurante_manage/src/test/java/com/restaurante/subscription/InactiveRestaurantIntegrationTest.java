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

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Un local desactivado por el plan (bajada de PRO a NORMAL con más de un
 * local) queda en solo lectura: se sigue consultando y sus datos se
 * conservan, pero no admite escrituras ni reservas nuevas por el QR público.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class InactiveRestaurantIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JwtTokenProvider jwtTokenProvider;
    @Autowired private TenantRepository tenantRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private RoleRepository roleRepository;
    @Autowired private SubscriptionRepository subscriptionRepository;

    private Tenant tenantPro;
    private Long idLocalActivo;
    private Long idLocalBloqueado;
    private String tokenAdmin;

    @BeforeEach
    void sembrarDatos() {
        // El nombre del tenant también es único en BD: cada @Test reejecuta este
        // @BeforeEach sobre el mismo contexto/H2, así que necesita su propio sufijo
        // igual que el slug, o el segundo test de la clase choca con el primero.
        long sufijo = System.nanoTime();
        tenantPro = crearTenant("Plan Pro Bloqueo SA " + sufijo, "plan-pro-bloqueo-sa-" + sufijo);

        crearSuscripcion(tenantPro, PlanCode.PRO, SubscriptionStatus.ACTIVE);

        Restaurant localActivo = crearRestaurante("Local Activo", tenantPro);
        idLocalActivo = localActivo.getId();

        Restaurant localBloqueado = crearRestaurante("Local Bloqueado", tenantPro);
        localBloqueado.setActiveUnderPlan(false);
        restaurantRepository.save(localBloqueado);
        idLocalBloqueado = localBloqueado.getId();

        tokenAdmin = jwtTokenProvider.generateToken(
                crearAdmin("admin.bloqueo", "admin.bloqueo@test.com", tenantPro));
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

    private void ponerEstadoSuscripcion(SubscriptionStatus estado) {
        Subscription suscripcion = subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenantPro.getId()).orElseThrow();
        suscripcion.setStatus(estado);
        subscriptionRepository.save(suscripcion);
    }

    @Test
    @DisplayName("Un local bloqueado por plan sigue siendo legible")
    void localBloqueadoSeSigueLeyendo() throws Exception {
        mockMvc.perform(get("/api/v1/restaurants/" + idLocalBloqueado)
                        .header("Authorization", "Bearer " + tokenAdmin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Local Bloqueado"));
    }

    @Test
    @DisplayName("Un local bloqueado por plan no admite escrituras")
    void localBloqueadoNoAdmiteEscrituras() throws Exception {
        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("name", "Nombre nuevo");
        cuerpo.put("address", "Calle Falsa 123");
        cuerpo.put("capacity", 60);

        mockMvc.perform(put("/api/v1/restaurants/" + idLocalBloqueado)
                        .header("Authorization", "Bearer " + tokenAdmin)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(cuerpo)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLAN_UPGRADE_REQUIRED"))
                .andExpect(jsonPath("$.data.feature").value("MULTI_RESTAURANT"));
    }

    @Test
    @DisplayName("El QR público de un local bloqueado no acepta reservas")
    void qrDeLocalBloqueadoCerrado() throws Exception {
        mockMvc.perform(get("/api/v1/public/restaurants/" + idLocalBloqueado))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("El QR sigue abierto con la suscripción en PAST_DUE")
    void qrAbiertoConPagoFallido() throws Exception {
        ponerEstadoSuscripcion(SubscriptionStatus.PAST_DUE);
        mockMvc.perform(get("/api/v1/public/restaurants/" + idLocalActivo))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("El QR se cierra con la suscripción CANCELED")
    void qrCerradoConSuscripcionCancelada() throws Exception {
        ponerEstadoSuscripcion(SubscriptionStatus.CANCELED);
        mockMvc.perform(get("/api/v1/public/restaurants/" + idLocalActivo))
                .andExpect(status().isBadRequest());
    }
}
