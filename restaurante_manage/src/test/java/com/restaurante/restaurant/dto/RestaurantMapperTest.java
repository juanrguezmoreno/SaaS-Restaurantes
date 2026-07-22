package com.restaurante.restaurant.dto;

import com.restaurante.restaurant.entity.Restaurant;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;

class RestaurantMapperTest {

    private final RestaurantMapper mapper = new RestaurantMapper();

    private RestaurantRequest baseRequest() {
        RestaurantRequest req = new RestaurantRequest();
        req.setName("La Buena Mesa");
        req.setAddress("Calle Falsa 123");
        return req;
    }

    @Test
    void toEntity_usaNoventaMinutosPorDefectoSiNoSeEspecificaDuracion() {
        Restaurant restaurant = mapper.toEntity(baseRequest());
        assertEquals(90, restaurant.getDefaultReservationDurationMinutes());
    }

    @Test
    void toEntity_respetaLaDuracionIndicadaEnElRequest() {
        RestaurantRequest req = baseRequest();
        req.setDefaultReservationDurationMinutes(120);
        Restaurant restaurant = mapper.toEntity(req);
        assertEquals(120, restaurant.getDefaultReservationDurationMinutes());
    }

    @Test
    void updateEntity_actualizaLaDuracionCuandoSeIndica() {
        Restaurant restaurant = new Restaurant();
        restaurant.setDefaultReservationDurationMinutes(90);

        RestaurantRequest req = baseRequest();
        req.setDefaultReservationDurationMinutes(60);
        mapper.updateEntity(restaurant, req);

        assertEquals(60, restaurant.getDefaultReservationDurationMinutes());
    }

    @Test
    void updateEntity_mantieneLaDuracionExistenteSiElRequestNoLaEspecifica() {
        Restaurant restaurant = new Restaurant();
        restaurant.setDefaultReservationDurationMinutes(120);

        mapper.updateEntity(restaurant, baseRequest());

        assertEquals(120, restaurant.getDefaultReservationDurationMinutes());
    }

    @Test
    void toResponse_incluyeLaDuracion() {
        Restaurant restaurant = new Restaurant();
        restaurant.setDefaultReservationDurationMinutes(90);

        RestaurantResponse response = mapper.toResponse(restaurant);

        assertEquals(90, response.getDefaultReservationDurationMinutes());
    }
}
