package com.restaurante.restaurant.controller;

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

import java.util.List;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Panel de administración de restaurantes: paginación, búsqueda, ordenación y
 * quién puede llegar al endpoint.
 *
 * <p>El perfil {@code dev} arranca con datos demo, así que las pruebas no
 * asumen totales absolutos salvo cuando ellas mismas controlan el conjunto
 * (búsquedas por un prefijo propio).</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
// La base H2 vive todo el contexto: sin rollback, los restaurantes que crea
// cada prueba se acumularían y los totales dejarían de significar nada.
@Transactional
class AdminRestaurantEndpointIntegrationTest {

    private static final String RUTA = "/api/v1/admin/restaurants";

    /** Prefijo propio para poder buscar solo lo que crea esta prueba. */
    private static final String PREFIJO = "ZZPanel";

    @Autowired private MockMvc mockMvc;
    @Autowired private RestaurantRepository restaurantRepository;

    @BeforeEach
    void setUp() {
        // 7 restaurantes propios: suficientes para tener varias páginas de 3.
        for (int i = 1; i <= 7; i++) {
            Restaurant restaurante = new Restaurant();
            restaurante.setName(PREFIJO + " " + (char) ('A' + i - 1));
            restaurante.setAddress("Calle " + i);
            restaurante.setEmail("panel" + i + "@ejemplo.com");
            restaurante.setPhone("60000000" + i);
            restaurante.setCapacity(i * 10);
            restaurante.setPublicBookingEnabled(i % 2 == 0);
            restaurante.setDefaultReservationDurationMinutes(90);
            restaurantRepository.save(restaurante);
        }
    }

    // ─── Seguridad ──────────────────────────────────────────────────────────

    @Test
    void sinAutenticacionRechazaElListado() throws Exception {
        mockMvc.perform(get(RUTA)).andExpect(status().isUnauthorized());
    }

    @Test
    void sinAutenticacionRechazaLasMetricas() throws Exception {
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
    @WithUserDetails("manager.demo")
    void unEncargadoNoAccede() throws Exception {
        mockMvc.perform(get(RUTA)).andExpect(status().isForbidden());
    }

    @Test
    @WithUserDetails("employee.demo")
    void unEmpleadoNoAccede() throws Exception {
        mockMvc.perform(get(RUTA)).andExpect(status().isForbidden());
    }

    @Test
    @WithUserDetails("juan.admin")
    void unAdministradorSoloVeLosRestaurantesDeSuCuenta() throws Exception {
        // Los restaurantes que crea esta prueba no tienen tenant, así que el
        // ADMIN del tenant demo no debe verlos por mucho que los busque.
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
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.content[0].name").value(PREFIJO + " A"));
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
                .andExpect(jsonPath("$.page").value(1))
                .andExpect(jsonPath("$.first").value(false))
                .andExpect(jsonPath("$.last").value(false))
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.content[0].name").value(PREFIJO + " D"));
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
                .andExpect(jsonPath("$.content[0].name").value(PREFIJO + " G"));
    }

    @Test
    @WithUserDetails("super.admin")
    void paginaFueraDeRangoDevuelveContenidoVacioPeroConservaElTotal() throws Exception {
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
    void cambiarElTamanoCambiaElNumeroDePaginas() throws Exception {
        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("size", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(10))
                .andExpect(jsonPath("$.totalPages").value(1))
                .andExpect(jsonPath("$.content.length()").value(7));
    }

    @Test
    @WithUserDetails("super.admin")
    void elTamanoDePaginaEstaAcotado() throws Exception {
        // Pedir 5000 no puede traer la tabla entera: se recorta a 100.
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

    // ─── Búsqueda ───────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void busquedaConResultados() throws Exception {
        mockMvc.perform(get(RUTA).param("search", "panel3@ejemplo.com"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].name").value(PREFIJO + " C"));
    }

    @Test
    @WithUserDetails("super.admin")
    void busquedaPorDireccionYTelefono() throws Exception {
        mockMvc.perform(get(RUTA).param("search", "600000005"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));

        mockMvc.perform(get(RUTA).param("search", "Calle 4"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    @WithUserDetails("super.admin")
    void busquedaSinResultados() throws Exception {
        mockMvc.perform(get(RUTA).param("search", "no-existe-este-restaurante-xyz"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.content.length()").value(0))
                .andExpect(jsonPath("$.empty").value(true));
    }

    @Test
    @WithUserDetails("super.admin")
    void elComodinDelUsuarioSeBuscaLiteralmente() throws Exception {
        // Un '%' escrito a mano no debe convertir la búsqueda en "todo".
        mockMvc.perform(get(RUTA).param("search", "%"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    // ─── Ordenación ─────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void ordenAscendentePorCapacidad() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("sort", "capacity")
                        .param("direction", "asc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].capacity").value(10))
                .andExpect(jsonPath("$.content[6].capacity").value(70));
    }

    @Test
    @WithUserDetails("super.admin")
    void ordenDescendentePorCapacidad() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("sort", "capacity")
                        .param("direction", "desc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].capacity").value(70))
                .andExpect(jsonPath("$.content[6].capacity").value(10));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnCampoDeOrdenNoPermitido() throws Exception {
        mockMvc.perform(get(RUTA).param("sort", "description"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnaDireccionNoValida() throws Exception {
        mockMvc.perform(get(RUTA).param("direction", "arriba"))
                .andExpect(status().isBadRequest());
    }

    // ─── Métricas ───────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void lasMetricasSeCalculanEnElServidor() throws Exception {
        mockMvc.perform(get(RUTA + "/stats"))
                .andExpect(status().isOk())
                // 7 propios más los del conjunto demo.
                .andExpect(jsonPath("$.data.totalRestaurants").value(org.hamcrest.Matchers.greaterThanOrEqualTo(7)))
                .andExpect(jsonPath("$.data.totalCapacity").value(org.hamcrest.Matchers.greaterThanOrEqualTo(280)))
                .andExpect(jsonPath("$.data.publicBookingEnabledCount").exists());
    }

    // ─── Eliminación y conjunto vacío ───────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void alEliminarUnRestauranteDesapareceDelListado() throws Exception {
        Long id = restaurantRepository.findAll().stream()
                .filter(r -> r.getName() != null && r.getName().startsWith(PREFIJO))
                .findFirst()
                .orElseThrow()
                .getId();

        mockMvc.perform(delete("/api/v1/restaurants/" + id))
                .andExpect(status().isOk());

        mockMvc.perform(get(RUTA).param("search", PREFIJO))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(6));
    }

    @Test
    @WithUserDetails("super.admin")
    void sinRestaurantesDevuelvePaginaVaciaYMetricasACero() throws Exception {
        // Borrado lógico de todo, como haría la aplicación.
        List<Restaurant> todos = restaurantRepository.findAll();
        todos.forEach(restaurante -> {
            restaurante.setDeleted(true);
            restaurante.setDeletedAt(java.time.LocalDateTime.now());
        });
        restaurantRepository.saveAll(todos);

        mockMvc.perform(get(RUTA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.totalPages").value(0))
                .andExpect(jsonPath("$.empty").value(true));

        mockMvc.perform(get(RUTA + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.totalRestaurants").value(0))
                .andExpect(jsonPath("$.data.totalCapacity").value(0))
                .andExpect(jsonPath("$.data.publicBookingEnabledCount").value(0));
    }
}
