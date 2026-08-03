package com.restaurante.serviceperiod.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.serviceperiod.dto.ServicePeriodRequest;
import com.restaurante.serviceperiod.dto.ServicePeriodResponse;
import com.restaurante.serviceperiod.service.ServicePeriodService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
@Tag(name = "Horarios de servicio",
        description = "Periodos de servicio por día de la semana de cada restaurante")
@SecurityRequirement(name = "bearerAuth")
public class ServicePeriodController {

    private static final String PERIODS_PATH =
            Constants.RESTAURANTS_PATH + "/{restaurantId}" + Constants.SERVICE_PERIODS_SUBPATH;

    private final ServicePeriodService servicePeriodService;

    @GetMapping(PERIODS_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Listar horarios de servicio",
            description = "Devuelve los periodos de servicio del restaurante, ordenados por día y hora de "
                    + "inicio. Una lista vacía significa que el restaurante usa el horario general "
                    + "(openingTime/closingTime). Requiere acceso al restaurante.")
    public ResponseEntity<ApiResponse<List<ServicePeriodResponse>>> findByRestaurant(
            @PathVariable Long restaurantId) {
        return ResponseEntity.ok(
                ApiResponse.success(servicePeriodService.findByRestaurantId(restaurantId)));
    }

    @PutMapping(PERIODS_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Guardar horarios de servicio",
            description = "Reemplaza los periodos de la semana completa: con id se actualizan, sin id se "
                    + "crean, y los existentes no incluidos se eliminan. Un día sin periodos queda cerrado. "
                    + "Requiere acceso al restaurante.")
    public ResponseEntity<ApiResponse<List<ServicePeriodResponse>>> replacePeriods(
            @PathVariable Long restaurantId,
            @RequestBody List<ServicePeriodRequest> requests) {
        List<ServicePeriodResponse> guardados = servicePeriodService.replacePeriods(restaurantId, requests);
        return ResponseEntity.ok(
                ApiResponse.success("Horarios de servicio guardados exitosamente", guardados));
    }
}
