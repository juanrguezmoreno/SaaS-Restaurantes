package com.restaurante.customer.controller;

import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.test.context.support.WithUserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Listado de clientes: paginación, búsqueda, segmentos, ordenación y permisos.
 *
 * <p>Los tres segmentos se comprueban contra datos construidos a propósito, que
 * es lo que antes no podía verificarse: se calculaban en el navegador.</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
// La base H2 vive todo el contexto: sin rollback, los clientes de cada prueba se
// acumularían y los totales dejarían de significar nada.
@Transactional
class CustomerEndpointIntegrationTest {

    private static final String RUTA = "/api/v1/customers";

    /** Prefijo propio, para buscar solo lo que crea esta prueba. */
    private static final String PREFIJO = "zzcli";

    @Autowired private MockMvc mockMvc;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private ReservationRepository reservationRepository;
    @Autowired private RestaurantRepository restaurantRepository;

    private Long restauranteId;

    @BeforeEach
    void setUp() {
        Restaurant restaurante = new Restaurant();
        restaurante.setName(PREFIJO + " Restaurante");
        restaurante.setPublicBookingEnabled(true);
        restaurante.setDefaultReservationDurationMinutes(90);
        restauranteId = restaurantRepository.save(restaurante).getId();

        // 7 clientes propios. Los dos primeros son recurrentes (2 reservas
        // recientes); el tercero tiene una sola reserva antigua, así que es el
        // único «sin venir»; el resto no tiene ninguna.
        for (int i = 1; i <= 7; i++) {
            Customer cliente = new Customer();
            cliente.setFirstName("Nombre" + (char) ('A' + i - 1));
            cliente.setLastName(PREFIJO + i);
            cliente.setEmail(PREFIJO + i + "@ejemplo.com");
            cliente.setPhone("61000000" + i);
            cliente.setRestaurant(restaurante);
            Customer guardado = customerRepository.save(cliente);

            if (i <= 2) {
                crearReserva(guardado, restaurante, LocalDate.now().minusDays(5), ReservationStatus.COMPLETED);
                crearReserva(guardado, restaurante, LocalDate.now().minusDays(2), ReservationStatus.CONFIRMED);
            } else if (i == 3) {
                crearReserva(guardado, restaurante, LocalDate.now().minusMonths(8), ReservationStatus.COMPLETED);
            }
        }
    }

    private void crearReserva(Customer cliente, Restaurant restaurante, LocalDate fecha, ReservationStatus estado) {
        Reservation reserva = new Reservation();
        reserva.setCustomer(cliente);
        reserva.setRestaurant(restaurante);
        reserva.setReservationDate(fecha);
        reserva.setReservationTime(LocalTime.of(20, 0));
        reserva.setPartySize(2);
        reserva.setStatus(estado);
        reservationRepository.save(reserva);
    }

    // ─── Seguridad ──────────────────────────────────────────────────────────

    @Test
    void sinAutenticacionRechazaElListado() throws Exception {
        mockMvc.perform(get(RUTA)).andExpect(status().isUnauthorized());
    }

    @Test
    void sinAutenticacionRechazaLasCifras() throws Exception {
        mockMvc.perform(get(RUTA + "/stats")).andExpect(status().isUnauthorized());
    }

