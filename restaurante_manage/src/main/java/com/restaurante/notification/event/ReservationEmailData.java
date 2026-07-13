package com.restaurante.notification.event;

import com.restaurante.customer.entity.Customer;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.restaurant.entity.Restaurant;

import java.time.format.DateTimeFormatter;

/**
 * Snapshot inmutable de los datos de una reserva necesarios para el email.
 * Se construye dentro de la transacción: el listener que lo consume corre
 * post-commit en otro hilo, con la sesión de Hibernate cerrada — acceder a
 * relaciones lazy en ese punto lanzaría LazyInitializationException.
 */
public record ReservationEmailData(
        String customerEmail,
        String customerName,
        String restaurantName,
        String date,
        String time,
        Integer partySize,
        String tableInfo
) {

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("dd/MM/yyyy");
    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm");

    public static ReservationEmailData from(Reservation reservation) {
        Customer customer = reservation.getCustomer();
        Restaurant restaurant = reservation.getRestaurant();
        DiningTable table = reservation.getDiningTable();

        String customerName = (customer.getFirstName() + " " + customer.getLastName()).trim();
        String tableInfo = table != null ? "Mesa " + table.getTableNumber() : "mesa por confirmar";

        return new ReservationEmailData(
                customer.getEmail(),
                customerName,
                restaurant.getName(),
                reservation.getReservationDate().format(DATE_FORMATTER),
                reservation.getReservationTime().format(TIME_FORMATTER),
                reservation.getPartySize(),
                tableInfo
        );
    }
}
