package com.restaurante.serviceperiod.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.DayOfWeek;
import java.time.LocalTime;

/**
 * Periodo recibido en el PUT de horarios.
 *
 * <p>{@code id} nulo significa periodo nuevo. Las reglas (fin posterior al
 * inicio, sin solapes, id perteneciente al restaurante) se validan en el
 * servicio, no con anotaciones: dependen del conjunto, no de un campo suelto.</p>
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class ServicePeriodRequest {

    private Long id;

    private DayOfWeek dayOfWeek;

    private LocalTime startTime;

    private LocalTime endTime;

    private String name;
}
