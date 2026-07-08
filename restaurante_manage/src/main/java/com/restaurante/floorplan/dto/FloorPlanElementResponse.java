package com.restaurante.floorplan.dto;

import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * DTO de respuesta de un elemento del plano de sala.
 */
public class FloorPlanElementResponse {

    private Long id;
    private Long restaurantId;
    private String type;
    private Integer xPosition;
    private Integer yPosition;
    private Integer width;
    private Integer height;
    private Integer rotation;

    public FloorPlanElementResponse() {
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

    public String getType() {
        return type;
    }

    public void setType(String type) {
        this.type = type;
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

    public Integer getRotation() {
        return rotation;
    }

    public void setRotation(Integer rotation) {
        this.rotation = rotation;
    }
}
