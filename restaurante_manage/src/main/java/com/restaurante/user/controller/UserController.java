package com.restaurante.user.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.dto.PagedResponse;
import com.restaurante.common.util.Constants;
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

    @GetMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Listar usuarios", description = "Obtiene lista paginada de usuarios (solo admin)")
    public ResponseEntity<PagedResponse<UserResponse>> findAll(
            @RequestParam(defaultValue = Constants.DEFAULT_PAGE) int page,
            @RequestParam(defaultValue = Constants.DEFAULT_SIZE) int size,
            @RequestParam(defaultValue = Constants.DEFAULT_SORT) String sort,
            @RequestParam(defaultValue = "asc") String direction) {

        Sort.Direction dir = direction.equalsIgnoreCase("desc") ? Sort.Direction.DESC : Sort.Direction.ASC;
        Pageable pageable = PageRequest.of(page, size, Sort.by(dir, sort));
        Page<UserResponse> userPage = userService.findAll(pageable);

        PagedResponse<UserResponse> response = PagedResponse.<UserResponse>builder()
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

    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Obtener usuario por ID", description = "Obtiene los detalles de un usuario por su ID (solo admin)")
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
