package com.restaurante.availability.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalTime;

/**
 * Una franja horaria de la rejilla de reservas.
 *
 * <p>Contiene exclusivamente la hora y si admite reserva. Nunca lleva ids ni
 * números de mesa, capacidades ni dato alguno de reservas ajenas: es la misma
 * carga que se devuelve al formulario público, que no está autenticado.</p>
 */
@Data
@NoArgsConstructor
@AllArgsConstructor
public class TimeSlotResponse {

    @JsonFormat(pattern = "HH:mm:ss")
    private LocalTime time;

    private boolean available;
}
