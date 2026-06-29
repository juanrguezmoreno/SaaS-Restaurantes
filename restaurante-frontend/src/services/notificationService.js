/**
 * Notification Service — Genera notificaciones inteligentes basadas en datos reales.
 *
 * No hace llamadas API directamente. Recibe los datos ya resueltos y devuelve
 * un array de notificaciones priorizadas (máximo 10).
 *
 * Cada notificación:
 * {
 *   id: string,
 *   type: string,
 *   icon: string,       // emoji
 *   title: string,
 *   description: string,
 *   timestamp: Date,
 *   priority: 'info' | 'warning' | 'alert',
 *   linkTo?: string,    // ruta opcional a la que navegar
 * }
 */

// ─── Helpers ────────────────────────────────────────────────────────────────

const getTodayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const getCurrentTimeMinutes = () => {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
};

const timeToMinutes = (timeStr) => {
  if (!timeStr) return 0;
  const parts = String(timeStr).split(':');
  return parseInt(parts[0], 10) * 60 + parseInt(parts[1], 10);
};

const getCustomerDisplay = (r) => {
  if (r.customer) {
    const c = r.customer;
    if (c.name) return c.name;
    if (c.firstName || c.lastName) return `${c.firstName || ''} ${c.lastName || ''}`.trim();
  }
  if (r.customerName) return r.customerName;
  if (r.customerId) return `Cliente #${r.customerId}`;
  return 'Cliente';
};

const getTableNumber = (r) => {
  if (r.diningTable && r.diningTable.tableNumber) return r.diningTable.tableNumber;
  if (r.table && r.table.tableNumber) return r.table.tableNumber;
  if (r.diningTableId) return `#${r.diningTableId}`;
  return '—';
};

// ─── Generador principal ─────────────────────────────────────────────────────

let notificationCounter = 0;

/**
 * @param {object} data
 * @param {Array}  data.reservations  - Lista de reservas
 * @param {Array}  data.tables        - Lista de mesas
 * @param {Array}  data.customers      - Lista de clientes
 * @param {number} data.totalTables   - Total de mesas
 * @returns {Array} notificaciones generadas (máx. 10)
 */
