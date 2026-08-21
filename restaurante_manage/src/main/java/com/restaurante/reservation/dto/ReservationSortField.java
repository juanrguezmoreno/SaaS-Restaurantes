package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Lista cerrada de campos por los que se puede ordenar el listado de reservas.
 *
 * <p>Antes el controlador partía la cadena {@code sort} por comas y pasaba el
 * nombre resultante directo a {@code Sort}: {@code ?sort=pepe} no devolvía 400,
 * reventaba con 500 desde Hibernate.</p>
 */
public enum ReservationSortField {

    ID("id", List.of("id")),

    /** Orden natural del panel: primero el día, luego la hora. */
    DATE("date", List.of("reservationDate", "reservationTime")),

    /** Nombre del cliente; se resuelve por la asociación, que es a-uno. */
    CUSTOMER("customer", List.of("customer.firstName", "customer.lastName")),

    PARTY_SIZE("partySize", List.of("partySize")),

    STATUS("status", List.of("status")),

    CREATED_AT("createdAt", List.of("createdAt"));

    private final String field;
    private final List<String> properties;

    ReservationSortField(String field, List<String> properties) {
        this.field = field;
        this.properties = properties;
    }

    public String getField() {
        return field;
    }

    public List<String> getProperties() {
        return properties;
    }

    /**
     * Resuelve el parámetro recibido, aceptando el nombre público
     * ({@code createdAt}) y el del enum ({@code CREATED_AT}).
     *
     * @throws BadRequestException si el campo no está en la lista permitida.
     */
    public static ReservationSortField from(String value) {
        if (value == null || value.isBlank()) {
            return DATE;
        }
        String normalized = value.trim();
        for (ReservationSortField candidate : values()) {
            if (candidate.field.equalsIgnoreCase(normalized) || candidate.name().equalsIgnoreCase(normalized)) {
                return candidate;
            }
        }
        throw new BadRequestException("Campo de ordenación no permitido: '" + value
                + "'. Valores admitidos: " + allowedValues());
    }

    /** Lista legible de campos permitidos, para el mensaje de error. */
    public static String allowedValues() {
        return Arrays.stream(values())
                .map(ReservationSortField::getField)
                .collect(Collectors.joining(", "));
    }
}
