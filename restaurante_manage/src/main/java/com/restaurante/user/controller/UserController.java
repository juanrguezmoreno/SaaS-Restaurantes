package com.restaurante.user.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.dto.PagedResponse;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.util.Constants;
import com.restaurante.role.enums.RoleName;
import com.restaurante.user.dto.AdminUserListItem;
import com.restaurante.user.dto.AdminUserSortField;
import com.restaurante.user.dto.UserStats;
import com.restaurante.user.dto.UserRequest;
import com.restaurante.user.dto.UserResponse;
import com.restaurante.user.dto.UserUpdateRequest;
import com.restaurante.user.service.UserService;
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
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping(Constants.USERS_PATH)
@RequiredArgsConstructor
@Tag(name = "Usuarios", description = "Gestión de usuarios del sistema")
@SecurityRequirement(name = "bearerAuth")
public class UserController {

    private final UserService userService;

    /** Tope de tamaño de página, para que nadie pida la tabla entera. */
    private static final int MAX_PAGE_SIZE = 100;

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Listar empleados",
            description = "Página de usuarios con búsqueda por usuario, email, teléfono o nombre, "
                    + "filtros por rol y estado, y ordenación por un conjunto cerrado de campos: "
                    + "id, name, username, email, createdAt, enabled.")
    public ResponseEntity<PagedResponse<AdminUserListItem>> findAll(
            @RequestParam(defaultValue = Constants.DEFAULT_PAGE) int page,
            @RequestParam(defaultValue = "25") int size,
            @RequestParam(required = false) String search,
            @RequestParam(required = false) String role,
            @RequestParam(required = false) String status,
            @RequestParam(defaultValue = Constants.DEFAULT_SORT) String sort,
            @RequestParam(defaultValue = "asc") String direction) {

        Pageable pageable = buildPageable(page, size, sort, direction);
        Page<AdminUserListItem> userPage = userService.findAll(
                pageable, search, resolveRole(role), resolveStatus(status));

        PagedResponse<AdminUserListItem> response = PagedResponse.<AdminUserListItem>builder()
                .content(userPage.getContent())
                .page(userPage.getNumber())
                .size(userPage.getSize())
                .totalElements(userPage.getTotalElements())
                .totalPages(userPage.getTotalPages())
                .last(userPage.isLast())
                .first(userPage.isFirst())
                .empty(userPage.isEmpty())
                .build();

        return ResponseEntity.ok(response);
    }

    @GetMapping("/stats")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Métricas de empleados",
            description = "Total, activos e inactivos en el alcance del usuario autenticado, "
                    + "calculados con una consulta agregada.")
    public ResponseEntity<ApiResponse<UserStats>> stats() {
        return ResponseEntity.ok(ApiResponse.success(userService.stats()));
    }

    /**
     * Construye la paginación validando lo que llega del cliente. El nombre del
     * campo de orden no se pasa nunca tal cual a {@code Sort}: se resuelve contra
     * {@link AdminUserSortField}, que es una lista cerrada.
     */
    private Pageable buildPageable(int page, int size, String sort, String direction) {
        if (page < 0) {
            throw new BadRequestException("El número de página no puede ser negativo.");
        }
        if (size < 1) {
            throw new BadRequestException("El tamaño de página debe ser al menos 1.");
        }

        Sort.Direction dir = resolveDirection(direction);
        AdminUserSortField sortField = AdminUserSortField.from(sort);
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

    /** Acepta {@code ADMIN} o {@code ROLE_ADMIN}; cualquier otra cosa es un 400. */
    private RoleName resolveRole(String role) {
        if (role == null || role.isBlank()) {
            return null;
        }
        String normalized = role.trim().toUpperCase();
        if (!normalized.startsWith("ROLE_")) {
            normalized = "ROLE_" + normalized;
        }
        try {
            return RoleName.valueOf(normalized);
        } catch (IllegalArgumentException ex) {
            throw new BadRequestException("Rol no válido: '" + role + "'.");
        }
    }

    /** {@code active} / {@code inactive}, o nada para no filtrar. */
    private Boolean resolveStatus(String status) {
        if (status == null || status.isBlank()) {
            return null;
        }
        String normalized = status.trim().toLowerCase();
        if ("active".equals(normalized) || "activo".equals(normalized)) {
            return Boolean.TRUE;
        }
        if ("inactive".equals(normalized) || "inactivo".equals(normalized)) {
            return Boolean.FALSE;
        }
        throw new BadRequestException("Estado no válido: '" + status
                + "'. Valores admitidos: active, inactive.");
    }

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Obtener usuario por ID", description = "Obtiene los detalles de un usuario por su ID (admin y encargado)")
    public ResponseEntity<ApiResponse<UserResponse>> findById(@PathVariable Long id) {
        UserResponse response = userService.findById(id);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @GetMapping("/me")
    @Operation(summary = "Perfil actual", description = "Obtiene el perfil del usuario autenticado")
    public ResponseEntity<ApiResponse<UserResponse>> getCurrentUser(Authentication authentication) {
        UserResponse response = userService.getCurrentUser(authentication.getName());
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @PostMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Crear usuario", description = "Crea un nuevo usuario (solo admin)")
    public ResponseEntity<ApiResponse<UserResponse>> create(@Valid @RequestBody UserRequest request) {
        UserResponse response = userService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED).body(ApiResponse.success("Usuario creado exitosamente", response));
    }

    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Actualizar usuario", description = "Actualiza un usuario existente (solo admin)")
    public ResponseEntity<ApiResponse<UserResponse>> update(@PathVariable Long id,
                                                            @Valid @RequestBody UserUpdateRequest request) {
        UserResponse response = userService.update(id, request);
        return ResponseEntity.ok(ApiResponse.success("Usuario actualizado exitosamente", response));
    }

    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Eliminar usuario", description = "Deshabilita un usuario (solo admin)")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        userService.delete(id);
        return ResponseEntity.ok(ApiResponse.success("Usuario deshabilitado exitosamente", null));
    }
}
