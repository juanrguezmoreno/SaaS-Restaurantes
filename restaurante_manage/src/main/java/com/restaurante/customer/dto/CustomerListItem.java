package com.restaurante.customer.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;

/**
 * Proyección de cliente para el listado.
 *
 * <p>Se construye con una <em>constructor expression</em> de JPQL que trae el
 * restaurante y el usuario por {@code LEFT JOIN}. Antes el listado pasaba por
 * {@code CustomerMapper}, que lee {@code user.username} y
 * {@code restaurant.name} sobre asociaciones {@code LAZY}: dos consultas extra
 * por fila.</p>
 *
 * <p>{@code totalReservations} y {@code lastReservationDate} se rellenan después
 * con la consulta agregada por lotes que ya existía, así que el listado cuesta
 * dos consultas por página.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class CustomerListItem {

    private Long id;
    private Long userId;
    private String username;
    private Long restaurantId;
    private String restaurantName;
    private String firstName;
    private String lastName;
    private String email;
    private String phone;

    /** Lo necesita el formulario de edición, que se abre con los datos de la fila. */
    private String notes;

    private LocalDateTime createdAt;

    /** Reservas no canceladas del cliente. Se rellena por lotes. */
    private long totalReservations;

    /** Fecha de la última reserva no cancelada, o nulo si nunca reservó. */
    private LocalDate lastReservationDate;

    /**
     * Constructor que usa la consulta de listado. Deja fuera los agregados a
     * propósito: llegan después.
     */
    public CustomerListItem(Long id,
                            Long userId,
                            String username,
                            Long restaurantId,
                            String restaurantName,
                            String firstName,
                            String lastName,
                            String email,
                            String phone,
                            String notes,
                            LocalDateTime createdAt) {
        this.id = id;
        this.userId = userId;
        this.username = username;
        this.restaurantId = restaurantId;
        this.restaurantName = restaurantName;
        this.firstName = firstName;
        this.lastName = lastName;
        this.email = email;
        this.phone = phone;
        this.notes = notes;
        this.createdAt = createdAt;
    }

    /** Nombre completo, como lo pinta la tabla. */
    public String getFullName() {
        String first = firstName != null ? firstName.trim() : "";
        String last = lastName != null ? lastName.trim() : "";
        return (first + " " + last).trim();
    }
}
