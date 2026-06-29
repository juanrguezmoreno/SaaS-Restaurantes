package com.restaurante.employee.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.employee.dto.EmployeeRequest;
import com.restaurante.employee.dto.EmployeeResponse;
import com.restaurante.employee.service.EmployeeService;
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
@Tag(name = "Empleados", description = "Gestión de empleados")
@SecurityRequirement(name = "bearerAuth")
public class EmployeeController {

    private final EmployeeService employeeService;

    @GetMapping("/api/v1/restaurants/{restaurantId}/employees")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Listar empleados", description = "Obtiene todos los empleados de un restaurante")
    public ResponseEntity<ApiResponse<List<EmployeeResponse>>> findByRestaurant(
            @PathVariable Long restaurantId) {
        List<EmployeeResponse> employees = employeeService.findByRestaurantId(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(employees));
    }

    @GetMapping(Constants.EMPLOYEES_PATH + "/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Obtener empleado", description = "Obtiene los detalles de un empleado por su ID")
    public ResponseEntity<ApiResponse<EmployeeResponse>> findById(@PathVariable Long id) {
        EmployeeResponse response = employeeService.findById(id);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @PostMapping("/api/v1/restaurants/{restaurantId}/employees")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Crear empleado", description = "Crea un nuevo empleado en un restaurante")
    public ResponseEntity<ApiResponse<EmployeeResponse>> create(
            @PathVariable Long restaurantId,
            @Valid @RequestBody EmployeeRequest request) {
        EmployeeResponse response = employeeService.create(restaurantId, request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success("Empleado creado exitosamente", response));
    }

    @PutMapping(Constants.EMPLOYEES_PATH + "/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Actualizar empleado", description = "Actualiza un empleado existente")
    public ResponseEntity<ApiResponse<EmployeeResponse>> update(@PathVariable Long id,
                                                                @Valid @RequestBody EmployeeRequest request) {
        EmployeeResponse response = employeeService.update(id, request);
        return ResponseEntity.ok(ApiResponse.success("Empleado actualizado exitosamente", response));
    }

    @DeleteMapping(Constants.EMPLOYEES_PATH + "/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Eliminar empleado", description = "Elimina un empleado (solo admin)")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        employeeService.delete(id);
        return ResponseEntity.ok(ApiResponse.success("Empleado eliminado exitosamente", null));
    }
}
