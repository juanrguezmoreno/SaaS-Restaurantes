package com.restaurante.diningtable.dto;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Positive;
import jakarta.validation.constraints.Size;

public class DiningTableRequest {

    @NotNull(message = "El ID del restaurante es obligatorio")
    private Long restaurantId;

    @NotBlank(message = "El número de mesa es obligatorio")
    @Size(max = 10, message = "El número de mesa no debe exceder 10 caracteres")
    private String tableNumber;

    @NotNull(message = "La capacidad es obligatoria")
    @Positive(message = "La capacidad debe ser un número positivo")
    private Integer capacity;

    @Size(max = 30, message = "La ubicación no debe exceder 30 caracteres")
    private String location;

    private String status;

    public DiningTableRequest() {
    }

    public DiningTableRequest(Long restaurantId, String tableNumber, Integer capacity,
                              String location, String status) {
        this.restaurantId = restaurantId;
        this.tableNumber = tableNumber;
        this.capacity = capacity;
        this.location = location;
        this.status = status;
    }

    public Long getRestaurantId() {
        return restaurantId;
    }

    public void setRestaurantId(Long restaurantId) {
        this.restaurantId = restaurantId;
    }

    public String getTableNumber() {
        return tableNumber;
    }

    public void setTableNumber(String tableNumber) {
        this.tableNumber = tableNumber;
    }

    public Integer getCapacity() {
        return capacity;
    }

    public void setCapacity(Integer capacity) {
        this.capacity = capacity;
    }

    public String getLocation() {
        return location;
    }

    public void setLocation(String location) {
        this.location = location;
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
