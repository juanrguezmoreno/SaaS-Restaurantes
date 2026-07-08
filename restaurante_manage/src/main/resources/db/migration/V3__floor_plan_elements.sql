-- ============================================================================
-- V3 — Elementos decorativos del plano de sala (barra, puerta...)
-- ============================================================================

CREATE TABLE `floor_plan_elements` (
  `deleted` bit(1) NOT NULL,
  `height` int DEFAULT NULL,
  `rotation` int DEFAULT NULL,
  `width` int DEFAULT NULL,
  `x_position` int NOT NULL,
  `y_position` int NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `id` bigint NOT NULL AUTO_INCREMENT,
  `restaurant_id` bigint NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `type` enum('BAR','DOOR') COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_floor_plan_elements_restaurant` (`restaurant_id`),
  CONSTRAINT `fk_floor_plan_elements_restaurant` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
