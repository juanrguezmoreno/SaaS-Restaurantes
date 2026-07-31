-- ============================================================================
-- V8 — Periodos de servicio por día de la semana.
-- ============================================================================
-- Sustituyen a la ventana única opening_time/closing_time como fuente de las
-- franjas horarias que se ofrecen al reservar.
--
-- Un día sin filas vivas está cerrado. Un restaurante sin ninguna fila viva en
-- toda la semana sigue usando opening_time/closing_time como horario general
-- (fallback), que por eso NO se eliminan de la tabla restaurants.

CREATE TABLE `service_periods` (
  `deleted` bit(1) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `updated_at` datetime(6) NOT NULL,
  `id` bigint NOT NULL AUTO_INCREMENT,
  `restaurant_id` bigint NOT NULL,
  `day_of_week` enum('MONDAY','TUESDAY','WEDNESDAY','THURSDAY','FRIDAY','SATURDAY','SUNDAY') COLLATE utf8mb4_unicode_ci NOT NULL,
  `start_time` time NOT NULL,
  `end_time` time NOT NULL,
  `name` varchar(50) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_service_periods_restaurant_day` (`restaurant_id`, `day_of_week`),
  CONSTRAINT `fk_service_periods_restaurant` FOREIGN KEY (`restaurant_id`) REFERENCES `restaurants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
