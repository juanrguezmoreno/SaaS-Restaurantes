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

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.HashSet;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Exportación CSV de reservas: es la primera funcionalidad tangible del plan
 * Pro, y estrena el uso de {@code EntitlementService.require(...)} en un
 * endpoint real.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class ProFeaturesEndpointIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private JwtTokenProvider jwtTokenProvider;
    @Autowired private TenantRepository tenantRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private RoleRepository roleRepository;
    @Autowired private SubscriptionRepository subscriptionRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private ReservationRepository reservationRepository;

    private String tokenAdminNormal;
    private String tokenAdminPro;

    @BeforeEach
    void sembrarDatos() {
        // El nombre del tenant también es único en BD: cada @Test reejecuta este
        // @BeforeEach sobre el mismo contexto/H2, así que necesita su propio sufijo
        // igual que el slug, o el segundo test de la clase choca con el primero.
        long sufijoNormal = System.nanoTime();
        long sufijoPro = System.nanoTime();
        Tenant tenantNormal = crearTenant("Export Normal SA " + sufijoNormal, "export-normal-sa-" + sufijoNormal);
        Tenant tenantPro = crearTenant("Export Pro SA " + sufijoPro, "export-pro-sa-" + sufijoPro);

        crearSuscripcion(tenantNormal, PlanCode.NORMAL, SubscriptionStatus.ACTIVE);
        crearSuscripcion(tenantPro, PlanCode.PRO, SubscriptionStatus.ACTIVE);

        Restaurant localNormal = crearRestaurante("Local Normal", tenantNormal);
        Restaurant localPro = crearRestaurante("Local Pro", tenantPro);

        Customer clienteNormal = crearCliente("Cliente", "Del Normal", localNormal);
        Customer clientePro = crearCliente("Cliente", "Del Pro", localPro);

        crearReserva(localNormal, clienteNormal);
        crearReserva(localPro, clientePro);

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

    private Customer crearCliente(String nombre, String apellido, Restaurant restaurante) {
        Customer cliente = new Customer();
        cliente.setFirstName(nombre);
        cliente.setLastName(apellido);
        cliente.setEmail(System.nanoTime() + "@test.com");
        cliente.setPhone("600000000");
        cliente.setRestaurant(restaurante);
        return customerRepository.save(cliente);
    }

    private Reservation crearReserva(Restaurant restaurante, Customer cliente) {
        Reservation reserva = new Reservation();
        reserva.setRestaurant(restaurante);
        reserva.setCustomer(cliente);
        reserva.setReservationDate(LocalDate.now().plusDays(1));
        reserva.setReservationTime(LocalTime.of(20, 30));
        reserva.setPartySize(2);
        reserva.setStatus(ReservationStatus.PENDING);
        return reservationRepository.save(reserva);
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

    @Test
    @DisplayName("Un tenant NORMAL no puede exportar: 403 PLAN_UPGRADE_REQUIRED")
    void normalNoPuedeExportar() throws Exception {
        mockMvc.perform(get("/api/v1/reservations/export")
                        .header("Authorization", "Bearer " + tokenAdminNormal))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLAN_UPGRADE_REQUIRED"))
                .andExpect(jsonPath("$.data.feature").value("EXPORT_DATA"))
                .andExpect(jsonPath("$.data.requiredPlan").value("PRO"));
    }

    @Test
    @DisplayName("Un tenant PRO exporta un CSV con cabecera y sus reservas")
    void proExportaCsv() throws Exception {
        mockMvc.perform(get("/api/v1/reservations/export")
                        .header("Authorization", "Bearer " + tokenAdminPro))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type",
                        org.hamcrest.Matchers.containsString("text/csv")))
                .andExpect(header().string("Content-Disposition",
                        org.hamcrest.Matchers.containsString("reservas")))
                .andExpect(content().string(org.hamcrest.Matchers.startsWith(
                        "id,fecha,hora,cliente,telefono,personas,mesa,estado,restaurante")));
    }

    @Test
    @DisplayName("La exportación de un PRO sólo incluye sus propias reservas")
    void exportacionAisladaPorInquilino() throws Exception {
        String csv = mockMvc.perform(get("/api/v1/reservations/export")
                        .header("Authorization", "Bearer " + tokenAdminPro))
                .andReturn().getResponse().getContentAsString();

        assertTrue(csv.contains("Cliente Del Pro"));
        assertFalse(csv.contains("Cliente Del Normal"),
                "Fuga de datos entre inquilinos en la exportación");
    }
}
