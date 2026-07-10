import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { getRestaurants } from '../services/restaurantService';
import {
  getTablesByRestaurant,
  updateTableStatus,
  updateTablesLayout,
} from '../services/tableService';
import {
  getFloorPlanElements,
  saveFloorPlanElements,
} from '../services/floorPlanService';
import { getReservationsByRestaurantAndDate } from '../services/reservationService';
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

// ─── Fecha de hoy en formato YYYY-MM-DD (huso horario local) ──────────────
const getTodayDateStr = () => {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
};

// ─── Hora actual en formato HH:mm:ss para comparar con reservationTime ────
const getNowTimeStr = () => {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${hh}:${mi}:00`;
};

// ─── Componente principal ───────────────────────────────────────────────────
const FloorPlan = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  // ── Estados de datos ──────────────────────────────────────────────────────
  const [restaurants, setRestaurants] = useState([]);
  const [selectedRestaurantId, setSelectedRestaurantId] = useState('');
  const [selectedRestaurantName, setSelectedRestaurantName] = useState('');
  const [tables, setTables] = useState([]);
  const [elements, setElements] = useState([]);
  const [reservations, setReservations] = useState([]);
  const [loading, setLoading] = useState(false);
  const [loadingRestaurants, setLoadingRestaurants] = useState(true);
  const [error, setError] = useState(null);
  const [selectedTable, setSelectedTable] = useState(null);
  const [statusUpdating, setStatusUpdating] = useState(null);

  // ── Estados de UI ─────────────────────────────────────────────────────────
  const [filterStatus, setFilterStatus] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // ── Estados del plano interactivo ─────────────────────────────────────────
  const [isEditMode, setIsEditMode] = useState(false);
  const [savingLayout, setSavingLayout] = useState(false);
  const [layoutDirty, setLayoutDirty] = useState(false);
  const [toastMessage, setToastMessage] = useState(null);
  const [toastType, setToastType] = useState('success');
  const toastTimer = useRef(null);

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
      setElements([]);
      setReservations([]);

      try {
        const [tablesData, elementsData, reservationsData] = await Promise.all([
          getTablesByRestaurant(Number(selectedRestaurantId)),
          getFloorPlanElements(Number(selectedRestaurantId)).catch((err) => {
            console.warn('[FloorPlan] No se pudieron cargar los elementos del plano:', err?.message);
            return [];
          }),
          getReservationsByRestaurantAndDate(Number(selectedRestaurantId), getTodayDateStr()).catch((err) => {
            console.warn('[FloorPlan] No se pudieron cargar las reservas de hoy:', err?.message);
            return [];
          }),
        ]);
        if (mounted) {
          const tableList = Array.isArray(tablesData) ? tablesData : [];
          setTables(tableList);
          setElements(Array.isArray(elementsData) ? elementsData : []);
          setReservations(Array.isArray(reservationsData) ? reservationsData : []);
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

  // ── Resumen de estados ──────────────────────────────────────────────────
  const summary = useMemo(() => {
    const total = tables.length;
    const available = tables.filter((t) => t.status === 'AVAILABLE').length;
    const reserved = tables.filter((t) => t.status === 'RESERVED').length;
    const occupied = tables.filter((t) => t.status === 'OCCUPIED').length;
    const outOfService = tables.filter((t) => t.status === 'MAINTENANCE').length;
    return { total, available, reserved, occupied, outOfService };
  }, [tables]);

  // ── Reservas de hoy agrupadas por mesa (PENDING/CONFIRMED, orden por hora) ──
  const reservationsByTableId = useMemo(() => {
    const map = {};
    reservations
      .filter((r) => r.status === 'PENDING' || r.status === 'CONFIRMED')
      .forEach((r) => {
        if (!r.diningTableId) return;
        if (!map[r.diningTableId]) map[r.diningTableId] = [];
        map[r.diningTableId].push(r);
      });
    Object.values(map).forEach((list) =>
      list.sort((a, b) => String(a.reservationTime).localeCompare(String(b.reservationTime)))
    );
    return map;
  }, [reservations]);

  // ── Próxima reserva de hoy por mesa (o la última en curso si todas pasaron) ──
  // Aún sin consumir en esta tarea (solo carga de datos); lo usará Task 5/6.
  // eslint-disable-next-line no-unused-vars
  const nextReservationByTableId = useMemo(() => {
    const nowStr = getNowTimeStr();
    const map = {};
    Object.entries(reservationsByTableId).forEach(([tableId, list]) => {
      const upcoming = list.find((r) => String(r.reservationTime) >= nowStr);
      map[tableId] = upcoming || list[list.length - 1];
    });
    return map;
  }, [reservationsByTableId]);

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

  // ── Refs y estados para el plano interactivo ──────────────────────────────
  const canvasSaveRef = useRef(null);
  // Fuerza el remontaje del canvas tras guardar/cancelar para sincronizar
  // el estado local con lo persistido en el servidor
  const [canvasReloadKey, setCanvasReloadKey] = useState(0);

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
   * Inicia el modo edición. Los cambios locales viven en el canvas;
   * cancelar recarga el estado persistido del servidor.
   */
  const handleStartEditMode = useCallback(() => {
    setLayoutDirty(false);
    setIsEditMode(true);
  }, []);

  /**
   * Recarga mesas y elementos del servidor y remonta el canvas para
   * descartar cualquier estado local (posiciones, formas, elementos).
   */
  const reloadPlanData = useCallback(async () => {
    if (!selectedRestaurantId) return;
    const [tablesData, elementsData, reservationsData] = await Promise.all([
      getTablesByRestaurant(Number(selectedRestaurantId)),
      getFloorPlanElements(Number(selectedRestaurantId)).catch(() => []),
      getReservationsByRestaurantAndDate(Number(selectedRestaurantId), getTodayDateStr()).catch(() => []),
    ]);
    setTables(Array.isArray(tablesData) ? tablesData : []);
    setElements(Array.isArray(elementsData) ? elementsData : []);
    setReservations(Array.isArray(reservationsData) ? reservationsData : []);
    setCanvasReloadKey((prev) => prev + 1);
  }, [selectedRestaurantId]);

  /**
   * Sale del modo edición sin guardar. Recarga el estado del servidor.
   */
  const handleCancelEdit = useCallback(() => {
    setIsEditMode(false);
    setLayoutDirty(false);
    reloadPlanData().catch(() => {
      window.location.reload();
    });
  }, [reloadPlanData]);

  /**
   * Recoloca las mesas en la cuadrícula automática (no toca los elementos).
   */
  const handleResetLayout = useCallback(() => {
    canvasSaveRef.current?.resetAutoLayout();
    setLayoutDirty(true);
    showToast('Posiciones restablecidas a la cuadrícula automática', 'success');
  }, [showToast]);

  /**
   * Añade un elemento decorativo (BAR | DOOR) al plano en modo edición.
   */
  const handleAddElement = useCallback((type) => {
    canvasSaveRef.current?.addElement(type);
    setLayoutDirty(true);
  }, []);

  /**
   * Callback del canvas cuando cambia el layout (forma, elementos...).
   */
  const handleLayoutChange = useCallback(() => {
    setLayoutDirty(true);
  }, []);

  /**
   * Guarda el layout completo (mesas + elementos) en el backend.
   * Solo muestra éxito si ambas llamadas responden OK; después recarga
   * el estado persistido del servidor. Si algo falla, mantiene el modo
   * edición para no perder los cambios locales.
   */
  const handleSaveLayout = useCallback(async () => {
    if (!selectedRestaurantId || !layoutDirty) return;
    if (!canvasSaveRef.current) {
      showToast('Error al obtener el estado del plano', 'error');
      return;
    }

    setSavingLayout(true);
    const { tables: tablesPayload, elements: elementsPayload } =
      canvasSaveRef.current.getLayout();

    let tablesSaved = false;
    try {
      if (tablesPayload.length > 0) {
        await updateTablesLayout(Number(selectedRestaurantId), tablesPayload);
      }
      tablesSaved = true;

      await saveFloorPlanElements(Number(selectedRestaurantId), elementsPayload);

      showToast('Plano guardado correctamente', 'success');
      setLayoutDirty(false);
      setIsEditMode(false);
      await reloadPlanData();
    } catch (err) {
      console.error('[FloorPlan] Error al guardar el plano:', err);
      showToast(
        tablesSaved
          ? `Las mesas se guardaron, pero falló el guardado de los elementos: ${err?.message || 'error desconocido'}`
          : err?.message || 'Error al guardar el plano. Intenta de nuevo.',
        'error'
      );
      // Mantener modo edición — el usuario puede corregir o cancelar
    } finally {
      setSavingLayout(false);
    }
  }, [selectedRestaurantId, layoutDirty, showToast, reloadPlanData]);

  // ── Render principal ────────────────────────────────────────────────────
  return (
    <div className="fp-container">
      {/* ═══ Page Header ═════════════════════════════════════════════════ */}
      <div className="fp-header">
        <div>
          <h1>Plano del Restaurante</h1>
          <p className="fp-header-subtitle">
            Plano interactivo con mesas posicionadas en el espacio del restaurante
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
      {tables.length > 0 && (
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
                      className="fp-edit-btn"
                      onClick={() => handleAddElement('BAR')}
                      disabled={savingLayout}
                      type="button"
                      title="Añadir una barra de bar al plano"
                    >
                      + Barra
                    </button>
                    <button
                      className="fp-edit-btn"
                      onClick={() => handleAddElement('DOOR')}
                      disabled={savingLayout}
                      type="button"
                      title="Añadir una puerta de entrada al plano"
                    >
                      + Puerta
                    </button>
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
      {!loadingRestaurants && !loading && filteredTables.length > 0 && (
        <div className="fp-canvas-container">
          <FloorPlanCanvas
            key={`canvas-${selectedRestaurantId}-${canvasReloadKey}`}
            ref={canvasSaveRef}
            tables={filteredTables}
            elements={elements}
            editMode={isEditMode}
            selectedTableId={selectedTable?.id}
            onTableClick={handleCanvasTableClick}
            onTableDragEnd={handleTableDragEnd}
            onLayoutChange={handleLayoutChange}
            saving={savingLayout}
          />
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
