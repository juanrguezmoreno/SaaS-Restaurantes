package com.restaurante.customer.dto;

import com.restaurante.customer.entity.Customer;
import org.springframework.stereotype.Component;

@Component
public class CustomerMapper {

    public CustomerResponse toResponse(Customer customer) {
        if (customer == null) {
            return null;
        }

        return CustomerResponse.builder()
                .id(customer.getId())
                .userId(customer.getUser() != null ? customer.getUser().getId() : null)
                .username(customer.getUser() != null ? customer.getUser().getUsername() : null)
                .restaurantId(customer.getRestaurant() != null ? customer.getRestaurant().getId() : null)
                .restaurantName(customer.getRestaurant() != null ? customer.getRestaurant().getName() : null)
                .firstName(customer.getFirstName())
                .lastName(customer.getLastName())
                .email(customer.getEmail())
                .phone(customer.getPhone())
                .notes(customer.getNotes())
                .createdAt(customer.getCreatedAt())
                .updatedAt(customer.getUpdatedAt())
                .build();
    }

    public Customer toEntity(CustomerRequest request) {
        if (request == null) {
            return null;
        }

        Customer customer = new Customer();
        customer.setFirstName(request.getFirstName());
        customer.setLastName(request.getLastName());
        customer.setEmail(request.getEmail());
        customer.setPhone(request.getPhone());
        customer.setNotes(request.getNotes());
        return customer;
    }

    public void updateEntity(Customer customer, CustomerRequest request) {
        if (request == null) {
            return;
        }
        customer.setFirstName(request.getFirstName());
        customer.setLastName(request.getLastName());
        customer.setEmail(request.getEmail());
        customer.setPhone(request.getPhone());
        customer.setNotes(request.getNotes());
    }
}
