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
import com.restaurante.subscription.stripe.FakeStripeGateway;
import com.restaurante.subscription.stripe.StripeSubscriptionSnapshot;
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
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Endpoints que mueven dinero: contratar, cambiar de plan, abrir el portal,
 * cancelar y reactivar.
 *
 * Regla comprobada en todos estos tests: el precio y el plan guardados siempre
 * los decide el servidor, nunca lo que envía el cliente en el cuerpo.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@TestPropertySource(properties = {
        "app.stripe.secret-key=sk_test_falsa",
        "app.stripe.webhook-secret=whsec_test_falsa",
        "app.stripe.price-normal-monthly=price_normal_test",
        "app.stripe.price-pro-monthly=price_pro_test",
        "app.stripe.trial-days=14"
})
class BillingCheckoutEndpointIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JwtTokenProvider jwtTokenProvider;
    @Autowired private TenantRepository tenantRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private RoleRepository roleRepository;
    @Autowired private SubscriptionRepository subscriptionRepository;
    @Autowired private FakeStripeGateway fakeStripeGateway;

    private Tenant tenantNormal;
    private Tenant tenantPro;
    private String tokenAdminNormal;
    private String tokenManager;

    @BeforeEach
    void sembrarDatos() {
        fakeStripeGateway.reset();

        // El nombre del tenant también es único en BD: cada @Test reejecuta este
        // @BeforeEach sobre el mismo contexto/H2, así que necesita su propio sufijo
        // igual que el slug, o el segundo test de la clase choca con el primero.
        long sufijoNormal = System.nanoTime();
        long sufijoPro = System.nanoTime();
        tenantNormal = crearTenant("Facturacion Checkout Normal SA " + sufijoNormal,
                "facturacion-checkout-normal-sa-" + sufijoNormal);
        tenantPro = crearTenant("Facturacion Checkout Pro SA " + sufijoPro,
                "facturacion-checkout-pro-sa-" + sufijoPro);

        crearSuscripcion(tenantNormal, PlanCode.NORMAL, SubscriptionStatus.ACTIVE);
        crearSuscripcion(tenantPro, PlanCode.PRO, SubscriptionStatus.ACTIVE);

        Restaurant localNormal = crearRestaurante("Local Checkout Normal", tenantNormal);

        tokenAdminNormal = jwtTokenProvider.generateToken(
                crearUsuario("admin.checkout", "admin.checkout@test.com",
                        tenantNormal, RoleName.ROLE_ADMIN, null));
        tokenManager = jwtTokenProvider.generateToken(
                crearUsuario("manager.checkout", "manager.checkout@test.com",
                        tenantNormal, RoleName.ROLE_MANAGER, localNormal));
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

    private User crearUsuario(String username, String email, Tenant tenant, RoleName rol,
                              Restaurant restauranteAsignado) {
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

    private void enlazarConStripe(Tenant tenant, String customerId,
                                  String subscriptionId, String priceId) {
        Subscription suscripcion = subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenant.getId()).orElseThrow();
        suscripcion.setStripeCustomerId(customerId);
        suscripcion.setStripeSubscriptionId(subscriptionId);
        suscripcion.setStripePriceId(priceId);
        subscriptionRepository.save(suscripcion);
    }

    @Test
    @DisplayName("El checkout resuelve el precio en servidor y añade la prueba de 14 días")
    void checkoutResuelvePrecioEnServidor() throws Exception {
        mockMvc.perform(post("/api/v1/billing/checkout")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"PRO\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.url").value("https://checkout.stripe.test/sesion-falsa"));

        FakeStripeGateway.CheckoutRequest peticion = fakeStripeGateway.getLastCheckoutRequest();
        assertEquals("price_pro_test", peticion.priceId());
        assertEquals(14, peticion.trialDays());
        assertEquals(tenantNormal.getId(), peticion.tenantId());
    }

    @Test
    @DisplayName("El checkout IGNORA cualquier priceId que envíe el cliente")
    void checkoutIgnoraPrecioDelCliente() throws Exception {
        // Intento de pagar el plan barato y recibir el caro.
        mockMvc.perform(post("/api/v1/billing/checkout")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"NORMAL\",\"priceId\":\"price_pro_test\","
                                + "\"paid\":true,\"plan\":\"PRO\"}"))
                .andExpect(status().isOk());

        // Se cobra lo que dice el servidor para NORMAL, no lo que pidió el cliente.
        assertEquals("price_normal_test", fakeStripeGateway.getLastCheckoutRequest().priceId());
        // Y el plan guardado NO ha cambiado: sólo lo cambia un webhook de Stripe.
        assertEquals(PlanCode.NORMAL, subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenantNormal.getId()).orElseThrow().getPlanCode());
    }

    @Test
    @DisplayName("Un plan inexistente se rechaza con 400")
    void planInvalido() throws Exception {
        mockMvc.perform(post("/api/v1/billing/checkout")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"ENTERPRISE\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Un MANAGER no puede iniciar un pago")
    void managerNoPuedePagar() throws Exception {
        mockMvc.perform(post("/api/v1/billing/checkout")
                        .header("Authorization", "Bearer " + tokenManager)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"PRO\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("El portal exige tener cliente en Stripe")
    void portalSinClienteStripe() throws Exception {
        mockMvc.perform(post("/api/v1/billing/portal")
                        .header("Authorization", "Bearer " + tokenAdminNormal))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Cancelar al final del periodo marca la bandera sin quitar el acceso")
    void cancelarAlFinalDelPeriodo() throws Exception {
        enlazarConStripe(tenantNormal, "cus_x", "sub_x", "price_normal_test");
        fakeStripeGateway.setNextSnapshot(new StripeSubscriptionSnapshot(
                "sub_x", "cus_x", "price_normal_test", "active",
                null, null, null, true));

        mockMvc.perform(post("/api/v1/billing/cancel")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"atPeriodEnd\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cancelAtPeriodEnd").value(true))
                .andExpect(jsonPath("$.data.status").value("ACTIVE"));
    }

    @Test
    @DisplayName("Un tenant no puede tocar la suscripción de otro")
    void aislamientoEntreInquilinos() throws Exception {
        // El ADMIN del tenant NORMAL cancela; el tenant PRO no debe verse afectado.
        enlazarConStripe(tenantNormal, "cus_a", "sub_a", "price_normal_test");
        mockMvc.perform(post("/api/v1/billing/cancel")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"atPeriodEnd\":false}"))
                .andExpect(status().isOk());

        assertEquals(SubscriptionStatus.ACTIVE, subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenantPro.getId()).orElseThrow().getStatus());
    }
}
