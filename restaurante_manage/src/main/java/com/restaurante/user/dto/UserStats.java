package com.restaurante.user.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Métricas del listado de empleados, en el mismo alcance que el listado.
 *
 * <p>Se calculan con una consulta agregada, no sumando la lista descargada.
 * Solo contienen datos que existen en el modelo: {@code enabled} es un campo
 * real de {@code User}.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class UserStats {

    /** Empleados visibles (no eliminados). */
    private long total;

    /** Empleados con la cuenta activa. */
    private long active;

    /** Empleados con la cuenta desactivada. */
    private long inactive;
}
