package com.restaurante.subscription;

import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.security.jwt.JwtTokenProvider;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.subscription.repository.ProcessedStripeEventRepository;
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

import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Flujo completo del downgrade: un webhook de Stripe que baja de plan bloquea
 * los locales sobrantes SIN borrarlos, el ADMIN puede elegir cuál conserva, y
 * volver a subir de plan reactiva todo con los datos intactos.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@TestPropertySource(properties = {
        "app.stripe.secret-key=clave-de-prueba",
        "app.stripe.webhook-secret=secreto-de-webhook-de-prueba",
        "app.stripe.price-normal-monthly=price_normal_test",
        "app.stripe.price-pro-monthly=price_pro_test",
        "app.stripe.trial-days=14"
})
class DowngradeEndpointIntegrationTest {

    private static final String SECRETO = "secreto-de-webhook-de-prueba";
    private static final String RUTA_WEBHOOK = "/api/v1/webhooks/stripe";
    private static final String VERSION_API = "2026-08-26.dahlia";

    @Autowired private MockMvc mockMvc;
    @Autowired private JwtTokenProvider jwtTokenProvider;
    @Autowired private TenantRepository tenantRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private RoleRepository roleRepository;
    @Autowired private SubscriptionRepository subscriptionRepository;
    @Autowired private ProcessedStripeEventRepository processedStripeEventRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private ReservationRepository reservationRepository;
    @Autowired private FakeStripeGateway fakeStripeGateway;

    private Tenant tenantPro;
    private Tenant tenantOtro;
    private Restaurant primerLocal;
    private Restaurant segundoLocal;
    private Restaurant tercerLocal;
    private Restaurant localDelOtroTenant;
    private String tokenAdminPro;
    private String subscriptionId;
    private String customerId;

