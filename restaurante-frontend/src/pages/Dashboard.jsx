import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { getRestaurants } from '../services/restaurantService';
import { getCustomers } from '../services/customerService';
import { getReservations } from '../services/reservationService';
import {
  isActiveReservation,
  filterPendingReservations,
  filterTodayConfirmedReservations,
  filterReservationsWithoutTable,
  getLocalTodayString,
} from '../lib/reservationHelpers';

// ─── Helper: extraer array de una respuesta API ─────────────────────────────
const extractArray = (response) => {
  if (!response || !response.data) return [];
  const body = response.data;
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.content)) return body.content;
  if (body && body.success && Array.isArray(body.data)) return body.data;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && body.data && Array.isArray(body.data.content)) return body.data.content;
  return [];
};

// ─── Helpers de formato ──────────────────────────────────────────────────────
const formatTime = (timeStr) => {
  if (!timeStr) return '—';
  return String(timeStr).substring(0, 5);
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const parts = String(dateStr).split('-');
  if (parts.length === 3) return `${parts[2]}/${parts[1]}/${parts[0]}`;
  return dateStr;
};

// Safe text helper: evita renderizar undefined, null, NaN, [object Object]
const safeText = (value, fallback = 'No disponible') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isNaN(value)) return fallback;
  if (typeof value === 'object') return fallback;
  return String(value);
};

const getTodayStr = () => getLocalTodayString();

const getCustomerDisplay = (r) => {
  if (r.customer) {
    const c = r.customer;
    if (c.name) return c.name;
    if (c.firstName || c.lastName) return `${c.firstName || ''} ${c.lastName || ''}`.trim();
  }
  if (r.customerName) return r.customerName;
  return `#${r.customerId || '?'}`;
};

const getTableNumber = (r, tables) => {
  if (r.diningTable && r.diningTable.tableNumber) return r.diningTable.tableNumber;
  if (r.table && r.table.tableNumber) return r.table.tableNumber;
  if (r.diningTableId) {
    const found = tables.find((t) => t.id === r.diningTableId);
    if (found) return found.tableNumber || `#${found.id}`;
  }
  return `#${r.diningTableId || '?'}`;
};

const STATUS_LABELS = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  COMPLETED: 'Completada',
};

