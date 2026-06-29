package com.restaurante.dashboard.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.dashboard.dto.DashboardSummary;
import com.restaurante.dashboard.dto.ReservationStats;
import com.restaurante.dashboard.service.DashboardService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping(Constants.DASHBOARD_PATH)
@RequiredArgsConstructor
@Tag(name = "Dashboard", description = "Estadísticas y resúmenes del sistema")
@SecurityRequirement(name = "bearerAuth")
@PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
public class DashboardController {

    private final DashboardService dashboardService;

    @GetMapping("/summary")
    @Operation(summary = "Resumen general", description = "Obtiene un resumen con estadísticas generales del sistema")
    public ResponseEntity<ApiResponse<DashboardSummary>> getSummary() {
        DashboardSummary summary = dashboardService.getSummary();
        return ResponseEntity.ok(ApiResponse.success(summary));
    }

    @GetMapping("/reservations-by-day")
    @Operation(summary = "Reservas por día", description = "Obtiene estadísticas de reservas agrupadas por día")
    public ResponseEntity<ApiResponse<List<ReservationStats>>> getReservationsByDay(
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate startDate,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate endDate) {
        List<ReservationStats> stats = dashboardService.getReservationsByDay(startDate, endDate);
        return ResponseEntity.ok(ApiResponse.success(stats));
    }

    @GetMapping("/popular-tables/{restaurantId}")
    @Operation(summary = "Mesas populares", description = "Obtiene las mesas más reservadas de un restaurante")
    public ResponseEntity<ApiResponse<List<Object[]>>> getPopularTables(@PathVariable Long restaurantId) {
        List<Object[]> popularTables = dashboardService.getPopularTables(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(popularTables));
    }
}
