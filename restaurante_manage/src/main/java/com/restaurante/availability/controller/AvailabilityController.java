package com.restaurante.availability.controller;

import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.availability.dto.TimeSlotResponse;
import com.restaurante.availability.service.AvailabilityService;
import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.common.util.Constants;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping(Constants.AVAILABILITY_PATH)
@RequiredArgsConstructor
@Validated
@Tag(name = "Disponibilidad", description = "Consulta de mesas disponibles")
public class AvailabilityController {

    private final AvailabilityService availabilityService;
    private final CurrentUserService currentUserService;

    @PostMapping("/tables")
    @Operation(summary = "Consultar disponibilidad",
            description = "Verifica mesas disponibles en un restaurante para una fecha y número de "
                    + "comensales. Requiere acceso al restaurante: expone número, capacidad y "
                    + "ubicación de las mesas.")
    public ResponseEntity<ApiResponse<List<AvailableTableResponse>>> checkAvailability(
            @Valid @RequestBody AvailabilityRequest request) {
        currentUserService.validateRestaurantAccess(request.getRestaurantId());
        List<AvailableTableResponse> availableTables = availabilityService.checkAvailability(request);
        return ResponseEntity.ok(ApiResponse.success(availableTables));
    }

    @GetMapping(Constants.AVAILABILITY_TIME_SLOTS_SUBPATH)
    @Operation(summary = "Rejilla de franjas horarias",
            description = "Devuelve las franjas horarias del restaurante para una fecha y número de "
                    + "comensales, indicando cuáles admiten reserva. Requiere acceso al restaurante.")
    public ResponseEntity<ApiResponse<List<TimeSlotResponse>>> getTimeSlots(
            @RequestParam Long restaurantId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(defaultValue = "1") @Min(1) @Max(50) Integer partySize) {

        currentUserService.validateRestaurantAccess(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(
                availabilityService.getTimeSlots(restaurantId, date, partySize)));
    }
}