    @Test
    @WithUserDetails("super.admin")
    void elSuperAdminAccedeAlListado() throws Exception {
        mockMvc.perform(get(RUTA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray());
    }

    @Test
    @WithUserDetails("employee.demo")
    void unEmpleadoAccedeAlListado() throws Exception {
        // Los cuatro roles del @PreAuthorize pueden leer clientes.
        mockMvc.perform(get(RUTA)).andExpect(status().isOk());
    }

    @Test
    @WithUserDetails("juan.admin")
    void unAdministradorNoVeLosClientesDeOtraCuenta() throws Exception {
        // El restaurante que crea esta prueba no tiene tenant, así que el ADMIN
        // del tenant demo no debe ver sus clientes ni buscándolos.
        mockMvc.perform(get(RUTA).param("search", PREFIJO))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    // ─── Paginación ─────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void primeraPagina() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("page", "0")
                        .param("size", "3")
                        .param("sort", "name")
                        .param("direction", "asc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(3))
                .andExpect(jsonPath("$.totalElements").value(7))
                .andExpect(jsonPath("$.totalPages").value(3))
                .andExpect(jsonPath("$.first").value(true))
                .andExpect(jsonPath("$.last").value(false))
                .andExpect(jsonPath("$.content[0].firstName").value("NombreA"));
    }

    @Test
    @WithUserDetails("super.admin")
    void paginaIntermedia() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("page", "1")
                        .param("size", "3")
                        .param("sort", "name"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.first").value(false))
                .andExpect(jsonPath("$.last").value(false))
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.content[0].firstName").value("NombreD"));
    }

    @Test
    @WithUserDetails("super.admin")
    void ultimaPagina() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("page", "2")
                        .param("size", "3")
                        .param("sort", "name"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.last").value(true))
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].firstName").value("NombreG"));
    }

    @Test
    @WithUserDetails("super.admin")
    void paginaFueraDeRangoDevuelveVacioPeroConservaElTotal() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("page", "99")
                        .param("size", "3"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0))
                .andExpect(jsonPath("$.empty").value(true))
                .andExpect(jsonPath("$.totalElements").value(7));
    }

    @Test
    @WithUserDetails("super.admin")
    void elTamanoDePaginaEstaAcotado() throws Exception {
        mockMvc.perform(get(RUTA).param("size", "5000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnaPaginaNegativa() throws Exception {
        mockMvc.perform(get(RUTA).param("page", "-1"))
                .andExpect(status().isBadRequest());
    }

    // ─── Búsqueda y filtro por restaurante ──────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void busquedaPorEmailYTelefono() throws Exception {
        mockMvc.perform(get(RUTA).param("search", PREFIJO + "3@ejemplo.com"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));

        mockMvc.perform(get(RUTA).param("search", "610000005"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    @WithUserDetails("super.admin")
    void busquedaSinResultados() throws Exception {
        mockMvc.perform(get(RUTA).param("search", "no-existe-este-cliente-xyz"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.empty").value(true));
    }

    @Test
    @WithUserDetails("super.admin")
    void elComodinDelUsuarioSeBuscaLiteralmente() throws Exception {
        mockMvc.perform(get(RUTA).param("search", "%"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @WithUserDetails("super.admin")
    void filtraPorRestaurante() throws Exception {
        mockMvc.perform(get(RUTA).param("restaurantId", String.valueOf(restauranteId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(7));
    }

    // ─── Segmentos ──────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void segmentoRecurrentes() throws Exception {
        // Solo los dos primeros tienen más de una reserva.
        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("segment", "recurrentes"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2));
    }

    @Test
    @WithUserDetails("super.admin")
    void segmentoNuevos() throws Exception {
        // Los 7 se acaban de crear, así que todos son altas de este mes.
        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("segment", "nuevos"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(7));
    }

    @Test
    @WithUserDetails("super.admin")
    void segmentoSinVenirExcluyeAquienNuncaReservo() throws Exception {
        // Solo el tercero tiene una reserva y es de hace ocho meses. Los cuatro
        // que no han reservado nunca quedan fuera a propósito.
        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("segment", "sin-venir"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].lastName").value(PREFIJO + "3"));
    }

    @Test
    @WithUserDetails("super.admin")
    void aceptaElSegmentoEnCamelCase() throws Exception {
        // El frontend usa 'sinVenir'; el backend acepta ambas formas.
        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("segment", "sinVenir"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnSegmentoNoValido() throws Exception {
        mockMvc.perform(get(RUTA).param("segment", "vip"))
                .andExpect(status().isBadRequest());
    }

    // ─── Ordenación ─────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void ordenAscendenteYdescendentePorNombre() throws Exception {
        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("sort", "name").param("direction", "asc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].firstName").value("NombreA"))
                .andExpect(jsonPath("$.content[6].firstName").value("NombreG"));

        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("sort", "name").param("direction", "desc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].firstName").value("NombreG"))
                .andExpect(jsonPath("$.content[6].firstName").value("NombreA"));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnCampoDeOrdenNoPermitido() throws Exception {
        // Los agregados no son ordenables: son subconsultas.
        mockMvc.perform(get(RUTA).param("sort", "totalReservations"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get(RUTA).param("sort", "notes"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnaDireccionNoValida() throws Exception {
        mockMvc.perform(get(RUTA).param("direction", "arriba"))
                .andExpect(status().isBadRequest());
    }

    // ─── Agregados de la fila ───────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void cadaFilaTraeSusReservasYlaFechaDeLaUltima() throws Exception {
        mockMvc.perform(get(RUTA).param("search", PREFIJO + "1@ejemplo.com"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].totalReservations").value(2))
                .andExpect(jsonPath("$.content[0].lastReservationDate")
                        .value(LocalDate.now().minusDays(2).toString()))
                .andExpect(jsonPath("$.content[0].restaurantName").value(PREFIJO + " Restaurante"));
    }

    // ─── Cifras y conjunto vacío ────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void lasCifrasSeCalculanEnElServidor() throws Exception {
        mockMvc.perform(get(RUTA + "/stats").param("restaurantId", String.valueOf(restauranteId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(7))
                .andExpect(jsonPath("$.data.recurrentes").value(2))
                .andExpect(jsonPath("$.data.nuevosEsteMes").value(7))
                .andExpect(jsonPath("$.data.sinVenir").value(1));
    }

    @Test
    @WithUserDetails("super.admin")
    void sinClientesDevuelvePaginaVaciaYcifrasACero() throws Exception {
        List<Customer> todos = customerRepository.findAll();
        todos.forEach(cliente -> {
            cliente.setDeleted(true);
            cliente.setDeletedAt(java.time.LocalDateTime.now());
        });
        customerRepository.saveAll(todos);

        mockMvc.perform(get(RUTA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.totalPages").value(0))
                .andExpect(jsonPath("$.empty").value(true));

        mockMvc.perform(get(RUTA + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0))
                .andExpect(jsonPath("$.data.recurrentes").value(0))
                .andExpect(jsonPath("$.data.sinVenir").value(0));
    }
}
