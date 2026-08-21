package com.restaurante.customer.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.dto.PagedResponse;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.util.Constants;
import com.restaurante.customer.dto.CustomerListItem;
import com.restaurante.customer.dto.CustomerRequest;
import com.restaurante.customer.dto.CustomerResponse;
import com.restaurante.customer.dto.CustomerSegment;
import com.restaurante.customer.dto.CustomerSortField;
import com.restaurante.customer.dto.CustomerStats;
import com.restaurante.customer.service.CustomerService;
import com.restaurante.reservation.dto.ReservationResponse;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.List;

@RestController
@RequestMapping(Constants.CUSTOMERS_PATH)
@RequiredArgsConstructor
@Tag(name = "Clientes", description = "Gestión de clientes")
@SecurityRequirement(name = "bearerAuth")
public class CustomerController {

    private final CustomerService customerService;

    /** Tope de tamaño de página, para que nadie pida la tabla entera. */
    private static final int MAX_PAGE_SIZE = 100;

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Listar clientes",
            description = "Página de clientes con búsqueda por nombre, email o teléfono, filtros "
                    + "opcionales por restaurante y segmento (recurrentes, nuevos, sin-venir) y "
                    + "ordenación por un conjunto cerrado de campos: id, name, email, createdAt. "
                    + "El alcance multi-tenant se aplica siempre.")
    public ResponseEntity<PagedResponse<CustomerListItem>> findAll(
            @RequestParam(defaultValue = Constants.DEFAULT_PAGE) int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(defaultValue = Constants.DEFAULT_SORT) String sort,
            @RequestParam(defaultValue = "asc") String direction,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) Long restaurantId,
            @RequestParam(required = false) String segment) {

        Pageable pageable = buildPageable(page, size, sort, direction);
        Page<CustomerListItem> customerPage = customerService.findAll(
                pageable, search, restaurantId, CustomerSegment.from(segment));

        PagedResponse<CustomerListItem> response = PagedResponse.<CustomerListItem>builder()
                .content(customerPage.getContent())
                .page(customerPage.getNumber())
                .size(customerPage.getSize())
                .totalElements(customerPage.getTotalElements())
                .totalPages(customerPage.getTotalPages())
                .last(customerPage.isLast())
                .first(customerPage.isFirst())
                .empty(customerPage.isEmpty())
                .build();

        return ResponseEntity.ok(response);
    }

    @GetMapping("/stats")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Cifras de clientes",
            description = "Total, recurrentes, nuevos este mes y sin venir en tres meses, "
                    + "calculados con una consulta agregada en el alcance del usuario.")
    public ResponseEntity<ApiResponse<CustomerStats>> stats(
            @RequestParam(required = false) Long restaurantId) {
        return ResponseEntity.ok(ApiResponse.success(customerService.stats(restaurantId)));
    }

    /**
     * Construye la paginación validando lo que llega del cliente. El campo de
     * orden se resuelve contra {@link CustomerSortField}, que es una lista
     * cerrada, en vez de pasarse tal cual a {@code Sort}.
     */
    private Pageable buildPageable(int page, int size, String sort, String direction) {
        if (page < 0) {
            throw new BadRequestException("El número de página no puede ser negativo.");
        }
        if (size < 1) {
            throw new BadRequestException("El tamaño de página debe ser al menos 1.");
        }

        Sort.Direction dir = resolveDirection(direction);
        CustomerSortField sortField = CustomerSortField.from(sort);
        Sort orders = Sort.by(sortField.getProperties().stream()
                .map(property -> new Sort.Order(dir, property))
                .toList());

        return PageRequest.of(page, Math.min(size, MAX_PAGE_SIZE), orders);
    }

    private Sort.Direction resolveDirection(String direction) {
        if (direction == null || direction.isBlank() || "asc".equalsIgnoreCase(direction.trim())) {
            return Sort.Direction.ASC;
        }
        if ("desc".equalsIgnoreCase(direction.trim())) {
            return Sort.Direction.DESC;
        }
        throw new BadRequestException("Dirección de ordenación no válida: '" + direction
                + "'. Valores admitidos: asc, desc.");
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Obtener cliente", description = "Obtiene los detalles de un cliente por su ID")
    public ResponseEntity<ApiResponse<CustomerResponse>> findById(@PathVariable Long id) {
        CustomerResponse response = customerService.findById(id);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @GetMapping("/{id}/reservations")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Historial de reservas del cliente", description = "Obtiene todas las reservas de un cliente, más recientes primero")
    public ResponseEntity<ApiResponse<List<ReservationResponse>>> getReservationHistory(@PathVariable Long id) {
        List<ReservationResponse> response = customerService.getReservationHistory(id);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Crear cliente", description = "Crea un nuevo cliente")
    public ResponseEntity<ApiResponse<CustomerResponse>> create(@Valid @RequestBody CustomerRequest request) {
        CustomerResponse response = customerService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success("Cliente creado exitosamente", response));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER','EMPLOYEE')")
    @Operation(summary = "Actualizar cliente", description = "Actualiza un cliente existente")
    public ResponseEntity<ApiResponse<CustomerResponse>> update(@PathVariable Long id,
                                                                @Valid @RequestBody CustomerRequest request) {
        CustomerResponse response = customerService.update(id, request);
        return ResponseEntity.ok(ApiResponse.success("Cliente actualizado exitosamente", response));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Eliminar cliente", description = "Elimina un cliente (solo admin)")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        customerService.delete(id);
        return ResponseEntity.ok(ApiResponse.success("Cliente eliminado exitosamente", null));
    }
}
