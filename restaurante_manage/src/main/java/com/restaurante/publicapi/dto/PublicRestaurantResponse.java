package com.restaurante.publicapi.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalTime;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PublicRestaurantResponse {

    private Long id;
    private String name;
    private String address;
    private String phone;
    private String email;
    private String description;
    private LocalTime openingTime;
    private LocalTime closingTime;
    private Integer capacity;
}
