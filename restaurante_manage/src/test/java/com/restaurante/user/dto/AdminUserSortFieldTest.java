package com.restaurante.user.dto;

import com.restaurante.common.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Lista cerrada de campos de ordenación del listado de empleados.
 */
class AdminUserSortFieldTest {

    @Test
    void aceptaLosCamposPermitidos() {
        assertThat(AdminUserSortField.from("username")).isEqualTo(AdminUserSortField.USERNAME);
        assertThat(AdminUserSortField.from("email")).isEqualTo(AdminUserSortField.EMAIL);
        assertThat(AdminUserSortField.from("createdAt")).isEqualTo(AdminUserSortField.CREATED_AT);
        assertThat(AdminUserSortField.from("enabled")).isEqualTo(AdminUserSortField.ENABLED);
        assertThat(AdminUserSortField.from("id")).isEqualTo(AdminUserSortField.ID);
    }

    @Test
    void elNombreOrdenaPorNombreYLuegoApellido() {
        assertThat(AdminUserSortField.from("name").getProperties())
                .containsExactly("firstName", "lastName");
    }

    @Test
    void noDistingueMayusculasNiFormaDelEnum() {
        assertThat(AdminUserSortField.from("USERNAME")).isEqualTo(AdminUserSortField.USERNAME);
        assertThat(AdminUserSortField.from("created_at")).isEqualTo(AdminUserSortField.CREATED_AT);
    }

    @Test
    void sinValorOrdenaPorIdentificador() {
        assertThat(AdminUserSortField.from(null)).isEqualTo(AdminUserSortField.ID);
        assertThat(AdminUserSortField.from("  ")).isEqualTo(AdminUserSortField.ID);
    }

    @Test
    void rechazaElRolPorqueEsUnaColeccion() {
        assertThatThrownBy(() -> AdminUserSortField.from("role"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("no permitido");
    }

    @Test
    void rechazaCamposInternosYFragmentosDeConsulta() {
        assertThatThrownBy(() -> AdminUserSortField.from("password"))
                .isInstanceOf(BadRequestException.class);

        assertThatThrownBy(() -> AdminUserSortField.from("tenant.name"))
                .isInstanceOf(BadRequestException.class);

        assertThatThrownBy(() -> AdminUserSortField.from("id; DROP TABLE users"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void elMensajeDeErrorEnumeraLosCamposAdmitidos() {
        assertThat(AdminUserSortField.allowedValues())
                .contains("id", "name", "username", "email", "createdAt", "enabled");
    }
}