// ─── Componente principal ─────────────────────────────────────────────────────
const Dashboard = () => {
  const navigate = useNavigate();

  // Estados de datos
  const [tables, setTables] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [partialError, setPartialError] = useState(null);

  const todayStr = getTodayStr();

  // ─── Cargar datos del dashboard ────────────────────────────────────────────
  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    setError(null);

    let fetchedRestaurants = [];
    let fetchedCustomers = [];
    let fetchedReservations = [];
    let fetchedTables = [];

    try {
      // Endpoints individuales
      const [restaurantsRes, customersRes, reservationsRes] = await Promise.allSettled([
        getRestaurants(),
        getCustomers(),
        getReservations(),
      ]);

      if (restaurantsRes.status === 'fulfilled' && Array.isArray(restaurantsRes.value)) {
        fetchedRestaurants = restaurantsRes.value;
      }

      if (customersRes.status === 'fulfilled' && Array.isArray(customersRes.value)) {
        fetchedCustomers = customersRes.value;
      }

      if (reservationsRes.status === 'fulfilled' && Array.isArray(reservationsRes.value)) {
        fetchedReservations = reservationsRes.value;
      }

      // Mesas: solo por restaurante (no existe GET /tables global)
      if (fetchedRestaurants.length > 0) {
        const promises = fetchedRestaurants.map((r) =>
          api.get(`/restaurants/${r.id}/tables`)
            .then((res) => extractArray(res))
            .catch(() => [])
        );
        const results = await Promise.allSettled(promises);
        fetchedTables = results.flatMap(
          (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [])
        );
      }

      setCustomers(fetchedCustomers);
      setReservations(fetchedReservations);
      setTables(fetchedTables);

      const succeeded = [
        fetchedCustomers.length > 0 || customersRes.status === 'fulfilled',
        fetchedReservations.length > 0 || reservationsRes.status === 'fulfilled',
        fetchedTables.length > 0,
      ].filter(Boolean).length;

      if (succeeded < 3 && succeeded > 0) {
        setPartialError(`${3 - succeeded} de 3 fuentes de datos no respondieron. Los datos pueden estar incompletos.`);
      } else {
        setPartialError(null);
      }

      if (succeeded === 0) {
        setError('No se pudieron cargar datos. Verifica la conexión con el servidor.');
      } else {
        setError(null);
      }
    } catch (err) {
      setError(err?.message || 'Error al cargar los datos del dashboard.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setLastUpdate(new Date());
    }
  }, []);

  // Carga inicial
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchDashboardData();
  }, [fetchDashboardData]);

  // Refrescar al volver a la pestaña y cada 60s
  useEffect(() => {
    let mounted = true;
    const handleRefresh = () => {
      if (mounted) {
        setIsRefreshing(true);
        fetchDashboardData();
      }
    };
    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handleRefresh();
    });
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setIsRefreshing(true);
        fetchDashboardData();
      }
    }, 60000);
    return () => {
      mounted = false;
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
      clearInterval(interval);
    };
  }, [fetchDashboardData]);

  // ─── Arrays seguros (useMemo para mantener referencias estables) ──────────
  const safeTables = useMemo(() => Array.isArray(tables) ? tables : [], [tables]);
  const safeCustomers = useMemo(() => Array.isArray(customers) ? customers : [], [customers]);
  const safeReservations = useMemo(() => Array.isArray(reservations) ? reservations : [], [reservations]);

  // ═════════════════════════════════════════════════════════════════════════
  //  FILTROS BASE — Limpios y reutilizables
  // Solicitudes pendientes: PENDING activas (hoy o futuras)
  const pendingReservations = useMemo(() =>
    filterPendingReservations(safeReservations),
    [safeReservations]
  );

  // Reservas activas: PENDING o CONFIRMED, fecha hoy/futura
  const activeReservations = useMemo(() =>
    safeReservations.filter(isActiveReservation),
    [safeReservations]
  );

  // Futuras activas: hoy en adelante (redundante con activeReservations, pero mantenemos para claridad)
  const futureReservations = useMemo(() =>
    activeReservations.filter((r) => {
      const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      return rd >= todayStr;
    }),
    [activeReservations, todayStr]
  );

  // ═════════════════════════════════════════════════════════════════════════
  //  DATOS OPERATIVOS — Tiempo real
  // ═════════════════════════════════════════════════════════════════════════

  const occupiedCount = safeTables.filter((t) => t.status === 'OCCUPIED').length;
  const reservedTablesCount = safeTables.filter((t) => t.status === 'RESERVED').length;
  const availableTablesCount = safeTables.filter((t) => t.status === 'AVAILABLE').length;
  const outOfServiceCount = safeTables.filter((t) => t.status === 'MAINTENANCE').length;

  // Total de mesas (usado en ocupación)
  const totalTables = safeTables.length;

  const occupiedPercent = totalTables > 0
    ? Math.round(((occupiedCount + reservedTablesCount) / totalTables) * 100)
    : 0;

  // ═════════════════════════════════════════════════════════════════════════
  //  DATOS HISTÓRICOS / ANALÍTICA
  // ═════════════════════════════════════════════════════════════════════════

  // Actividad reciente: últimas operaciones registradas
  // NOTA: Como la API no expone createdAt, usamos los últimos IDs como proxy.
  const recentActivity = useMemo(() => {
    const events = [];

    // Últimos 2 clientes como "Cliente registrado"
    safeCustomers.slice(-2).forEach((c) => {
      events.push({
        type: 'customer_created',
        label: 'Cliente registrado',
        detail: c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || `#${c.id}`,
        sortKey: `B_${String(c.id).padStart(10, '0')}`,
        icon: 'person',
      });
    });

    // Últimas reservas clasificadas por estado
    safeReservations.slice(-10).forEach((r) => {
      if (r.status === 'CANCELLED') {
        events.push({
          type: 'reservation_cancelled',
          label: 'Reserva cancelada',
          detail: `${getCustomerDisplay(r)} — Mesa ${getTableNumber(r, safeTables)}`,
          sortKey: `A_${String(r.id).padStart(10, '0')}`,
          icon: 'cancel',
        });
      } else if (r.status === 'COMPLETED') {
        events.push({
          type: 'reservation_completed',
          label: 'Mesa liberada',
          detail: `Mesa ${getTableNumber(r, safeTables)} — ${getCustomerDisplay(r)}`,
          sortKey: `A_${String(r.id).padStart(10, '0')}`,
          icon: 'check',
        });
      } else {
        events.push({
          type: 'reservation_created',
          label: 'Reserva creada',
          detail: `${getCustomerDisplay(r)} — ${formatTime(r.reservationTime)} — ${r.partySize || '?'} pers.`,
          sortKey: `A_${String(r.id).padStart(10, '0')}`,
          icon: 'reservation',
        });
      }
    });

    events.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    return events.slice(0, 4);
  }, [safeCustomers, safeReservations, safeTables]);

  // ═════════════════════════════════════════════════════════════════════════
  //  INDICADORES INTELIGENTES — Basados en datos limpios
  // ═════════════════════════════════════════════════════════════════════════

  // Próxima reserva: primera reserva CONFIRMADA del futuro (hoy en adelante)
  const nextReservation = useMemo(() => {
    const sorted = [...futureReservations]
      .filter((r) => r.status === 'CONFIRMED')
      .sort((a, b) => {
        const dA = a.reservationDate || '';
        const dB = b.reservationDate || '';
        if (dA !== dB) return dA.localeCompare(dB);
        const tA = a.reservationTime || '';
        const tB = b.reservationTime || '';
        return tA.localeCompare(tB);
      });
    return sorted[0] || null;
  }, [futureReservations]);

  // Hora punta: hora con más reservas futuras activas
  const peakHour = useMemo(() => {
    if (futureReservations.length === 0) return null;
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
    return { hour: maxHour, count: maxCount };
  }, [futureReservations]);

  // Ocupación prevista: mesas ocupadas HOY + reservas futuras activas
  const forecastedOccupancy = useMemo(() => {
    if (totalTables === 0) return 0;
    const futureActiveCount = futureReservations.filter((r) =>
      ['CONFIRMED', 'PENDING'].includes(r.status)
    ).length;
    const currentOccupied = occupiedCount + reservedTablesCount;
    const estimate = Math.min(currentOccupied + futureActiveCount, totalTables * 2);
    return Math.round(Math.min((estimate / totalTables) * 100, 100));
  }, [futureReservations, totalTables, occupiedCount, reservedTablesCount]);

  // ─── Nuevos cómputos para Inicio rediseñado ──────────────────────────────────

  // Reservas CONFIRMED de hoy (para KPI "Reservas hoy" y Agenda de hoy)
  const todayConfirmedReservations = useMemo(() =>
    filterTodayConfirmedReservations(safeReservations),
    [safeReservations]
  );

  // Reservas urgentes (próximos 60 min) para "Requiere atención"
  const urgentReservations = useMemo(() => {
    const now = new Date();
    const currentMin = now.getHours() * 60 + now.getMinutes();
    return safeReservations.filter((r) => {
      if (r.status !== 'CONFIRMED') return false;
      const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      if (rd !== todayStr) return false;
      const time = r.reservationTime || '';
      const [h, m] = time.split(':').map(Number);
      if (isNaN(h) || isNaN(m)) return false;
      const totalMin = h * 60 + m;
      const diff = totalMin - currentMin;
      return diff > 0 && diff <= 60;
    });
  }, [safeReservations, todayStr]);

  // Reservas activas sin mesa asignada (para KPI "Requiere atención")
  const unassignedTableReservations = useMemo(() => {
    const result = filterReservationsWithoutTable(safeReservations);
    // Debug temporal: muestra qué reservas se están contando como "sin mesa"
    if (result.length > 0) {
      console.log('[Inicio] reservas sin mesa asignada:', result.map((r) => ({
        id: r.id,
        cliente: r.customer?.name || r.customerName || `#${r.customerId}`,
        fecha: r.reservationDate,
        hora: r.reservationTime,
        status: r.status,
        diningTableId: r.diningTableId,
        tableNumber: r.tableNumber,
        diningTable: r.diningTable,
        table: r.table,
      })));
    }
    return result;
  }, [safeReservations]);

  // ─── Render helpers ─────────────────────────────────────────────────────────
  const renderStatusBadge = (status) => {
    const label = STATUS_LABELS[status] || status || '—';
    const cls = (status || '').toLowerCase();
    return <span className={`badge-status ${cls}`}>{label}</span>;
  };

  const renderActivityIcon = (icon) => {
    switch (icon) {
      case 'person':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        );
      case 'cancel':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="15" y1="9" x2="9" y2="15" />
            <line x1="9" y1="9" x2="15" y2="15" />
          </svg>
        );
      case 'check':
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
        );
      case 'reservation':
      default:
        return (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
            <line x1="16" y1="2" x2="16" y2="6" />
            <line x1="8" y1="2" x2="8" y2="6" />
            <line x1="3" y1="10" x2="21" y2="10" />
          </svg>
        );
    }
  };

  // ─── Render principal ───────────────────────────────────────────────────────
  return (
    <div className="exec-dashboard">
      {/* ═══ HEADER ═════════════════════════════════════════════════════════ */}

      <div className="exec-header">
        <div>
          <h1 className="exec-header-title">Inicio</h1>
          <p className="exec-header-subtitle">
            {loading
              ? 'Cargando...'
              : `Resumen operativo del día — ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
          </p>
        </div>
        <div className="exec-header-actions">
          {lastUpdate && (
            <span className="exec-update-time">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {lastUpdate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })}
            </span>
          )}
          <button
            className="exec-refresh-btn"
            onClick={() => { setIsRefreshing(true); fetchDashboardData(); }}
            type="button"
            title="Actualizar datos"
            aria-label="Actualizar datos del dashboard"
            disabled={isRefreshing}
          >
            {isRefreshing ? (
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* ═══ ALERTAS ═══════════════════════════════════════════════════════ */}

      {error && (
        <div className="exec-alert exec-alert-error" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span className="flex-grow-1">{error}</span>
          <button className="exec-alert-btn" onClick={fetchDashboardData} type="button">Reintentar</button>
        </div>
      )}

      {partialError && !error && (
        <div className="exec-alert exec-alert-warning" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          <span className="flex-grow-1">{partialError}</span>
        </div>
      )}

      {/* ═══ LOADING ═════════════════════════════════════════════════════ */}

      {loading && (
        <div className="exec-loading">
          <div className="spinner-border mb-3" role="status" style={{ width: '2rem', height: '2rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="mb-0" style={{ color: 'var(--text-secondary)' }}>Cargando datos del dashboard...</p>
        </div>
      )}

      {/* ═══ CONTENIDO ═══════════════════════════════════════════════════ */}

      {!loading && (
        <>
          {/* ═══ ROW 1: 4 KPIs operativos ════════════════════════════════════ */}
          <div className="exec-kpi-grid" style={{ gridTemplateColumns: 'repeat(4, 1fr)', marginBottom: '1.5rem' }}>
            {/* Reservas hoy */}
            <div className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver reservas de hoy">
              <div className="exec-kpi-icon" style={{ color: 'var(--info, #06b6d4)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value">{todayConfirmedReservations.length}</span>
                <span className="exec-kpi-label">Reservas hoy</span>
                <span className="exec-kpi-trend">Confirmadas</span>
              </div>
            </div>

            {/* Solicitudes pendientes */}
            <div className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver solicitudes pendientes">
              <div className="exec-kpi-icon" style={{ color: 'var(--warning)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value">{pendingReservations.length}</span>
                <span className="exec-kpi-label">Solicitudes pendientes</span>
                <span className="exec-kpi-trend">{pendingReservations.length === 1 ? 'Requiere atención' : 'Requieren atención'}</span>
              </div>
            </div>

            {/* Ocupación actual */}
            <div className="exec-kpi">
              <div className="exec-kpi-icon" style={{ color: 'var(--violet, #8b5cf6)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value" style={{ fontSize: '1.75rem' }}>
                  {totalTables > 0 ? occupiedPercent : '—'}
                </span>
                <span className="exec-kpi-label">Ocupación actual</span>
                <span className="exec-kpi-trend" style={{ color: occupiedPercent > 75 ? 'var(--danger)' : occupiedPercent > 50 ? 'var(--warning)' : 'var(--success)' }}>
                  {occupiedCount} ocupadas · {reservedTablesCount} reservadas
                </span>
              </div>
            </div>

            {/* Próxima reserva */}
            <div className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver próximas reservas">
              <div className="exec-kpi-icon" style={{ color: 'var(--primary)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <polyline points="12 6 12 12 16 14" />
                </svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-label" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>Próxima reserva</span>
                <span className="exec-kpi-value" style={{ fontSize: '1rem', fontWeight: 600 }}>
                  {nextReservation ? formatTime(nextReservation.reservationTime) : '—'}
                </span>
                <span className="exec-kpi-trend">
                  {nextReservation
                    ? `${getCustomerDisplay(nextReservation)}${nextReservation.reservationDate === todayStr ? '' : ` · ${formatDate(nextReservation.reservationDate)}`}`
                    : 'Sin reservas confirmadas'}
                </span>
              </div>
            </div>
          </div>

          {/* ═══ ROW 2: Agenda de hoy + Requiere atención + Estado de sala ═══ */}
          <div className="exec-two-col" style={{ marginBottom: '1.25rem' }}>
            {/* ─── IZQUIERDA: Agenda de hoy ──────────────────────────────── */}
            <div className="exec-card" style={{ marginBottom: 0 }}>
              <div className="exec-card-header">
                <h3>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Agenda de hoy
                </h3>
                {todayConfirmedReservations.length > 5 && (
                  <button className="exec-card-action" onClick={() => navigate('/reservations')} type="button">
                    Ver todas
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                )}
              </div>

              <div className="exec-card-body" style={{ padding: 0 }}>
                {todayConfirmedReservations.length === 0 ? (
                  <div className="exec-empty">
                    <div className="exec-empty-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    </div>
                    <p>No hay reservas confirmadas para hoy.</p>
                  </div>
                ) : (
                  <div className="exec-upcoming-list">
                    {[...todayConfirmedReservations]
                      .sort((a, b) => (a.reservationTime || '').localeCompare(b.reservationTime || ''))
                      .slice(0, 5)
                      .map((r, idx) => {
                        const timeStr = formatTime(r.reservationTime);
                        const clientName = getCustomerDisplay(r);
                        const tableNum = getTableNumber(r, safeTables);
                        return (
                          <div
                            key={r.id || idx}
                            className="exec-upcoming-item"
                            onClick={() => navigate('/reservations')}
                          >
                            <div className="exec-upcoming-time">
                              <span className="exec-upcoming-time-value">{timeStr}</span>
                            </div>
                            <div className="exec-upcoming-info">
                              <div className="exec-upcoming-client">{clientName}</div>
                              <div className="exec-upcoming-meta">
                                <span>{r.partySize || '?'} {r.partySize === 1 ? 'persona' : 'personas'}</span>
                                <span className="exec-dot" />
                                <span>Mesa {tableNum}</span>
                              </div>
                            </div>
                            <div className="exec-upcoming-status">
                              {renderStatusBadge(r.status)}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                )}
                {todayConfirmedReservations.length > 5 && (
                  <div className="exec-card-footer-link" onClick={() => navigate('/reservations')}>
                    Ver todas las {todayConfirmedReservations.length} reservas de hoy
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                  </div>
                )}
              </div>
            </div>

            {/* ─── DERECHA: Requiere atención + Estado de sala ──────────── */}
            <div className="d-flex flex-column gap-3" style={{ minWidth: 0 }}>
              {/* Requiere atención */}
              <div className="exec-card" style={{ marginBottom: 0 }}>
                <div className="exec-card-header">
                  <h3>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    Requiere atención
                  </h3>
                </div>
                <div className="exec-card-body">
                  {pendingReservations.length === 0 && outOfServiceCount === 0 && urgentReservations.length === 0 && unassignedTableReservations.length === 0 ? (
                    <p className="mb-0" style={{ color: 'var(--text-muted)', fontSize: '0.85rem', textAlign: 'center', padding: '0.75rem 0' }}>
                      Todo en orden. No hay incidencias.
                    </p>
                  ) : (
                    <div className="d-flex flex-column gap-2">
                      {pendingReservations.length > 0 && (
                        <div className="exec-attention-item" onClick={() => navigate('/reservations')}>
                          <div className="exec-attention-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" />
                              <line x1="12" y1="8" x2="12" y2="12" />
                              <line x1="12" y1="16" x2="12.01" y2="16" />
                            </svg>
                          </div>
                          <div className="flex-grow-1">
                            <span className="exec-attention-text">{pendingReservations.length} {pendingReservations.length === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}</span>
                          </div>
                          <span className="exec-attention-badge">{pendingReservations.length}</span>
                        </div>
                      )}
                      {outOfServiceCount > 0 && (
                        <div className="exec-attention-item" onClick={() => navigate('/tables')}>
                          <div className="exec-attention-icon" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="15" y1="9" x2="9" y2="15" />
                              <line x1="9" y1="9" x2="15" y2="15" />
                            </svg>
                          </div>
                          <div className="flex-grow-1">
                            <span className="exec-attention-text">{outOfServiceCount} {outOfServiceCount === 1 ? 'mesa fuera de servicio' : 'mesas fuera de servicio'}</span>
                          </div>
                          <span className="exec-attention-badge" style={{ background: 'var(--danger)', color: '#fff' }}>{outOfServiceCount}</span>
                        </div>
                      )}
                      {urgentReservations.length > 0 && urgentReservations.map((r, idx) => (
                        <div key={r.id || `urg-${idx}`} className="exec-attention-item" onClick={() => navigate('/reservations')}>
                          <div className="exec-attention-icon" style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--primary)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <circle cx="12" cy="12" r="10" />
                              <polyline points="12 6 12 12 16 14" />
                            </svg>
                          </div>
                          <div className="flex-grow-1">
                            <span className="exec-attention-text">Reserva a las {formatTime(r.reservationTime)} — {getCustomerDisplay(r)}</span>
                          </div>
                          <span className="exec-attention-time">Pronto</span>
                        </div>
                      ))}
                      {unassignedTableReservations.length > 0 && (
                        <div className="exec-attention-item" onClick={() => navigate('/reservations')}>
                          <div className="exec-attention-icon" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                              <path d="M9 3v18" />
                            </svg>
                          </div>
                          <div className="flex-grow-1">
                            <span className="exec-attention-text">{unassignedTableReservations.length} {unassignedTableReservations.length === 1 ? 'reserva sin mesa asignada' : 'reservas sin mesa asignada'}</span>
                          </div>
                          <span className="exec-attention-badge" style={{ background: 'var(--warning)', color: '#fff' }}>{unassignedTableReservations.length}</span>
                        </div>
                      )}
                      <div className="exec-attention-actions">
                        {pendingReservations.length > 0 && (
                          <button className="exec-attention-btn" onClick={() => navigate('/reservations')} type="button">
                            Ver solicitudes
                          </button>
                        )}
                        {(outOfServiceCount > 0 || totalTables > 0) && (
                          <button className="exec-attention-btn" onClick={() => navigate('/tables')} type="button">
                            Ir al plano
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Estado de sala (Plano rápido) */}
              <div className="exec-card" style={{ marginBottom: 0 }}>
                <div className="exec-card-header">
                  <h3>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="3" width="7" height="7" />
                      <rect x="14" y="3" width="7" height="7" />
                      <rect x="3" y="14" width="7" height="7" />
                      <rect x="14" y="14" width="7" height="7" />
                    </svg>
                    Estado de sala
                  </h3>
                  <button className="exec-card-action" onClick={() => navigate('/tables')} type="button">
                    Ir al plano de sala
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                </div>
                <div className="exec-card-body">
                  <div className="exec-status-grid">
                    <div className="exec-status-item" onClick={() => navigate('/tables')}>
                      <div className="exec-status-indicator" style={{ background: 'var(--success)' }} />
                      <div className="exec-status-body">
                        <span className="exec-status-value">{availableTablesCount}</span>
                        <span className="exec-status-label">Disponibles</span>
                      </div>
                    </div>
                    <div className="exec-status-item" onClick={() => navigate('/tables')}>
                      <div className="exec-status-indicator" style={{ background: 'var(--warning)' }} />
                      <div className="exec-status-body">
                        <span className="exec-status-value">{reservedTablesCount}</span>
                        <span className="exec-status-label">Reservadas</span>
                      </div>
                    </div>
                    <div className="exec-status-item" onClick={() => navigate('/tables')}>
                      <div className="exec-status-indicator" style={{ background: 'var(--danger)' }} />
                      <div className="exec-status-body">
                        <span className="exec-status-value">{occupiedCount}</span>
                        <span className="exec-status-label">Ocupadas</span>
                      </div>
                    </div>
                    <div className="exec-status-item" onClick={() => navigate('/tables')}>
                      <div className="exec-status-indicator" style={{ background: 'var(--text-muted)' }} />
                      <div className="exec-status-body">
                        <span className="exec-status-value">{outOfServiceCount}</span>
                        <span className="exec-status-label">En mantenimiento</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ═══ ROW 3: Actividad reciente + Indicadores inteligentes ═══════ */}
          <div className="exec-two-col">
            {/* Actividad reciente (compacta, 4 eventos) */}
            <div className="exec-card">
              <div className="exec-card-header">
                <h3>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Actividad reciente
                </h3>
                <button className="exec-card-action" onClick={() => navigate('/reservations')} type="button">
                  Ver historial
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                </button>
              </div>

              <div className="exec-card-body" style={{ padding: 0 }}>
                {recentActivity.length === 0 ? (
                  <div className="exec-empty">
                    <div className="exec-empty-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                    </div>
                    <p>Sin actividad reciente</p>
                  </div>
                ) : (
                  <div className="exec-activity-timeline" style={{ padding: '0.25rem 0' }}>
                    {recentActivity.slice(0, 4).map((ev, idx) => (
                      <div key={idx} className="exec-activity-item">
                        <div className={`exec-activity-icon ${ev.type}`}>
                          {renderActivityIcon(ev.icon)}
                        </div>
                        <div className="exec-activity-content">
                          <span className="exec-activity-label">{ev.label}</span>
                          <span className="exec-activity-detail">{ev.detail}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Indicadores inteligentes (máximo 3) */}
            <div className="exec-card">
              <div className="exec-card-header">
                <h3>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                  </svg>
                  Indicadores
                </h3>
              </div>

              <div className="exec-card-body">
                <div className="exec-insights">
                  {/* Próxima reserva */}
                  <div className="exec-insight">
                    <div className="exec-insight-icon" style={{ background: 'var(--primary-light, rgba(99,102,241,0.12))', color: 'var(--primary)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                    </div>
                    <div className="exec-insight-content">
                      <span className="exec-insight-label">Próxima reserva</span>
                      <span className="exec-insight-value">
                        {nextReservation
                          ? `${formatTime(nextReservation.reservationTime)} — ${getCustomerDisplay(nextReservation)}`
                          : 'Sin reservas confirmadas'}
                      </span>
                      <span className="exec-insight-trend" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        {nextReservation ? nextReservation.reservationDate === todayStr ? 'Hoy' : formatDate(nextReservation.reservationDate) : ''}
                      </span>
                    </div>
                  </div>

                  {/* Hora punta */}
                  <div className="exec-insight">
                    <div className="exec-insight-icon" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
                      </svg>
                    </div>
                    <div className="exec-insight-content">
                      <span className="exec-insight-label">Hora punta de hoy</span>
                      <span className="exec-insight-value">
                        {peakHour
                          ? `${safeText(peakHour.hour)}:00 — ${peakHour.count} ${peakHour.count === 1 ? 'reserva' : 'reservas'}`
                          : 'Sin datos suficientes'}
                      </span>
                    </div>
                  </div>

                  {/* Ocupación prevista */}
                  <div className="exec-insight">
                    <div className="exec-insight-icon" style={{ background: 'rgba(139,92,246,0.12)', color: 'var(--violet, #8b5cf6)' }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="12" y1="20" x2="12" y2="10" />
                        <line x1="18" y1="20" x2="18" y2="4" />
                        <line x1="6" y1="20" x2="6" y2="16" />
                      </svg>
                    </div>
                    <div className="exec-insight-content">
                      <span className="exec-insight-label">Ocupación prevista</span>
                      <span className="exec-insight-value">
                        {forecastedOccupancy}%
                      </span>
                      <span className="exec-insight-trend" style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                        {futureReservations.length} reservas futuras
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
