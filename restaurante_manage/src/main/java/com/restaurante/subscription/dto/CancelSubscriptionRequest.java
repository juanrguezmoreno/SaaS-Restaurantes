package com.restaurante.subscription.dto;

import lombok.Data;

/** Cancelación. Por defecto, al final del periodo ya pagado. */
@Data
public class CancelSubscriptionRequest {
    private boolean atPeriodEnd = true;
}
