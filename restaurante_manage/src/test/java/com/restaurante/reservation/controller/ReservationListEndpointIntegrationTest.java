package com.restaurante.reservation.controller;

import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.repository.DiningTableRepository;
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

import static org.hamcrest.Matchers.greaterThan;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Listado de reservas: vistas, búsqueda, filtros, ordenación y permisos.
 *
 * <p>Las cinco vistas se comprueban contra datos construidos a propósito, que es
 * lo que antes no podía verificarse: se calculaban en el navegador sobre la
 * lista completa descargada con {@code size=9999}.</p>
 *
 * <p>Todas las cifras se piden acotadas a {@code restaurantId}, porque el perfil
 * {@code dev} siembra reservas de demostración con fechas relativas a hoy y sin
 * ese filtro los totales no significarían nada.</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
// La base H2 vive todo el contexto: sin rollback, las reservas de cada prueba se
// acumularían y los totales dejarían de cuadrar.
@Transactional
class ReservationListEndpointIntegrationTest {

    private static final String RUTA = "/api/v1/reservations";

    /** Prefijo propio, para buscar solo lo que crea esta prueba. */
    private static final String PREFIJO = "zzres";

    @Autowired private MockMvc mockMvc;
    @Autowired private ReservationRepository reservationRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private DiningTableRepository diningTableRepository;

    private Long restauranteId;
    private Long mesaId;

    @BeforeEach
    void setUp() {
        Restaurant restaurante = new Restaurant();
        restaurante.setName(PREFIJO + " Restaurante");
        restaurante.setPublicBookingEnabled(true);
        restaurante.setDefaultReservationDurationMinutes(90);
        restaurante = restaurantRepository.save(restaurante);
        restauranteId = restaurante.getId();

        DiningTable mesa = new DiningTable();
        mesa.setRestaurant(restaurante);
        mesa.setTableNumber(PREFIJO + "mesa");
        mesa.setCapacity(4);
        mesaId = diningTableRepository.save(mesa).getId();

        Customer cliente = new Customer();
        cliente.setFirstName("Ana");
        cliente.setLastName(PREFIJO + "Apellido");
        cliente.setEmail(PREFIJO + "@ejemplo.com");
        cliente.setPhone("610000001");
        cliente.setRestaurant(restaurante);
        cliente = customerRepository.save(cliente);

        LocalDate hoy = LocalDate.now();

        // Una por vista, más dos casos límite.
        crearReserva(cliente, restaurante, null, hoy.plusDays(1), ReservationStatus.PENDING);
        crearReserva(cliente, restaurante, mesa, hoy, ReservationStatus.CONFIRMED);
        crearReserva(cliente, restaurante, null, hoy.plusDays(3), ReservationStatus.CONFIRMED);
        crearReserva(cliente, restaurante, null, hoy.plusDays(1), ReservationStatus.CANCELLED);
        crearReserva(cliente, restaurante, null, hoy.minusDays(7), ReservationStatus.COMPLETED);
        // Pendiente y pasada: ni es solicitud (la vista exige fecha >= hoy) ni
        // entra en el historial (el criterio excluye PENDING a propósito).
        crearReserva(cliente, restaurante, null, hoy.minusDays(10), ReservationStatus.PENDING);
    }

    private void crearReserva(Customer cliente, Restaurant restaurante, DiningTable mesa,
                              LocalDate fecha, ReservationStatus estado) {
        Reservation reserva = new Reservation();
        reserva.setCustomer(cliente);
        reserva.setRestaurant(restaurante);
        reserva.setDiningTable(mesa);
        reserva.setReservationDate(fecha);
        reserva.setReservationTime(LocalTime.of(20, 0));
        reserva.setPartySize(2);
        reserva.setStatus(estado);
        reserva.setNotes("nota " + estado);
        reservationRepository.save(reserva);
    }

