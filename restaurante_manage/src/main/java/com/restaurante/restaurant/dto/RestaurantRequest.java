package com.restaurante.restaurant.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class RestaurantRequest {

    @NotBlank(message = "El nombre del restaurante es obligatorio")
    @Size(max = 100, message = "El nombre no debe exceder 100 caracteres")
    private String name;

    @Size(max = 200, message = "La dirección no debe exceder 200 caracteres")
    private String address;

    @Size(max = 20, message = "El teléfono no debe exceder 20 caracteres")
    private String phone;

    @Size(max = 100, message = "El email no debe exceder 100 caracteres")
    private String email;

    private String description;

    private LocalTime openingTime;

    private LocalTime closingTime;

    private Integer capacity;

    private Boolean publicBookingEnabled;

    @Min(value = 15, message = "La duración mínima de una reserva es de 15 minutos")
    @Max(value = 480, message = "La duración máxima de una reserva es de 480 minutos")
    private Integer defaultReservationDurationMinutes;

    private Long tenantId;
}
