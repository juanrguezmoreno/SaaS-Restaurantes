import { useState, useEffect, useCallback, useMemo } from 'react';
import { getRestaurants } from '../services/restaurantService';
import { getReservations } from '../services/reservationService';
import { getCustomers } from '../services/customerService';
import api from '../api/axios';

// ═══════════════════════════════════════════════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

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

const safeText = (value, fallback = '—') => {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' && Number.isNaN(value)) return fallback;
  if (typeof value === 'object') return fallback;
  return String(value);
};

const DAY_NAMES = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'];
const DAY_NAMES_SHORT = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

/**
 * Obtiene los límites del periodo seleccionado.
 */
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
      const dayOfWeek = start.getDay(); // 0=Sun
      const diff = dayOfWeek === 0 ? 6 : dayOfWeek - 1; // Monday as first day
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

/**
 * Obtiene el nombre del cliente desde una reserva.
 */
const getCustomerName = (r) => {
  if (r.customer) {
    const c = r.customer;
    if (c.name) return c.name;
    if (c.firstName || c.lastName) return `${c.firstName || ''} ${c.lastName || ''}`.trim();
  }
  if (r.customerName) return r.customerName;
  return null;
};

/**
 * Obtiene el número de mesa desde una reserva.
 */
const getTableNumber = (r) => {
  if (r.diningTable && r.diningTable.tableNumber) return r.diningTable.tableNumber;
  if (r.table && r.table.tableNumber) return r.table.tableNumber;
  if (r.diningTableId) return `Mesa #${r.diningTableId}`;
  return null;
};

/**
 * Formatea un número como entero legible.
 */
const formatNum = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '0';
  return String(Math.round(n));
};

/**
 * Formatea un porcentaje.
 */
const formatPercent = (n) => {
  if (n === null || n === undefined || Number.isNaN(n)) return '0%';
  return `${Math.round(n)}%`;
};

// ═══════════════════════════════════════════════════════════════════════════════
//  BAR CHART (componente reutilizable, fuera del principal)
// ═══════════════════════════════════════════════════════════════════════════════

const BarChart = ({ data, labelKey, valueKey, barClass = 'analytics-bar-fill' }) => (
  <div className="analytics-chart-bars">
    {data.map((item, idx) => (
      <div key={idx} className="analytics-bar-row">
        <span className="analytics-bar-label">{item[labelKey]}</span>
        <div className="analytics-bar-track">
          <div
            className={barClass}
            style={{ width: `${item.percent || 0}%` }}
          />
        </div>
        <span className="analytics-bar-value">{item[valueKey]}</span>
      </div>
    ))}
    {data.length === 0 && (
      <div className="analytics-empty-chart">Sin datos</div>
    )}
  </div>
);

// ═══════════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

