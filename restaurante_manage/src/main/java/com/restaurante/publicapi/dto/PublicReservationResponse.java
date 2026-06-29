package com.restaurante.publicapi.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDate;
import java.time.LocalTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PublicReservationResponse {

    private Long reservationId;
    private Long customerId;
    private String customerName;
    private LocalDate reservationDate;
    private LocalTime reservationTime;
    private Integer partySize;
    private String status;
    private String message;
}
