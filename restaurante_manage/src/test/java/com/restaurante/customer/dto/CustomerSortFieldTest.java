package com.restaurante.customer.dto;

import com.restaurante.common.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Lista cerrada de campos de ordenación del listado de clientes.
 */
class CustomerSortFieldTest {

    @Test
    void aceptaLosCamposPermitidos() {
        assertThat(CustomerSortField.from("id")).isEqualTo(CustomerSortField.ID);
        assertThat(CustomerSortField.from("email")).isEqualTo(CustomerSortField.EMAIL);
        assertThat(CustomerSortField.from("createdAt")).isEqualTo(CustomerSortField.CREATED_AT);
    }

    @Test
    void elNombreOrdenaPorNombreYLuegoApellido() {
        assertThat(CustomerSortField.from("name").getProperties())
                .containsExactly("firstName", "lastName");
    }

    @Test
    void sinValorOrdenaPorIdentificador() {
        assertThat(CustomerSortField.from(null)).isEqualTo(CustomerSortField.ID);
        assertThat(CustomerSortField.from("  ")).isEqualTo(CustomerSortField.ID);
    }

    @Test
    void rechazaLosAgregadosPorqueSonSubconsultas() {
        assertThatThrownBy(() -> CustomerSortField.from("totalReservations"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("no permitido");

        assertThatThrownBy(() -> CustomerSortField.from("lastReservationDate"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void rechazaCamposInternosYFragmentosDeConsulta() {
        assertThatThrownBy(() -> CustomerSortField.from("notes"))
                .isInstanceOf(BadRequestException.class);

        assertThatThrownBy(() -> CustomerSortField.from("id; DROP TABLE customers"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void elMensajeDeErrorEnumeraLosCamposAdmitidos() {
        assertThat(CustomerSortField.allowedValues())
                .contains("id", "name", "email", "createdAt");
    }
}
