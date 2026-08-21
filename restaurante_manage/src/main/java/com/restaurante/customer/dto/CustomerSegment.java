package com.restaurante.customer.dto;

import com.restaurante.common.exception.BadRequestException;

import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * Segmentos de clientela que ofrecen las tarjetas de la pantalla.
 *
 * <p>Los tres se apoyan en datos reales: el número de reservas no canceladas, la
 * fecha de la última y la fecha de alta. No hay segmentos de gasto ni de
 * fidelización porque el modelo no los tiene.</p>
 */
public enum CustomerSegment {

    /** Más de una reserva no cancelada. */
    RECURRENTES("recurrentes"),

    /** Dados de alta desde el día 1 del mes en curso. */
    NUEVOS("nuevos"),

    /**
     * Última reserva anterior a hace tres meses. Quien nunca reservó queda
     * fuera a propósito: es otro caso, no un cliente que se enfría.
     */
    SIN_VENIR("sin-venir");

    /** Nombre público del segmento, el que usa el cliente. */
    private final String value;

    CustomerSegment(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * Resuelve el parámetro recibido, aceptando el nombre público
     * ({@code sin-venir}), el del enum ({@code SIN_VENIR}) y la forma en
     * <em>camelCase</em> que usaba el frontend ({@code sinVenir}).
     *
     * @return el segmento, o {@code null} si no se pide ninguno.
     * @throws BadRequestException si el valor no corresponde a ningún segmento.
     */
    public static CustomerSegment from(String value) {
        if (value == null || value.isBlank()) {
            return null;
        }
        String normalized = value.trim().replace("-", "").replace("_", "");
        for (CustomerSegment candidate : values()) {
            String canonical = candidate.value.replace("-", "");
            if (canonical.equalsIgnoreCase(normalized) || candidate.name().replace("_", "").equalsIgnoreCase(normalized)) {
                return candidate;
            }
        }
        throw new BadRequestException("Segmento no válido: '" + value
                + "'. Valores admitidos: " + allowedValues());
    }

    /** Lista legible de segmentos, para el mensaje de error. */
    public static String allowedValues() {
        return Arrays.stream(values())
                .map(CustomerSegment::getValue)
                .collect(Collectors.joining(", "));
    }
}
