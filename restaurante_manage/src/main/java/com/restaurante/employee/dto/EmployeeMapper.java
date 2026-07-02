package com.restaurante.employee.dto;

import com.restaurante.employee.entity.Employee;
import com.restaurante.restaurant.entity.Restaurant;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class EmployeeMapper {

    public EmployeeResponse toResponse(Employee employee) {
        if (employee == null) {
            return null;
        }

        Set<Long> restaurantIds = Collections.emptySet();
        Set<String> restaurantNames = Collections.emptySet();
        if (employee.getRestaurants() != null && !employee.getRestaurants().isEmpty()) {
            restaurantIds = employee.getRestaurants().stream()
                    .map(Restaurant::getId)
                    .collect(Collectors.toSet());
            restaurantNames = employee.getRestaurants().stream()
                    .map(Restaurant::getName)
                    .collect(Collectors.toSet());
        } else if (employee.getRestaurant() != null) {
            // Fallback al restaurante legacy
            restaurantIds = Set.of(employee.getRestaurant().getId());
            restaurantNames = Set.of(employee.getRestaurant().getName());
        }

        String firstName = employee.getFirstName() != null ? employee.getFirstName() : "";
        String lastName = employee.getLastName() != null ? employee.getLastName() : "";
        String fullName = (firstName + " " + lastName).trim();
        if (fullName.isEmpty()) {
            fullName = null;
        }

        return EmployeeResponse.builder()
                .id(employee.getId())
                .firstName(employee.getFirstName())
                .lastName(employee.getLastName())
                .fullName(fullName)
                .email(employee.getEmail())
                .phone(employee.getPhone())
                .position(employee.getPosition())
                .systemRole(employee.getSystemRole())
                .restaurantIds(restaurantIds)
                .restaurantNames(restaurantNames)
                .active(employee.getActive())
                .hasSystemAccess(employee.getHasSystemAccess())
                .userId(employee.getUser() != null ? employee.getUser().getId() : null)
                .createdAt(employee.getCreatedAt())
                .updatedAt(employee.getUpdatedAt())
                .build();
    }

    public Employee toEntity(EmployeeRequest request) {
        if (request == null) {
            return null;
        }

        Employee employee = new Employee();
        employee.setFirstName(request.getFirstName());
        employee.setLastName(request.getLastName());
        employee.setEmail(request.getEmail());
        employee.setPhone(request.getPhone());
        employee.setPosition(request.getPosition());
        employee.setActive(request.getActive() != null ? request.getActive() : true);
        employee.setHasSystemAccess(request.getCreateUser() != null ? request.getCreateUser() : false);
        employee.setSystemRole(request.getSystemRole());

        return employee;
    }

    public void updateEntity(Employee employee, EmployeeRequest request) {
        if (request == null) {
            return;
        }
        employee.setFirstName(request.getFirstName());
        employee.setLastName(request.getLastName());
        employee.setEmail(request.getEmail());
        employee.setPhone(request.getPhone());
        employee.setPosition(request.getPosition());
        if (request.getActive() != null) {
            employee.setActive(request.getActive());
        }
        if (request.getCreateUser() != null) {
            employee.setHasSystemAccess(request.getCreateUser());
        }
        if (request.getSystemRole() != null) {
            employee.setSystemRole(request.getSystemRole());
        }
    }
}
