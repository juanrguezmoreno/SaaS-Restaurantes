package com.restaurante.customer.dto;

import com.restaurante.common.exception.BadRequestException;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * Lista cerrada de segmentos de clientela.
 */
class CustomerSegmentTest {

    @Test
    void aceptaElNombrePublico() {
        assertThat(CustomerSegment.from("recurrentes")).isEqualTo(CustomerSegment.RECURRENTES);
        assertThat(CustomerSegment.from("nuevos")).isEqualTo(CustomerSegment.NUEVOS);
        assertThat(CustomerSegment.from("sin-venir")).isEqualTo(CustomerSegment.SIN_VENIR);
    }

    @Test
    void aceptaLaFormaDelEnumYlaDelFrontend() {
        assertThat(CustomerSegment.from("SIN_VENIR")).isEqualTo(CustomerSegment.SIN_VENIR);
        // El frontend usaba 'sinVenir' cuando el filtro se aplicaba en cliente.
        assertThat(CustomerSegment.from("sinVenir")).isEqualTo(CustomerSegment.SIN_VENIR);
        assertThat(CustomerSegment.from("RECURRENTES")).isEqualTo(CustomerSegment.RECURRENTES);
    }

    @Test
    void sinValorNoFiltra() {
        assertThat(CustomerSegment.from(null)).isNull();
        assertThat(CustomerSegment.from("   ")).isNull();
    }

    @Test
    void rechazaSegmentosInventados() {
        assertThatThrownBy(() -> CustomerSegment.from("vip"))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("no válido");

        // No existe segmento de gasto: el modelo no lo tiene.
        assertThatThrownBy(() -> CustomerSegment.from("alto-gasto"))
                .isInstanceOf(BadRequestException.class);
    }

    @Test
    void elMensajeDeErrorEnumeraLosSegmentosAdmitidos() {
        assertThat(CustomerSegment.allowedValues())
                .contains("recurrentes", "nuevos", "sin-venir");
    }
}
