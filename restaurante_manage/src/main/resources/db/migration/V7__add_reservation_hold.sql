-- V7 — Bloqueo provisional de mesa para solicitudes de reserva públicas.
--
-- Una solicitud pública se crea en PENDING con una mesa compatible asignada y
-- esta caducidad. Mientras no venza, esa mesa no se ofrece a nadie más. Al
-- vencer, la mesa se libera pero la solicitud sigue viva para que el
-- restaurante pueda confirmarla (revalidando disponibilidad en ese momento).
--
-- NULL = reserva sin bloqueo: las creadas desde el panel privado y las que ya
-- se han confirmado, cancelado o completado.
ALTER TABLE `reservations`
  ADD COLUMN `hold_expires_at` DATETIME NULL;
