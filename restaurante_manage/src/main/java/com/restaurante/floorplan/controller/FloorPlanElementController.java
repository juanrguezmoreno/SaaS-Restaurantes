package com.restaurante.floorplan.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.floorplan.dto.FloorPlanElementRequest;
import com.restaurante.floorplan.dto.FloorPlanElementResponse;
import com.restaurante.floorplan.service.FloorPlanElementService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
@Tag(name = "Plano de sala", description = "Elementos decorativos del plano de sala (barra, puerta...)")
@SecurityRequirement(name = "bearerAuth")
public class FloorPlanElementController {

    private static final Logger log = LoggerFactory.getLogger(FloorPlanElementController.class);

    private static final String ELEMENTS_PATH =
            Constants.RESTAURANTS_PATH + "/{restaurantId}" + Constants.FLOOR_PLAN_ELEMENTS_SUBPATH;

    private final FloorPlanElementService floorPlanElementService;

    @GetMapping(ELEMENTS_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Listar elementos del plano",
            description = "Obtiene los elementos decorativos (barra, puerta...) del plano de sala de un restaurante.")
    public ResponseEntity<ApiResponse<List<FloorPlanElementResponse>>> findByRestaurant(
            @PathVariable Long restaurantId) {
        List<FloorPlanElementResponse> elements = floorPlanElementService.findByRestaurantId(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(elements));
    }

    @PutMapping(ELEMENTS_PATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Guardar elementos del plano",
            description = "Reemplaza los elementos decorativos del plano: con id se actualizan, sin id se crean, " +
                    "y los existentes no incluidos se eliminan (borrado lógico). Requiere rol de administración o gerencia.")
    public ResponseEntity<ApiResponse<List<FloorPlanElementResponse>>> replaceElements(
            @PathVariable Long restaurantId,
            @RequestBody List<FloorPlanElementRequest> requests) {
        log.info("[FloorPlan] PUT elementos del plano — restaurantId={}, received={}",
                restaurantId, requests != null ? requests.size() : 0);
        List<FloorPlanElementResponse> updated =
                floorPlanElementService.replaceElements(restaurantId, requests);
        return ResponseEntity.ok(ApiResponse.success("Elementos del plano guardados exitosamente", updated));
    }
}
