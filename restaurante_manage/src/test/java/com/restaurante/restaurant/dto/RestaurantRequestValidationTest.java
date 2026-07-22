package com.restaurante.restaurant.dto;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.Test;

import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class RestaurantRequestValidationTest {

    private final Validator validator;

    RestaurantRequestValidationTest() {
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
            validator = factory.getValidator();
        }
    }

    private RestaurantRequest baseRequest(Integer duration) {
        RestaurantRequest req = new RestaurantRequest();
        req.setName("La Buena Mesa");
        req.setAddress("Calle Falsa 123");
        req.setDefaultReservationDurationMinutes(duration);
        return req;
    }

    @Test
    void permiteDuracionNula_seAplicaElDefaultEnElMapper() {
        Set<ConstraintViolation<RestaurantRequest>> violations = validator.validate(baseRequest(null));
        assertTrue(violations.isEmpty());
    }

    @Test
    void rechazaDuracionMenorA15Minutos() {
        Set<ConstraintViolation<RestaurantRequest>> violations = validator.validate(baseRequest(10));
        assertFalse(violations.isEmpty());
    }

    @Test
    void rechazaDuracionMayorA480Minutos() {
        Set<ConstraintViolation<RestaurantRequest>> violations = validator.validate(baseRequest(481));
        assertFalse(violations.isEmpty());
    }

    @Test
    void permiteDuracionEnElRangoValido() {
        Set<ConstraintViolation<RestaurantRequest>> violations = validator.validate(baseRequest(90));
        assertTrue(violations.isEmpty());
    }
}
