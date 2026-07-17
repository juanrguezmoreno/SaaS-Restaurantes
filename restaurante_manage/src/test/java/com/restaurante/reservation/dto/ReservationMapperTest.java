package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
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
