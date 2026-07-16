package com.restaurante.reservation.dto;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import org.springframework.stereotype.Component;

@Component
public class ReservationMapper {

    public ReservationResponse toResponse(Reservation reservation) {
        if (reservation == null) {
            return null;
        }

        return ReservationResponse.builder()
                .id(reservation.getId())
                .customerId(reservation.getCustomer().getId())
                .customerName(reservation.getCustomer().getFirstName() + " " + reservation.getCustomer().getLastName())
                .customerEmail(reservation.getCustomer().getEmail())
                .diningTableId(reservation.getDiningTable() != null ? reservation.getDiningTable().getId() : null)
                .tableNumber(reservation.getDiningTable() != null ? reservation.getDiningTable().getTableNumber() : null)
                .restaurantId(reservation.getRestaurant().getId())
                .restaurantName(reservation.getRestaurant().getName())
                .reservationDate(reservation.getReservationDate())
                .reservationTime(reservation.getReservationTime())
                .partySize(reservation.getPartySize())
                .status(reservation.getStatus().name())
                .notes(reservation.getNotes())
                .createdAt(reservation.getCreatedAt())
                .updatedAt(reservation.getUpdatedAt())
                .build();
    }

    /**
     * Una reserva solo puede CREARSE en PENDING o CONFIRMED. Cualquier otro
     * cambio de estado (CANCELLED, COMPLETED, NO_SHOW) pasa exclusivamente por
     * PATCH /reservations/{id}/status, que valida la transición.
     */
    public Reservation toEntity(ReservationRequest request) {
        if (request == null) {
            return null;
        }

        Reservation reservation = new Reservation();
        reservation.setReservationDate(request.getReservationDate());
        reservation.setReservationTime(request.getReservationTime());
        reservation.setPartySize(request.getPartySize());
        reservation.setNotes(request.getNotes());

        if (request.getStatus() == null) {
            reservation.setStatus(ReservationStatus.PENDING);
            return reservation;
        }

        ReservationStatus status;
        try {
            status = ReservationStatus.valueOf(request.getStatus().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Estado inválido: " + request.getStatus());
        }
        if (status != ReservationStatus.PENDING && status != ReservationStatus.CONFIRMED) {
            throw new BadRequestException(
                    "Una reserva solo puede crearse en estado PENDING o CONFIRMED. "
                            + "Para otros cambios de estado usa PATCH /reservations/{id}/status.");
        }
        reservation.setStatus(status);
        return reservation;
    }

    /**
     * El estado NO se modifica aquí: los cambios de estado tienen su propio
     * endpoint (PATCH /reservations/{id}/status) con las validaciones de
     * transición correspondientes. Editar una reserva (PUT) nunca cambia su estado.
     */
    public void updateEntity(Reservation reservation, ReservationRequest request) {
        if (request == null) {
            return;
        }
        reservation.setReservationDate(request.getReservationDate());
        reservation.setReservationTime(request.getReservationTime());
        reservation.setPartySize(request.getPartySize());
        reservation.setNotes(request.getNotes());
    }
}
