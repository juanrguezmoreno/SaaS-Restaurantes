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
@RequestMapping(Constants.EMPLOYEES_PATH)
@RequiredArgsConstructor
@Tag(name = "Employees", description = "Employee management (multi-tenant with role-based access)")
@SecurityRequirement(name = "bearerAuth")
public class EmployeeController {

    private final EmployeeService employeeService;

    // ─── LISTAR TODOS ──────────────────────────────────────────────────────
    @GetMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "List employees", description = "Returns all employees visible to the current user (tenant-scoped)")
    public ResponseEntity<ApiResponse<List<EmployeeResponse>>> findAll() {
        List<EmployeeResponse> employees = employeeService.findAll();
        return ResponseEntity.ok(ApiResponse.success(employees));
    }

    // ─── LISTAR POR RESTAURANTE (legacy) ───────────────────────────────────
    @GetMapping("/by-restaurant/{restaurantId}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "List employees by restaurant", description = "Returns all employees assigned to a specific restaurant")
    public ResponseEntity<ApiResponse<List<EmployeeResponse>>> findByRestaurant(
            @PathVariable Long restaurantId) {
        List<EmployeeResponse> employees = employeeService.findByRestaurantId(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(employees));
    }

    // ─── OBTENER POR ID ────────────────────────────────────────────────────
    @GetMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Get employee by ID", description = "Returns the details of an employee by their ID")
    public ResponseEntity<ApiResponse<EmployeeResponse>> findById(@PathVariable Long id) {
        EmployeeResponse response = employeeService.findById(id);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    // ─── CREAR ─────────────────────────────────────────────────────────────
    @PostMapping
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Create employee", description = "Creates a new employee with restaurant assignments (optionally creates system access)")
    public ResponseEntity<ApiResponse<EmployeeResponse>> create(
            @Valid @RequestBody EmployeeRequest request) {
        EmployeeResponse response = employeeService.create(request);
        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success("Employee created successfully", response));
    }

    // ─── ACTUALIZAR ────────────────────────────────────────────────────────
    @PutMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Update employee", description = "Updates an existing employee's information and assignments")
    public ResponseEntity<ApiResponse<EmployeeResponse>> update(@PathVariable Long id,
                                                                @Valid @RequestBody EmployeeRequest request) {
        EmployeeResponse response = employeeService.update(id, request);
        return ResponseEntity.ok(ApiResponse.success("Employee updated successfully", response));
    }

    // ─── CAMBIAR ESTADO ACTIVO ─────────────────────────────────────────────
    @PatchMapping("/{id}/active")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Toggle active status", description = "Activates or deactivates an employee (also enables/disables system access)")
    public ResponseEntity<ApiResponse<EmployeeResponse>> toggleActive(
            @PathVariable Long id,
            @RequestBody ActiveRequest request) {
        EmployeeResponse response = employeeService.toggleActive(id, request.active());
        String msg = request.active() ? "Employee activated successfully" : "Employee deactivated successfully";
        return ResponseEntity.ok(ApiResponse.success(msg, response));
    }

    // ─── ELIMINAR ──────────────────────────────────────────────────────────
    @DeleteMapping("/{id}")
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Delete employee", description = "Soft-deletes an employee (admin only)")
    public ResponseEntity<ApiResponse<Void>> delete(@PathVariable Long id) {
        employeeService.delete(id);
        return ResponseEntity.ok(ApiResponse.success("Employee deleted successfully", null));
    }

    // ─── DTO interno para active toggle ───────────────────────────────────
    record ActiveRequest(boolean active) {}
}
