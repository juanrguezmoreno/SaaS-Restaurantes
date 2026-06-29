package com.restaurante.employee.dto;

import com.restaurante.employee.entity.Employee;
import com.restaurante.employee.enums.EmployeeStatus;
import org.springframework.stereotype.Component;

@Component
public class EmployeeMapper {

    public EmployeeResponse toResponse(Employee employee) {
        if (employee == null) {
            return null;
        }

        return EmployeeResponse.builder()
                .id(employee.getId())
                .userId(employee.getUser() != null ? employee.getUser().getId() : null)
                .username(employee.getUser() != null ? employee.getUser().getUsername() : null)
                .userEmail(employee.getUser() != null ? employee.getUser().getEmail() : null)
                .restaurantId(employee.getRestaurant().getId())
                .restaurantName(employee.getRestaurant().getName())
                .position(employee.getPosition())
                .hireDate(employee.getHireDate())
                .salary(employee.getSalary())
                .status(employee.getStatus().name())
                .createdAt(employee.getCreatedAt())
                .updatedAt(employee.getUpdatedAt())
                .build();
    }

    public Employee toEntity(EmployeeRequest request) {
        if (request == null) {
            return null;
        }

        Employee employee = new Employee();
        employee.setPosition(request.getPosition());
        employee.setHireDate(request.getHireDate());
        employee.setSalary(request.getSalary());

        if (request.getStatus() != null) {
            try {
                employee.setStatus(EmployeeStatus.valueOf(request.getStatus().toUpperCase()));
            } catch (IllegalArgumentException e) {
                employee.setStatus(EmployeeStatus.ACTIVE);
            }
        } else {
            employee.setStatus(EmployeeStatus.ACTIVE);
        }

        return employee;
    }

    public void updateEntity(Employee employee, EmployeeRequest request) {
        if (request == null) {
            return;
        }
        employee.setPosition(request.getPosition());
        employee.setHireDate(request.getHireDate());
        employee.setSalary(request.getSalary());

        if (request.getStatus() != null) {
            try {
                employee.setStatus(EmployeeStatus.valueOf(request.getStatus().toUpperCase()));
            } catch (IllegalArgumentException e) {
                // Mantener el status actual
            }
        }
    }
}
