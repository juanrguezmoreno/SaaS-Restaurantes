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
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
