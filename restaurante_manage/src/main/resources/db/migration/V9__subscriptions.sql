-- ============================================================================
-- V9 — Suscripciones por tenant (planes NORMAL/PRO con Stripe Billing).
-- ============================================================================
-- 100 % aditiva: no borra ni modifica ningún dato existente.
--
-- Los tenants que ya existen reciben una concesión de cortesía PRO
-- (legacy_grant = 1, sin identificadores de Stripe) para que la implantación del
-- cobro no rompa ninguna cuenta el día del despliegue. La conversión a plan de
-- pago se hace después, tenant a tenant, poniendo legacy_grant = 0.

CREATE TABLE `subscriptions` (
  `deleted` bit(1) NOT NULL,
  `cancel_at_period_end` bit(1) NOT NULL,
  `legacy_grant` bit(1) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `current_period_start` datetime(6) DEFAULT NULL,
  `current_period_end` datetime(6) DEFAULT NULL,
  `trial_end` datetime(6) DEFAULT NULL,
  `last_stripe_event_at` datetime(6) DEFAULT NULL,
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `plan_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stripe_customer_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stripe_subscription_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stripe_price_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_subscriptions_tenant` (`tenant_id`),
  UNIQUE KEY `uk_subscriptions_stripe_subscription` (`stripe_subscription_id`),
  KEY `idx_subscriptions_stripe_customer` (`stripe_customer_id`),
  CONSTRAINT `fk_subscriptions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bitácora de idempotencia de webhooks. La UNIQUE de stripe_event_id es lo que
-- garantiza que un evento reentregado por Stripe no se procese dos veces.
CREATE TABLE `stripe_processed_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `stripe_event_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `processed_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stripe_processed_events_event` (`stripe_event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bloqueo suave del downgrade. Todos los locales existentes quedan activos.
ALTER TABLE `restaurants`
  ADD COLUMN `active_under_plan` bit(1) NOT NULL DEFAULT b'1';

-- Concesión de cortesía para los tenants que ya existían.
INSERT INTO `subscriptions`
  (`tenant_id`, `plan_code`, `status`, `legacy_grant`, `cancel_at_period_end`,
   `deleted`, `created_at`, `updated_at`)
SELECT t.`id`, 'PRO', 'ACTIVE', b'1', b'0', b'0', NOW(6), NOW(6)
FROM `tenants` t
WHERE t.`deleted` = b'0'
  AND NOT EXISTS (SELECT 1 FROM `subscriptions` s WHERE s.`tenant_id` = t.`id`);
