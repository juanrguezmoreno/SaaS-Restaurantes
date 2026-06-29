package com.restaurante.dashboard.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class DashboardSummary {

    private long totalRestaurants;
    private long totalTables;
    private long totalCustomers;
    private long totalEmployees;
    private long totalReservations;
    private long pendingReservations;
    private long confirmedReservations;
    private long completedReservations;
    private long cancelledReservations;
    private long todayReservations;
}
