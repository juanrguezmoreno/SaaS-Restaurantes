import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getReservations } from '../services/reservationService';
import { useAllTables } from '../hooks/useAllTables';
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

// ═══════════════════════════════════════════════════════════════════════════
//  COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════

const Inicio = () => {
  const navigate = useNavigate();

  const { tables, loading: tablesLoading, error: tablesError, refetch: refetchTables } = useAllTables({ auto: false });
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [partialError, setPartialError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const todayStr = getLocalTodayString();

  // ─── Carga de reservas (las mesas las gestiona useAllTables) ────────────
  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const [reservationsRes] = await Promise.allSettled([getReservations()]);

      const fetchedReservations =
        reservationsRes.status === 'fulfilled' && Array.isArray(reservationsRes.value)
          ? reservationsRes.value
          : [];

      setReservations(fetchedReservations);
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
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') handleRefresh();
    };
    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const interval = setInterval(() => {
      if (document.visibilityState === 'visible') {
        setIsRefreshing(true);
        fetchData();
      }
    }, 60000);
    return () => {
      mounted = false;
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      clearInterval(interval);
    };
  }, [fetchData]);

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

      {/* ═══ CARGA ═══
          Esqueleto con la forma de las tarjetas reales: reserva el espacio y
          adelanta la estructura, en vez de un spinner que no dice nada. */}
      {(loading || tablesLoading) && (
        <div aria-busy="true" aria-live="polite">
          <span className="visually-hidden">Cargando el resumen del día…</span>
          <div className="exec-kpi-grid">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="exec-kpi" aria-hidden="true">
                <span className="exec-kpi-icon skeleton" />
                <span className="exec-kpi-body">
                  <span className="skeleton skeleton-line skeleton-line-value" />
                  <span className="skeleton skeleton-line skeleton-line-label" />
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ═══ CONTENIDO OPERATIVO ═══ */}
      {!loading && !tablesLoading && (
        <>
          <div className="exec-kpi-grid">
            <button type="button" className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver reservas de hoy">
              <span className="exec-kpi-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </span>
              <span className="exec-kpi-body">
                <span className="exec-kpi-value">{todayConfirmedReservations.length}</span>
                <span className="exec-kpi-label">Reservas hoy</span>
                <span className="exec-kpi-trend">Confirmadas</span>
              </span>
            </button>

            <button type="button" className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver solicitudes pendientes">
              <span className="exec-kpi-icon warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </span>
              <span className="exec-kpi-body">
                <span className="exec-kpi-value">{pendingReservations.length}</span>
                <span className="exec-kpi-label">Solicitudes pendientes</span>
                <span className="exec-kpi-trend">{pendingReservations.length === 1 ? 'Requiere atención' : 'Requieren atención'}</span>
              </span>
            </button>

            <button type="button" className="exec-kpi" onClick={() => navigate('/floor-plan')} title="Ver plano de sala">
              <span className="exec-kpi-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
              </span>
              <span className="exec-kpi-body">
                <span className="exec-kpi-value">{totalTables > 0 ? `${occupiedPercent}%` : '—'}</span>
                <span className="exec-kpi-label">Estado de sala</span>
                <span className="exec-kpi-trend" style={{ color: occupiedPercent > 75 ? 'var(--danger)' : occupiedPercent > 50 ? 'var(--warning)' : 'var(--success)' }}>
                  {availableTablesCount} disponibles &middot; {reservedTablesCount} reservadas &middot; {occupiedCount} ocupadas
                </span>
              </span>
            </button>

            <button type="button" className="exec-kpi" onClick={() => navigate('/reservations')} title="Ver próximas reservas">
              <span className="exec-kpi-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
              </span>
              <span className="exec-kpi-body">
                <span className="exec-kpi-value">{nextReservation ? formatTime(nextReservation.reservationTime) : '—'}</span>
                <span className="exec-kpi-label">Próxima reserva</span>
                <span className="exec-kpi-trend">{nextReservation ? getCustomerDisplay(nextReservation) : 'Sin reservas confirmadas'}</span>
              </span>
            </button>
          </div>

          <div className="exec-two-col-wide exec-main-zone">
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
                        <button type="button" key={r.id || idx} className="exec-upcoming-item" onClick={() => navigate('/reservations')}>
                          <span className="exec-upcoming-time"><span className="exec-upcoming-time-value">{formatTime(r.reservationTime)}</span></span>
                          <span className="exec-upcoming-info">
                            <span className="exec-upcoming-client">{getCustomerDisplay(r)}</span>
                            <span className="exec-upcoming-meta">
                              <span>{r.partySize || '?'} {r.partySize === 1 ? 'persona' : 'personas'}</span>
                              <span className="exec-dot" />
                              <span>{getTableDisplay(r, safeTables)}</span>
                            </span>
                          </span>
                          <span className="exec-upcoming-status">{renderStatusBadge(r.status)}</span>
                        </button>
                      ))}
                  </div>
                )}
                {todayConfirmedReservations.length > 5 && (
                  <button type="button" className="exec-card-footer-link" onClick={() => navigate('/reservations')}>
                    Ver todas las {todayConfirmedReservations.length} reservas de hoy
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
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
                      <button type="button" className="exec-attention-item" onClick={() => navigate('/reservations')}>
                        <span className="exec-attention-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                        </span>
                        <span className="flex-grow-1"><span className="exec-attention-text">{pendingReservations.length} {pendingReservations.length === 1 ? 'solicitud pendiente' : 'solicitudes pendientes'}</span></span>
                        <span className="exec-attention-badge">{pendingReservations.length}</span>
                      </button>
                    )}
                    {unassignedTableReservations.length > 0 && (
                      <button type="button" className="exec-attention-item" onClick={() => navigate('/reservations')}>
                        <span className="exec-attention-icon" style={{ background: 'var(--warning-light)', color: 'var(--warning)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><path d="M9 3v18" /></svg>
                        </span>
                        <span className="flex-grow-1"><span className="exec-attention-text">{unassignedTableReservations.length} {unassignedTableReservations.length === 1 ? 'reserva sin mesa asignada' : 'reservas sin mesa asignada'}</span></span>
                        <span className="exec-attention-badge" style={{ background: 'var(--warning)', color: '#fff' }}>{unassignedTableReservations.length}</span>
                      </button>
                    )}
                    {outOfServiceCount > 0 && (
                      <button type="button" className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <span className="exec-attention-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" /></svg>
                        </span>
                        <span className="flex-grow-1"><span className="exec-attention-text">{outOfServiceCount} {outOfServiceCount === 1 ? 'mesa en mantenimiento' : 'mesas en mantenimiento'}</span></span>
                        <span className="exec-attention-badge" style={{ background: 'var(--danger)', color: '#fff' }}>{outOfServiceCount}</span>
                      </button>
                    )}
                    {highOccupancy && (
                      <button type="button" className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <span className="exec-attention-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 12h-4l-3 9L9 3l-3 9H2" /></svg>
                        </span>
                        <span className="flex-grow-1"><span className="exec-attention-text">Ocupación crítica ({occupiedPercent}%)</span></span>
                        <span className="exec-attention-time">Ahora</span>
                      </button>
                    )}
                    {noTablesAvailable && (
                      <button type="button" className="exec-attention-item" onClick={() => navigate('/floor-plan')}>
                        <span className="exec-attention-icon" style={{ background: 'var(--danger-light)', color: 'var(--danger)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></svg>
                        </span>
                        <span className="flex-grow-1"><span className="exec-attention-text">Sin mesas disponibles</span></span>
                        <span className="exec-attention-time">Ahora</span>
                      </button>
                    )}
                    {urgentReservations.map((r, idx) => (
                      <button type="button" key={r.id || `urg-${idx}`} className="exec-attention-item" onClick={() => navigate('/reservations')}>
                        <span className="exec-attention-icon" style={{ background: 'var(--primary-light)', color: 'var(--primary)' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>
                        </span>
                        <span className="flex-grow-1"><span className="exec-attention-text">Reserva a las {formatTime(r.reservationTime)} &mdash; {getCustomerDisplay(r)}</span></span>
                        <span className="exec-attention-time">Pronto</span>
                      </button>
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
    </div>
  );
};

export default Inicio;
