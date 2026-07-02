package com.restaurante.diningtable.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.diningtable.dto.DiningTableRequest;
import com.restaurante.diningtable.dto.DiningTableResponse;
import com.restaurante.reservation.dto.ReservationStatusUpdateRequest;
import com.restaurante.diningtable.service.DiningTableService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequiredArgsConstructor
@Tag(name = "Mesas", description = "Gestión de mesas de restaurantes")
@SecurityRequirement(name = "bearerAuth")
public class DiningTableController {

    private final DiningTableService diningTableService;

    @GetMapping("/api/v1/restaurants/{restaurantId}/tables")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Listar mesas", description = "Obtiene todas las mesas de un restaurante (requiere rol de administración)")
    public ResponseEntity<ApiResponse<List<DiningTableResponse>>> findByRestaurant(
            @PathVariable Long restaurantId) {
        List<DiningTableResponse> tables = diningTableService.findByRestaurantId(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(tables));
    }

    @GetMapping(Constants.TABLES_PATH + "/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Obtener mesa", description = "Obtiene los detalles de una mesa por su ID (requiere rol de administración)")
    public ResponseEntity<ApiResponse<DiningTableResponse>> findById(@PathVariable Long id) {
        DiningTableResponse response = diningTableService.findById(id);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @PostMapping("/api/v1/restaurants/{restaurantId}/tables")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Crear mesa", description = "Crea una nueva mesa en un restaurante (admin/manager)")
    public ResponseEntity<ApiResponse<DiningTableResponse>> create(
            @PathVariable Long restaurantId,
            @Valid @RequestBody DiningTableRequest request) {
        DiningTableResponse response = diningTableService.create(restaurantId, request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success("Mesa creada exitosamente", response));
    }

    @PutMapping(Constants.TABLES_PATH + "/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Actualizar mesa", description = "Actualiza una mesa existente (admin/manager)")
    public ResponseEntity<ApiResponse<DiningTableResponse>> update(
            @PathVariable Long id,
            @Valid @RequestBody DiningTableRequest request) {
        DiningTableResponse response = diningTableService.update(id, request);
        return ResponseEntity.ok(ApiResponse.success("Mesa actualizada exitosamente", response));
    }

    @PatchMapping(Constants.TABLES_PATH + "/{id}/status")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Cambiar estado de mesa", description = "Actualiza el estado de una mesa (admin/manager/employee). Enviar JSON: {\"status\": \"AVAILABLE\"}")
    public ResponseEntity<ApiResponse<DiningTableResponse>> updateStatus(
            @PathVariable Long id,
            @Valid @RequestBody ReservationStatusUpdateRequest request) {
        DiningTableResponse response = diningTableService.updateStatus(id, request.getStatus());
        return ResponseEntity.ok(ApiResponse.success("Estado de mesa actualizado", response));
    }

    @DeleteMapping(Constants.TABLES_PATH + "/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Eliminar mesa", description = "Elimina una mesa (solo admin)")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        diningTableService.delete(id);
        return ResponseEntity.ok(ApiResponse.success("Mesa eliminada exitosamente", null));
    }
}