export const generateNotifications = ({ reservations = [], tables = [], customers = [] } = {}) => {
  const notifications = [];
  const now = new Date();
  const todayStr = getTodayStr();
  const currentMinutes = getCurrentTimeMinutes();

  // ─── Datos seguros ────────────────────────────────────────────────────────
  const safeReservations = Array.isArray(reservations) ? reservations : [];
  const safeTables = Array.isArray(tables) ? tables : [];
  const safeCustomers = Array.isArray(customers) ? customers : [];
  const totalTables = safeTables.length;

  // ─── Reservas activas (no canceladas) ─────────────────────────────────────
  const activeReservations = safeReservations.filter((r) => r.status !== 'CANCELLED');

  // Reservas de hoy
  const reservationsToday = activeReservations.filter((r) => {
    const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
    return rd === todayStr;
  });

  // Reservas futuras (hoy en adelante, activas)
  const futureReservations = activeReservations.filter((r) => {
    const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
    return rd >= todayStr;
  });

  // ─── 1. PRÓXIMA RESERVA (< 60 min) ──────────────────────────────────────
  const upcomingSoon = reservationsToday
    .filter((r) => {
      if (r.status !== 'CONFIRMED' && r.status !== 'PENDING') return false;
      const resMin = timeToMinutes(r.reservationTime);
      const diff = resMin - currentMinutes;
      return diff > 0 && diff <= 60;
    })
    .sort((a, b) => {
      const tA = a.reservationTime || '';
      const tB = b.reservationTime || '';
      return tA.localeCompare(tB);
    });

  upcomingSoon.slice(0, 2).forEach((r) => {
    const resMin = timeToMinutes(r.reservationTime);
    const diff = resMin - currentMinutes;
    notifications.push({
      id: `upcoming-${r.id || notificationCounter++}`,
      type: 'UPCOMING_RESERVATION',
      icon: '⏰',
      title: 'Próxima reserva',
      description: `Mesa ${getTableNumber(r)} — ${getCustomerDisplay(r)} a las ${String(r.reservationTime).substring(0, 5)}`,
      timestamp: now,
      priority: diff <= 15 ? 'alert' : 'warning',
      linkTo: '/reservations',
    });
  });

  // ─── 2. RESERVAS DE HOY (resumen) ────────────────────────────────────────
  if (reservationsToday.length > 0) {
    const confirmed = reservationsToday.filter((r) => r.status === 'CONFIRMED').length;
    const pending = reservationsToday.filter((r) => r.status === 'PENDING').length;
    notifications.push({
      id: `today-reservations-${todayStr}`,
      type: 'TODAY_RESERVATIONS',
      icon: '📅',
      title: 'Reservas de hoy',
      description: `${reservationsToday.length} reserva${reservationsToday.length !== 1 ? 's' : ''} activa${reservationsToday.length !== 1 ? 's' : ''} · ${confirmed} confirmada${confirmed !== 1 ? 's' : ''}, ${pending} pendiente${pending !== 1 ? 's' : ''}`,
      timestamp: now,
      priority: 'info',
      linkTo: '/reservations',
    });
  }

  // ─── 3. RESERVAS PENDIENTES (requieren atención) ─────────────────────────
  const pendingReservations = safeReservations.filter((r) => r.status === 'PENDING');
  if (pendingReservations.length > 0) {
    notifications.push({
      id: `pending-reservations-${pendingReservations.length}`,
      type: 'PENDING_RESERVATIONS',
      icon: '⏳',
      title: 'Reservas pendientes',
      description: `${pendingReservations.length} reserva${pendingReservations.length !== 1 ? 's' : ''} pendiente${pendingReservations.length !== 1 ? 's' : ''} de confirmación`,
      timestamp: now,
      priority: 'warning',
      linkTo: '/reservations',
    });
  }

  // ─── 4. MESAS EN MANTENIMIENTO ──────────────────────────────────────────
  const outOfServiceTables = safeTables.filter((t) => t.status === 'MAINTENANCE');
  if (outOfServiceTables.length > 0) {
    const tableNumbers = outOfServiceTables
      .slice(0, 3)
      .map((t) => t.tableNumber || `#${t.id}`)
      .join(', ');
    notifications.push({
      id: `out-of-service-${outOfServiceTables.length}`,
      type: 'OUT_OF_SERVICE_TABLES',
      icon: '🔧',
      title: 'Mesas en mantenimiento',
      description: `${outOfServiceTables.length} mesa${outOfServiceTables.length !== 1 ? 's' : ''} en mantenimiento: ${tableNumbers}${outOfServiceTables.length > 3 ? ` y ${outOfServiceTables.length - 3} más` : ''}`,
      timestamp: now,
      priority: 'warning',
      linkTo: '/tables',
    });
  }

  // ─── 5. OCUPACIÓN > 80% ──────────────────────────────────────────────────
  const occupiedCount = safeTables.filter((t) => t.status === 'OCCUPIED').length;
  const reservedCount = safeTables.filter((t) => t.status === 'RESERVED').length;
  const occupiedPercent = totalTables > 0
    ? Math.round(((occupiedCount + reservedCount) / totalTables) * 100)
    : 0;

  if (occupiedPercent > 80 && totalTables > 0) {
    notifications.push({
      id: `high-occupancy-${occupiedPercent}`,
      type: 'HIGH_OCCUPANCY',
      icon: '📊',
      title: 'Ocupación crítica',
      description: `La ocupación actual es del ${occupiedPercent}% · ${occupiedCount} ocupadas, ${reservedCount} reservadas`,
      timestamp: now,
      priority: 'alert',
      linkTo: '/tables',
    });
  }

  // ─── 6. SIN MESAS DISPONIBLES ────────────────────────────────────────────
  const availableTables = safeTables.filter((t) => t.status === 'AVAILABLE');
  if (availableTables.length === 0 && totalTables > 0) {
    notifications.push({
      id: 'no-tables-available',
      type: 'NO_TABLES_AVAILABLE',
      icon: '🚫',
      title: 'Sin mesas disponibles',
      description: 'Todas las mesas están ocupadas o fuera de servicio. No hay mesas libres.',
      timestamp: now,
      priority: 'alert',
      linkTo: '/tables',
    });
  }

  // ─── 7. CLIENTE FRECUENTE ────────────────────────────────────────────────
  if (activeReservations.length > 0 && safeCustomers.length > 0) {
    const counts = {};
    activeReservations.forEach((r) => {
      const id = r.customerId || r.customer?.id;
      if (id) counts[id] = (counts[id] || 0) + 1;
    });
    const maxId = Object.keys(counts).reduce((a, b) => (counts[a] > counts[b] ? a : b), '');
    const found = safeCustomers.find((c) => String(c.id) === String(maxId));
    if (found && counts[maxId] >= 3) {
      const name = found.name || `${found.firstName || ''} ${found.lastName || ''}`.trim() || `#${found.id}`;
      notifications.push({
        id: `frequent-customer-${found.id}`,
        type: 'FREQUENT_CUSTOMER',
        icon: '⭐',
        title: 'Cliente frecuente',
        description: `${name} ha realizado ${counts[maxId]} reservas · Cliente habitual`,
        timestamp: now,
        priority: 'info',
        linkTo: '/customers',
      });
    }
  }

  // ─── 8. CLIENTE NUEVO ────────────────────────────────────────────────────
  if (safeCustomers.length > 0) {
    // Tomamos los 2 últimos clientes como "nuevos" (asumiendo orden por ID)
    const recentCustomers = safeCustomers.slice(-2);
    recentCustomers.forEach((c) => {
      const name = c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || `#${c.id}`;
      notifications.push({
        id: `new-customer-${c.id}`,
        type: 'NEW_CUSTOMER',
        icon: '🆕',
        title: 'Cliente nuevo',
        description: `${name} se ha registrado recientemente`,
        timestamp: now,
        priority: 'info',
        linkTo: '/customers',
      });
    });
  }

  // ─── 9. HORA PUNTA ────────────────────────────────────────────────────────
  if (futureReservations.length > 0) {
    const hourCounts = {};
    futureReservations.forEach((r) => {
      const h = r.reservationTime ? String(r.reservationTime).substring(0, 2) : '??';
      hourCounts[h] = (hourCounts[h] || 0) + 1;
    });
    let maxHour = '';
    let maxCount = 0;
    Object.entries(hourCounts).forEach(([hour, count]) => {
      if (count > maxCount) { maxHour = hour; maxCount = count; }
    });
    if (maxHour && maxCount >= 2) {
      notifications.push({
        id: `peak-hour-${maxHour}`,
        type: 'PEAK_HOUR',
        icon: '🔮',
        title: 'Hora punta prevista',
        description: `Las ${maxHour}:00 es la hora con más reservas (${maxCount}) · Prepara al equipo`,
        timestamp: now,
        priority: 'info',
      });
    }
  }

  // ─── 10. DÍA CON MÁS RESERVAS ────────────────────────────────────────────
  if (safeReservations.length > 0) {
    const dayCounts = {};
    safeReservations.forEach((r) => {
      const d = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      if (d) dayCounts[d] = (dayCounts[d] || 0) + 1;
    });
    let maxDay = '';
    let maxDayCount = 0;
    Object.entries(dayCounts).forEach(([day, count]) => {
      if (count > maxDayCount) { maxDay = day; maxDayCount = count; }
    });
    if (maxDay && maxDay !== todayStr && maxDayCount >= 3) {
      const formatted = maxDay.split('-').reverse().join('/');
      notifications.push({
        id: `busiest-day-${maxDay}`,
        type: 'BUSIEST_DAY',
        icon: '📈',
        title: 'Día más reservado',
        description: `El ${formatted} tiene ${maxDayCount} reservas · Prepárate para un día intenso`,
        timestamp: now,
        priority: 'info',
      });
    }
  }

  // ─── Limitar a 10 y ordenar por prioridad ─────────────────────────────────
  const priorityOrder = { alert: 0, warning: 1, info: 2 };
  notifications.sort((a, b) => {
    const pA = priorityOrder[a.priority] ?? 2;
    const pB = priorityOrder[b.priority] ?? 2;
    if (pA !== pB) return pA - pB;
    // Misma prioridad: más reciente primero
    return b.timestamp - a.timestamp;
  });

  return notifications.slice(0, 10);
};

/**
 * Genera un texto relativo para el timestamp de una notificación.
 * Ej: "Hace 5 minutos", "Hace 1 hora", "Ahora"
 */
export const getRelativeTime = (timestamp) => {
  if (!timestamp) return '';
  const now = new Date();
  const diffMs = now - new Date(timestamp);
  const diffSeconds = Math.floor(diffMs / 1000);

  if (diffSeconds < 10) return 'Ahora';
  if (diffSeconds < 60) return `Hace ${diffSeconds} segundos`;

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes === 1) return 'Hace 1 minuto';
  if (diffMinutes < 60) return `Hace ${diffMinutes} minutos`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours === 1) return 'Hace 1 hora';
  if (diffHours < 24) return `Hace ${diffHours} horas`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays === 1) return 'Ayer';
  return `Hace ${diffDays} días`;
};
