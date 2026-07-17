package com.restaurante.reservation.dto;

import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import jakarta.validation.ValidatorFactory;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class ReservationRequestValidationTest {

    private final Validator validator;

    ReservationRequestValidationTest() {
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
            validator = factory.getValidator();
        }
    }

    private ReservationRequest baseRequest(int partySize) {
        ReservationRequest req = new ReservationRequest();
        req.setCustomerId(1L);
        req.setRestaurantId(1L);
        req.setReservationDate(LocalDate.now().plusDays(1));
        req.setReservationTime(LocalTime.of(20, 0));
        req.setPartySize(partySize);
        return req;
    }

    @Test
    void rechazaMasDe50Comensales() {
        Set<ConstraintViolation<ReservationRequest>> violations = validator.validate(baseRequest(51));
        assertFalse(violations.isEmpty());
    }

    @Test
    void permite50Comensales() {
        Set<ConstraintViolation<ReservationRequest>> violations = validator.validate(baseRequest(50));
        assertTrue(violations.isEmpty());
    }
}
