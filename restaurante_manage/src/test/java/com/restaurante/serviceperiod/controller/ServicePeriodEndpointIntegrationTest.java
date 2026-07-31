package com.restaurante.serviceperiod.controller;

import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.test.context.support.WithUserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Horarios de servicio: acceso, aislamiento entre restaurantes y persistencia
 * extremo a extremo.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class ServicePeriodEndpointIntegrationTest {

    private static final String CUERPO_LUNES = """
            [
              {"dayOfWeek":"MONDAY","startTime":"13:00:00","endTime":"16:00:00","name":"Comidas"},
              {"dayOfWeek":"MONDAY","startTime":"20:00:00","endTime":"23:00:00","name":"Cenas"}
            ]
            """;

    @Autowired private MockMvc mockMvc;
    @Autowired private RestaurantRepository restaurantRepository;

    private Long restauranteId;
    private String ruta;

    @BeforeEach
    void setUp() {
        Restaurant restaurante = new Restaurant();
        restaurante.setName("Horarios Endpoint Test");
        restaurante.setDefaultReservationDurationMinutes(90);
        restaurante.setPublicBookingEnabled(true);
        restauranteId = restaurantRepository.save(restaurante).getId();
        ruta = "/api/v1/restaurants/" + restauranteId + "/service-periods";
    }

    @Test
    void requiereAutenticacionParaLeer() throws Exception {
        mockMvc.perform(get(ruta)).andExpect(status().isUnauthorized());
    }

    @Test
    void requiereAutenticacionParaGuardar() throws Exception {
        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(CUERPO_LUNES))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithUserDetails("super.admin")
    void unAdministradorGuardaYRecuperaLosPeriodos() throws Exception {
        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(CUERPO_LUNES))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2));

        mockMvc.perform(get(ruta))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                // Devueltos ordenados por hora de inicio.
                .andExpect(jsonPath("$.data[0].startTime").value("13:00:00"))
                .andExpect(jsonPath("$.data[0].name").value("Comidas"))
                .andExpect(jsonPath("$.data[1].startTime").value("20:00:00"));
    }

    @Test
    @WithUserDetails("super.admin")
    void unRestauranteSinPeriodosDevuelveListaVacia() throws Exception {
        mockMvc.perform(get(ruta))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(0));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaPeriodosSolapados() throws Exception {
        String solapados = """
                [
                  {"dayOfWeek":"MONDAY","startTime":"13:00:00","endTime":"16:00:00"},
                  {"dayOfWeek":"MONDAY","startTime":"15:00:00","endTime":"18:00:00"}
                ]
                """;

        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(solapados))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithUserDetails("juan.admin")
    void noSePuedeLeerLaConfiguracionDeOtroRestaurante() throws Exception {
        // "Horarios Endpoint Test" se crea sin tenant; juan.admin es ADMIN del
        // tenant "Demo Gourmet", así que el acceso se deniega por cross-tenant.
        mockMvc.perform(get(ruta)).andExpect(status().isForbidden());
    }

    @Test
    @WithUserDetails("juan.admin")
    void noSePuedeEditarOtroRestauranteCambiandoLaUrl() throws Exception {
        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(CUERPO_LUNES))
                .andExpect(status().isForbidden());
    }

    @Test
    @WithUserDetails("employee.demo")
    void unUsuarioSinPermisosDeGestionNoPuedeGuardar() throws Exception {
        mockMvc.perform(put(ruta).contentType(MediaType.APPLICATION_JSON).content(CUERPO_LUNES))
                .andExpect(status().isForbidden());
    }
}
