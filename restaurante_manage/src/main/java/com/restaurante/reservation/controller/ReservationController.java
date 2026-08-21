package com.restaurante.reservation.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.dto.PagedResponse;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.util.Constants;
import com.restaurante.reservation.dto.ReservationListItem;
import com.restaurante.reservation.dto.ReservationRequest;
import com.restaurante.reservation.dto.ReservationResponse;
import com.restaurante.reservation.dto.ReservationSortField;
import com.restaurante.reservation.dto.ReservationStats;
import com.restaurante.reservation.dto.ReservationStatusUpdateRequest;
import com.restaurante.reservation.dto.ReservationView;
import com.restaurante.reservation.enums.ReservationStatus;
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
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;

@RestController
@RequestMapping(Constants.RESERVATIONS_PATH)
@RequiredArgsConstructor
@Slf4j
@Tag(name = "Reservas", description = "Gestión de reservas")
@SecurityRequirement(name = "bearerAuth")
public class ReservationController {

    private final ReservationService reservationService;

    /** Tope de tamaño de página, para que nadie pida la tabla entera. */
    private static final int MAX_PAGE_SIZE = 100;

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Listar reservas",
            description = "Página de reservas con vista (solicitudes, hoy, proximas, historial, todas), "
                    + "búsqueda por cliente, email o número de mesa, filtros opcionales por restaurante, "
                    + "estado y fecha, y ordenación por un conjunto cerrado de campos: id, date, customer, "
                    + "partySize, status, createdAt. El alcance multi-tenant se aplica siempre.")
    public ResponseEntity<PagedResponse<ReservationListItem>> findAll(
            @RequestParam(defaultValue = Constants.DEFAULT_PAGE) int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(defaultValue = "date") String sort,
            @RequestParam(defaultValue = "desc") String direction,
            @RequestParam(required = false) String view,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long restaurantId,
            @RequestParam(required = false) String status,
            @RequestParam(required = false) @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date) {

        Pageable pageable = buildPageable(page, size, sort, direction);
        log.debug("findAll() -> page={}, size={}, view={}, sort={}", page, size, view, pageable.getSort());

        Page<ReservationListItem> reservationPage = reservationService.findAllForList(
                pageable, ReservationView.from(view), search, restaurantId, resolveStatus(status), date);

        PagedResponse<ReservationListItem> response = PagedResponse.<ReservationListItem>builder()
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

    @GetMapping("/stats")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Cifras de reservas",
            description = "Total, pendientes, confirmadas de hoy, próximas, canceladas futuras e "
                    + "historial, calculados con una consulta agregada en el alcance del usuario. "
                    + "No dependen de la vista ni de los filtros.")
    public ResponseEntity<ApiResponse<ReservationStats>> stats(
            @RequestParam(required = false) Long restaurantId) {
        return ResponseEntity.ok(ApiResponse.success(reservationService.stats(restaurantId)));
    }

    /**
     * Construye la paginación validando lo que llega del cliente. El campo de
     * orden se resuelve contra {@link ReservationSortField}, que es una lista
     * cerrada: antes se partía la cadena y el nombre resultante iba directo a
     * {@code Sort}, así que un parámetro con una errata daba 500 en vez de 400.
     */
    private Pageable buildPageable(int page, int size, String sort, String direction) {
        if (page < 0) {
            throw new BadRequestException("El número de página no puede ser negativo.");
        }
        if (size < 1) {
            throw new BadRequestException("El tamaño de página debe ser al menos 1.");
        }

        Sort.Direction dir = resolveDirection(direction);
        ReservationSortField sortField = ReservationSortField.from(sort);
        Sort orders = Sort.by(sortField.getProperties().stream()
                .map(property -> new Sort.Order(dir, property))
                .toList());

        return PageRequest.of(page, Math.min(size, MAX_PAGE_SIZE), orders);
    }

    /** Por defecto descendente: es el orden que ya tenía el panel. */
    private Sort.Direction resolveDirection(String direction) {
        if (direction == null || direction.isBlank() || "desc".equalsIgnoreCase(direction.trim())) {
            return Sort.Direction.DESC;
        }
        if ("asc".equalsIgnoreCase(direction.trim())) {
            return Sort.Direction.ASC;
        }
        throw new BadRequestException("Dirección de ordenación no válida: '" + direction
                + "'. Valores admitidos: asc, desc.");
    }

    /** Estado opcional; un valor desconocido es un 400, no una lista vacía. */
    private ReservationStatus resolveStatus(String status) {
        if (status == null || status.isBlank()) {
            return null;
        }
        try {
            return ReservationStatus.valueOf(status.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Estado no válido: '" + status
                    + "'. Valores admitidos: PENDING, CONFIRMED, CANCELLED, COMPLETED, NO_SHOW.");
        }
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Obtener reserva", description = "Obtiene los detalles de una reserva por su ID")
    public ResponseEntity<ApiResponse<ReservationResponse>> findById(@PathVariable Long id) {
        ReservationResponse response = reservationService.findById(id);
        return ResponseEntity.ok(ApiResponse.success(response));
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
    @Operation(summary = "Cambiar estado de reserva", description = "Actualiza el estado de una reserva según la matriz de transiciones permitida. Enviar JSON: {\"status\": \"CONFIRMED\"}. CANCELLED, COMPLETED y NO_SHOW son estados finales y no admiten más cambios.")
    public ResponseEntity<ApiResponse<ReservationResponse>> updateStatus(
            @PathVariable Long id,
            @Valid @RequestBody ReservationStatusUpdateRequest request) {
        ReservationResponse response = reservationService.updateStatus(id, request.getStatus());
        return ResponseEntity.ok(ApiResponse.success("Estado de reserva actualizado", response));
    }

    @DeleteMapping("/{id}")
    @Operation(summary = "Eliminar reserva",
               description = "Elimina una reserva de forma permanente (borrado lógico). "
                            + "Para cancelar sin eliminar usa PATCH /reservations/{id}/status con CANCELLED.")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        reservationService.delete(id);
        return ResponseEntity.ok(ApiResponse.success("Reserva eliminada exitosamente", null));
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
