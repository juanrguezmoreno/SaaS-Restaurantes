package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;

import java.text.Normalizer;
import java.util.Arrays;
import java.util.stream.Collectors;

/**
 * Vistas del panel de reservas.
 *
 * <p>Cada una es una consulta al servidor con unos criterios fijos: los mismos
 * que antes aplicaba el navegador en {@code lib/reservationHelpers.js} y en los
 * {@code useMemo} de la pantalla, sobre la lista completa descargada con
 * {@code size=9999}.</p>
 *
 * <p>Los criterios concretos los resuelve el servicio, porque dependen de la
 * fecha de hoy; aquí solo vive la lista cerrada.</p>
 */
public enum ReservationView {

    /** PENDING con fecha de hoy en adelante: lo que está por gestionar. */
    SOLICITUDES("solicitudes"),

    /** CONFIRMED de hoy. */
    HOY("hoy"),

    /** CONFIRMED a partir de mañana. */
    PROXIMAS("proximas"),

    /** Estados finales, o pasadas que no sigan pendientes. */
    HISTORIAL("historial"),

    /** Sin criterio: la vista donde mandan los filtros del usuario. */
    TODAS("todas");

    /** Nombre público de la vista, el que usa el cliente. */
    private final String value;

    ReservationView(String value) {
        this.value = value;
    }

    public String getValue() {
        return value;
    }

    /**
     * Resuelve el parámetro recibido, aceptando el nombre público
     * ({@code proximas}), el del enum ({@code PROXIMAS}) y la forma con tilde
     * que se lee en la pestaña ({@code próximas}).
     *
     * @return la vista pedida; {@link #TODAS} si no se pide ninguna.
     * @throws BadRequestException si el valor no corresponde a ninguna vista.
     */
    public static ReservationView from(String value) {
        if (value == null || value.isBlank()) {
            return TODAS;
        }
        String normalized = stripAccents(value.trim());
        for (ReservationView candidate : values()) {
            if (candidate.value.equalsIgnoreCase(normalized) || candidate.name().equalsIgnoreCase(normalized)) {
                return candidate;
            }
        }
        throw new BadRequestException("Vista de reservas no válida: '" + value
                + "'. Valores admitidos: " + allowedValues());
    }

    /** Lista legible de vistas, para el mensaje de error. */
    public static String allowedValues() {
        return Arrays.stream(values())
                .map(ReservationView::getValue)
                .collect(Collectors.joining(", "));
    }

    private static String stripAccents(String value) {
        return Normalizer.normalize(value, Normalizer.Form.NFD)
                .replaceAll("\\p{InCombiningDiacriticalMarks}+", "");
    }
}
