// ═══════════════════════════════════════════════════════════════════════════════
//  Helpers centralizados para lógica de reservas
//  Unifica criterios de: estado, fechas, mesas asignadas, actividad
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * Normaliza un status a mayúsculas para comparación segura.
 */
export const normalizeStatus = (status) => String(status || '').toUpperCase();

/**
 * Obtiene la fecha local de hoy en formato YYYY-MM-DD.
 */
export const getLocalTodayString = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

/**
 * Obtiene un objeto Date a partir de reservationDate + reservationTime.
 * Usa fecha por defecto 1970-01-01 si no hay date, y 00:00:00 si no hay time.
 */
export const getReservationDateTime = (reservation) => {
  const date = reservation.reservationDate || '1970-01-01';
  const time = reservation.reservationTime || '00:00:00';
  return new Date(`${date}T${time}`);
};

/**
 * Verifica si la reserva es pasada (fecha+hora ya ocurrieron).
 */
export const isPastReservation = (reservation) => {
  const reservationDateTime = getReservationDateTime(reservation);
  return reservationDateTime < new Date();
};

/**
 * Verifica si la reserva es de hoy (misma fecha local).
 */
export const isTodayReservation = (reservation) => {
  const today = getLocalTodayString();
  const rd = reservation.reservationDate ? String(reservation.reservationDate).substring(0, 10) : '';
  return rd === today;
};

/**
 * Verifica si la reserva es de hoy o futura (no ha pasado).
 */
export const isFutureReservation = (reservation) => {
  const today = getLocalTodayString();
  const rd = reservation.reservationDate ? String(reservation.reservationDate).substring(0, 10) : '';
  return rd >= today;
};

/**
 * Determina si una reserva está "activa" operativamente.
 * Una reserva activa:
 * - Tiene status PENDING o CONFIRMED
 * - NO tiene status CANCELLED, COMPLETED o NO_SHOW
 * - Su fecha es hoy o futura (no ha pasado)
 */
export const isActiveReservation = (reservation) => {
  const status = normalizeStatus(reservation.status);

  // Descartar estados no operativos
  if (['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(status)) {
    return false;
  }

  // Solo PENDING y CONFIRMED son activas
  if (!['PENDING', 'CONFIRMED'].includes(status)) {
    return false;
  }

  // Descartar pasadas
  if (isPastReservation(reservation)) {
    return false;
  }

  return true;
};

/**
 * Verifica si la reserva tiene una mesa asignada.
 * Revisa diningTableId, tableId, diningTable, table, tableNumber.
 */
export const hasAssignedTable = (reservation) => {
  if (reservation.diningTableId) return true;
  if (reservation.tableId) return true;
  if (reservation.tableNumber) return true;
  if (reservation.diningTable && reservation.diningTable.id) return true;
  if (reservation.table && reservation.table.id) return true;
  // diningTable con tableNumber sin id también cuenta como asignada
  if (reservation.diningTable && reservation.diningTable.tableNumber) return true;
  return false;
};

/**
 * Verifica si la reserva está activa Y no tiene mesa asignada.
 */
export const isReservationWithoutTable = (reservation) => {
  return isActiveReservation(reservation) && !hasAssignedTable(reservation);
};

/**
 * Filtra reservas que son "Solicitudes pendientes":
 * status PENDING + fecha hoy o futura
 */
export const filterPendingReservations = (reservations) => {
  return reservations.filter((r) => {
    const status = normalizeStatus(r.status);
    if (status !== 'PENDING') return false;
    return isFutureReservation(r);
  });
};

/**
 * Filtra reservas CONFIRMED de hoy.
 */
export const filterTodayConfirmedReservations = (reservations) => {
  return reservations.filter((r) => {
    const status = normalizeStatus(r.status);
    if (status !== 'CONFIRMED') return false;
    return isTodayReservation(r);
  });
};

/**
 * Filtra reservas activas sin mesa asignada.
 */
export const filterReservationsWithoutTable = (reservations) => {
  return reservations.filter(isReservationWithoutTable);
};
