import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRestaurants } from '../services/restaurantService';
import {
  getTablesByRestaurant,
  updateTableStatus,
  updateTablesLayout,
} from '../services/tableService';
import { canAccess, PERMISSIONS } from '../config/permissions';
import FloorPlanCanvas from '../components/FloorPlanCanvas';

// ─── Mapa de estados de mesa ────────────────────────────────────────────────
const TABLE_STATUS = {
  AVAILABLE: { label: 'Disponible', class: 'available', color: '#22c55e' },
  RESERVED: { label: 'Reservada', class: 'reserved', color: '#f59e0b' },
  OCCUPIED: { label: 'Ocupada', class: 'occupied', color: '#ef4444' },
  MAINTENANCE: { label: 'En mantenimiento', class: 'maintenance', color: '#94a3b8' },
};

const FILTER_OPTIONS = [
  { value: 'ALL', label: 'Todas' },
  { value: 'AVAILABLE', label: 'Libres' },
  { value: 'RESERVED', label: 'Reservadas' },
  { value: 'OCCUPIED', label: 'Ocupadas' },
  { value: 'MAINTENANCE', label: 'Mantenimiento' },
];

// ─── Orden canónico para ubicaciones ────────────────────────────────────────
const ZONE_ORDER = ['Sala', 'Sala principal', 'Interior', 'Terraza', 'Exterior', 'VIP', 'Sin ubicación'];

