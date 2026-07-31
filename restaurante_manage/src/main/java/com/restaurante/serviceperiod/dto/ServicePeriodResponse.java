package com.restaurante.serviceperiod.dto;

import com.fasterxml.jackson.annotation.JsonFormat;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.DayOfWeek;
import java.time.LocalTime;

/**
 * Periodo de servicio devuelto al panel privado.
 *
 * <p>No expone {@code restaurantId} ni campos de auditoría: el restaurante ya
 * viene en la ruta.</p>
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
public class ServicePeriodResponse {

    private Long id;

    private DayOfWeek dayOfWeek;

    @JsonFormat(pattern = "HH:mm:ss")
    private LocalTime startTime;

    @JsonFormat(pattern = "HH:mm:ss")
    private LocalTime endTime;

    private String name;
}
