package com.restaurante.employee.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.math.BigDecimal;
import java.time.LocalDate;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@JsonIgnoreProperties(ignoreUnknown = true)
public class EmployeeRequest {

    @NotNull(message = "El ID de usuario es obligatorio")
    private Long userId;

    @Size(max = 30, message = "El cargo no debe exceder 30 caracteres")
    private String position;

    private LocalDate hireDate;

    private BigDecimal salary;

    private String status;
}
