package com.restaurante.customer.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CustomerResponse {

    private Long id;
    private Long userId;
    private String username;
    private Long restaurantId;
    private String restaurantName;
    private String firstName;
    private String lastName;
    private String email;
    private String phone;
    private String notes;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /**
     * Reservas del cliente que cuentan como visita (ni canceladas ni borradas).
     * El listado ya mostraba estas dos columnas, pero nadie las rellenaba: salían
     * siempre "0" y "Sin reservas".
     */
    private long totalReservations;
    private LocalDate lastReservationDate;
}
