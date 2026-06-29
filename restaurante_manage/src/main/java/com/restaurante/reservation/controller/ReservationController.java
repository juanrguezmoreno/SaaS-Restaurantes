package com.restaurante.reservation.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.dto.PagedResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.reservation.dto.ReservationRequest;
import com.restaurante.reservation.dto.ReservationResponse;
import com.restaurante.reservation.dto.ReservationStatusUpdateRequest;
import com.restaurante.reservation.service.ReservationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping(Constants.RESERVATIONS_PATH)
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Reservas", description = "Gestión de reservas")
@SecurityRequirement(name = "bearerAuth")
public class ReservationController {

    private final ReservationService reservationService;

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Listar reservas", description = "Obtiene lista paginada de reservas")
    public ResponseEntity<PagedResponse<ReservationResponse>> findAll(
            @RequestParam(defaultValue = Constants.DEFAULT_PAGE) int page,
            @RequestParam(defaultValue = Constants.DEFAULT_SIZE) int size,
            @RequestParam(required = false) String[] sort,
            @RequestParam(defaultValue = "desc") String direction) {

        Sort sorting;
        if (sort != null && sort.length > 0) {
            List<Sort.Order> orders = new java.util.ArrayList<>();
            for (String s : sort) {
                if (s == null || s.trim().isEmpty()) continue;
                String[] parts = s.split(",");
                String property = parts[0].trim();
                if (property.isEmpty()) continue;
                Sort.Direction dir = (parts.length > 1 && "desc".equalsIgnoreCase(parts[1].trim()))
                        ? Sort.Direction.DESC : Sort.Direction.ASC;
                orders.add(new Sort.Order(dir, property));
            }
            sorting = orders.isEmpty() ? Sort.by(Sort.Direction.DESC, Constants.DEFAULT_SORT) : Sort.by(orders);
        } else {
            Sort.Direction dir = direction.equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC;
            sorting = Sort.by(dir, Constants.DEFAULT_SORT);
        }

        Pageable pageable = PageRequest.of(page, size, sorting);
        log.debug("findAll() -> page={}, size={}, sort={}", page, size, sorting);

        Page<ReservationResponse> reservationPage;
        try {
            reservationPage = reservationService.findAll(pageable);
        } catch (Exception e) {
            log.error("Error al listar reservas: page={}, size={}, sort={}", page, size, sorting, e);
            throw e;
        }

        PagedResponse<ReservationResponse> response = PagedResponse.<ReservationResponse>builder()
                .content(reservationPage.getContent())
                .page(reservationPage.getNumber())
                .size(reservationPage.getSize())
                .totalElements(reservationPage.getTotalElements())
                .totalPages(reservationPage.getTotalPages())
                .last(reservationPage.isLast())
                .first(reservationPage.isFirst())
                .empty(reservationPage.isEmpty())
                .build();

        return ResponseEntity.ok(response);
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Obtener reserva", description = "Obtiene los detalles de una reserva por su ID")
    public ResponseEntity<ApiResponse<ReservationResponse>> findById(@PathVariable Long id) {
        ReservationResponse response = reservationService.findById(id);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @GetMapping("/my")
    @Operation(summary = "Mis reservas", description = "Obtiene las reservas del cliente autenticado")
    public ResponseEntity<ApiResponse<List<ReservationResponse>>> getMyReservations(Authentication authentication) {
        // Simplificación: retorna todas por ahora. La lógica de filtrado por usuario se añadirá después.
        return ResponseEntity.ok(ApiResponse.success(List.of()));
    }

    @PostMapping
    @Operation(summary = "Crear reserva", description = "Crea una nueva reserva (cualquier usuario autenticado)")
    public ResponseEntity<ApiResponse<ReservationResponse>> create(@Valid @RequestBody ReservationRequest request) {
        ReservationResponse response = reservationService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success("Reserva creada exitosamente", response));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Actualizar reserva", description = "Actualiza una reserva existente")
    public ResponseEntity<ApiResponse<ReservationResponse>> update(@PathVariable Long id,
                                                                   @Valid @RequestBody ReservationRequest request) {
        ReservationResponse response = reservationService.update(id, request);
        return ResponseEntity.ok(ApiResponse.success("Reserva actualizada exitosamente", response));
    }

    @PatchMapping("/{id}/status")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Cambiar estado de reserva", description = "Actualiza el estado de una reserva. Enviar JSON: {\"status\": \"CONFIRMED\"}")
    public ResponseEntity<ApiResponse<ReservationResponse>> updateStatus(
            @PathVariable Long id,
            @Valid @RequestBody ReservationStatusUpdateRequest request) {
        ReservationResponse response = reservationService.updateStatus(id, request.getStatus());
        return ResponseEntity.ok(ApiResponse.success("Estado de reserva actualizado", response));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Cancelar reserva", description = "Cancela una reserva")
    public ResponseEntity<ApiResponse<Void>> cancel(@PathVariable Long id) {
        reservationService.cancel(id);
        return ResponseEntity.ok(ApiResponse.success("Reserva cancelada exitosamente", null));
    }

    // ════════════════════════════════════════════════════════════════
    //  MANTENIMIENTO
    // ════════════════════════════════════════════════════════════════

    @PostMapping("/maintenance/fix-table-statuses")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Corregir estados de mesas",
               description = "Recalcula los estados de las mesas: si una mesa está RESERVED pero no tiene " +
                             "reservas CONFIRMED activas/futuras, la cambia a AVAILABLE. " +
                             "Si no se especifica restaurantId, revisa todas las mesas (solo ADMIN).")
    public ResponseEntity<ApiResponse<String>> fixTableStatuses(
            @RequestParam(required = false) Long restaurantId) {
        int fixed = reservationService.fixTableStatuses(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(
                "Mantenimiento completado. " + fixed + " mesas corregidas a AVAILABLE."));
    }
}
