package com.restaurante.availability.dto;

public class AvailableTableResponse {

    private Long tableId;
    private String tableNumber;
    private Integer capacity;
    private String location;

    public AvailableTableResponse() {
    }

    public AvailableTableResponse(Long tableId, String tableNumber, Integer capacity, String location) {
        this.tableId = tableId;
        this.tableNumber = tableNumber;
        this.capacity = capacity;
        this.location = location;
    }

    public Long getTableId() {
        return tableId;
    }

    public void setTableId(Long tableId) {
        this.tableId = tableId;
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
}
