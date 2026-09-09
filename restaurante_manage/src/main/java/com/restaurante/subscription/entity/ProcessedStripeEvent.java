package com.restaurante.subscription.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Registro de eventos de Stripe ya procesados.
 *
 * La idempotencia se consigue con la restricción UNIQUE de stripe_event_id, no
 * con una consulta previa: una comprobación previa tiene condición de carrera
 * (dos entregas simultáneas del mismo evento la pasarían las dos), una UNIQUE no.
 *
 * No extiende BaseEntity: es una bitácora técnica, no un dato de negocio, y no
 * tiene sentido el borrado lógico ni la auditoría de actualización.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stripe_processed_events")
public class ProcessedStripeEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "stripe_event_id", nullable = false, unique = true, length = 255)
    private String stripeEventId;

    @Column(nullable = false, length = 100)
    private String type;

    @Column(name = "processed_at", nullable = false)
    private LocalDateTime processedAt;

    public ProcessedStripeEvent(String stripeEventId, String type) {
        this.stripeEventId = stripeEventId;
        this.type = type;
        this.processedAt = LocalDateTime.now();
    }
}
