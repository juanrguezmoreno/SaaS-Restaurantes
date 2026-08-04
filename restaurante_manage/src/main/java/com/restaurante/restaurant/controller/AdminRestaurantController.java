package com.restaurante.restaurant.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.dto.PagedResponse;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.util.Constants;
import com.restaurante.restaurant.dto.AdminRestaurantListItem;
import com.restaurante.restaurant.dto.AdminRestaurantSortField;
import com.restaurante.restaurant.dto.AdminRestaurantStats;
import com.restaurante.restaurant.service.AdminRestaurantService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.security.SecurityRequirement;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;
import org.springframework.data.domain.Sort;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * Panel de administración de restaurantes de la plataforma.
 *
 * <p>Existe aparte de {@link RestaurantController} porque ese listado es
 * público (lo consumen los desplegables de varias pantallas) y devuelve el DTO
 * completo. Este exige autenticación con rol SUPER_ADMIN o ADMIN, devuelve una
 * proyección ligera y pagina, busca y ordena en la base de datos.</p>
 *
 * <p>El alcance lo resuelve el servidor a partir del usuario autenticado:
 * SUPER_ADMIN ve todos los tenants, ADMIN solo el suyo. Cambiar el rol en el
 * cliente no amplía lo que se ve.</p>
 */
@RestController
@RequestMapping(Constants.ADMIN_RESTAURANTS_PATH)
@RequiredArgsConstructor
@Tag(name = "Administración de restaurantes",
        description = "Listado paginado y métricas de restaurantes para la administración de la plataforma")
@SecurityRequirement(name = "bearerAuth")
@PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
public class AdminRestaurantController {

    /** Tope de tamaño de página, para que nadie pida la tabla entera. */
    private static final int MAX_PAGE_SIZE = 100;

    private final AdminRestaurantService adminRestaurantService;

    @GetMapping
    @Operation(summary = "Listar restaurantes (administración)",
            description = "Página de restaurantes con búsqueda por nombre, email, teléfono, dirección "
                    + "o cuenta, y ordenación por un conjunto cerrado de campos: "
                    + "id, name, capacity, createdAt.")
    public ResponseEntity<PagedResponse<AdminRestaurantListItem>> search(
            @RequestParam(defaultValue = Constants.DEFAULT_PAGE) int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String search,
            @RequestParam(defaultValue = Constants.DEFAULT_SORT) String sort,
            @RequestParam(defaultValue = "asc") String direction) {

        Pageable pageable = buildPageable(page, size, sort, direction);
        Page<AdminRestaurantListItem> result = adminRestaurantService.search(pageable, search);

        PagedResponse<AdminRestaurantListItem> response = PagedResponse.<AdminRestaurantListItem>builder()
                .content(result.getContent())
                .page(result.getNumber())
                .size(result.getSize())
                .totalElements(result.getTotalElements())
                .totalPages(result.getTotalPages())
                .first(result.isFirst())
                .last(result.isLast())
                .empty(result.isEmpty())
                .build();

        return ResponseEntity.ok(response);
    }

    @GetMapping("/stats")
    @Operation(summary = "Métricas de restaurantes (administración)",
            description = "Total de restaurantes, capacidad acumulada y cuántos tienen las reservas "
                    + "online activas, calculados con una consulta agregada.")
    public ResponseEntity<ApiResponse<AdminRestaurantStats>> stats() {
        return ResponseEntity.ok(ApiResponse.success(adminRestaurantService.stats()));
    }

    /**
     * Construye la paginación validando lo que llega del cliente.
     *
     * <p>El nombre del campo de orden no se pasa nunca tal cual a {@code Sort}:
     * se resuelve contra {@link AdminRestaurantSortField}, que es una lista
     * cerrada.</p>
     */
    private Pageable buildPageable(int page, int size, String sort, String direction) {
        if (page < 0) {
            throw new BadRequestException("El número de página no puede ser negativo.");
        }
        if (size < 1) {
            throw new BadRequestException("El tamaño de página debe ser al menos 1.");
        }

        int safeSize = Math.min(size, MAX_PAGE_SIZE);
        AdminRestaurantSortField sortField = AdminRestaurantSortField.from(sort);
        Sort.Direction dir = resolveDirection(direction);

        return PageRequest.of(page, safeSize, Sort.by(dir, sortField.getProperty()));
    }

    private Sort.Direction resolveDirection(String direction) {
        if (direction == null || direction.isBlank()) {
            return Sort.Direction.ASC;
        }
        String normalized = direction.trim();
        if ("asc".equalsIgnoreCase(normalized)) {
            return Sort.Direction.ASC;
        }
        if ("desc".equalsIgnoreCase(normalized)) {
            return Sort.Direction.DESC;
        }
        throw new BadRequestException("Dirección de ordenación no válida: '" + direction
                + "'. Valores admitidos: asc, desc.");
    }
}
