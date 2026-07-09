-- RES-03: refuerzo a nivel de base de datos contra reservas duplicadas.
--
-- La regla de negocio (ya validada en ReservationService) es que una mesa no
-- puede tener dos reservas ACTIVAS (PENDING o CONFIRMED) en la misma fecha y
-- hora. Las CANCELLED/COMPLETED/NO_SHOW y las borradas (soft delete) no
-- bloquean el hueco, por lo que un UNIQUE simple sobre
-- (dining_table_id, reservation_date, reservation_time) no sirve.
--
-- MySQL no soporta índices parciales, así que se usa una columna generada que
-- solo "participa" cuando la reserva es activa y no borrada; en el resto de
-- casos vale NULL y MySQL permite NULLs repetidos en índices UNIQUE.

-- 1) Sanear datos previos: si ya existen duplicados activos en el mismo hueco,
--    se conserva la reserva más antigua (menor id) y el resto se cancela para
--    que la creación del índice no falle.
UPDATE reservations r
JOIN (
    SELECT dining_table_id, reservation_date, reservation_time, MIN(id) AS keep_id
    FROM reservations
    WHERE deleted = 0
      AND status IN ('PENDING', 'CONFIRMED')
      AND dining_table_id IS NOT NULL
    GROUP BY dining_table_id, reservation_date, reservation_time
    HAVING COUNT(*) > 1
) dup ON r.dining_table_id = dup.dining_table_id
     AND r.reservation_date = dup.reservation_date
     AND r.reservation_time = dup.reservation_time
     AND r.id <> dup.keep_id
SET r.status = 'CANCELLED'
WHERE r.deleted = 0
  AND r.status IN ('PENDING', 'CONFIRMED');

-- 2) Columna generada: id de mesa solo cuando la reserva está activa y viva.
ALTER TABLE reservations
    ADD COLUMN active_slot_table_id BIGINT
        GENERATED ALWAYS AS (
            CASE
                WHEN status IN ('PENDING', 'CONFIRMED') AND deleted = 0
                THEN dining_table_id
                ELSE NULL
            END
        ) STORED;

-- 3) Índice único: dos reservas activas no pueden compartir mesa+fecha+hora.
ALTER TABLE reservations
    ADD UNIQUE KEY uk_reservations_active_slot
        (active_slot_table_id, reservation_date, reservation_time);
