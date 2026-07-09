import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getReservations } from '../services/reservationService';
import { getCustomers } from '../services/customerService';
import { useAllTables } from '../hooks/useAllTables';
import { useAuth } from '../context/AuthContext';
import { canAccess, PERMISSIONS } from '../config/permissions';
import {
  filterPendingReservations,
  filterTodayConfirmedReservations,
  filterReservationsWithoutTable,
  getLocalTodayString,
} from '../lib/reservationHelpers';

// ═══════════════════════════════════════════════════════════════════════════
//  HELPERS COMPARTIDOS
// ═══════════════════════════════════════════════════════════════════════════

const formatTime = (timeStr) => {
  if (!timeStr) return '—';
  return String(timeStr).substring(0, 5);
};

const getCustomerDisplay = (r) => {
  if (r.customer) {
    const c = r.customer;
    if (c.name) return c.name;
    if (c.firstName || c.lastName) return `${c.firstName || ''} ${c.lastName || ''}`.trim();
  }
  if (r.customerName) return r.customerName;
  return `#${r.customerId || '?'}`;
};

const getTableDisplay = (r, tables) => {
  if (r.diningTable && r.diningTable.tableNumber) return `Mesa ${r.diningTable.tableNumber}`;
  if (r.table && r.table.tableNumber) return `Mesa ${r.table.tableNumber}`;
  if (r.diningTableId) {
    const found = tables.find((t) => t.id === r.diningTableId);
    if (found) return `Mesa ${found.tableNumber}`;
  }
  return 'Sin mesa asignada';
};

const STATUS_LABELS = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  COMPLETED: 'Completada',
  NO_SHOW: 'No presentado',
};

// ─── Helpers de la sección Tendencias (antes en Analytics.jsx) ─────────────

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const getPeriodBounds = (period) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let start, end;

  switch (period) {
    case 'today': {
      start = today;
      end = new Date(today);
      end.setDate(end.getDate() + 1);
      break;
    }
    case 'week': {
      start = new Date(today);
      const dayOfWeek = start.getDay();
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
      start.setDate(start.getDate() - diff);
      end = new Date(start);
      end.setDate(end.getDate() + 7);
      break;
    }
    case 'month':
    default: {
      start = new Date(today.getFullYear(), today.getMonth(), 1);
      end = new Date(today.getFullYear(), today.getMonth() + 1, 1);
      break;
    }
  }

  return { start, end };
};

const getCustomerName = (r) => {
  if (r.customer) {
    const c = r.customer;
    if (c.name) return c.name;
    if (c.firstName || c.lastName) return `${c.firstName || ''} ${c.lastName || ''}`.trim();
  }
  if (r.customerName) return r.customerName;
  return null;
};

const getTableNumber = (r) => {
  if (r.diningTable && r.diningTable.tableNumber) return r.diningTable.tableNumber;
  if (r.table && r.table.tableNumber) return r.table.tableNumber;
  if (r.diningTableId) return `Mesa #${r.diningTableId}`;
  return null;
};

const formatNum = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '0';
  return String(Math.round(n));
};

const formatPercent = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '0%';
  return `${Math.round(n)}%`;
};

const safeText = (value, fallback = '—') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isNaN(value)) return fallback;
  if (typeof value === 'object') return fallback;
  return String(value);
};

