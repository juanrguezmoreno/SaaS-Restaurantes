package com.restaurante.availability.controller;

import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.availability.service.AvailabilityService;
import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping(Constants.AVAILABILITY_PATH)
@RequiredArgsConstructor
@Tag(name = "Disponibilidad", description = "Consulta de mesas disponibles")
public class AvailabilityController {

    private final AvailabilityService availabilityService;

    @PostMapping("/tables")
    @Operation(summary = "Consultar disponibilidad",
            description = "Verifica mesas disponibles en un restaurante para una fecha y número de comensales (público)")
    public ResponseEntity<ApiResponse<List<AvailableTableResponse>>> checkAvailability(
            @Valid @RequestBody AvailabilityRequest request) {
        List<AvailableTableResponse> availableTables = availabilityService.checkAvailability(request);
        return ResponseEntity.ok(ApiResponse.success(availableTables));
    }
}
