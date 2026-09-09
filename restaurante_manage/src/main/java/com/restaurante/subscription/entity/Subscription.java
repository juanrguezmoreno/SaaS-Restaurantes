package com.restaurante.subscription.entity;

import com.restaurante.common.audit.BaseEntity;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.tenant.entity.Tenant;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Suscripción de un tenant. Una por tenant (tenant_id es UNIQUE).
 *
 * El estado NUNCA se cambia desde una petición del frontend: sólo desde webhooks
 * de Stripe con firma verificada, o desde la concesión de cortesía (legacyGrant).
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "subscriptions")
public class Subscription extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tenant_id", nullable = false, unique = true)
    private Tenant tenant;

    @Enumerated(EnumType.STRING)
    @Column(name = "plan_code", nullable = false, length = 30)
    private PlanCode planCode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private SubscriptionStatus status;

    @Column(name = "stripe_customer_id", length = 255)
    private String stripeCustomerId;

    @Column(name = "stripe_subscription_id", length = 255, unique = true)
    private String stripeSubscriptionId;

    @Column(name = "stripe_price_id", length = 255)
    private String stripePriceId;

    @Column(name = "current_period_start")
    private LocalDateTime currentPeriodStart;

    @Column(name = "current_period_end")
    private LocalDateTime currentPeriodEnd;

    @Column(name = "trial_end")
    private LocalDateTime trialEnd;

    @Column(name = "cancel_at_period_end", nullable = false)
    private boolean cancelAtPeriodEnd = false;

    /**
     * Concesión de cortesía: el plan es válido aunque no haya suscripción en
     * Stripe. Lo usan los tenants que ya existían antes de implantar el cobro,
     * para que la migración no rompa ninguna cuenta.
     */
    @Column(name = "legacy_grant", nullable = false)
    private boolean legacyGrant = false;

    /**
     * Momento del último evento de Stripe aplicado. Stripe no garantiza el orden
     * de entrega: un evento más antiguo que este se descarta.
     */
    @Column(name = "last_stripe_event_at")
    private LocalDateTime lastStripeEventAt;
}
