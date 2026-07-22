-- V6 — Duración de reserva configurable por restaurante.
--
-- Minutos que ocupa una reserva la mesa asignada. Se usa para calcular
-- solapes por intervalo horario (antes se comparaba solo la hora exacta).
-- Los restaurantes existentes quedan en 90 minutos por defecto.
ALTER TABLE `restaurants`
  ADD COLUMN `default_reservation_duration_minutes` INT NOT NULL DEFAULT 90;
