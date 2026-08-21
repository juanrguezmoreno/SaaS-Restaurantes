package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Lista cerrada de campos de ordenación del listado de reservas.
 */
class ReservationSortFieldTest {

    @Test
    void aceptaLosCamposPermitidos() {
        assertThat(ReservationSortField.from("id")).isEqualTo(ReservationSortField.ID);
        assertThat(ReservationSortField.from("partySize")).isEqualTo(ReservationSortField.PARTY_SIZE);
        assertThat(ReservationSortField.from("status")).isEqualTo(ReservationSortField.STATUS);
        assertThat(ReservationSortField.from("createdAt")).isEqualTo(ReservationSortField.CREATED_AT);
    }

    @Test
    void laFechaOrdenaPorDiaYluegoPorHora() {
        assertThat(ReservationSortField.from("date").getProperties())
                .containsExactly("reservationDate", "reservationTime");
    }

    @Test
    void sinValorOrdenaPorFecha() {
        assertThat(ReservationSortField.from(null)).isEqualTo(ReservationSortField.DATE);
        assertThat(ReservationSortField.from("  ")).isEqualTo(ReservationSortField.DATE);
    }

    @Test
    void rechazaCamposInternosYFragmentosDeConsulta() {
        assertThatThrownBy(() -> ReservationSortField.from("notes"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("no permitido");

        assertThatThrownBy(() -> ReservationSortField.from("id; DROP TABLE reservations"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void elMensajeDeErrorEnumeraLosCamposAdmitidos() {
        assertThat(ReservationSortField.allowedValues())
                .contains("id", "date", "partySize", "status", "createdAt");
    }
}
