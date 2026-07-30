package com.restaurante.reservation.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReservationResponse {

    private Long id;
    private Long customerId;
    private String customerName;
    private String customerEmail;
    private Long diningTableId;
    private String tableNumber;
    private Long restaurantId;
    private String restaurantName;
    private LocalDate reservationDate;
    private LocalTime reservationTime;
    private Integer partySize;
    private String status;
    private String notes;

    /** Caducidad del bloqueo provisional; null si la reserva no tiene bloqueo. */
    private LocalDateTime holdExpiresAt;

    /** NONE (sin bloqueo) | ACTIVE (bloqueo vivo) | EXPIRED (bloqueo caducado). */
    private String holdStatus;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
