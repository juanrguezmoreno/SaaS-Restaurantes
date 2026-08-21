package com.restaurante.restaurant.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Métricas del panel de administración de restaurantes.
 *
 * <p>Se calculan con una única consulta agregada en el mismo alcance que el
 * listado, no sumando la lista completa en el cliente. Solo contienen datos que
 * existen en el modelo: no hay planes de suscripción ni estados de pago.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AdminRestaurantStats {

    /** Número total de restaurantes visibles (no eliminados). */
    private long totalRestaurants;

    /** Suma de capacidades declaradas; los nulos cuentan como cero. */
    private long totalCapacity;

    /** Restaurantes con las reservas online activadas ({@code publicBookingEnabled}). */
    private long publicBookingEnabledCount;
}
