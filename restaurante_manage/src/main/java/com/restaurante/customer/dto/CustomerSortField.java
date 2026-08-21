package com.restaurante.customer.dto;

import com.restaurante.common.exception.BadRequestException;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Lista cerrada de campos por los que se puede ordenar el listado de clientes.
 *
 * <p>Lo que llega del cliente no se pasa nunca tal cual a {@code Sort}. No hay
 * campos para «Reservas» ni «Última reserva»: son subconsultas agregadas y
 * ordenar por ellas no encaja con {@code Pageable} sin meter el {@code ORDER BY}
 * dentro de la consulta.</p>
 */
public enum CustomerSortField {

    ID("id", List.of("id")),
    /** Nombre visible: primero el nombre y luego el apellido. */
    NAME("name", List.of("firstName", "lastName")),
    EMAIL("email", List.of("email")),
    CREATED_AT("createdAt", List.of("createdAt"));

    private final String field;
    private final List<String> properties;

    CustomerSortField(String field, List<String> properties) {
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
    public static CustomerSortField from(String value) {
        if (value == null || value.isBlank()) {
            return ID;
        }
        String normalized = value.trim();
        for (CustomerSortField candidate : values()) {
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
                .map(CustomerSortField::getField)
                .collect(Collectors.joining(", "));
    }
}
