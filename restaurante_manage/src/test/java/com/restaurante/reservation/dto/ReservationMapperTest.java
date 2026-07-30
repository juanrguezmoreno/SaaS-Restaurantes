package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.customer.entity.Customer;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.restaurant.entity.Restaurant;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

import static org.junit.jupiter.api.Assertions.*;

class ReservationMapperTest {

    private final ReservationMapper mapper = new ReservationMapper();

    private ReservationRequest baseRequest() {
        ReservationRequest req = new ReservationRequest();
        req.setCustomerId(1L);
        req.setRestaurantId(1L);
        req.setReservationDate(LocalDate.now().plusDays(1));
        req.setReservationTime(LocalTime.of(20, 0));
        req.setPartySize(2);
        return req;
    }

    /** Reserva PENDING completa (con cliente y restaurante) lista para mapear a response. */
    private Reservation reservaBase() {
        Customer customer = new Customer();
        customer.setId(1L);
        customer.setFirstName("Ana");
        customer.setLastName("García");
        customer.setEmail("ana@example.com");

        Restaurant restaurant = new Restaurant();
        restaurant.setId(1L);
        restaurant.setName("La Buena Mesa");

        Reservation reserva = new Reservation();
        reserva.setId(1L);
        reserva.setCustomer(customer);
        reserva.setRestaurant(restaurant);
        reserva.setReservationDate(LocalDate.now().plusDays(1));
        reserva.setReservationTime(LocalTime.of(20, 0));
        reserva.setPartySize(2);
        reserva.setStatus(ReservationStatus.PENDING);
        return reserva;
    }

    @Test
    void toEntity_sinStatusUsaPending() {
        Reservation r = mapper.toEntity(baseRequest());
        assertEquals(ReservationStatus.PENDING, r.getStatus());
    }

    @Test
    void toEntity_permiteConfirmedComoEstadoInicial() {
        ReservationRequest req = baseRequest();
        req.setStatus("CONFIRMED");
        Reservation r = mapper.toEntity(req);
        assertEquals(ReservationStatus.CONFIRMED, r.getStatus());
    }

    @Test
    void toEntity_rechazaStatusInvalido() {
        ReservationRequest req = baseRequest();
        req.setStatus("ESTADO_QUE_NO_EXISTE");
        assertThrows(BadRequestException.class, () -> mapper.toEntity(req));
    }

    @Test
    void toEntity_rechazaCrearDirectamenteEnCancelled() {
        ReservationRequest req = baseRequest();
        req.setStatus("CANCELLED");
        assertThrows(BadRequestException.class, () -> mapper.toEntity(req));
    }

    @Test
    void toEntity_rechazaCrearDirectamenteEnCompleted() {
        ReservationRequest req = baseRequest();
        req.setStatus("COMPLETED");
        assertThrows(BadRequestException.class, () -> mapper.toEntity(req));
    }

    // ─── Task 6: holdStatus expuesto en el panel ──────────────────────────

    @Test
    void toResponse_holdStatusNoneSiNoHayBloqueo() {
        Reservation reserva = reservaBase();
        reserva.setHoldExpiresAt(null);

        assertEquals("NONE", mapper.toResponse(reserva).getHoldStatus());
    }

    @Test
    void toResponse_holdStatusActiveSiElBloqueoSigueVivo() {
        Reservation reserva = reservaBase();
        reserva.setHoldExpiresAt(LocalDateTime.now().plusHours(3));

        assertEquals("ACTIVE", mapper.toResponse(reserva).getHoldStatus());
    }

    @Test
    void toResponse_holdStatusExpiredSiElBloqueoYaVencio() {
        Reservation reserva = reservaBase();
        reserva.setHoldExpiresAt(LocalDateTime.now().minusMinutes(1));

        assertEquals("EXPIRED", mapper.toResponse(reserva).getHoldStatus());
    }

    @Test
    void updateEntity_noModificaElEstadoAunqueElRequestLoIndique() {
        Reservation r = new Reservation();
        r.setStatus(ReservationStatus.PENDING);
        r.setReservationDate(LocalDate.now().plusDays(1));
        r.setReservationTime(LocalTime.of(20, 0));
        r.setPartySize(2);

        ReservationRequest req = baseRequest();
        req.setStatus("CONFIRMED");
        mapper.updateEntity(r, req);

        assertEquals(ReservationStatus.PENDING, r.getStatus());
    }
}
