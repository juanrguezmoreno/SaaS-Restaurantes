package com.restaurante.restaurant.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.time.LocalTime;

@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class RestaurantResponse {

    private Long id;
    private String name;
    private String address;
    private String phone;
    private String email;
    private String description;
    private LocalTime openingTime;
    private LocalTime closingTime;
    private Integer capacity;
    private Boolean publicBookingEnabled;
    private Long tenantId;
    private String tenantName;
    private int tableCount;
    private int employeeCount;
    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;
}
