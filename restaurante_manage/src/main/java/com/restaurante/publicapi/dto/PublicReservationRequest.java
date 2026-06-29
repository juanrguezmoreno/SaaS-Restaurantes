package com.restaurante.publicapi.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import jakarta.validation.constraints.*;
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
public class PublicReservationRequest {

    @NotBlank(message = "El nombre del cliente es obligatorio")
    @Size(max = 100, message = "El nombre no puede exceder 100 caracteres")
    private String customerName;

    @NotBlank(message = "El teléfono es obligatorio")
    @Size(max = 20, message = "El teléfono no puede exceder 20 caracteres")
    private String phone;

    @NotBlank(message = "El email es obligatorio")
    @Email(message = "El email debe tener un formato válido")
    @Size(max = 100, message = "El email no puede exceder 100 caracteres")
    private String email;

    @NotNull(message = "La fecha de reserva es obligatoria")
    @FutureOrPresent(message = "La fecha de reserva debe ser hoy o futura")
    @JsonFormat(pattern = "yyyy-MM-dd")
    private LocalDate reservationDate;

    @NotNull(message = "La hora de reserva es obligatoria")
    @JsonFormat(pattern = "HH:mm:ss")
    private LocalTime reservationTime;

    @NotNull(message = "El número de comensales es obligatorio")
    @Positive(message = "El número de comensales debe ser positivo")
    @Max(value = 50, message = "Máximo 50 personas por reserva")
    private Integer partySize;

    @Size(max = 500, message = "Las notas no pueden exceder 500 caracteres")
    private String notes;
}