    @BeforeEach
    void sembrarDatos() {
        fakeStripeGateway.reset();
        // La bitácora de eventos procesados es compartida por toda la clase: se
        // limpia para que un id de evento repetido entre tests no se ignore por
        // "ya procesado".
        processedStripeEventRepository.deleteAll();

        long sufijoPro = System.nanoTime();
        long sufijoOtro = System.nanoTime();
        tenantPro = crearTenant("Facturacion Downgrade Pro SA " + sufijoPro,
                "facturacion-downgrade-pro-sa-" + sufijoPro);
        tenantOtro = crearTenant("Facturacion Downgrade Otro SA " + sufijoOtro,
                "facturacion-downgrade-otro-sa-" + sufijoOtro);

        crearSuscripcion(tenantPro, PlanCode.PRO, SubscriptionStatus.ACTIVE);
        crearSuscripcion(tenantOtro, PlanCode.NORMAL, SubscriptionStatus.ACTIVE);

        primerLocal = crearRestaurante("Local Downgrade Uno", tenantPro);
        segundoLocal = crearRestaurante("Local Downgrade Dos", tenantPro);
        tercerLocal = crearRestaurante("Local Downgrade Tres", tenantPro);
        localDelOtroTenant = crearRestaurante("Local De Otro Inquilino", tenantOtro);

        // Una reserva viva en el segundo local: es la que no se puede perder al
        // bajar y volver a subir de plan.
        crearReserva(segundoLocal);

        // El id de suscripción y de cliente en Stripe también son únicos por
        // test: sub_down/cus_down_1 son columnas UNIQUE y el mismo contexto/H2
        // se reutiliza en toda la clase, igual que el tenant y su slug.
        subscriptionId = "sub_down_" + System.nanoTime();
        customerId = "cus_down_" + System.nanoTime();
        enlazarConStripe(tenantPro, customerId, subscriptionId, "price_pro_test");

        tokenAdminPro = jwtTokenProvider.generateToken(
                crearUsuario("admin.downgrade", "admin.downgrade@test.com",
                        tenantPro, RoleName.ROLE_ADMIN, null));
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

    private void crearReserva(Restaurant restaurante) {
        Customer cliente = new Customer();
        cliente.setRestaurant(restaurante);
        cliente.setFirstName("Cliente");
        cliente.setLastName("De Prueba");
        cliente.setEmail("cliente." + System.nanoTime() + "@test.com");
        cliente = customerRepository.save(cliente);

        Reservation reserva = new Reservation();
        reserva.setCustomer(cliente);
        reserva.setRestaurant(restaurante);
        reserva.setReservationDate(LocalDate.now().plusDays(1));
        reserva.setReservationTime(LocalTime.of(20, 0));
        reserva.setPartySize(2);
        reserva.setStatus(ReservationStatus.PENDING);
        reservationRepository.save(reserva);
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

    private void prepararInstantanea(String subscriptionId, String customerId, String priceId,
                                     String estado, long expiraEn) {
        long ahora = Instant.now().getEpochSecond();
        fakeStripeGateway.setNextSnapshot(new StripeSubscriptionSnapshot(
                subscriptionId, customerId, priceId, estado,
                ahora, expiraEn, null, false));
    }

    private String cuerpoSuscripcion(String eventId, String subscriptionId, String priceId,
                                     String estado, long creadoEn) {
        return """
            {
              "id": "%s",
              "object": "event",
              "api_version": "%s",
              "type": "customer.subscription.updated",
              "created": %d,
              "data": { "object": {
                "id": "%s",
                "object": "subscription",
                "customer": "%s",
                "status": "%s",
                "cancel_at_period_end": false,
                "items": { "object": "list", "data": [
                  { "id": "si_1", "object": "subscription_item",
                    "current_period_start": 1750000000,
                    "current_period_end": 1752592000,
                    "price": { "id": "%s", "object": "price" } }
                ]}
              }}
            }
            """.formatted(eventId, VERSION_API, creadoEn, subscriptionId, customerId, estado, priceId);
    }

    private void enviarWebhookFirmado(String cuerpo) throws Exception {
        mockMvc.perform(post(RUTA_WEBHOOK)
                        .header("Stripe-Signature", StripeSignatureHelper.firmar(
                                cuerpo, SECRETO, Instant.now().getEpochSecond()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Un webhook que baja a NORMAL bloquea los locales sobrantes sin borrarlos")
    void webhookDeDowngradeReconcilia() throws Exception {
        prepararInstantanea(subscriptionId, customerId, "price_normal_test", "active",
                Instant.now().getEpochSecond() + 2_592_000L);

        enviarWebhookFirmado(cuerpoSuscripcion("evt_down", subscriptionId,
                "price_normal_test", "active", Instant.now().getEpochSecond()));

        List<Restaurant> locales = restaurantRepository
                .findByTenantIdAndDeletedFalseOrderByIdAsc(tenantPro.getId());
        assertEquals(3, locales.size(), "No se debe perder ningún local");
        assertTrue(locales.get(0).getActiveUnderPlan());
        assertFalse(locales.get(1).getActiveUnderPlan());
        assertFalse(locales.get(2).getActiveUnderPlan());
    }

    @Test
    @DisplayName("El ADMIN puede elegir qué local queda activo")
    void adminEligeLocalActivo() throws Exception {
        prepararInstantanea(subscriptionId, customerId, "price_normal_test", "active",
                Instant.now().getEpochSecond() + 2_592_000L);
        enviarWebhookFirmado(cuerpoSuscripcion("evt_down", subscriptionId,
                "price_normal_test", "active", Instant.now().getEpochSecond()));

        mockMvc.perform(post("/api/v1/billing/active-restaurant")
                        .header("Authorization", "Bearer " + tokenAdminPro)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"restaurantId\":" + tercerLocal.getId() + "}"))
                .andExpect(status().isOk());

        assertTrue(restaurantRepository.findById(tercerLocal.getId())
                .orElseThrow().getActiveUnderPlan());
        assertFalse(restaurantRepository.findById(primerLocal.getId())
                .orElseThrow().getActiveUnderPlan());
    }

    @Test
    @DisplayName("No se puede elegir como activo un local de otro inquilino")
    void noSePuedeElegirLocalAjeno() throws Exception {
        mockMvc.perform(post("/api/v1/billing/active-restaurant")
                        .header("Authorization", "Bearer " + tokenAdminPro)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"restaurantId\":" + localDelOtroTenant.getId() + "}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Volver a PRO reactiva los tres locales con sus datos intactos")
    void upgradeDevuelveTodo() throws Exception {
        long reservasAntes = reservationRepository.count();

        // Primero baja a NORMAL...
        prepararInstantanea(subscriptionId, customerId, "price_normal_test", "active",
                Instant.now().getEpochSecond() + 2_592_000L);
        enviarWebhookFirmado(cuerpoSuscripcion("evt_down", subscriptionId,
                "price_normal_test", "active", Instant.now().getEpochSecond()));

        // ...y luego vuelve a subir a PRO.
        prepararInstantanea(subscriptionId, customerId, "price_pro_test", "active",
                Instant.now().getEpochSecond() + 5_184_000L);
        enviarWebhookFirmado(cuerpoSuscripcion("evt_up", subscriptionId,
                "price_pro_test", "active", Instant.now().getEpochSecond() + 60));

        restaurantRepository.findByTenantIdAndDeletedFalseOrderByIdAsc(tenantPro.getId())
                .forEach(local -> assertTrue(local.getActiveUnderPlan()));
        assertEquals(reservasAntes, reservationRepository.count(),
                "Bajar y subir de plan no debe perder ni una reserva");
    }
}
