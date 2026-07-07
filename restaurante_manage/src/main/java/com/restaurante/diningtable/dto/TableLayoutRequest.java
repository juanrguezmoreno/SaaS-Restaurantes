package com.restaurante.diningtable.dto;

import jakarta.validation.constraints.NotNull;

/**
 * DTO para actualizar la posición/visualización de una mesa en el plano de sala.
 */
public class TableLayoutRequest {

    @NotNull(message = "El ID de la mesa es obligatorio")
    private Long tableId;

    private Integer xPosition;
    private Integer yPosition;
    private Integer width;
    private Integer height;
    private String shape;
    private Integer rotation;

    public TableLayoutRequest() {
    }

    public TableLayoutRequest(Long tableId, Integer xPosition, Integer yPosition,
                              Integer width, Integer height, String shape,
                              Integer rotation) {
        this.tableId = tableId;
        this.xPosition = xPosition;
        this.yPosition = yPosition;
        this.width = width;
        this.height = height;
        this.shape = shape;
        this.rotation = rotation;
    }

    public Long getTableId() {
        return tableId;
    }

    public void setTableId(Long tableId) {
        this.tableId = tableId;
    }

    public Integer getXPosition() {
        return xPosition;
    }

    public void setXPosition(Integer xPosition) {
        this.xPosition = xPosition;
    }

    public Integer getYPosition() {
        return yPosition;
    }

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
}
