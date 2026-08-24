package com.restaurante.user.dto;

/**
 * Restaurante asignado a un usuario, con su identificador y su nombre juntos.
 *
 * <p>Existe porque {@code assignedRestaurantIds} y {@code restaurantNames} son
 * dos listas independientes que <strong>no</strong> se corresponden posición a
 * posición: los nombres se ordenan alfabéticamente y los identificadores no, y
 * cuando no hay asignaciones explícitas los nombres caen al restaurante
 * principal, que no está entre los identificadores. Emparejarlas fuera daría
 * etiquetas equivocadas.</p>
 */
public record AssignedRestaurant(Long id, String name) {
}
