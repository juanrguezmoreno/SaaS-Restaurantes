package com.restaurante.restaurant.dto;

import com.restaurante.common.exception.BadRequestException;

import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * Lista cerrada de campos por los que se puede ordenar el listado de
 * administración.
 *
 * <p>El nombre de propiedad que llega del cliente nunca se pasa tal cual a
 * {@code Sort}: se resuelve contra este enum. Así un parámetro arbitrario no
 * puede ordenar por campos internos ni provocar un error 500 de Hibernate por
 * una propiedad inexistente.</p>
 */
public enum AdminRestaurantSortField {

    ID("id"),
    NAME("name"),
    CAPACITY("capacity"),
    CREATED_AT("createdAt");

    /** Nombre de la propiedad de la entidad {@code Restaurant}. */
    private final String property;

    AdminRestaurantSortField(String property) {
        this.property = property;
    }

    public String getProperty() {
        return property;
    }

    /**
     * Resuelve el parámetro recibido del cliente.
     *
     * <p>Acepta tanto el nombre de la propiedad ({@code createdAt}) como el del
     * enum ({@code CREATED_AT}), sin distinguir mayúsculas.</p>
     *
     * @throws BadRequestException si el campo no está en la lista permitida.
     */
    public static AdminRestaurantSortField from(String value) {
        if (value == null || value.isBlank()) {
            return ID;
        }
        String normalized = value.trim();
        for (AdminRestaurantSortField field : values()) {
            if (field.property.equalsIgnoreCase(normalized) || field.name().equalsIgnoreCase(normalized)) {
                return field;
            }
        }
        throw new BadRequestException("Campo de ordenación no permitido: '" + value
                + "'. Valores admitidos: " + allowedValues());
    }

    /** Lista legible de campos permitidos, para el mensaje de error. */
    public static String allowedValues() {
        return Arrays.stream(values())
                .map(AdminRestaurantSortField::getProperty)
                .collect(Collectors.joining(", "));
    }
}
