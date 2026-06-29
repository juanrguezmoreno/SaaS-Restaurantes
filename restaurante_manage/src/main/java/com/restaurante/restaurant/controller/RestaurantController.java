package com.restaurante.restaurant.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.dto.PagedResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.restaurant.dto.RestaurantRequest;
import com.restaurante.restaurant.dto.RestaurantResponse;
import com.restaurante.restaurant.service.RestaurantService;
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

@RestController
@RequestMapping(Constants.RESTAURANTS_PATH)
@RequiredArgsConstructor
@Tag(name = "Restaurantes", description = "Gestión de restaurantes")
public class RestaurantController {

    private final RestaurantService restaurantService;

    @GetMapping
    @Operation(summary = "Listar restaurantes", description = "Obtiene lista paginada de restaurantes (público)")
    public ResponseEntity<PagedResponse<RestaurantResponse>> findAll(
            @RequestParam(defaultValue = Constants.DEFAULT_PAGE) int page,
            @RequestParam(defaultValue = Constants.DEFAULT_SIZE) int size,
            @RequestParam(defaultValue = Constants.DEFAULT_SORT) String sort,
            @RequestParam(defaultValue = "asc") String direction) {

        Sort.Direction dir = direction.equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC;
        Pageable pageable = PageRequest.of(page, size, Sort.by(dir, sort));
        Page<RestaurantResponse> restaurantPage = restaurantService.findAll(pageable);

        PagedResponse<RestaurantResponse> response = PagedResponse.<RestaurantResponse>builder()
                .content(restaurantPage.getContent())
                .page(restaurantPage.getNumber())
                .size(restaurantPage.getSize())
                .totalElements(restaurantPage.getTotalElements())
                .totalPages(restaurantPage.getTotalPages())
                .last(restaurantPage.isLast())
                .first(restaurantPage.isFirst())
                .empty(restaurantPage.isEmpty())
                .build();

        return ResponseEntity.ok(response);
    }

    @GetMapping("/{id}")
    @Operation(summary = "Obtener restaurante", description = "Obtiene los detalles de un restaurante por su ID")
    public ResponseEntity<ApiResponse<RestaurantResponse>> findById(@PathVariable Long id) {
        RestaurantResponse response = restaurantService.findById(id);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Crear restaurante", description = "Crea un nuevo restaurante (admin/manager)")
    public ResponseEntity<ApiResponse<RestaurantResponse>> create(@Valid @RequestBody RestaurantRequest request) {
        RestaurantResponse response = restaurantService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success("Restaurante creado exitosamente", response));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Actualizar restaurante", description = "Actualiza un restaurante existente (admin/manager)")
    public ResponseEntity<ApiResponse<RestaurantResponse>> update(@PathVariable Long id,
                                                                  @Valid @RequestBody RestaurantRequest request) {
        RestaurantResponse response = restaurantService.update(id, request);
        return ResponseEntity.ok(ApiResponse.success("Restaurante actualizado exitosamente", response));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @SecurityRequirement(name = "bearerAuth")
    @Operation(summary = "Eliminar restaurante", description = "Elimina un restaurante (solo admin)")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        restaurantService.delete(id);
        return ResponseEntity.ok(ApiResponse.success("Restaurante eliminado exitosamente", null));
    }
}
