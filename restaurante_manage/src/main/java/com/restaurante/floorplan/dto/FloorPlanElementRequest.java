package com.restaurante.floorplan.dto;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.restaurante.floorplan.enums.ElementType;

/**
 * DTO para crear/actualizar un elemento del plano de sala.
 * Sin id = crear; con id = actualizar el elemento existente.
 * La validación de campos obligatorios se hace en el servicio (payload batch).
 */
public class FloorPlanElementRequest {

    private Long id;
    private ElementType type;
    private Integer xPosition;
    private Integer yPosition;
    private Integer width;
    private Integer height;
    private Integer rotation;

    public FloorPlanElementRequest() {
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public ElementType getType() {
        return type;
    }

    public void setType(ElementType type) {
        this.type = type;
    }

    // @JsonProperty explícito: sin él, Jackson expone getXPosition como "xposition"
    // (regla JavaBeans) y no vincula el "xPosition" que envía el frontend.
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
