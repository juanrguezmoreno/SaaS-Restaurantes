package com.restaurante.customer.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Cifras de las tarjetas de la pantalla de clientes, en el alcance del usuario
 * autenticado.
 *
 * <p>Se calculan con una consulta agregada, no contando la lista descargada: al
 * paginar, contar la página daría un número sin sentido.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CustomerStats {

    /** Clientes visibles (no eliminados). */
    private long total;

    /** Con más de una reserva no cancelada. */
    private long recurrentes;

    /** Dados de alta desde el día 1 del mes en curso. */
    private long nuevosEsteMes;

    /** Con la última reserva anterior a hace tres meses. */
    private long sinVenir;
}
