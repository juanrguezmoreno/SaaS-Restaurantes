package com.restaurante.user.dto;

import com.restaurante.role.entity.Role;
import com.restaurante.user.entity.User;
import org.springframework.stereotype.Component;

import java.util.Collections;
import java.util.Set;
import java.util.stream.Collectors;

@Component
public class UserMapper {

    public UserResponse toResponse(User user) {
        if (user == null) {
            return null;
        }

        Set<String> roleNames = Collections.emptySet();
        if (user.getRoles() != null) {
            roleNames = user.getRoles().stream()
                    .map(role -> role.getName().name())
                    .collect(Collectors.toSet());
        }

        Set<Long> assignedRestaurantIds = user.getAssignedRestaurants() != null
                ? user.getAssignedRestaurants().stream()
                        .map(r -> r.getId())
                        .collect(Collectors.toSet())
                : Collections.emptySet();

        return UserResponse.builder()
                .id(user.getId())
                .username(user.getUsername())
                .email(user.getEmail())
                .firstName(user.getFirstName())
                .lastName(user.getLastName())
                .phone(user.getPhone())
                .enabled(user.isEnabled())
                .restaurantId(user.getRestaurant() != null ? user.getRestaurant().getId() : null)
                .restaurantName(user.getRestaurant() != null ? user.getRestaurant().getName() : null)
                .assignedRestaurantIds(assignedRestaurantIds)
                .tenantId(user.getTenant() != null ? user.getTenant().getId() : null)
                .tenantName(user.getTenant() != null ? user.getTenant().getName() : null)
                .roles(roleNames)
                .createdAt(user.getCreatedAt())
                .updatedAt(user.getUpdatedAt())
                .build();
    }

    public User toEntity(UserRequest request) {
        if (request == null) {
            return null;
        }

        User user = new User();
        user.setUsername(request.getUsername());
        user.setEmail(request.getEmail());
        user.setPassword(request.getPassword());
        user.setFirstName(request.getFirstName());
        user.setLastName(request.getLastName());
        user.setPhone(request.getPhone());
        return user;
    }
}
