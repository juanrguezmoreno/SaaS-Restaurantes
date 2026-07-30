package com.restaurante.availability.controller;

import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
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

import java.time.LocalDate;
import java.time.LocalTime;

import org.springframework.http.MediaType;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Rejilla de franjas horarias: aislamiento entre restaurantes en el endpoint
 * privado y ausencia de datos sensibles en el público.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class TimeSlotEndpointIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private DiningTableRepository diningTableRepository;

    private Long restauranteId;
    private String fecha;

    @BeforeEach
    void setUp() {
        Restaurant restaurante = new Restaurant();
        restaurante.setName("Franjas Test");
        restaurante.setOpeningTime(LocalTime.of(13, 0));
        restaurante.setClosingTime(LocalTime.of(16, 0));
        restaurante.setDefaultReservationDurationMinutes(90);
        restaurante.setPublicBookingEnabled(true);
        restauranteId = restaurantRepository.save(restaurante).getId();

        DiningTable mesa = new DiningTable();
        mesa.setRestaurant(restaurante);
        mesa.setTableNumber("T1");
        mesa.setCapacity(4);
        mesa.setStatus(TableStatus.AVAILABLE);
        diningTableRepository.save(mesa);

        fecha = LocalDate.now().plusDays(30).toString();
    }

    @Test
    void endpointPrivado_requiereAutenticacion() throws Exception {
        mockMvc.perform(get("/api/v1/availability/time-slots")
                        .param("restaurantId", String.valueOf(restauranteId))
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    @WithUserDetails("super.admin")
    void endpointPrivado_devuelveLaRejilla() throws Exception {
        mockMvc.perform(get("/api/v1/availability/time-slots")
                        .param("restaurantId", String.valueOf(restauranteId))
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].time").value("13:00:00"))
                .andExpect(jsonPath("$.data[0].available").value(true));
    }

    @Test
    void endpointDeMesas_yaNoEsPublico() throws Exception {
        // POST /availability/tables expone número, capacidad y ubicación de las
        // mesas: deja de ser accesible sin autenticación.
        mockMvc.perform(post("/api/v1/availability/tables")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"restaurantId\":" + restauranteId
                                + ",\"date\":\"" + fecha + "\",\"time\":\"13:00:00\",\"partySize\":2}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void endpointPublico_noRequiereAutenticacion() throws Exception {
        mockMvc.perform(get("/api/v1/public/restaurants/" + restauranteId + "/time-slots")
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data[0].time").value("13:00:00"));
    }

    @Test
    void endpointPublico_soloExponeHoraYDisponibilidad() throws Exception {
        mockMvc.perform(get("/api/v1/public/restaurants/" + restauranteId + "/time-slots")
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isOk())
                // Exactamente dos claves por franja: nada de mesas ni de clientes.
                .andExpect(jsonPath("$.data[0].length()").value(2))
                .andExpect(jsonPath("$.data[0].tableId").doesNotExist())
                .andExpect(jsonPath("$.data[0].tableNumber").doesNotExist())
                .andExpect(jsonPath("$.data[0].capacity").doesNotExist())
                .andExpect(jsonPath("$.data[0].customerName").doesNotExist());
    }

    @Test
    @WithUserDetails("super.admin")
    void publicoYPrivadoDevuelvenLaMismaRejilla() throws Exception {
        String privado = mockMvc.perform(get("/api/v1/availability/time-slots")
                        .param("restaurantId", String.valueOf(restauranteId))
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andReturn().getResponse().getContentAsString();

        String publico = mockMvc.perform(get("/api/v1/public/restaurants/" + restauranteId + "/time-slots")
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andReturn().getResponse().getContentAsString();

        com.fasterxml.jackson.databind.ObjectMapper om = new com.fasterxml.jackson.databind.ObjectMapper();
        org.junit.jupiter.api.Assertions.assertEquals(
                om.readTree(privado).get("data"),
                om.readTree(publico).get("data"),
                "Ambos flujos deben aplicar exactamente las mismas reglas de disponibilidad");
    }

    @Test
    void endpointPublico_rechazaRestauranteConReservasPublicasDesactivadas() throws Exception {
        Restaurant cerrado = new Restaurant();
        cerrado.setName("Sin reservas públicas");
        cerrado.setOpeningTime(LocalTime.of(13, 0));
        cerrado.setClosingTime(LocalTime.of(16, 0));
        cerrado.setDefaultReservationDurationMinutes(90);
        cerrado.setPublicBookingEnabled(false);
        Long cerradoId = restaurantRepository.save(cerrado).getId();

        mockMvc.perform(get("/api/v1/public/restaurants/" + cerradoId + "/time-slots")
                        .param("date", fecha)
                        .param("partySize", "2"))
                .andExpect(status().isBadRequest());
    }
}