const Analytics = () => {
  // ─── Estados ──────────────────────────────────────────────────────────────
  const [restaurants, setRestaurants] = useState([]);
  const [allReservations, setAllReservations] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Selectores
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('');
  const [selectedPeriod, setSelectedPeriod] = useState('week');

  // ─── Carga de datos ──────────────────────────────────────────────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [restaurantsRes, reservationsRes, customersRes] = await Promise.allSettled([
        getRestaurants(),
        getReservations(),
        getCustomers(),
      ]);

      let fetchedRestaurants = [];
      let fetchedReservations = [];
      let fetchedCustomers = [];
      let fetchedTables = [];

      if (restaurantsRes.status === 'fulfilled' && Array.isArray(restaurantsRes.value)) {
        fetchedRestaurants = restaurantsRes.value;
      }

      if (reservationsRes.status === 'fulfilled' && Array.isArray(reservationsRes.value)) {
        fetchedReservations = reservationsRes.value;
      }

      if (customersRes.status === 'fulfilled' && Array.isArray(customersRes.value)) {
        fetchedCustomers = customersRes.value;
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

      setRestaurants(fetchedRestaurants);
      setAllReservations(fetchedReservations);
      setCustomers(fetchedCustomers);
      setTables(fetchedTables);

      // Seleccionar primer restaurante por defecto si hay
      if (!selectedRestaurantId && fetchedRestaurants.length > 0) {
        setSelectedRestaurantId(String(fetchedRestaurants[0].id));
      }
    } catch (err) {
      setError(err?.message || 'Error al cargar datos de analítica.');
    } finally {
      setLoading(false);
    }
  }, [selectedRestaurantId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Reservas filtradas ──────────────────────────────────────────────────
  const filteredReservations = useMemo(() => {
    const safe = Array.isArray(allReservations) ? allReservations : [];
    const { start, end } = getPeriodBounds(selectedPeriod);

    return safe.filter((r) => {
      // Filtro por restaurante
      if (selectedRestaurantId) {
        const rid = r.restaurantId ? String(r.restaurantId) : '';
        if (rid !== selectedRestaurantId) return false;
      }

      // Filtro por fecha
      const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      if (!rd) return false;
      const d = new Date(rd + 'T00:00:00');
      return d >= start && d < end;
    });
  }, [allReservations, selectedRestaurantId, selectedPeriod]);

  // ─── Métricas calculadas ─────────────────────────────────────────────────
  const metrics = useMemo(() => {
    const total = filteredReservations.length;
    const confirmed = filteredReservations.filter((r) => r.status === 'CONFIRMED').length;
    const cancelled = filteredReservations.filter((r) => r.status === 'CANCELLED').length;
    const pending = filteredReservations.filter((r) => r.status === 'PENDING').length;
    const completed = filteredReservations.filter((r) => r.status === 'COMPLETED').length;
    const cancellationRate = total > 0 ? (cancelled / total) * 100 : 0;

    // Clientes nuevos en el periodo
    const newCustomers = Array.isArray(customers)
      ? customers.filter((c) => {
          // Si no tenemos createdAt, usamos un proxy: clientes con id alto ≈ nuevos
          // También filtramos los que aparecen en reservas del periodo
          return filteredReservations.some((r) => {
            const cid = r.customerId || r.customer?.id;
            return cid && String(cid) === String(c.id);
          });
        }).length
      : 0;

    // Ocupación estimada: mesas ocupadas o reservadas / total mesas
    const safeTables = Array.isArray(tables) ? tables : [];
    const tablesInRestaurant = selectedRestaurantId
      ? safeTables.filter((t) => String(t.restaurantId) === selectedRestaurantId)
      : safeTables;
    const totalTables = tablesInRestaurant.length;
    const occupiedTables = tablesInRestaurant.filter((t) => t.status === 'OCCUPIED' || t.status === 'RESERVED').length;
    const estimatedOccupancy = totalTables > 0 ? (occupiedTables / totalTables) * 100 : 0;

    return {
      total,
      confirmed,
      cancelled,
      pending,
      completed,
      cancellationRate,
      newCustomers,
      estimatedOccupancy,
      totalTables,
    };
  }, [filteredReservations, customers, tables, selectedRestaurantId]);

  // ─── Reservas por día de la semana ───────────────────────────────────────
  const reservationsByDay = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]; // Dom, Lun, Mar, Mié, Jue, Vie, Sáb

    filteredReservations.forEach((r) => {
      const rd = r.reservationDate ? String(r.reservationDate).substring(0, 10) : '';
      if (rd) {
        const d = new Date(rd + 'T00:00:00');
        const dayOfWeek = d.getDay(); // 0=Sun
        counts[dayOfWeek]++;
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

  // ─── Horas punta ─────────────────────────────────────────────────────────
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
      .map(([hour, count]) => ({
        hour: `${hour}:00`,
        hourNum: parseInt(hour, 10),
        count,
      }))
      .sort((a, b) => a.hourNum - b.hourNum);

    const maxVal = Math.max(...entries.map((e) => e.count), 1);
    return entries.map((e) => ({
      ...e,
      percent: (e.count / maxVal) * 100,
    }));
  }, [filteredReservations]);

  // ─── Top 5 mesas más usadas ──────────────────────────────────────────────
  const topTables = useMemo(() => {
    const tableCounts = {};

    filteredReservations.forEach((r) => {
      const tableId = r.diningTableId;
      if (!tableId) return;
      const tableNum = getTableNumber(r);
      const key = tableNum || `Mesa #${tableId}`;
      if (!tableCounts[key]) {
        tableCounts[key] = { name: key, count: 0, id: tableId };
      }
      tableCounts[key].count++;
    });

    return Object.values(tableCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredReservations]);

  // ─── Top 5 clientes recurrentes ──────────────────────────────────────────
  const topCustomers = useMemo(() => {
    const customerCounts = {};

    filteredReservations.forEach((r) => {
      const cId = r.customerId || r.customer?.id;
      if (!cId) return;
      const name = getCustomerName(r) || `Cliente #${cId}`;
      if (!customerCounts[cId]) {
        customerCounts[cId] = { name, count: 0, id: cId };
      }
      customerCounts[cId].count++;
      // Actualizar nombre si ahora tenemos mejor info
      const betterName = getCustomerName(r);
      if (betterName) customerCounts[cId].name = betterName;
    });

    return Object.values(customerCounts)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredReservations]);

  // ─── Insights inteligentes ───────────────────────────────────────────────
  const insights = useMemo(() => {
    const list = [];

    // Día con más reservas
    const maxDay = [...reservationsByDay].sort((a, b) => b.count - a.count)[0];
    if (maxDay && maxDay.count > 0) {
      const minDay = [...reservationsByDay].filter((d) => d.count > 0).sort((a, b) => a.count - b.count)[0];
      if (maxDay.count > (minDay?.count || 0)) {
        list.push({
          icon: '📈',
          text: `El día con más reservas es el ${maxDay.day} (${maxDay.count} reservas).`,
        });
      } else {
        list.push({
          icon: '📊',
          text: `La actividad es constante todos los días de la semana.`,
        });
      }
    }

    // Hora punta
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

    // Tasa de cancelación
    if (metrics.total > 0) {
      if (metrics.cancellationRate < 10) {
        list.push({
          icon: '✅',
          text: `La tasa de cancelación es baja (${formatPercent(metrics.cancellationRate)}). Los clientes cumplen con sus reservas.`,
        });
      } else if (metrics.cancellationRate < 25) {
        list.push({
          icon: '⚠️',
          text: `La tasa de cancelación es del ${formatPercent(metrics.cancellationRate)}. Considera recordar las reservas a los clientes.`,
        });
      } else {
        list.push({
          icon: '🔴',
          text: `La tasa de cancelación es alta (${formatPercent(metrics.cancellationRate)}). Revisa tus políticas de cancelación.`,
        });
      }
    }

    // Mesa más solicitada
    if (topTables.length > 0) {
      const topTable = topTables[0];
      list.push({
        icon: '🪑',
        text: `La ${topTable.name} es la más solicitada con ${topTable.count} reservas.`,
      });
    }

    // Cliente más frecuente
    if (topCustomers.length > 0) {
      const topCustomer = topCustomers[0];
      list.push({
        icon: '⭐',
        text: `${topCustomer.name} es el cliente más frecuente con ${topCustomer.count} visitas en este periodo.`,
      });
    }

    // Ocupación
    if (metrics.estimatedOccupancy > 0) {
      if (metrics.estimatedOccupancy > 80) {
        list.push({
          icon: '📊',
          text: `La ocupación estimada es alta (${formatPercent(metrics.estimatedOccupancy)}). Considera expandir tu capacidad.`,
        });
      } else if (metrics.estimatedOccupancy < 30) {
        list.push({
          icon: '📊',
          text: `La ocupación estimada es baja (${formatPercent(metrics.estimatedOccupancy)}). Podrías lanzar promociones.`,
        });
      }
    }

    // Reservas totales
    if (metrics.total === 0) {
      list.push({
        icon: 'ℹ️',
        text: 'No hay suficientes datos para generar insights en este periodo.',
      });
    }

    return list;
  }, [reservationsByDay, peakHours, metrics, topTables, topCustomers]);

  // ─── Safe text helpers ───────────────────────────────────────────────────
  const noData = !loading && !error && filteredReservations.length === 0;

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div className="analytics-page">
      {/* ═══ Header ════════════════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <h1>Analítica</h1>
          <p className="page-description">
            Estadísticas y rendimiento de tu negocio
          </p>
        </div>

        <div className="d-flex align-items-center gap-3 flex-wrap">
          {/* Selector de restaurante */}
          <div className="analytics-selector-group">
            <label htmlFor="analytics-restaurant" className="analytics-selector-label">
              Restaurante
            </label>
            <select
              id="analytics-restaurant"
              className="form-select form-select-sm"
              value={selectedRestaurantId}
              onChange={(e) => setSelectedRestaurantId(e.target.value)}
              aria-label="Seleccionar restaurante"
              style={{ minWidth: '160px' }}
            >
              <option value="">Todos los restaurantes</option>
              {Array.isArray(restaurants) && restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'No disponible'}
                </option>
              ))}
            </select>
          </div>

          {/* Selector de periodo */}
          <div className="analytics-selector-group">
            <label htmlFor="analytics-period" className="analytics-selector-label">
              Periodo
            </label>
            <select
              id="analytics-period"
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

      {/* ═══ Loading ══════════════════════════════════════════════════════ */}
      {loading && (
        <div className="loading-state">
          <div className="spinner-border mb-3" role="status" style={{ width: '2.25rem', height: '2.25rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="text-muted mb-0">Cargando datos de analítica...</p>
        </div>
      )}

      {/* ═══ Error ════════════════════════════════════════════════════════ */}
      {error && !loading && (
        <div className="exec-alert exec-alert-error" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span className="flex-grow-1">{error}</span>
          <button className="exec-alert-btn" onClick={fetchData} type="button">Reintentar</button>
        </div>
      )}

      {/* ═══ Empty state ═════════════════════════════════════════════════ */}
      {noData && (
        <div className="app-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
            </div>
            <h5>Sin datos suficientes para este periodo</h5>
            <p>No hay reservas registradas en el periodo y restaurante seleccionados. Prueba con otro período o restaurante.</p>
          </div>
        </div>
      )}

      {/* ═══ Contenido ═══════════════════════════════════════════════════ */}
      {!loading && !error && filteredReservations.length > 0 && (
        <>
          {/* ─── KPI Cards ─────────────────────────────────────────────── */}
          <div className="analytics-kpi-grid">
            <div className="analytics-kpi-card">
              <div className="analytics-kpi-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="analytics-kpi-body">
                <span className="analytics-kpi-value">{formatNum(metrics.total)}</span>
                <span className="analytics-kpi-label">Reservas totales</span>
              </div>
            </div>

            <div className="analytics-kpi-card">
              <div className="analytics-kpi-icon success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="analytics-kpi-body">
                <span className="analytics-kpi-value">{formatNum(metrics.confirmed)}</span>
                <span className="analytics-kpi-label">Confirmadas</span>
              </div>
            </div>

            <div className="analytics-kpi-card">
              <div className="analytics-kpi-icon danger">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div className="analytics-kpi-body">
                <span className="analytics-kpi-value">{formatNum(metrics.cancelled)}</span>
                <span className="analytics-kpi-label">Canceladas</span>
              </div>
            </div>

            <div className="analytics-kpi-card">
              <div className="analytics-kpi-icon warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                  <line x1="12" y1="9" x2="12" y2="13" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
              </div>
              <div className="analytics-kpi-body">
                <span className="analytics-kpi-value">{formatPercent(metrics.cancellationRate)}</span>
                <span className="analytics-kpi-label">Tasa cancelación</span>
              </div>
            </div>

            <div className="analytics-kpi-card">
              <div className="analytics-kpi-icon cyan">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="analytics-kpi-body">
                <span className="analytics-kpi-value">{formatNum(metrics.newCustomers)}</span>
                <span className="analytics-kpi-label">Clientes nuevos</span>
              </div>
            </div>

            <div className="analytics-kpi-card">
              <div className="analytics-kpi-icon purple">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="12" y1="20" x2="12" y2="10" />
                  <line x1="18" y1="20" x2="18" y2="4" />
                  <line x1="6" y1="20" x2="6" y2="16" />
                </svg>
              </div>
              <div className="analytics-kpi-body">
                <span className="analytics-kpi-value">{formatPercent(metrics.estimatedOccupancy)}</span>
                <span className="analytics-kpi-label">Ocupación estimada</span>
              </div>
            </div>
          </div>

          {/* ─── Gráficos 2-columnas ─────────────────────────────────────── */}
          <div className="analytics-two-col">
            {/* Reservas por día */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <h3>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                    <line x1="16" y1="2" x2="16" y2="6" />
                    <line x1="8" y1="2" x2="8" y2="6" />
                    <line x1="3" y1="10" x2="21" y2="10" />
                  </svg>
                  Reservas por día
                </h3>
              </div>
              <div className="analytics-card-body">
                <BarChart
                  data={reservationsByDay}
                  labelKey="dayShort"
                  valueKey="count"
                  barClass="analytics-bar-fill primary"
                />
              </div>
            </div>

            {/* Horas punta */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <h3>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <polyline points="12 6 12 12 16 14" />
                  </svg>
                  Horas punta
                </h3>
              </div>
              <div className="analytics-card-body">
                <BarChart
                  data={peakHours}
                  labelKey="hour"
                  valueKey="count"
                  barClass="analytics-bar-fill warning"
                />
              </div>
            </div>
          </div>

          {/* ─── Rankings 2-columnas ─────────────────────────────────────── */}
          <div className="analytics-two-col">
            {/* Mesas más usadas */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <h3>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" />
                    <rect x="14" y="3" width="7" height="7" />
                    <rect x="3" y="14" width="7" height="7" />
                    <rect x="14" y="14" width="7" height="7" />
                  </svg>
                  Mesas más utilizadas
                </h3>
              </div>
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
                          <div
                            className="analytics-ranking-fill"
                            style={{
                              width: `${topTables.length > 0 ? (t.count / topTables[0].count) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Clientes recurrentes */}
            <div className="analytics-card">
              <div className="analytics-card-header">
                <h3>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                  Clientes recurrentes
                </h3>
              </div>
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
                          <div
                            className="analytics-ranking-fill customer"
                            style={{
                              width: `${topCustomers.length > 0 ? (c.count / topCustomers[0].count) * 100 : 0}%`,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* ─── Insights ────────────────────────────────────────────────── */}
          <div className="analytics-card">
            <div className="analytics-card-header">
              <h3>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="3" />
                  <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
                </svg>
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
  );
};

export default Analytics;
