package com.restaurante.notification.event;

import com.restaurante.customer.entity.Customer;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.restaurant.entity.Restaurant;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ReservationEmailDataTest {

    private Reservation reservation(DiningTable table) {
        Customer customer = new Customer();
        customer.setFirstName("Ana");
        customer.setLastName("García");
        customer.setEmail("ana@example.com");

        Restaurant restaurant = new Restaurant();
        restaurant.setName("La Buena Mesa");

        Reservation reservation = new Reservation();
        reservation.setCustomer(customer);
        reservation.setRestaurant(restaurant);
        reservation.setDiningTable(table);
        reservation.setReservationDate(LocalDate.of(2026, 12, 31));
        reservation.setReservationTime(LocalTime.of(21, 30));
        reservation.setPartySize(4);
        return reservation;
    }

    @Test
    void from_mapeaTodosLosCamposYFormateaFechaYHora() {
        DiningTable table = new DiningTable();
        table.setTableNumber("7");

        ReservationEmailData data = ReservationEmailData.from(reservation(table));

        assertEquals("ana@example.com", data.customerEmail());
        assertEquals("Ana García", data.customerName());
        assertEquals("La Buena Mesa", data.restaurantName());
        assertEquals("31/12/2026", data.date());
        assertEquals("21:30", data.time());
        assertEquals(4, data.partySize());
        assertEquals("Mesa 7", data.tableInfo());
    }

    @Test
    void from_usaTextoGenericoDeMesaCuandoNoHayMesaAsignada() {
        ReservationEmailData data = ReservationEmailData.from(reservation(null));

        assertEquals("mesa por confirmar", data.tableInfo());
    }
}
