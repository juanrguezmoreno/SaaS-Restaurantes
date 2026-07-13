-- V5 — Tokens de recuperación de contraseña.
--
-- Solo se guarda el hash SHA-256 del token (nunca el valor en claro que se
-- envía por email): un volcado de esta tabla no permite secuestrar cuentas
-- con tokens vivos.

CREATE TABLE `password_reset_tokens` (
  `deleted` bit(1) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `expires_at` datetime(6) NOT NULL,
  `id` bigint NOT NULL AUTO_INCREMENT,
  `updated_at` datetime(6) NOT NULL,
  `used_at` datetime(6) DEFAULT NULL,
  `user_id` bigint NOT NULL,
  `token_hash` varchar(64) COLLATE utf8mb4_unicode_ci NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_password_reset_tokens_token_hash` (`token_hash`),
  KEY `fk_password_reset_tokens_user` (`user_id`),
  CONSTRAINT `fk_password_reset_tokens_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
