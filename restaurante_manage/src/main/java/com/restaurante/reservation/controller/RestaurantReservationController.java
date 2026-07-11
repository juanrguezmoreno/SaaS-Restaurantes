package com.restaurante.reservation.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.reservation.dto.ReservationResponse;
import com.restaurante.reservation.service.ReservationService;
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
@RequiredArgsConstructor
@Tag(name = "Reservas", description = "Reservas de un restaurante (usado por el plano de sala)")
@SecurityRequirement(name = "bearerAuth")
public class RestaurantReservationController {

    private static final String RESERVATIONS_BY_RESTAURANT_PATH =
            Constants.RESTAURANTS_PATH + "/{restaurantId}" + Constants.RESTAURANT_RESERVATIONS_SUBPATH;

    private final ReservationService reservationService;

    @GetMapping(RESERVATIONS_BY_RESTAURANT_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Listar reservas de un restaurante por fecha",
            description = "Obtiene las reservas de un restaurante para una fecha concreta (por defecto, hoy). " +
                    "Usado por el plano de sala para mostrar la reserva de cada mesa sin cargar todo el histórico.")
    public ResponseEntity<ApiResponse<List<ReservationResponse>>> findByRestaurantAndDate(
            @PathVariable Long restaurantId,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {
        LocalDate targetDate = date != null ? date : LocalDate.now();
        List<ReservationResponse> reservations = reservationService.findByRestaurantIdAndDate(restaurantId, targetDate);
        return ResponseEntity.ok(ApiResponse.success(reservations));
    }
}