const BarChart = ({ data, labelKey, valueKey, barClass = 'analytics-bar-fill' }) => (
  <div className="analytics-chart-bars">
    {data.map((item, idx) => (
      <div key={idx} className="analytics-bar-row">
        <span className="analytics-bar-label">{item[labelKey]}</span>
        <div className="analytics-bar-track">
          <div className={barClass} style={{ width: `${item.percent || 0}%` }} />
        </div>
        <span className="analytics-bar-value">{item[valueKey]}</span>
      </div>
    ))}
    {data.length === 0 && <div className="analytics-empty-chart">Sin datos</div>}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

const Inicio = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canViewTrends = canAccess(user, PERMISSIONS.VIEW_ANALYTICS);

  const { restaurants, tables, loading: tablesLoading, error: tablesError, refetch: refetchTables } = useAllTables();
  const [reservations, setReservations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [partialError, setPartialError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Selectores de la sección Tendencias
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('week');

  const todayStr = getLocalTodayString();

  // ─── Carga de reservas y clientes (las mesas las gestiona useAllTables) ──
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [reservationsRes, customersRes] = await Promise.allSettled([
        getReservations(),
        getCustomers(),
      ]);

      const fetchedReservations =
        reservationsRes.status === 'fulfilled' && Array.isArray(reservationsRes.value)
          ? reservationsRes.value
          : [];
      const fetchedCustomers =
        customersRes.status === 'fulfilled' && Array.isArray(customersRes.value)
          ? customersRes.value
          : [];

      setReservations(fetchedReservations);
      setCustomers(fetchedCustomers);
      await refetchTables();

      if (reservationsRes.status !== 'fulfilled') {
        setPartialError('Algunas fuentes de datos no respondieron. Los datos pueden estar incompletos.');
      } else {
        setPartialError(null);
      }
    } catch (err) {
      setError(err?.message || 'Error al cargar los datos de Inicio.');
    } finally {
      setLoading(false);
      setIsRefreshing(false);
      setLastUpdate(new Date());
    }
  }, [refetchTables]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Refrescar al volver a la pestaña y cada 60s
  useEffect(() => {
    let mounted = true;
    const handleRefresh = () => {
      if (mounted) {
        setIsRefreshing(true);
        fetchData();
      }
    };
    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') handleRefresh();
    });
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setIsRefreshing(true);
        fetchData();
      }
    }, 60000);
    return () => {
      mounted = false;
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
      clearInterval(interval);
    };
  }, [fetchData]);

  // Seleccionar primer restaurante por defecto para Tendencias
  useEffect(() => {
    if (!selectedRestaurantId && restaurants.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelectedRestaurantId(String(restaurants[0].id));
    }
  }, [restaurants, selectedRestaurantId]);

  const safeTables = useMemo(() => (Array.isArray(tables) ? tables : []), [tables]);
  const safeReservations = useMemo(() => (Array.isArray(reservations) ? reservations : []), [reservations]);

  // ═══════════════════════════════════════════════════════════════════════
  //  SECCIÓN OPERATIVA (KPIs, agenda, requiere atención)
  // ═══════════════════════════════════════════════════════════════════════

  const pendingReservations = useMemo(
    () => filterPendingReservations(safeReservations),
    [safeReservations]
  );

  const occupiedCount = safeTables.filter((t) => t.status === 'OCCUPIED').length;
  const reservedTablesCount = safeTables.filter((t) => t.status === 'RESERVED').length;
  const availableTablesCount = safeTables.filter((t) => t.status === 'AVAILABLE').length;
  const outOfServiceCount = safeTables.filter((t) => t.status === 'MAINTENANCE').length;
  const totalTables = safeTables.length;

  const occupiedPercent =
    totalTables > 0 ? Math.round(((occupiedCount + reservedTablesCount) / totalTables) * 100) : 0;
  const highOccupancy = totalTables > 0 && occupiedPercent > 80;
  const noTablesAvailable = totalTables > 0 && availableTablesCount === 0;

  const todayConfirmedReservations = useMemo(
    () => filterTodayConfirmedReservations(safeReservations),
    [safeReservations]
  );

  const nextReservation = useMemo(() => {
    const sorted = [...todayConfirmedReservations]
      .filter((r) => r.status === 'CONFIRMED')
      .sort((a, b) => (a.reservationTime || '').localeCompare(b.reservationTime || ''));
    return sorted[0] || null;
  }, [todayConfirmedReservations]);

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

  const unassignedTableReservations = useMemo(
    () => filterReservationsWithoutTable(safeReservations),
    [safeReservations]
  );

  const renderStatusBadge = (status) => {
    const label = STATUS_LABELS[status] || status || '—';
    const cls = (status || '').toLowerCase();
    return <span className={`badge-status ${cls}`}>{label}</span>;
  };

  const noAttentionItems =
    pendingReservations.length === 0 &&
    outOfServiceCount === 0 &&
    urgentReservations.length === 0 &&
    unassignedTableReservations.length === 0 &&
    !highOccupancy &&
    !noTablesAvailable;

  // ═══════════════════════════════════════════════════════════════════════
  //  SECCIÓN TENDENCIAS (antes Analytics.jsx) — solo se calcula/renderiza
  //  si el usuario tiene permiso VIEW_ANALYTICS.
  // ═══════════════════════════════════════════════════════════════════════

  const filteredReservations = useMemo(() => {
    const { start, end } = getPeriodBounds(selectedPeriod);
    return safeReservations.filter((r) => {
      if (selectedRestaurantId) {
        const rid = r.restaurantId ? String(r.restaurantId) : '';
        if (rid !== selectedRestaurantId) return false;
      }
      const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      if (!rd) return false;
      const d = new Date(rd + 'T00:00:00');
      return d >= start && d < end;
    });
  }, [safeReservations, selectedRestaurantId, selectedPeriod]);

  const metrics = useMemo(() => {
    const total = filteredReservations.length;
    const confirmed = filteredReservations.filter((r) => r.status === 'CONFIRMED').length;
    const cancelled = filteredReservations.filter((r) => r.status === 'CANCELLED').length;
    const pending = filteredReservations.filter((r) => r.status === 'PENDING').length;
    const completed = filteredReservations.filter((r) => r.status === 'COMPLETED').length;
    const cancellationRate = total > 0 ? (cancelled / total) * 100 : 0;

    const newCustomers = Array.isArray(customers)
      ? customers.filter((c) =>
          filteredReservations.some((r) => {
            const cid = r.customerId || r.customer?.id;
            return cid && String(cid) === String(c.id);
          })
        ).length
      : 0;

    const tablesInRestaurant = selectedRestaurantId
      ? safeTables.filter((t) => String(t.restaurantId) === selectedRestaurantId)
      : safeTables;
    const totalTablesForMetrics = tablesInRestaurant.length;
    const occupiedTables = tablesInRestaurant.filter(
      (t) => t.status === 'OCCUPIED' || t.status === 'RESERVED'
    ).length;
    const estimatedOccupancy = totalTablesForMetrics > 0 ? (occupiedTables / totalTablesForMetrics) * 100 : 0;

    return {
      total, confirmed, cancelled, pending, completed,
      cancellationRate, newCustomers, estimatedOccupancy,
      totalTables: totalTablesForMetrics,
    };
  }, [filteredReservations, customers, safeTables, selectedRestaurantId]);

  const reservationsByDay = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    filteredReservations.forEach((r) => {
      const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      if (rd) {
        const d = new Date(rd + 'T00:00:00');
        counts[d.getDay()]++;
      }
    });
    const maxVal = Math.max(...counts, 1);
    return counts.map((count, idx) => ({
      day: DAY_NAMES[idx],
      dayShort: DAY_NAMES_SHORT[idx],
      count,
      percent: maxVal > 0 ? (count / maxVal) * 100 : 0,
    }));
  }, [filteredReservations]);

  const peakHours = useMemo(() => {
    const hourCounts = {};
    filteredReservations.forEach((r) => {
      const time = r.reservationTime ? String(r.reservationTime).substring(0, 5) : '';
      if (time) {
        const hour = time.substring(0, 2);
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      }
    });
    const entries = Object.entries(hourCounts)
      .map(([hour, count]) => ({ hour: `${hour}:00`, hourNum: parseInt(hour, 10), count }))
      .sort((a, b) => a.hourNum - b.hourNum);
    const maxVal = Math.max(...entries.map((e) => e.count), 1);
    return entries.map((e) => ({ ...e, percent: (e.count / maxVal) * 100 }));
  }, [filteredReservations]);

  const topTables = useMemo(() => {
    const tableCounts = {};
    filteredReservations.forEach((r) => {
      const tableId = r.diningTableId;
      if (!tableId) return;
      const tableNum = getTableNumber(r);
      const key = tableNum || `Mesa #${tableId}`;
      if (!tableCounts[key]) tableCounts[key] = { name: key, count: 0, id: tableId };
      tableCounts[key].count++;
    });
    return Object.values(tableCounts).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filteredReservations]);

  const topCustomers = useMemo(() => {
    const customerCounts = {};
    filteredReservations.forEach((r) => {
      const cId = r.customerId || r.customer?.id;
      if (!cId) return;
      const name = getCustomerName(r) || `Cliente #${cId}`;
      if (!customerCounts[cId]) customerCounts[cId] = { name, count: 0, id: cId };
      customerCounts[cId].count++;
      const betterName = getCustomerName(r);
      if (betterName) customerCounts[cId].name = betterName;
    });
    return Object.values(customerCounts).sort((a, b) => b.count - a.count).slice(0, 5);
  }, [filteredReservations]);

  const insights = useMemo(() => {
    const list = [];
    const maxDay = [...reservationsByDay].sort((a, b) => b.count - a.count)[0];
    if (maxDay && maxDay.count > 0) {
      const minDay = [...reservationsByDay].filter((d) => d.count > 0).sort((a, b) => a.count - b.count)[0];
      if (maxDay.count > (minDay?.count || 0)) {
        list.push({ icon: '📈', text: `El día con más reservas es el ${maxDay.day} (${maxDay.count} reservas).` });
      } else {
        list.push({ icon: '📊', text: 'La actividad es constante todos los días de la semana.' });
      }
    }
    if (peakHours.length > 0) {
      const maxHour = peakHours.reduce((a, b) => (a.count > b.count ? a : b), peakHours[0]);
      if (maxHour && maxHour.count >= 2) {
        const hourInt = parseInt(maxHour.hour, 10);
        const nextHour = hourInt + 1;
        list.push({
          icon: '⏰',
          text: `La hora punta se concentra entre las ${String(hourInt).padStart(2, '0')}:00 y las ${String(nextHour).padStart(2, '0')}:00 (${maxHour.count} reservas).`,
        });
      }
    }
    if (metrics.total > 0) {
      if (metrics.cancellationRate < 10) {
        list.push({ icon: '✅', text: `La tasa de cancelación es baja (${formatPercent(metrics.cancellationRate)}). Los clientes cumplen con sus reservas.` });
      } else if (metrics.cancellationRate < 25) {
        list.push({ icon: '⚠️', text: `La tasa de cancelación es del ${formatPercent(metrics.cancellationRate)}. Considera recordar las reservas a los clientes.` });
      } else {
        list.push({ icon: '🔴', text: `La tasa de cancelación es alta (${formatPercent(metrics.cancellationRate)}). Revisa tus políticas de cancelación.` });
      }
    }
    if (topTables.length > 0) {
      list.push({ icon: '🪑', text: `La ${topTables[0].name} es la más solicitada con ${topTables[0].count} reservas.` });
    }
    if (topCustomers.length > 0) {
      list.push({ icon: '⭐', text: `${topCustomers[0].name} es el cliente más frecuente con ${topCustomers[0].count} visitas en este periodo.` });
    }
    if (metrics.estimatedOccupancy > 0) {
      if (metrics.estimatedOccupancy > 80) {
        list.push({ icon: '📊', text: `La ocupación estimada es alta (${formatPercent(metrics.estimatedOccupancy)}). Considera expandir tu capacidad.` });
      } else if (metrics.estimatedOccupancy < 30) {
        list.push({ icon: '📊', text: `La ocupación estimada es baja (${formatPercent(metrics.estimatedOccupancy)}). Podrías lanzar promociones.` });
      }
    }
    if (metrics.total === 0) {
      list.push({ icon: 'ℹ️', text: 'No hay suficientes datos para generar insights en este periodo.' });
    }
    return list;
  }, [reservationsByDay, peakHours, metrics, topTables, topCustomers]);

  const trendsNoData = canViewTrends && !loading && !error && filteredReservations.length === 0;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="exec-dashboard">
      {/* ═══ HEADER ═══ */}
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
            onClick={() => { setIsRefreshing(true); fetchData(); }}
            type="button"
            title="Actualizar datos"
            aria-label="Actualizar datos de Inicio"
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

      {/* ═══ ALERTAS ═══ */}
      {(error || tablesError) && (
        <div className="exec-alert exec-alert-error" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span className="flex-grow-1">{error || tablesError}</span>
          <button className="exec-alert-btn" onClick={fetchData} type="button">Reintentar</button>
        </div>
      )}
      {partialError && !error && !tablesError && (
        <div className="exec-alert exec-alert-warning" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
          <span className="flex-grow-1">{partialError}</span>
        </div>
      )}

      {/* ═══ LOADING ═══ */}
      {(loading || tablesLoading) && (
        <div className="exec-loading">
          <div className="spinner-border mb-3" role="status" style={{ width: '2rem', height: '2rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="mb-0" style={{ color: 'var(--text-secondary)' }}>Cargando datos de Inicio...</p>
        </div>
      )}

      {/* ═══ CONTENIDO OPERATIVO ═══ */}
      {!loading && !tablesLoading && (
        <>
          <div className="exec-kpi-grid">
            <div className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver reservas de hoy">
              <div className="exec-kpi-icon" style={{ color: 'var(--info, #06b6d4)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value">{todayConfirmedReservations.length}</span>
                <span className="exec-kpi-label">Reservas hoy</span>
                <span className="exec-kpi-trend">Confirmadas</span>
              </div>
            </div>

            <div className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver solicitudes pendientes">
              <div className="exec-kpi-icon" style={{ color: 'var(--warning)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value">{pendingReservations.length}</span>
                <span className="exec-kpi-label">Solicitudes pendientes</span>
                <span className="exec-kpi-trend">{pendingReservations.length === 1 ? 'Requiere atención' : 'Requieren atención'}</span>
              </div>
            </div>

            <div className="exec-kpi" onClick={() => navigate('/floor-plan')} title="Ver plano de sala">
              <div className="exec-kpi-icon" style={{ color: 'var(--violet, #8b5cf6)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value" style={{ fontSize: '1.75rem' }}>{totalTables > 0 ? `${occupiedPercent}%` : '—'}</span>
                <span className="exec-kpi-label">Estado de sala</span>
                <span className="exec-kpi-trend" style={{ color: occupiedPercent > 75 ? 'var(--danger)' : occupiedPercent > 50 ? 'var(--warning)' : 'var(--success)' }}>
                  {availableTablesCount} disponibles &middot; {reservedTablesCount} reservadas &middot; {occupiedCount} ocupadas
                </span>
              </div>
            </div>

            <div className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver próximas reservas">
              <div className="exec-kpi-icon" style={{ color: 'var(--primary)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-label" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>Próxima reserva</span>
                <span className="exec-kpi-value" style={{ fontSize: '1rem', fontWeight: 600 }}>{nextReservation ? formatTime(nextReservation.reservationTime) : '—'}</span>
                <span className="exec-kpi-trend">{nextReservation ? getCustomerDisplay(nextReservation) : 'Sin reservas confirmadas'}</span>
              </div>
            </div>
          </div>

          <div className="exec-two-col-wide">
            <div className="exec-card agenda-card">
              <div className="exec-card-header">
                <h3>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
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
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>
                    </div>
                    <p>No hay reservas confirmadas para hoy.</p>
                  </div>
                ) : (
                  <div className="exec-upcoming-list">
                    {[...todayConfirmedReservations]
                      .sort((a, b) => (a.reservationTime || '').localeCompare(b.reservationTime || ''))
                      .slice(0, 5)
                      .map((r, idx) => (
                        <div key={r.id || idx} className="exec-upcoming-item" onClick={() => navigate('/reservations')}>
                          <div className="exec-upcoming-time"><span className="exec-upcoming-time-value">{formatTime(r.reservationTime)}</span></div>
                          <div className="exec-upcoming-info">
                            <div className="exec-upcoming-client">{getCustomerDisplay(r)}</div>
                            <div className="exec-upcoming-meta">
                              <span>{r.partySize || '?'} {r.partySize === 1 ? 'persona' : 'personas'}</span>
                              <span className="exec-dot" />
                              <span>{getTableDisplay(r, safeTables)}</span>
                            </div>
                          </div>
                          <div className="exec-upcoming-status">{renderStatusBadge(r.status)}</div>
                        </div>
                      ))}
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

            <div className="exec-card attention-card">
              <div className="exec-card-header">
                <h3>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>
                  Requiere atención
                </h3>
              </div>
              <div className="exec-card-body">
                {noAttentionItems ? (
                  <div className="exec-attention-empty">
                    <div className="exec-attention-empty-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg>
                    </div>
                    <p className="exec-attention-empty-title">Todo en orden</p>
                    <p className="exec-attention-empty-sub">No hay solicitudes pendientes ni incidencias.</p>
                  </div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {pendingReservations.length > 0 && (
                      <div className="exec-attention-item" onClick={() => navigate('/reservations')}>
                        <div className="exec-attention-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">{pendingReservations.length} {pendingReservations.length === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}</span></div>
                        <span className="exec-attention-badge">{pendingReservations.length}</span>
                      </div>
                    )}
                    {unassignedTableReservations.length > 0 && (
                      <div className="exec-attention-item" onClick={() => navigate('/reservations')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(245,158,11,0.12)', color: 'var(--warning)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><path d="M9 3v18" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">{unassignedTableReservations.length} {unassignedTableReservations.length === 1 ? 'reserva sin mesa asignada' : 'reservas sin mesa asignada'}</span></div>
                        <span className="exec-attention-badge" style={{ background: 'var(--warning)', color: '#fff' }}>{unassignedTableReservations.length}</span>
                      </div>
                    )}
                    {outOfServiceCount > 0 && (
                      <div className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">{outOfServiceCount} {outOfServiceCount === 1 ? 'mesa en mantenimiento' : 'mesas en mantenimiento'}</span></div>
                        <span className="exec-attention-badge" style={{ background: 'var(--danger)', color: '#fff' }}>{outOfServiceCount}</span>
                      </div>
                    )}
                    {highOccupancy && (
                      <div className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">Ocupación crítica ({occupiedPercent}%)</span></div>
                        <span className="exec-attention-time">Ahora</span>
                      </div>
                    )}
                    {noTablesAvailable && (
                      <div className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">Sin mesas disponibles</span></div>
                        <span className="exec-attention-time">Ahora</span>
                      </div>
                    )}
                    {urgentReservations.map((r, idx) => (
                      <div key={r.id || `urg-${idx}`} className="exec-attention-item" onClick={() => navigate('/reservations')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(99,102,241,0.12)', color: 'var(--primary)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        </div>
                        <div className="flex-grow-1"><span className="exec-attention-text">Reserva a las {formatTime(r.reservationTime)} &mdash; {getCustomerDisplay(r)}</span></div>
                        <span className="exec-attention-time">Pronto</span>
                      </div>
                    ))}
                    <div className="exec-attention-actions">
                      {(pendingReservations.length > 0 || unassignedTableReservations.length > 0) && (
                        <button className="exec-attention-btn" onClick={() => navigate('/reservations')} type="button">Gestionar solicitudes</button>
                      )}
                      {(outOfServiceCount > 0 || highOccupancy || noTablesAvailable) && (
                        <button className="exec-attention-btn" onClick={() => navigate('/floor-plan')} type="button">Ir al plano</button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ SECCIÓN TENDENCIAS (solo con permiso VIEW_ANALYTICS) ═══ */}
      {canViewTrends && !loading && !tablesLoading && (
        <div className="analytics-page" style={{ marginTop: '1.5rem' }}>
          <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
            <div>
              <h2>Tendencias</h2>
              <p className="page-description">Estadísticas y rendimiento de tu negocio</p>
            </div>
            <div className="d-flex align-items-center gap-3 flex-wrap">
              <div className="analytics-selector-group">
                <label htmlFor="trends-restaurant" className="analytics-selector-label">Restaurante</label>
                <select
                  id="trends-restaurant"
                  className="form-select form-select-sm"
                  value={selectedRestaurantId}
                  onChange={(e) => setSelectedRestaurantId(e.target.value)}
                  aria-label="Seleccionar restaurante"
                  style={{ minWidth: '160px' }}
                >
                  <option value="">Todos los restaurantes</option>
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>{r.name || 'No disponible'}</option>
                  ))}
                </select>
              </div>
              <div className="analytics-selector-group">
                <label htmlFor="trends-period" className="analytics-selector-label">Periodo</label>
                <select
                  id="trends-period"
                  className="form-select form-select-sm"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  aria-label="Seleccionar periodo"
                  style={{ minWidth: '130px' }}
                >
                  <option value="today">Hoy</option>
                  <option value="week">Esta semana</option>
                  <option value="month">Este mes</option>
                </select>
              </div>
            </div>
          </div>

          {trendsNoData && (
            <div className="app-card">
              <div className="empty-state">
                <div className="empty-state-icon">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                </div>
                <h5>Sin datos suficientes para este periodo</h5>
                <p>No hay reservas registradas en el periodo y restaurante seleccionados. Prueba con otro período o restaurante.</p>
              </div>
            </div>
          )}

          {!trendsNoData && filteredReservations.length > 0 && (
            <>
              <div className="analytics-kpi-grid">
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon primary"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatNum(metrics.total)}</span><span className="analytics-kpi-label">Reservas totales</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon success"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatNum(metrics.confirmed)}</span><span className="analytics-kpi-label">Confirmadas</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon danger"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatNum(metrics.cancelled)}</span><span className="analytics-kpi-label">Canceladas</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon warning"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatPercent(metrics.cancellationRate)}</span><span className="analytics-kpi-label">Tasa cancelación</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon cyan"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatNum(metrics.newCustomers)}</span><span className="analytics-kpi-label">Clientes nuevos</span></div>
                </div>
                <div className="analytics-kpi-card">
                  <div className="analytics-kpi-icon purple"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="20" x2="12" y2="10" /><line x1="18" y1="20" x2="18" y2="4" /><line x1="6" y1="20" x2="6" y2="16" /></svg></div>
                  <div className="analytics-kpi-body"><span className="analytics-kpi-value">{formatPercent(metrics.estimatedOccupancy)}</span><span className="analytics-kpi-label">Ocupación estimada</span></div>
                </div>
              </div>

              <div className="analytics-two-col">
                <div className="analytics-card">
                  <div className="analytics-card-header"><h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>Reservas por día</h3></div>
                  <div className="analytics-card-body"><BarChart data={reservationsByDay} labelKey="dayShort" valueKey="count" barClass="analytics-bar-fill primary" /></div>
                </div>
                <div className="analytics-card">
                  <div className="analytics-card-header"><h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>Horas punta</h3></div>
                  <div className="analytics-card-body"><BarChart data={peakHours} labelKey="hour" valueKey="count" barClass="analytics-bar-fill warning" /></div>
                </div>
              </div>

              <div className="analytics-two-col">
                <div className="analytics-card">
                  <div className="analytics-card-header"><h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" /></svg>Mesas más utilizadas</h3></div>
                  <div className="analytics-card-body">
                    {topTables.length === 0 ? (
                      <div className="analytics-empty-state">Sin datos suficientes</div>
                    ) : (
                      <div className="analytics-ranking">
                        {topTables.map((t, idx) => (
                          <div key={t.id || idx} className="analytics-ranking-item">
                            <span className="analytics-ranking-pos">{idx + 1}</span>
                            <div className="analytics-ranking-info">
                              <span className="analytics-ranking-name">{safeText(t.name)}</span>
                              <span className="analytics-ranking-count">{t.count} reserva{t.count !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="analytics-ranking-bar">
                              <div className="analytics-ranking-fill" style={{ width: `${(t.count / topTables[0].count) * 100}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
                <div className="analytics-card">
                  <div className="analytics-card-header"><h3><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>Clientes recurrentes</h3></div>
                  <div className="analytics-card-body">
                    {topCustomers.length === 0 ? (
                      <div className="analytics-empty-state">Sin datos suficientes</div>
                    ) : (
                      <div className="analytics-ranking">
                        {topCustomers.map((c, idx) => (
                          <div key={c.id || idx} className="analytics-ranking-item">
                            <span className="analytics-ranking-pos">{idx + 1}</span>
                            <div className="analytics-ranking-info">
                              <span className="analytics-ranking-name">{safeText(c.name)}</span>
                              <span className="analytics-ranking-count">{c.count} visita{c.count !== 1 ? 's' : ''}</span>
                            </div>
                            <div className="analytics-ranking-bar">
                              <div className="analytics-ranking-fill customer" style={{ width: `${(c.count / topCustomers[0].count) * 100}%` }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="analytics-card">
                <div className="analytics-card-header">
                  <h3>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>
                    Insights inteligentes
                  </h3>
                </div>
                <div className="analytics-card-body">
                  {insights.length === 0 ? (
                    <div className="analytics-empty-state">Sin datos suficientes para generar insights</div>
                  ) : (
                    <div className="analytics-insights">
                      {insights.map((insight, idx) => (
                        <div key={idx} className="analytics-insight-item">
                          <span className="analytics-insight-icon">{insight.icon}</span>
                          <span className="analytics-insight-text">{insight.text}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Inicio;
