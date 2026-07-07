package com.restaurante.diningtable.dto;

import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import org.springframework.stereotype.Component;

@Component
public class DiningTableMapper {

    public DiningTableResponse toResponse(DiningTable table) {
        if (table == null) {
            return null;
        }

        return DiningTableResponse.builder()
                .id(table.getId())
                .restaurantId(table.getRestaurant().getId())
                .restaurantName(table.getRestaurant().getName())
                .tableNumber(table.getTableNumber())
                .capacity(table.getCapacity())
                .location(table.getLocation())
                .status(table.getStatus().name())
                .xPosition(table.getXPosition())
                .yPosition(table.getYPosition())
                .width(table.getWidth())
                .height(table.getHeight())
                .shape(table.getShape())
                .rotation(table.getRotation())
                .createdAt(table.getCreatedAt())
                .updatedAt(table.getUpdatedAt())
                .build();
    }

    public DiningTable toEntity(DiningTableRequest request) {
        if (request == null) {
            return null;
        }

        DiningTable table = new DiningTable();
        table.setTableNumber(request.getTableNumber());
        table.setCapacity(request.getCapacity());
        table.setLocation(request.getLocation());

        if (request.getStatus() != null) {
            try {
                table.setStatus(TableStatus.valueOf(request.getStatus().toUpperCase()));
            } catch (IllegalArgumentException e) {
                table.setStatus(TableStatus.AVAILABLE);
            }
        } else {
            table.setStatus(TableStatus.AVAILABLE);
        }

        return table;
    }

    public void updateEntity(DiningTable table, DiningTableRequest request) {
        if (request == null) {
            return;
        }
        table.setTableNumber(request.getTableNumber());
        table.setCapacity(request.getCapacity());
        table.setLocation(request.getLocation());

        if (request.getStatus() != null) {
            try {
                table.setStatus(TableStatus.valueOf(request.getStatus().toUpperCase()));
            } catch (IllegalArgumentException e) {
                // Mantener el status actual
            }
        }
    }
}
