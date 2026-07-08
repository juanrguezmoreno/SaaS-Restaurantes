package com.restaurante.diningtable.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

import java.time.LocalDateTime;

public class DiningTableResponse {

    private Long id;
    private Long restaurantId;
    private String restaurantName;
    private String tableNumber;
    private Integer capacity;
    private String location;
    private String status;

    // ─── Campos de layout visual (plano de sala) ─────────────────────────
    private Integer xPosition;
    private Integer yPosition;
    private Integer width;
    private Integer height;
    private String shape;
    private Integer rotation;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    public DiningTableResponse() {
    }

    public DiningTableResponse(Long id, Long restaurantId, String restaurantName,
                               String tableNumber, Integer capacity, String location,
                               String status,
                               Integer xPosition, Integer yPosition,
                               Integer width, Integer height,
                               String shape, Integer rotation,
                               LocalDateTime createdAt, LocalDateTime updatedAt) {
        this.id = id;
        this.restaurantId = restaurantId;
        this.restaurantName = restaurantName;
        this.tableNumber = tableNumber;
        this.capacity = capacity;
        this.location = location;
        this.status = status;
        this.xPosition = xPosition;
        this.yPosition = yPosition;
        this.width = width;
        this.height = height;
        this.shape = shape;
        this.rotation = rotation;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Long getRestaurantId() {
        return restaurantId;
    }

    public void setRestaurantId(Long restaurantId) {
        this.restaurantId = restaurantId;
    }

    public String getRestaurantName() {
        return restaurantName;
    }

    public void setRestaurantName(String restaurantName) {
        this.restaurantName = restaurantName;
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

    public LocalDateTime getCreatedAt() {
        return createdAt;
    }

    public void setCreatedAt(LocalDateTime createdAt) {
        this.createdAt = createdAt;
    }

    public LocalDateTime getUpdatedAt() {
        return updatedAt;
    }

    public void setUpdatedAt(LocalDateTime updatedAt) {
        this.updatedAt = updatedAt;
    }

    // @JsonProperty explícito: sin él, Jackson serializa "xposition" (regla JavaBeans)
    // y el frontend espera "xPosition".
    @JsonProperty("xPosition")
    public Integer getXPosition() {
        return xPosition;
    }

    @JsonProperty("xPosition")
    public void setXPosition(Integer xPosition) {
        this.xPosition = xPosition;
    }

    @JsonProperty("yPosition")
    public Integer getYPosition() {
        return yPosition;
    }

    @JsonProperty("yPosition")
    public void setYPosition(Integer yPosition) {
        this.yPosition = yPosition;
    }

    public Integer getWidth() {
        return width;
    }

    public void setWidth(Integer width) {
        this.width = width;
    }

    public Integer getHeight() {
        return height;
    }

    public void setHeight(Integer height) {
        this.height = height;
    }

    public String getShape() {
        return shape;
    }

    public void setShape(String shape) {
        this.shape = shape;
    }

    public Integer getRotation() {
        return rotation;
    }

    public void setRotation(Integer rotation) {
        this.rotation = rotation;
    }

    public static DiningTableResponseBuilder builder() {
        return new DiningTableResponseBuilder();
    }

    public static class DiningTableResponseBuilder {
        private Long id;
        private Long restaurantId;
        private String restaurantName;
        private String tableNumber;
        private Integer capacity;
        private String location;
        private String status;
        private Integer xPosition;
        private Integer yPosition;
        private Integer width;
        private Integer height;
        private String shape;
        private Integer rotation;
        private LocalDateTime createdAt;
        private LocalDateTime updatedAt;

        DiningTableResponseBuilder() {
        }

        public DiningTableResponseBuilder id(Long id) {
            this.id = id;
            return this;
        }

        public DiningTableResponseBuilder restaurantId(Long restaurantId) {
            this.restaurantId = restaurantId;
            return this;
        }

        public DiningTableResponseBuilder restaurantName(String restaurantName) {
            this.restaurantName = restaurantName;
            return this;
        }

        public DiningTableResponseBuilder tableNumber(String tableNumber) {
            this.tableNumber = tableNumber;
            return this;
        }

        public DiningTableResponseBuilder capacity(Integer capacity) {
            this.capacity = capacity;
            return this;
        }

        public DiningTableResponseBuilder location(String location) {
            this.location = location;
            return this;
        }

        public DiningTableResponseBuilder status(String status) {
            this.status = status;
            return this;
        }

        public DiningTableResponseBuilder xPosition(Integer xPosition) {
            this.xPosition = xPosition;
            return this;
        }

        public DiningTableResponseBuilder yPosition(Integer yPosition) {
            this.yPosition = yPosition;
            return this;
        }

        public DiningTableResponseBuilder width(Integer width) {
            this.width = width;
            return this;
        }

        public DiningTableResponseBuilder height(Integer height) {
            this.height = height;
            return this;
        }

        public DiningTableResponseBuilder shape(String shape) {
            this.shape = shape;
            return this;
        }

        public DiningTableResponseBuilder rotation(Integer rotation) {
            this.rotation = rotation;
            return this;
        }

        public DiningTableResponseBuilder createdAt(LocalDateTime createdAt) {
            this.createdAt = createdAt;
            return this;
        }

        public DiningTableResponseBuilder updatedAt(LocalDateTime updatedAt) {
            this.updatedAt = updatedAt;
            return this;
        }

        public DiningTableResponse build() {
            return new DiningTableResponse(id, restaurantId, restaurantName,
                    tableNumber, capacity, location, status,
                    xPosition, yPosition, width, height, shape, rotation,
                    createdAt, updatedAt);
        }
    }
}
