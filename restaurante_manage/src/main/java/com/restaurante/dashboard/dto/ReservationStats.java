package com.restaurante.dashboard.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReservationStats {

    private LocalDate date;
    private long totalReservations;
    private long confirmedReservations;
    private long cancelledReservations;
}
