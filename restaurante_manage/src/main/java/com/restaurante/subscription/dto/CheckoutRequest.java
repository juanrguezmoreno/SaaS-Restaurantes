package com.restaurante.subscription.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.restaurante.subscription.enums.PlanCode;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * Petición de contratación. Sólo lleva el plan: el identificador de precio se
 * resuelve SIEMPRE en el servidor. Aceptar un priceId del cliente permitiría
 * pagar el plan barato y recibir el caro.
 *
 * Se ignoran a propósito otros campos que el cliente pueda enviar (priceId,
 * paid, plan...): ninguno de ellos influye en lo que se cobra.
 */
@Data
@JsonIgnoreProperties(ignoreUnknown = true)
public class CheckoutRequest {

    @NotNull(message = "El plan es obligatorio")
    private PlanCode planCode;
}
