package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Lista cerrada de vistas del panel de reservas.
 */
class ReservationViewTest {

    @Test
    void aceptaElNombrePublico() {
        assertThat(ReservationView.from("solicitudes")).isEqualTo(ReservationView.SOLICITUDES);
        assertThat(ReservationView.from("hoy")).isEqualTo(ReservationView.HOY);
        assertThat(ReservationView.from("proximas")).isEqualTo(ReservationView.PROXIMAS);
        assertThat(ReservationView.from("historial")).isEqualTo(ReservationView.HISTORIAL);
        assertThat(ReservationView.from("todas")).isEqualTo(ReservationView.TODAS);
    }

    @Test
    void aceptaElNombreDelEnumYlasTildes() {
        assertThat(ReservationView.from("PROXIMAS")).isEqualTo(ReservationView.PROXIMAS);
        // La pestaña se llama «Próximas»: si alguien manda la tilde, no es un error.
        assertThat(ReservationView.from("próximas")).isEqualTo(ReservationView.PROXIMAS);
    }

    @Test
    void sinValorMuestraTodas() {
        assertThat(ReservationView.from(null)).isEqualTo(ReservationView.TODAS);
        assertThat(ReservationView.from("   ")).isEqualTo(ReservationView.TODAS);
    }

    @Test
    void rechazaVistasInventadas() {
        assertThatThrownBy(() -> ReservationView.from("canceladas"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("no válida");
    }

    @Test
    void elMensajeDeErrorEnumeraLasVistasAdmitidas() {
        assertThat(ReservationView.allowedValues())
                .contains("solicitudes", "hoy", "proximas", "historial", "todas");
    }
}
