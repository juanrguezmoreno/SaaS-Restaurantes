import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../api/axios';
import { getRestaurants } from '../services/restaurantService';
import { getReservations } from '../services/reservationService';
import {
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

// ─── Componente principal ─────────────────────────────────────────────────────
const Dashboard = () => {
  const navigate = useNavigate();

  // Estados de datos
  const [tables, setTables] = useState([]);
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
    let fetchedReservations = [];
    let fetchedTables = [];

    try {
      const [restaurantsRes, reservationsRes] = await Promise.allSettled([
        getRestaurants(),
        getReservations(),
      ]);

      if (restaurantsRes.status === 'fulfilled' && Array.isArray(restaurantsRes.value)) {
        fetchedRestaurants = restaurantsRes.value;
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

      setReservations(fetchedReservations);
      setTables(fetchedTables);

      const succeeded = [
        fetchedReservations.length > 0 || reservationsRes.status === 'fulfilled',
        fetchedTables.length > 0,
      ].filter(Boolean).length;

      if (succeeded < 2 && succeeded > 0) {
        setPartialError('1 de 2 fuentes de datos no respondieron. Los datos pueden estar incompletos.');
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

  // ─── Arrays seguros ──────────────────────────────────────────────────────
  const safeTables = useMemo(() => Array.isArray(tables) ? tables : [], [tables]);
  const safeReservations = useMemo(() => Array.isArray(reservations) ? reservations : [], [reservations]);

  // ═════════════════════════════════════════════════════════════════════════
  //  FILTROS BASE
  // Solicitudes pendientes: PENDING activas (hoy o futuras)
  const pendingReservations = useMemo(() =>
    filterPendingReservations(safeReservations),
    [safeReservations]
  );

  // ═════════════════════════════════════════════════════════════════════════
  //  DATOS OPERATIVOS
  const occupiedCount = safeTables.filter((t) => t.status === 'OCCUPIED').length;
  const reservedTablesCount = safeTables.filter((t) => t.status === 'RESERVED').length;
  const availableTablesCount = safeTables.filter((t) => t.status === 'AVAILABLE').length;
  const outOfServiceCount = safeTables.filter((t) => t.status === 'MAINTENANCE').length;

  const totalTables = safeTables.length;

  const occupiedPercent = totalTables > 0
    ? Math.round(((occupiedCount + reservedTablesCount) / totalTables) * 100)
    : 0;

  // ═════════════════════════════════════════════════════════════════════════
  //  DATOS PARA INICIO
  const todayConfirmedReservations = useMemo(() =>
    filterTodayConfirmedReservations(safeReservations),
    [safeReservations]
  );

  // Próxima reserva: primera CONFIRMED de hoy
  const nextReservation = useMemo(() => {
    const sorted = [...todayConfirmedReservations]
      .filter((r) => r.status === 'CONFIRMED')
      .sort((a, b) => (a.reservationTime || '').localeCompare(b.reservationTime || ''));
    return sorted[0] || null;
  }, [todayConfirmedReservations]);

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

  // Reservas activas sin mesa asignada (para "Requiere atención")
  const unassignedTableReservations = useMemo(() => {
    return filterReservationsWithoutTable(safeReservations);
  }, [safeReservations]);

  // ─── Render helpers ─────────────────────────────────────────────────────────
  const renderStatusBadge = (status) => {
    const label = STATUS_LABELS[status] || status || '—';
    const cls = (status || '').toLowerCase();
    return <span className={`badge-status ${cls}`}>{label}</span>;
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
              : `Resumen operativo del d\u00eda \u2014 ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}`}
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
          <div className="exec-kpi-grid">
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
                <span className="exec-kpi-trend">{pendingReservations.length === 1 ? 'Requiere atenci\u00f3n' : 'Requieren atenci\u00f3n'}</span>
              </div>
            </div>

            {/* Estado de sala / Ocupación actual */}
            <div className="exec-kpi" onClick={() => navigate('/floor-plan')} title="Ver plano de sala">
              <div className="exec-kpi-icon" style={{ color: 'var(--violet, #8b5cf6)' }}>
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 12h-4l-3 9L9 3l-3 9H2" />
                </svg>
              </div>
              <div className="exec-kpi-body">
                <span className="exec-kpi-value" style={{ fontSize: '1.75rem' }}>
                  {totalTables > 0 ? `${occupiedPercent}%` : '—'}
                </span>
                <span className="exec-kpi-label">Estado de sala</span>
                <span className="exec-kpi-trend" style={{ color: occupiedPercent > 75 ? 'var(--danger)' : occupiedPercent > 50 ? 'var(--warning)' : 'var(--success)' }}>
                  {availableTablesCount} disponibles &middot; {reservedTablesCount} reservadas &middot; {occupiedCount} ocupadas
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
                <span className="exec-kpi-label" style={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-muted)', marginBottom: '0.125rem' }}>Pr\u00f3xima reserva</span>
                <span className="exec-kpi-value" style={{ fontSize: '1rem', fontWeight: 600 }}>
                  {nextReservation ? formatTime(nextReservation.reservationTime) : '—'}
                </span>
                <span className="exec-kpi-trend">
                  {nextReservation
                    ? `${getCustomerDisplay(nextReservation)}`
                    : 'Sin reservas confirmadas'}
                </span>
              </div>
            </div>
          </div>

          {/* ═══ ROW 2: Agenda de hoy (60%) + Requiere atención (40%) ═══════ */}
          <div className="exec-two-col-wide">
            {/* ─── IZQUIERDA: Agenda de hoy ──────────────────────────────── */}
            <div className="exec-card agenda-card">
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
                        const tableDisplay = getTableDisplay(r, safeTables);
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
                                <span>{tableDisplay}</span>
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

            {/* ─── DERECHA: Requiere atención ────────────────────────────── */}
            <div className="exec-card attention-card">
              <div className="exec-card-header">
                <h3>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  Requiere atenci&oacute;n
                </h3>
              </div>
              <div className="exec-card-body">
                {pendingReservations.length === 0 && outOfServiceCount === 0 && urgentReservations.length === 0 && unassignedTableReservations.length === 0 ? (
                  <div className="exec-attention-empty">
                    <div className="exec-attention-empty-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    </div>
                    <p className="exec-attention-empty-title">Todo en orden</p>
                    <p className="exec-attention-empty-sub">No hay solicitudes pendientes ni incidencias.</p>
                  </div>
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
                    {outOfServiceCount > 0 && (
                      <div className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <div className="exec-attention-icon" style={{ background: 'rgba(239,68,68,0.12)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="15" y1="9" x2="9" y2="15" />
                            <line x1="9" y1="9" x2="15" y2="15" />
                          </svg>
                        </div>
                        <div className="flex-grow-1">
                          <span className="exec-attention-text">{outOfServiceCount} {outOfServiceCount === 1 ? 'mesa en mantenimiento' : 'mesas en mantenimiento'}</span>
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
                          <span className="exec-attention-text">Reserva a las {formatTime(r.reservationTime)} &mdash; {getCustomerDisplay(r)}</span>
                        </div>
                        <span className="exec-attention-time">Pronto</span>
                      </div>
                    ))}
                    <div className="exec-attention-actions">
                      {(pendingReservations.length > 0 || unassignedTableReservations.length > 0) && (
                        <button className="exec-attention-btn" onClick={() => navigate('/reservations')} type="button">
                          Gestionar solicitudes
                        </button>
                      )}
                      {unassignedTableReservations.length > 0 && (
                        <button className="exec-attention-btn" onClick={() => navigate('/reservations')} type="button">
                          Asignar mesas
                        </button>
                      )}
                      {outOfServiceCount > 0 && (
                        <button className="exec-attention-btn" onClick={() => navigate('/floor-plan')} type="button">
                          Ir al plano
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default Dashboard;
