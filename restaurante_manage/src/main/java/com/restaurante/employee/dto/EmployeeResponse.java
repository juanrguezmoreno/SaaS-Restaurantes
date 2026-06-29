package com.restaurante.employee.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.LocalDateTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmployeeResponse {

    private Long id;
    private Long userId;
    private String username;
    private String userEmail;
    private Long restaurantId;
    private String restaurantName;
    private String position;
    private LocalDate hireDate;
    private BigDecimal salary;
    private String status;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