    /** Ruta del listado acotada al restaurante de la prueba. */
    private String mio(String queryString) {
        return RUTA + "?restaurantId=" + restauranteId + (queryString.isEmpty() ? "" : "&" + queryString);
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
    @WithUserDetails("employee.demo")
    void unEmpleadoSinAsignacionesNoVeNada() throws Exception {
        // employee.demo tiene tenant pero ninguna asignación: no ve ningún restaurante.
        mockMvc.perform(get(RUTA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.empty").value(true));
    }

    @Test
    @WithUserDetails("employee.demo")
    void unEmpleadoSinAsignacionesRecibeCifrasACero() throws Exception {
        mockMvc.perform(get(RUTA + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0))
                .andExpect(jsonPath("$.data.pendientes").value(0));
    }

    @Test
    @WithUserDetails("employee.demo")
    void elAlcanceManda_pedirUnRestauranteAjenoNoLoDesbloquea() throws Exception {
        mockMvc.perform(get(mio("")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    // ─── Las cinco vistas ───────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void vistaSolicitudesDevuelveSoloPendientesDeHoyEnAdelante() throws Exception {
        mockMvc.perform(get(mio("view=solicitudes")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].status").value("PENDING"));
    }

    @Test
    @WithUserDetails("super.admin")
    void vistaHoyDevuelveSoloConfirmadasDeHoy() throws Exception {
        mockMvc.perform(get(mio("view=hoy")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].reservationDate").value(LocalDate.now().toString()));
    }

    @Test
    @WithUserDetails("super.admin")
    void vistaProximasExcluyeLasDeHoy() throws Exception {
        mockMvc.perform(get(mio("view=proximas")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].reservationDate")
                        .value(LocalDate.now().plusDays(3).toString()));
    }

    @Test
    @WithUserDetails("super.admin")
    void vistaHistorialIncluyeEstadosFinalesYexcluyeLasPendientesPasadas() throws Exception {
        // CANCELLED futura y COMPLETED pasada entran; la PENDING pasada no.
        mockMvc.perform(get(mio("view=historial")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2));
    }

    @Test
    @WithUserDetails("super.admin")
    void vistaTodasNoFiltra() throws Exception {
        mockMvc.perform(get(mio("view=todas")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(6));
    }

    @Test
    @WithUserDetails("super.admin")
    void sinVistaSeComportaComoTodas() throws Exception {
        mockMvc.perform(get(mio("")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(6));
    }

    @Test
    @WithUserDetails("super.admin")
    void aceptaLaVistaConTilde() throws Exception {
        // Se pasa como parámetro, no dentro de la URL, para no depender de la
        // codificación del query string en MockMvc.
        mockMvc.perform(get(RUTA)
                        .param("restaurantId", String.valueOf(restauranteId))
                        .param("view", "próximas"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnaVistaNoValida() throws Exception {
        mockMvc.perform(get(mio("view=canceladas")))
                .andExpect(status().isBadRequest());
    }

    // ─── Búsqueda y filtros ─────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void laBusquedaEncuentraPorNombreDelCliente() throws Exception {
        mockMvc.perform(get(mio("search=" + PREFIJO + "Apellido")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(6));
    }

    @Test
    @WithUserDetails("super.admin")
    void laBusquedaEncuentraPorNumeroDeMesa() throws Exception {
        // Solo una de las seis tiene mesa asignada.
        mockMvc.perform(get(mio("search=" + PREFIJO + "mesa")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].diningTableId").value(mesaId));
    }

    @Test
    @WithUserDetails("super.admin")
    void laBusquedaSinResultadosDevuelvePaginaVacia() throws Exception {
        mockMvc.perform(get(mio("search=noexisteestecliente")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.empty").value(true));
    }

    @Test
    @WithUserDetails("super.admin")
    void elComodinDelUsuarioSeBuscaLiteralmente() throws Exception {
        mockMvc.perform(get(mio("search=%25")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @WithUserDetails("super.admin")
    void elFiltroDeEstadoSeSumaAlDeLaVista() throws Exception {
        // La vista «hoy» ya fija CONFIRMED: pedir PENDING no puede devolver nada.
        mockMvc.perform(get(mio("view=hoy&status=PENDING")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));

        mockMvc.perform(get(mio("view=todas&status=CANCELLED")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    @WithUserDetails("super.admin")
    void elFiltroDeFechaAcotaLaVista() throws Exception {
        mockMvc.perform(get(mio("view=todas&date=" + LocalDate.now())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));

        // Una fecha fuera del rango de la vista no lo amplía.
        mockMvc.perform(get(mio("view=proximas&date=" + LocalDate.now())))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnEstadoNoValido() throws Exception {
        mockMvc.perform(get(mio("status=INVENTADO")))
                .andExpect(status().isBadRequest());
    }

    // ─── Paginación y ordenación ────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void elTamanoDePaginaSeRecortaACien() throws Exception {
        // Antes el frontend pedía size=9999 y el backend obedecía.
        mockMvc.perform(get(mio("size=9999")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    @Test
    @WithUserDetails("super.admin")
    void paginaYtamanoRecortanElContenido() throws Exception {
        mockMvc.perform(get(mio("size=2&page=1")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(2))
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.totalPages").value(3))
                .andExpect(jsonPath("$.first").value(false));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnaPaginaNegativa() throws Exception {
        mockMvc.perform(get(mio("page=-1")))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithUserDetails("super.admin")
    void ordenaPorFechaEnAmbosSentidos() throws Exception {
        mockMvc.perform(get(mio("sort=date&direction=asc&size=100")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].reservationDate")
                        .value(LocalDate.now().minusDays(10).toString()));

        mockMvc.perform(get(mio("sort=date&direction=desc&size=100")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].reservationDate")
                        .value(LocalDate.now().plusDays(3).toString()));
    }

    @Test
    @WithUserDetails("super.admin")
    void ordenaPorNombreDeCliente() throws Exception {
        // Se ordena por una asociación a-uno; se comprueba que la consulta es válida.
        mockMvc.perform(get(mio("sort=customer&direction=asc")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(6));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnCampoDeOrdenNoPermitido() throws Exception {
        // Antes esto era un 500 desde Hibernate, no un 400.
        mockMvc.perform(get(mio("sort=notes")))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnaDireccionNoValida() throws Exception {
        mockMvc.perform(get(mio("direction=arriba")))
                .andExpect(status().isBadRequest());
    }

    // ─── Forma de la fila ───────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void elListadoConservaLosCamposQueUsanElDetalleYelFormulario() throws Exception {
        // El modal de detalle y el formulario de edición se abren con los datos
        // de la fila: si falta alguno de estos campos, dejan de funcionar.
        mockMvc.perform(get(mio("view=hoy")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].id").exists())
                .andExpect(jsonPath("$.content[0].customerId").exists())
                .andExpect(jsonPath("$.content[0].customerName").value("Ana " + PREFIJO + "Apellido"))
                .andExpect(jsonPath("$.content[0].customerEmail").value(PREFIJO + "@ejemplo.com"))
                .andExpect(jsonPath("$.content[0].restaurantId").value(restauranteId))
                .andExpect(jsonPath("$.content[0].restaurantName").value(PREFIJO + " Restaurante"))
                .andExpect(jsonPath("$.content[0].diningTableId").value(mesaId))
                .andExpect(jsonPath("$.content[0].tableNumber").value(PREFIJO + "mesa"))
                .andExpect(jsonPath("$.content[0].reservationTime").exists())
                .andExpect(jsonPath("$.content[0].partySize").value(2))
                .andExpect(jsonPath("$.content[0].status").value("CONFIRMED"))
                .andExpect(jsonPath("$.content[0].notes").value("nota CONFIRMED"))
                .andExpect(jsonPath("$.content[0].holdStatus").value("NONE"));
    }

    @Test
    @WithUserDetails("super.admin")
    void laFilaNoExponeElNombreYelApellidoPorSeparado() throws Exception {
        mockMvc.perform(get(mio("view=hoy")))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].customerFirstName").doesNotExist())
                .andExpect(jsonPath("$.content[0].customerLastName").doesNotExist());
    }

    // ─── Cifras ─────────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void lasCifrasCuadranConLasVistas() throws Exception {
        mockMvc.perform(get(RUTA + "/stats?restaurantId=" + restauranteId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(6))
                .andExpect(jsonPath("$.data.pendientes").value(1))
                .andExpect(jsonPath("$.data.hoyConfirmadas").value(1))
                .andExpect(jsonPath("$.data.proximasConfirmadas").value(1))
                .andExpect(jsonPath("$.data.canceladasFuturas").value(1))
                .andExpect(jsonPath("$.data.historial").value(2));
    }

    @Test
    @WithUserDetails("super.admin")
    void lasCifrasSinFiltroAbarcanMasQueUnRestaurante() throws Exception {
        // El perfil dev siembra reservas de demostración en otros restaurantes.
        mockMvc.perform(get(RUTA + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(greaterThan(6)));
    }
}
