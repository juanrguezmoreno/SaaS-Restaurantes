package com.restaurante.restaurant.dto;

import com.restaurante.restaurant.entity.Restaurant;
import org.springframework.stereotype.Component;

@Component
public class RestaurantMapper {

    public RestaurantResponse toResponse(Restaurant restaurant) {
        if (restaurant == null) {
            return null;
        }

        return RestaurantResponse.builder()
                .id(restaurant.getId())
                .name(restaurant.getName())
                .address(restaurant.getAddress())
                .phone(restaurant.getPhone())
                .email(restaurant.getEmail())
                .description(restaurant.getDescription())
                .openingTime(restaurant.getOpeningTime())
                .closingTime(restaurant.getClosingTime())
                .capacity(restaurant.getCapacity())
                .publicBookingEnabled(restaurant.getPublicBookingEnabled())
                .tenantId(restaurant.getTenant() != null ? restaurant.getTenant().getId() : null)
                .tenantName(restaurant.getTenant() != null ? restaurant.getTenant().getName() : null)
                .tableCount(restaurant.getTables() != null ? restaurant.getTables().size() : 0)
                .employeeCount(restaurant.getEmployees() != null ? restaurant.getEmployees().size() : 0)
                .createdAt(restaurant.getCreatedAt())
                .updatedAt(restaurant.getUpdatedAt())
                .build();
    }

    public Restaurant toEntity(RestaurantRequest request) {
        if (request == null) {
            return null;
        }

        Restaurant restaurant = new Restaurant();
        restaurant.setName(request.getName());
        restaurant.setAddress(request.getAddress());
        restaurant.setPhone(request.getPhone());
        restaurant.setEmail(request.getEmail());
        restaurant.setDescription(request.getDescription());
        restaurant.setOpeningTime(request.getOpeningTime());
        restaurant.setClosingTime(request.getClosingTime());
        restaurant.setCapacity(request.getCapacity());
        if (request.getPublicBookingEnabled() != null) {
            restaurant.setPublicBookingEnabled(request.getPublicBookingEnabled());
        }
        return restaurant;
    }

    public void updateEntity(Restaurant restaurant, RestaurantRequest request) {
        if (request == null) {
            return;
        }
        restaurant.setName(request.getName());
        restaurant.setAddress(request.getAddress());
        restaurant.setPhone(request.getPhone());
        restaurant.setEmail(request.getEmail());
        restaurant.setDescription(request.getDescription());
        restaurant.setOpeningTime(request.getOpeningTime());
        restaurant.setClosingTime(request.getClosingTime());
        restaurant.setCapacity(request.getCapacity());
        if (request.getPublicBookingEnabled() != null) {
            restaurant.setPublicBookingEnabled(request.getPublicBookingEnabled());
        }
    }
}
