package com.restaurante.subscription.dto;

/** URL alojada por Stripe a la que redirigir al usuario. */
public record BillingSessionResponse(String url) {}
