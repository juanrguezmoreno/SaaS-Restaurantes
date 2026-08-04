package com.restaurante.restaurant.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;

/**
 * Proyección ligera de restaurante para el listado de administración.
 *
 * <p>Deliberadamente NO incluye {@code description} ni los contadores de mesas
 * y empleados: esos contadores obligan a {@code RestaurantMapper} a recorrer
 * colecciones {@code LAZY}, lo que produce dos consultas extra por fila. Aquí
 * la página completa se construye con una sola consulta mediante una
 * <em>constructor expression</em> de JPQL.</p>
 *
 * <p>No expone contraseñas, tokens ni datos internos: solo los campos que la
 * pantalla de administración muestra o necesita para sus acciones.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AdminRestaurantListItem {

    private Long id;
    private String name;
    private String address;
    private String phone;
    private String email;
    private Integer capacity;
    private Boolean publicBookingEnabled;
    private Long tenantId;
    private String tenantName;
    private LocalDateTime createdAt;
}
