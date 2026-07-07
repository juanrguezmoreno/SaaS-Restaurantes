package com.restaurante.floorplan.dto;

import com.restaurante.floorplan.entity.FloorPlanElement;
import org.springframework.stereotype.Component;

@Component
public class FloorPlanElementMapper {

    public FloorPlanElementResponse toResponse(FloorPlanElement element) {
        if (element == null) {
            return null;
        }
        FloorPlanElementResponse response = new FloorPlanElementResponse();
        response.setId(element.getId());
        response.setRestaurantId(element.getRestaurant().getId());
        response.setType(element.getType().name());
        response.setXPosition(element.getXPosition());
        response.setYPosition(element.getYPosition());
        response.setWidth(element.getWidth());
        response.setHeight(element.getHeight());
        response.setRotation(element.getRotation());
        return response;
    }
}
