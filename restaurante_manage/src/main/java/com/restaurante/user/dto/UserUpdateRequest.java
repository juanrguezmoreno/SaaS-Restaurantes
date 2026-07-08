package com.restaurante.user.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.util.Set;

/**
 * DTO para actualizar un usuario existente.
 *
 * A diferencia de {@link UserRequest} (usado en creación), la contraseña es
 * OPCIONAL: si viene null/vacía se conserva la contraseña actual; si viene
 * informada debe cumplir la longitud mínima y se cifra de nuevo.
 */
@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class UserUpdateRequest {

    @NotBlank(message = "El username es obligatorio")
    @Size(min = 3, max = 50, message = "El username debe tener entre 3 y 50 caracteres")
    private String username;

    @NotBlank(message = "El email es obligatorio")
    @Email(message = "Debe proporcionar un email válido")
    @Size(max = 100, message = "El email no debe exceder 100 caracteres")
    private String email;

    // Opcional al editar: @Size solo valida cuando hay valor (null se ignora).
    @Size(min = 6, max = 100, message = "La contraseña debe tener entre 6 y 100 caracteres")
    private String password;

    @Size(max = 50, message = "El nombre no debe exceder 50 caracteres")
    private String firstName;

    @Size(max = 50, message = "El apellido no debe exceder 50 caracteres")
    private String lastName;

    @Size(max = 20, message = "El teléfono no debe exceder 20 caracteres")
    private String phone;

    private Set<String> roles;

    private Long tenantId;

    private Long restaurantId;
}
