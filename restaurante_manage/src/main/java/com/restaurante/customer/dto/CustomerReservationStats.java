package com.restaurante.customer.dto;

import java.time.LocalDate;

/**
 * Agregado de reservas por cliente, resuelto en una única consulta para toda
 * la página de clientes (evita una consulta por fila).
 *
 * <p>Solo cuenta las reservas que representan una visita real: quedan fuera las
 * canceladas y las borradas lógicamente.</p>
 */
public interface CustomerReservationStats {

    Long getCustomerId();

    long getTotalReservations();

    LocalDate getLastReservationDate();
}
