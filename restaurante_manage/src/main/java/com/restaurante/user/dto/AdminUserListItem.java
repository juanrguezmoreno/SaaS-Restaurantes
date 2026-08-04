package com.restaurante.user.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;

/**
 * Proyección ligera de usuario para el listado de empleados.
 *
 * <p>Se construye con una <em>constructor expression</em> de JPQL que no toca
 * ninguna colección: {@code roles} y {@code restaurantNames} se rellenan después
 * con dos consultas por lotes sobre los identificadores de la página. Así el
 * listado cuesta tres consultas en total, en vez de dos por fila como cuando
 * pasaba por {@code UserMapper} y sus colecciones {@code LAZY}.</p>
 *
 * <p>No incluye la contraseña ni ningún dato interno: solo lo que la pantalla
 * de empleados muestra.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AdminUserListItem {

    private Long id;
    private String username;
    private String email;
    private String firstName;
    private String lastName;
    private String phone;
    private boolean enabled;
    private String tenantName;

    /** Restaurante principal ({@code User.restaurant}), si tiene. */
    private String primaryRestaurantName;

    private LocalDateTime createdAt;

    /** Nombres de rol ({@code ROLE_ADMIN}, …). Se rellena por lotes. */
    private List<String> roles = new ArrayList<>();

    /**
     * Restaurantes que se muestran en la tabla: los asignados explícitamente y,
     * si no tiene ninguno, el principal. Se rellena por lotes.
     */
    private List<String> restaurantNames = new ArrayList<>();

    /**
     * Constructor que usa la consulta de listado. Deja fuera las colecciones a
     * propósito.
     */
    public AdminUserListItem(Long id,
                             String username,
                             String email,
                             String firstName,
                             String lastName,
                             String phone,
                             boolean enabled,
                             String tenantName,
                             String primaryRestaurantName,
                             LocalDateTime createdAt) {
        this.id = id;
        this.username = username;
        this.email = email;
        this.firstName = firstName;
        this.lastName = lastName;
        this.phone = phone;
        this.enabled = enabled;
        this.tenantName = tenantName;
        this.primaryRestaurantName = primaryRestaurantName;
        this.createdAt = createdAt;
        this.roles = new ArrayList<>();
        this.restaurantNames = new ArrayList<>();
    }
}
