package com.restaurante.restaurant.dto;

import com.restaurante.common.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Lista cerrada de campos de ordenación: lo que llega del cliente no puede
 * convertirse en un nombre de propiedad arbitrario.
 */
class AdminRestaurantSortFieldTest {

    @Test
    void aceptaLosCamposPermitidosPorNombreDePropiedad() {
        assertThat(AdminRestaurantSortField.from("name").getProperty()).isEqualTo("name");
        assertThat(AdminRestaurantSortField.from("capacity").getProperty()).isEqualTo("capacity");
        assertThat(AdminRestaurantSortField.from("createdAt").getProperty()).isEqualTo("createdAt");
        assertThat(AdminRestaurantSortField.from("id").getProperty()).isEqualTo("id");
    }

    @Test
    void noDistingueMayusculasNiFormaDelEnum() {
        assertThat(AdminRestaurantSortField.from("NAME")).isEqualTo(AdminRestaurantSortField.NAME);
        assertThat(AdminRestaurantSortField.from("created_at")).isEqualTo(AdminRestaurantSortField.CREATED_AT);
        assertThat(AdminRestaurantSortField.from("CREATED_AT")).isEqualTo(AdminRestaurantSortField.CREATED_AT);
    }

    @Test
    void sinValorOrdenaPorIdentificador() {
        assertThat(AdminRestaurantSortField.from(null)).isEqualTo(AdminRestaurantSortField.ID);
        assertThat(AdminRestaurantSortField.from("  ")).isEqualTo(AdminRestaurantSortField.ID);
    }

    @Test
    void rechazaCualquierOtroCampo() {
        assertThatThrownBy(() -> AdminRestaurantSortField.from("description"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("no permitido");

        assertThatThrownBy(() -> AdminRestaurantSortField.from("tenant.name"))
                .isInstanceOf(BadRequestException.class);

        // Nada de inyectar fragmentos en la cláusula de orden.
        assertThatThrownBy(() -> AdminRestaurantSortField.from("id; DROP TABLE restaurants"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void elMensajeDeErrorEnumeraLosCamposAdmitidos() {
        assertThat(AdminRestaurantSortField.allowedValues())
                .contains("id", "name", "capacity", "createdAt");
    }
}
