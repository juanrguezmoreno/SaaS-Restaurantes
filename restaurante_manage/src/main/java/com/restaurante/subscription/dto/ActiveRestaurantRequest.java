package com.restaurante.subscription.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/** Local que el inquilino quiere mantener operativo tras bajar de plan. */
@Data
public class ActiveRestaurantRequest {

    @NotNull(message = "El identificador del local es obligatorio")
    private Long restaurantId;
}
