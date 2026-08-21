package com.restaurante.reservation.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Cifras del panel de reservas, calculadas con una sola consulta agregada en el
 * alcance del usuario.
 *
 * <p>Alimentan las cuatro tarjetas y los contadores de las cinco pestañas.
 * Antes se derivaban en el navegador de la lista completa, así que al paginar
 * habrían pasado a contar solo la página.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReservationStats {

    /** Todas las reservas visibles, sin filtro de vista. */
    private long total;

    /** PENDING con fecha de hoy en adelante. Es el contador de «Solicitudes». */
    private long pendientes;

    /** CONFIRMED de hoy. */
    private long hoyConfirmadas;

    /** CONFIRMED a partir de mañana. */
    private long proximasConfirmadas;

    /** CANCELLED con fecha de hoy en adelante; es la cuarta tarjeta actual. */
    private long canceladasFuturas;

    /** Lo que cae en la vista de historial. */
    private long historial;
}
