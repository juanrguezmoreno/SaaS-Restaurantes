package com.restaurante.availability.dto;

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

class AvailabilityRequestValidationTest {

    private final Validator validator;

    AvailabilityRequestValidationTest() {
        try (ValidatorFactory factory = Validation.buildDefaultValidatorFactory()) {
            validator = factory.getValidator();
        }
    }

    @Test
    void rechazaTimeNulo() {
        AvailabilityRequest req = new AvailabilityRequest(1L, LocalDate.now().plusDays(1), null, 2);
        Set<ConstraintViolation<AvailabilityRequest>> violations = validator.validate(req);
        assertFalse(violations.isEmpty());
    }

    @Test
    void permiteTimeInformado() {
        AvailabilityRequest req = new AvailabilityRequest(1L, LocalDate.now().plusDays(1), LocalTime.of(21, 0), 2);
        Set<ConstraintViolation<AvailabilityRequest>> violations = validator.validate(req);
        assertTrue(violations.isEmpty());
    }
}
