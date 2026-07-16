package com.restaurante.reservation.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.FutureOrPresent;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDate;
import java.time.LocalTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ReservationRequest {

    @NotNull(message = "El ID del cliente es obligatorio")
    private Long customerId;

    private Long diningTableId;

    @NotNull(message = "El ID del restaurante es obligatorio")
    private Long restaurantId;

    @NotNull(message = "La fecha de reserva es obligatoria")
    @FutureOrPresent(message = "La fecha de reserva debe ser hoy o futura")
    private LocalDate reservationDate;

    @NotNull(message = "La hora de reserva es obligatoria")
    private LocalTime reservationTime;

    @NotNull(message = "El número de comensales es obligatorio")
    @Positive(message = "El número de comensales debe ser positivo")
    @Max(value = 50, message = "Máximo 50 personas por reserva")
    private Integer partySize;

    private String notes;

    private String status;
}
