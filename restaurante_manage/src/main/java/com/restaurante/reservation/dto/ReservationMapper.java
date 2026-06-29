package com.restaurante.reservation.dto;

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

    public Reservation toEntity(ReservationRequest request) {
        if (request == null) {
            return null;
        }

        Reservation reservation = new Reservation();
        reservation.setReservationDate(request.getReservationDate());
        reservation.setReservationTime(request.getReservationTime());
        reservation.setPartySize(request.getPartySize());
        reservation.setNotes(request.getNotes());

        if (request.getStatus() != null) {
            try {
                reservation.setStatus(ReservationStatus.valueOf(request.getStatus().toUpperCase()));
            } catch (IllegalArgumentException e) {
                reservation.setStatus(ReservationStatus.PENDING);
            }
        } else {
            reservation.setStatus(ReservationStatus.PENDING);
        }

        return reservation;
    }

    public void updateEntity(Reservation reservation, ReservationRequest request) {
        if (request == null) {
            return;
        }
        reservation.setReservationDate(request.getReservationDate());
        reservation.setReservationTime(request.getReservationTime());
        reservation.setPartySize(request.getPartySize());
        reservation.setNotes(request.getNotes());

        if (request.getStatus() != null) {
            try {
                reservation.setStatus(ReservationStatus.valueOf(request.getStatus().toUpperCase()));
            } catch (IllegalArgumentException e) {
                // Mantener el status actual
            }
        }
    }
}
