package com.restaurante.user.dto;

import com.restaurante.common.exception.BadRequestException;

import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

/**
 * Lista cerrada de campos por los que se puede ordenar el listado de empleados.
 *
 * <p>Lo que llega del cliente no se pasa nunca tal cual a {@code Sort}: se
 * resuelve aquí, de modo que un parámetro arbitrario no puede ordenar por campos
 * internos ni provocar un error 500 de Hibernate.</p>
 *
 * <p>No hay campo para el rol: los roles son una colección {@code ManyToMany} y
 * no son ordenables en SQL. La pantalla ofrece un filtro por rol en su lugar.</p>
 */
public enum AdminUserSortField {

    ID("id", List.of("id")),
    /** Nombre visible: primero el nombre y luego el apellido. */
    NAME("name", List.of("firstName", "lastName")),
    USERNAME("username", List.of("username")),
    EMAIL("email", List.of("email")),
    CREATED_AT("createdAt", List.of("createdAt")),
    ENABLED("enabled", List.of("enabled"));

    /** Nombre público del campo, el que usa el cliente. */
    private final String field;

    /** Propiedades de la entidad por las que se ordena, en orden. */
    private final List<String> properties;

    AdminUserSortField(String field, List<String> properties) {
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
     * Resuelve el parámetro recibido del cliente, aceptando tanto el nombre
     * público ({@code createdAt}) como el del enum ({@code CREATED_AT}).
     *
     * @throws BadRequestException si el campo no está en la lista permitida.
     */
    public static AdminUserSortField from(String value) {
        if (value == null || value.isBlank()) {
            return ID;
        }
        String normalized = value.trim();
        for (AdminUserSortField candidate : values()) {
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
                .map(AdminUserSortField::getField)
                .collect(Collectors.joining(", "));
    }
}
