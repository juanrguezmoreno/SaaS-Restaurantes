package com.restaurante.employee.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.Set;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmployeeResponse {

    private Long id;
    private String firstName;
    private String lastName;
    private String fullName;
    private String email;
    private String phone;
    private String position;
    private String systemRole;
    private Set<Long> restaurantIds;
    private Set<String> restaurantNames;
    private Boolean active;
    private Boolean hasSystemAccess;
    private Long userId;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