// ─── Componente principal ───────────────────────────────────────────────────
const FloorPlan = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Estados de datos ──────────────────────────────────────────────────────
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('');
  const [selectedRestaurantName, setSelectedRestaurantName] = useState('');
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState(null);

  // ── Estados de UI ─────────────────────────────────────────────────────────
  const [viewMode, setViewMode] = useState('visual');
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [collapsedZones, setCollapsedZones] = useState(() => new Set());

  // ── Estados del plano interactivo ─────────────────────────────────────────
  const [isEditMode, setIsEditMode] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [toastType, setToastType] = useState('success');
  const toastTimer = useRef(null);

  // Al entrar en edición, guardamos las posiciones originales para poder cancelar
  const originalPositionsRef = useRef({});

  // ── Cargar restaurantes al montar y auto-seleccionar el primero ─────────
  useEffect(() => {
    const loadRestaurants = async () => {
      try {
        const data = await getRestaurants();
        const list = Array.isArray(data) ? data : [];
        setRestaurants(list);
        if (list.length > 0) {
          const first = list[0];
          setSelectedRestaurantId(String(first.id));
          setSelectedRestaurantName(first.name || '');
        }
      } catch {
        setError('Error al cargar los restaurantes.');
      } finally {
        setLoadingRestaurants(false);
      }
    };
    loadRestaurants();
  }, []);

  // ── Cargar mesas al cambiar de restaurante ──────────────────────────────
  useEffect(() => {
    if (!selectedRestaurantId) return;

    let mounted = true;

    const loadTables = async () => {
      setLoading(true);
      setError(null);
      setTables([]);

      try {
        const data = await getTablesByRestaurant(Number(selectedRestaurantId));
        if (mounted) {
          const tableList = Array.isArray(data) ? data : [];
          setTables(tableList);
          // Auto-detectar vista según cantidad de mesas
          setViewMode(tableList.length > 8 ? 'compact' : 'visual');
        }
      } catch {
        if (mounted) {
          setError('Error al cargar las mesas del restaurante.');
          setTables([]);
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    loadTables();

    return () => {
      mounted = false;
    };
  }, [selectedRestaurantId]);

  // ── Manejar cambio de restaurante ───────────────────────────────────────
  const handleRestaurantChange = (e) => {
    const id = e.target.value;
    setSelectedRestaurantId(id);
    const restaurant = restaurants.find((r) => String(r.id) === id);
    setSelectedRestaurantName(restaurant?.name || '');
    setSelectedTable(null);
    setSearchQuery('');
    setFilterStatus('ALL');
  };

  // ── Obtener info de estado de mesa (segura, sin textos técnicos) ────────
  const getStatusInfo = useCallback((status) => {
    if (!status) return TABLE_STATUS.MAINTENANCE;
    return TABLE_STATUS[status] || TABLE_STATUS.MAINTENANCE;
  }, []);

  // ── Filtrar mesas por estado y búsqueda ─────────────────────────────────
  const filteredTables = useMemo(() => {
    let result = tables;

    // Filtro por estado
    if (filterStatus !== 'ALL') {
      result = result.filter((t) => t.status === filterStatus);
    }

    // Filtro por búsqueda
    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      result = result.filter((t) => {
        const numberMatch = (t.tableNumber || '').toLowerCase().includes(q);
        const locationMatch = (t.location || '').toLowerCase().includes(q);
        const statusLabel = getStatusInfo(t.status).label.toLowerCase();
        const statusMatch = statusLabel.includes(q);
        return numberMatch || locationMatch || statusMatch;
      });
    }

    return result;
  }, [tables, filterStatus, searchQuery, getStatusInfo]);

  // ── Agrupar mesas filtradas por ubicación ───────────────────────────────
  const groupedTables = useMemo(() => {
    const groups = {};

    filteredTables.forEach((table) => {
      const location = table.location && table.location.trim() !== ''
        ? table.location.trim()
        : 'Sin ubicación';
      if (!groups[location]) {
        groups[location] = [];
      }
      groups[location].push(table);
    });

    // Ordenar grupos según ZONE_ORDER, el resto va al final
    const sorted = Object.entries(groups).sort(([a], [b]) => {
      const ai = ZONE_ORDER.indexOf(a);
      const bi = ZONE_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    return sorted;
  }, [filteredTables]);

  // ── Resumen de estados ──────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total = tables.length;
    const available = tables.filter((t) => t.status === 'AVAILABLE').length;
    const reserved = tables.filter((t) => t.status === 'RESERVED').length;
    const occupied = tables.filter((t) => t.status === 'OCCUPIED').length;
    const outOfService = tables.filter((t) => t.status === 'MAINTENANCE').length;
    return { total, available, reserved, occupied, outOfService };
  }, [tables]);

  // ── Resumen de estados por zona ─────────────────────────────────────────
  const getZoneSummary = useCallback((zoneTables) => {
    const total = zoneTables.length;
    const available = zoneTables.filter((t) => t.status === 'AVAILABLE').length;
    const reserved = zoneTables.filter((t) => t.status === 'RESERVED').length;
    const occupied = zoneTables.filter((t) => t.status === 'OCCUPIED').length;
    const maintenance = zoneTables.filter((t) => t.status === 'MAINTENANCE').length;
    return { total, available, reserved, occupied, maintenance };
  }, []);

  // ── Cambiar estado de mesa ──────────────────────────────────────────────
  const handleStatusChange = async (table, newStatus) => {
    setStatusUpdating(table.id);
    try {
      await updateTableStatus(table.id, newStatus);
      setTables((prev) =>
        prev.map((t) =>
          t.id === table.id ? { ...t, status: newStatus } : t
        )
      );
      setSelectedTable((prev) =>
        prev && prev.id === table.id ? { ...prev, status: newStatus } : prev
      );
    } catch {
      setError('Error al actualizar el estado de la mesa.');
    } finally {
      setStatusUpdating(null);
    }
  };

  // ── Alternar colapso de zona ────────────────────────────────────────────
  const toggleZoneCollapse = useCallback((zoneName) => {
    setCollapsedZones((prev) => {
      const next = new Set(prev);
      if (next.has(zoneName)) {
        next.delete(zoneName);
      } else {
        next.add(zoneName);
      }
      return next;
    });
  }, []);

  // ── Refs y estados para el plano interactivo ──────────────────────────────
  const canvasSaveRef = useRef(null);
  const [layoutResetKey, setLayoutResetKey] = useState(0);

  /**
   * Muestra un toast temporal con auto-dismiss.
   */
  const showToast = useCallback((message, type = 'success') => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToastMessage(message);
    setToastType(type);
    toastTimer.current = setTimeout(() => {
      setToastMessage(null);
      toastTimer.current = null;
    }, 4000);
  }, []);

  /**
   * Callback de FloorPlanCanvas cuando se arrastra una mesa.
   */
  // eslint-disable-next-line no-unused-vars
  const handleTableDragEnd = useCallback((tableId, x, y) => {
    setLayoutDirty(true);
  }, []);

  /**
   * Callback de FloorPlanCanvas cuando se hace clic en una mesa (en modo vista).
   */
  const handleCanvasTableClick = useCallback((table) => {
    setSelectedTable(table);
  }, []);

  /**
   * Inicia el modo edición: guarda las posiciones actuales como referencia
   * para poder cancelar cambios.
   */
  const handleStartEditMode = useCallback(() => {
    const positions = {};
    tables.forEach((table, index) => {
      const hasPos =
        table.xPosition !== null &&
        table.xPosition !== undefined &&
        table.yPosition !== null &&
        table.yPosition !== undefined;
      if (hasPos) {
        positions[table.id] = { x: table.xPosition, y: table.yPosition };
      } else {
        // Auto-layout para mesas sin posición
        const cols = 5;
        const marginX = 140;
        const marginY = 130;
        const startX = 50;
        const startY = 50;
        const col = index % cols;
        const row = Math.floor(index / cols);
        positions[table.id] = {
          x: startX + col * marginX,
          y: startY + row * marginY,
        };
      }
    });
    originalPositionsRef.current = positions;
    setLayoutDirty(false);
    setIsEditMode(true);
  }, [tables]);

  /**
   * Sale del modo edición sin guardar. Recarga las posiciones del servidor.
   */
  const handleCancelEdit = useCallback(() => {
    setIsEditMode(false);
    setLayoutDirty(false);
    const loadOriginal = async () => {
      if (!selectedRestaurantId) return;
      try {
        const data = await getTablesByRestaurant(Number(selectedRestaurantId));
        const tableList = Array.isArray(data) ? data : [];
        setTables(tableList);
      } catch {
        window.location.reload();
      }
    };
    loadOriginal();
  }, [selectedRestaurantId]);

  /**
   * Resetea las posiciones a auto-layout forzando remontaje del canvas.
   */
  const handleResetLayout = useCallback(() => {
    setLayoutDirty(true);
    setLayoutResetKey((prev) => prev + 1);
    showToast('Posiciones restablecidas a la cuadrícula automática', 'success');
  }, [showToast]);

  /**
   * Guarda el layout completo en el backend.
   * Solo muestra éxito si el backend responde 200/201/204.
   * Si hay cualquier error (incluyendo 404), muestra mensaje de error
   * y mantiene el modo edición para no perder los cambios locales.
   */
  const handleSaveLayout = useCallback(async () => {
    if (!selectedRestaurantId || !layoutDirty) return;
    setSavingLayout(true);
    try {
      if (canvasSaveRef.current) {
        const positions = canvasSaveRef.current.getPositions();
        if (positions && positions.length > 0) {
          console.log('[FloorPlan] Sending layout to backend:', {
            restaurantId: Number(selectedRestaurantId),
            tableCount: positions.length,
            firstTable: positions[0],
          });
          await updateTablesLayout(Number(selectedRestaurantId), positions);
          // Si llegamos aquí, el backend respondió 200 OK o 204 No Content
          console.log('[FloorPlan] Layout saved successfully via backend API');
          showToast('Plano guardado correctamente', 'success');
          setLayoutDirty(false);
          setIsEditMode(false);
          // Recargar mesas para tener las posiciones confirmadas del servidor
          const data = await getTablesByRestaurant(Number(selectedRestaurantId));
          const tableList = Array.isArray(data) ? data : [];
          setTables(tableList);
        } else {
          showToast('No hay cambios para guardar', 'info');
        }
      } else {
        showToast('Error al obtener las posiciones del plano', 'error');
      }
    } catch (err) {
      // Error real del backend (404, 403, 500, etc.) — no mostrar éxito
      console.error('[FloorPlan] Error saving layout:', err);
      showToast(
        err?.message || 'Error al guardar el plano. Intenta de nuevo.',
        'error'
      );
      // Mantener modo edición — el usuario puede corregir o cancelar
    } finally {
      setSavingLayout(false);
    }
  }, [selectedRestaurantId, layoutDirty, showToast]);

  // ── Render: Card en vista visual (SVG) ──────────────────────────────────
  const renderVisualCard = (table) => {
    const statusInfo = getStatusInfo(table.status);
    const location = table.location && table.location.trim() !== '' ? table.location.trim() : 'Sin ubicación';
    return (
      <div
        key={table.id}
        className={`fp-card fp-card-visual ${statusInfo.class}`}
        onClick={() => setSelectedTable(table)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTable(table); } }}
        title={`Mesa ${table.tableNumber || table.id} — ${statusInfo.label}`}
      >
        <div className="fp-card-top">
          <span className="fp-card-dot" style={{ backgroundColor: statusInfo.color }} />
          <span className="fp-card-status-label">{statusInfo.label}</span>
        </div>

        <div className="fp-card-icon-wrap" style={{ color: statusInfo.color }}>
          <svg viewBox="0 0 48 48" fill="none" stroke={statusInfo.color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="fp-card-svg">
            <rect x="10" y="18" width="28" height="20" rx="3" strokeWidth="1.3" />
            <line x1="14" y1="38" x2="12" y2="44" strokeWidth="1.3" />
            <line x1="34" y1="38" x2="36" y2="44" strokeWidth="1.3" />
            <rect x="4" y="8" width="8" height="6" rx="1.5" strokeWidth="1" opacity="0.6" />
            <rect x="36" y="8" width="8" height="6" rx="1.5" strokeWidth="1" opacity="0.6" />
            <rect x="20" y="4" width="8" height="6" rx="1.5" strokeWidth="1" opacity="0.6" />
            <rect x="20" y="28" width="8" height="6" rx="1.5" strokeWidth="1" opacity="0.6" />
            <text x="24" y="38" textAnchor="middle" fontSize="9" fontWeight="700" fill={statusInfo.color}>
              {table.capacity || '—'}
            </text>
          </svg>
        </div>

        <div className="fp-card-info">
          <div className="fp-card-title">Mesa {table.tableNumber || table.id}</div>
          <div className="fp-card-meta">
            <span>{table.capacity || '—'} pers.</span>
            <span className="fp-card-sep">·</span>
            <span>{location}</span>
          </div>
        </div>
      </div>
    );
  };

  // ── Render: Card en vista compacta ──────────────────────────────────────
  const renderCompactCard = (table) => {
    const statusInfo = getStatusInfo(table.status);
    const location = table.location && table.location.trim() !== '' ? table.location.trim() : '';
    return (
      <div
        key={table.id}
        className={`fp-card-compact ${statusInfo.class}`}
        onClick={() => setSelectedTable(table)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedTable(table); } }}
        title={`Mesa ${table.tableNumber || table.id} — ${statusInfo.label}`}
      >
        <div className="fp-compact-indicator" style={{ backgroundColor: statusInfo.color }} />
        <div className="fp-compact-body">
          <div className="fp-compact-top">
            <span className="fp-compact-name">Mesa {table.tableNumber || table.id}</span>
            <span className="fp-compact-capacity">{table.capacity || '—'}</span>
          </div>
          <div className="fp-compact-bottom">
            <span className="fp-compact-status" style={{ color: statusInfo.color }}>
              {statusInfo.label}
            </span>
            {location && (
              <>
                <span className="fp-compact-sep">·</span>
                <span className="fp-compact-location">{location}</span>
              </>
            )}
          </div>
        </div>
      </div>
    );
  };

  // ── Render de zona (con colapso) ────────────────────────────────────────
  const renderZone = ([zoneName, zoneTables]) => {
    const zoneKey = zoneName.toLowerCase().replace(/\s+/g, '-');
    const isCollapsed = collapsedZones.has(zoneName);
    const zs = getZoneSummary(zoneTables);

    return (
      <div key={zoneKey} className={`fp-zone ${isCollapsed ? 'fp-zone-collapsed' : ''}`}>
        <button
          className="fp-zone-header"
          onClick={() => toggleZoneCollapse(zoneName)}
          type="button"
          aria-expanded={!isCollapsed}
          aria-controls={`zone-content-${zoneKey}`}
        >
          <svg
            className="fp-zone-chevron"
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ transform: isCollapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="fp-zone-icon">
            <rect x="3" y="3" width="7" height="7" />
            <rect x="14" y="3" width="7" height="7" />
            <rect x="3" y="14" width="7" height="7" />
            <rect x="14" y="14" width="7" height="7" />
          </svg>
          <span className="fp-zone-name">{zoneName}</span>
          <span className="fp-zone-summary">
            {zs.total} mesa{zs.total !== 1 ? 's' : ''}
            {zs.available > 0 && <span className="fp-zone-stat fp-zone-stat-available" title="Libres">{zs.available}</span>}
            {zs.reserved > 0 && <span className="fp-zone-stat fp-zone-stat-reserved" title="Reservadas">{zs.reserved}</span>}
            {zs.occupied > 0 && <span className="fp-zone-stat fp-zone-stat-occupied" title="Ocupadas">{zs.occupied}</span>}
            {zs.maintenance > 0 && <span className="fp-zone-stat fp-zone-stat-maintenance" title="Mantenimiento">{zs.maintenance}</span>}
          </span>
        </button>

        <div
          id={`zone-content-${zoneKey}`}
          className={`fp-zone-content ${isCollapsed ? 'fp-zone-content-hidden' : ''}`}
        >
          <div className={viewMode === 'compact' ? 'fp-grid-compact' : 'fp-grid-visual'}>
            {zoneTables.map(viewMode === 'compact' ? renderCompactCard : renderVisualCard)}
          </div>
        </div>
      </div>
    );
  };

  // ── Render principal ────────────────────────────────────────────────────
  return (
    <div className="fp-container">
      {/* ═══ Page Header ═════════════════════════════════════════════════ */}
      <div className="fp-header">
        <div>
          <h1>Plano del Restaurante</h1>
          <p className="fp-header-subtitle">
            {viewMode === 'interactive'
              ? 'Plano interactivo con mesas posicionadas en el espacio del restaurante'
              : `Vista ${viewMode === 'compact' ? 'compacta' : 'visual'} de las mesas agrupadas por ubicación`}
          </p>
        </div>
      </div>

      {/* ═══ Toolbar: selector restaurante + resumen ════════════════════ */}
      <div className="fp-toolbar">
        <div className="fp-toolbar-row">
          <div className="fp-selector-group">
            <label htmlFor="restaurant-select">Restaurante</label>
            <select
              id="restaurant-select"
              className="fp-select"
              value={selectedRestaurantId}
              onChange={handleRestaurantChange}
              disabled={loadingRestaurants}
            >
              {loadingRestaurants && <option value="">Cargando...</option>}
              {!loadingRestaurants && restaurants.length === 0 && (
                <option value="">Sin restaurantes</option>
              )}
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>

          {/* ─── View Mode Toggle ──────────────────────────────────── */}
          {tables.length > 0 && (
            <div className="fp-view-toggle" role="group" aria-label="Cambiar vista">
              <button
                className={`fp-view-toggle-btn ${viewMode === 'visual' ? 'active' : ''}`}
                onClick={() => { setViewMode('visual'); setIsEditMode(false); }}
                type="button"
                title="Vista visual con SVG de mesas"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" />
                  <rect x="14" y="3" width="7" height="7" />
                  <rect x="3" y="14" width="7" height="7" />
                  <rect x="14" y="14" width="7" height="7" />
                </svg>
                Visual
              </button>
              <button
                className={`fp-view-toggle-btn ${viewMode === 'compact' ? 'active' : ''}`}
                onClick={() => { setViewMode('compact'); setIsEditMode(false); }}
                type="button"
                title="Vista compacta para muchas mesas"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="8" y1="6" x2="21" y2="6" />
                  <line x1="8" y1="12" x2="21" y2="12" />
                  <line x1="8" y1="18" x2="21" y2="18" />
                  <line x1="3" y1="6" x2="3.01" y2="6" />
                  <line x1="3" y1="12" x2="3.01" y2="12" />
                  <line x1="3" y1="18" x2="3.01" y2="18" />
                </svg>
                Compacta
              </button>
              <button
                className={`fp-view-toggle-btn ${viewMode === 'interactive' ? 'active' : ''}`}
                onClick={() => setViewMode('interactive')}
                type="button"
                title="Plano interactivo con mesas posicionadas"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" />
                  <circle cx="8" cy="8" r="2" />
                  <circle cx="16" cy="8" r="2" />
                  <circle cx="8" cy="16" r="2" />
                  <circle cx="16" cy="16" r="2" />
                </svg>
                Plano
              </button>
            </div>
          )}
        </div>

        {/* ─── Summary Bar ─────────────────────────────────────────── */}
        {tables.length > 0 && (
          <div className="fp-summary">
            <button
              className={`fp-summary-item ${filterStatus === 'ALL' ? 'fp-summary-active' : ''}`}
              onClick={() => setFilterStatus('ALL')}
              type="button"
              title="Mostrar todas las mesas"
            >
              <span className="fp-summary-value">{summary.total}</span>
              <span className="fp-summary-label">Total</span>
            </button>
            <button
              className={`fp-summary-item ${filterStatus === 'AVAILABLE' ? 'fp-summary-active' : ''}`}
              onClick={() => setFilterStatus('AVAILABLE')}
              type="button"
              title="Mostrar solo mesas libres"
            >
              <span className="fp-summary-value" style={{ color: '#22c55e' }}>{summary.available}</span>
              <span className="fp-summary-label">Libres</span>
            </button>
            <button
              className={`fp-summary-item ${filterStatus === 'RESERVED' ? 'fp-summary-active' : ''}`}
              onClick={() => setFilterStatus('RESERVED')}
              type="button"
              title="Mostrar solo mesas reservadas"
            >
              <span className="fp-summary-value" style={{ color: '#f59e0b' }}>{summary.reserved}</span>
              <span className="fp-summary-label">Reservadas</span>
            </button>
            <button
              className={`fp-summary-item ${filterStatus === 'OCCUPIED' ? 'fp-summary-active' : ''}`}
              onClick={() => setFilterStatus('OCCUPIED')}
              type="button"
              title="Mostrar solo mesas ocupadas"
            >
              <span className="fp-summary-value" style={{ color: '#ef4444' }}>{summary.occupied}</span>
              <span className="fp-summary-label">Ocupadas</span>
            </button>
            <button
              className={`fp-summary-item ${filterStatus === 'MAINTENANCE' ? 'fp-summary-active' : ''}`}
              onClick={() => setFilterStatus('MAINTENANCE')}
              type="button"
              title="Mostrar solo mesas en mantenimiento"
            >
              <span className="fp-summary-value" style={{ color: '#94a3b8' }}>{summary.outOfService}</span>
              <span className="fp-summary-label">F/Servicio</span>
            </button>
          </div>
        )}

        {/* ─── Filtros rápidos y buscador ─────────────────────────────── */}
        {tables.length > 0 && (
          <div className="fp-filter-bar">
            <div className="fp-filter-badges" role="group" aria-label="Filtrar por estado">
              {FILTER_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  className={`fp-filter-badge ${filterStatus === opt.value ? 'fp-filter-badge-active' : ''}`}
                  onClick={() => setFilterStatus(opt.value)}
                  type="button"
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <div className="fp-search-wrapper">
              <svg className="fp-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="fp-search-input"
                placeholder="Buscar mesa..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar mesa por número, ubicación o estado"
              />
              {searchQuery && (
                <button
                  className="fp-search-clear"
                  onClick={() => setSearchQuery('')}
                  type="button"
                  aria-label="Limpiar búsqueda"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ═══ Toast de notificación ════════════════════════════════════════ */}
      {toastMessage && (
        <div className={`fp-toast fp-toast-${toastType}`} role="alert">
          {toastType === 'success' && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          )}
          {toastType === 'error' && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="15" y1="9" x2="9" y2="15" />
              <line x1="9" y1="9" x2="15" y2="15" />
            </svg>
          )}
          {toastType === 'info' && (
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
          )}
          <span>{toastMessage}</span>
          <button className="fp-toast-close" onClick={() => setToastMessage(null)} type="button" aria-label="Cerrar notificación">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
          </button>
        </div>
      )}

      {/* ═══ Edit mode toolbar (solo en modo interactivo) ════════════════ */}
      {viewMode === 'interactive' && tables.length > 0 && (
        <div className="fp-edit-toolbar">
          <div className="fp-edit-toolbar-left">
            {canAccess(user, PERMISSIONS.MANAGE_FLOOR_PLAN) && (
              <>
                {!isEditMode ? (
                  <button
                    className="fp-edit-btn fp-edit-btn-primary"
                    onClick={handleStartEditMode}
                    type="button"
                    title="Activar modo edición para mover mesas"
                  >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Modo edición
                  </button>
                ) : (
                  <>
                    <span className="fp-edit-badge-active">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      </svg>
                      Editando plano
                    </span>
                    <button
                      className="fp-edit-btn fp-edit-btn-save"
                      onClick={handleSaveLayout}
                      disabled={savingLayout || !layoutDirty}
                      type="button"
                      title="Guardar posiciones actuales"
                    >
                      {savingLayout ? (
                        <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                      ) : (
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                          <polyline points="17 21 17 13 7 13 7 21" />
                          <polyline points="7 3 7 8 15 8" />
                        </svg>
                      )}
                      Guardar plano
                    </button>
                    <button
                      className="fp-edit-btn fp-edit-btn-cancel"
                      onClick={handleCancelEdit}
                      disabled={savingLayout}
                      type="button"
                      title="Cancelar cambios"
                    >
                      Cancelar cambios
                    </button>
                    <button
                      className="fp-edit-btn fp-edit-btn-reset"
                      onClick={handleResetLayout}
                      disabled={savingLayout}
                      type="button"
                      title="Restablecer posiciones automáticas"
                    >
                      Resetear plano
                    </button>
                  </>
                )}
              </>
            )}
          </div>
          <div className="fp-edit-toolbar-right">
            {!isEditMode && (
              <span className="fp-edit-mode-label">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
                Modo operativo — haz clic en una mesa para ver información
              </span>
            )}
          </div>
        </div>
      )}

      {/* ═══ Alertas ════════════════════════════════════════════════════ */}
      {error && (
        <div className="fp-alert fp-alert-error" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span>{error}</span>
          <button className="fp-alert-btn" onClick={() => setError(null)} type="button">Cerrar</button>
        </div>
      )}

      {/* ═══ Loading restaurantes ═══════════════════════════════════════ */}
      {loadingRestaurants && (
        <div className="fp-loading">
          <div className="spinner-border mb-3" role="status" style={{ width: '2rem', height: '2rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p>Cargando restaurantes...</p>
        </div>
      )}

      {/* ═══ Sin restaurantes ═══════════════════════════════════════════ */}
      {!loadingRestaurants && restaurants.length === 0 && (
        <div className="fp-empty">
          <div className="fp-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h5>No hay restaurantes</h5>
          <p>Crea un restaurante antes de diseñar el plano de mesas.</p>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/restaurants')}
            type="button"
          >
            Crear restaurante
          </button>
        </div>
      )}

      {/* ═══ Loading mesas ══════════════════════════════════════════════ */}
      {!loadingRestaurants && restaurants.length > 0 && loading && (
        <div className="fp-loading">
          <div className="spinner-border mb-3" role="status" style={{ width: '2rem', height: '2rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p>Cargando mesas de {selectedRestaurantName}...</p>
        </div>
      )}

      {/* ═══ Sin mesas ══════════════════════════════════════════════════ */}
      {!loadingRestaurants && !loading && selectedRestaurantId && tables.length === 0 && !error && (
        <div className="fp-empty">
          <div className="fp-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
          </div>
          <h5>Este restaurante no tiene mesas</h5>
          <p>{selectedRestaurantName} todavía no tiene mesas registradas. Crea la primera mesa para empezar a visualizar el plano.</p>
          <button
            className="btn btn-primary"
            onClick={() => navigate('/tables')}
            type="button"
          >
            Crear primera mesa
          </button>
        </div>
      )}

      {/* ═══ Sin resultados de filtro ═══════════════════════════════════ */}
      {!loadingRestaurants && !loading && tables.length > 0 && filteredTables.length === 0 && (
        <div className="fp-empty">
          <div className="fp-empty-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
          </div>
          <h5>No se encontraron mesas</h5>
          <p>
            {searchQuery
              ? `No hay mesas que coincidan con "${searchQuery}".`
              : `No hay mesas con el filtro seleccionado.`}
          </p>
          <button
            className="btn btn-outline-secondary"
            onClick={() => { setFilterStatus('ALL'); setSearchQuery(''); }}
            type="button"
          >
            Limpiar filtros
          </button>
        </div>
      )}

      {/* ═══ Plano interactivo (modo canvas) ════════════════════════════ */}
      {!loadingRestaurants && !loading && filteredTables.length > 0 && viewMode === 'interactive' && (
        <div className="fp-canvas-container">
          <FloorPlanCanvas
            key={`canvas-${selectedRestaurantId}-${layoutResetKey}`}
            ref={canvasSaveRef}
            tables={filteredTables}
            editMode={isEditMode}
            selectedTableId={selectedTable?.id}
            onTableClick={handleCanvasTableClick}
            onTableDragEnd={handleTableDragEnd}
            saving={savingLayout}
          />
        </div>
      )}

      {/* ═══ Plano por zonas (vista visual/compacta) ════════════════════ */}
      {!loadingRestaurants && !loading && filteredTables.length > 0 && viewMode !== 'interactive' && (
        <div className="fp-plan">
          {groupedTables.map(renderZone)}
        </div>
      )}

      {/* ═══ Modal de detalle de mesa ═══════════════════════════════════ */}
      {selectedTable && (
        <div
          className="modal-backdrop show"
          style={{ zIndex: 1050 }}
          onClick={() => setSelectedTable(null)}
        >
          <div
            className="modal d-block"
            tabIndex="-1"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-dialog modal-dialog-centered">
              <div className="modal-content">
                <div className="modal-header">
                  <h5 className="modal-title d-flex align-items-center gap-2">
                    <span
                      className="fp-modal-badge-dot"
                      style={{ backgroundColor: getStatusInfo(selectedTable.status).color }}
                    />
                    Mesa {selectedTable.tableNumber || selectedTable.id}
                  </h5>
                  <button
                    type="button"
                    className="btn-close"
                    onClick={() => setSelectedTable(null)}
                    aria-label="Cerrar"
                  />
                </div>
                <div className="modal-body">
                  <div className="fp-modal-details">
                    <div className="fp-modal-row">
                      <span className="fp-modal-label">Restaurante</span>
                      <span className="fp-modal-value">{selectedRestaurantName || '—'}</span>
                    </div>
                    <div className="fp-modal-row">
                      <span className="fp-modal-label">Mesa</span>
                      <span className="fp-modal-value">Mesa {selectedTable.tableNumber || selectedTable.id}</span>
                    </div>
                    <div className="fp-modal-row">
                      <span className="fp-modal-label">Capacidad</span>
                      <span className="fp-modal-value">{selectedTable.capacity || '—'} personas</span>
                    </div>
                    <div className="fp-modal-row">
                      <span className="fp-modal-label">Ubicación</span>
                      <span className="fp-modal-value">{selectedTable.location || 'Sin ubicación'}</span>
                    </div>
                    <div className="fp-modal-row">
                      <span className="fp-modal-label">Estado</span>
                      <span className="fp-modal-value">
                        <span
                          className="fp-modal-badge"
                          style={{ backgroundColor: getStatusInfo(selectedTable.status).color }}
                        >
                          {getStatusInfo(selectedTable.status).label}
                        </span>
                      </span>
                    </div>
                  </div>

                  {/* Acciones rápidas */}
                  <div className="fp-modal-actions">
                    <p className="fp-modal-actions-title">Acciones</p>
                    <div className="fp-modal-actions-grid">
                      {canAccess(user, PERMISSIONS.MANAGE_TABLES) && (
                        <button
                          className="fp-modal-action-btn"
                          onClick={() => { setSelectedTable(null); navigate('/tables'); }}
                          type="button"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                          Editar mesa
                        </button>
                      )}

                      {/* Cambiar estado */}
                      <div className="fp-modal-status-group">
                        <span className="fp-modal-status-label">Cambiar estado</span>
                        <div className="fp-modal-status-options">
                          {Object.entries(TABLE_STATUS).map(([key, st]) => {
                            if (key === selectedTable.status) return null;
                            return (
                              <button
                                key={key}
                                className="fp-modal-status-btn"
                                style={{ '--status-color': st.color }}
                                onClick={() => handleStatusChange(selectedTable, key)}
                                disabled={statusUpdating === selectedTable.id}
                                type="button"
                              >
                                {statusUpdating === selectedTable.id ? (
                                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                                ) : (
                                  <span className="fp-modal-status-dot" style={{ backgroundColor: st.color }} />
                                )}
                                {st.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <button
                        className="fp-modal-action-btn"
                        onClick={() => { setSelectedTable(null); navigate('/reservations'); }}
                        type="button"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                          <line x1="16" y1="2" x2="16" y2="6" />
                          <line x1="8" y1="2" x2="8" y2="6" />
                          <line x1="3" y1="10" x2="21" y2="10" />
                        </svg>
                        Ver reservas
                      </button>
                    </div>
                  </div>
                </div>
                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={() => setSelectedTable(null)}
                  >
                    Cerrar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FloorPlan;
