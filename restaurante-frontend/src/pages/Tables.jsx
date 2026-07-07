import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getTablesByRestaurant,
  createTable,
  updateTable,
  deleteTable,
} from '../services/tableService';
import { getRestaurants } from '../services/restaurantService';
import { canAccess, PERMISSIONS } from '../config/permissions';

// ─── Configuración de estados de mesa ──────────────────────────────────────
const TABLE_STATUSES = [
  { value: 'AVAILABLE', label: 'Disponible', badgeClass: 'bg-success' },
  { value: 'OCCUPIED', label: 'Ocupada', badgeClass: 'bg-danger' },
  { value: 'RESERVED', label: 'Reservada', badgeClass: 'bg-warning text-dark' },
  { value: 'MAINTENANCE', label: 'En mantenimiento', badgeClass: 'bg-secondary' },
];

const STATUS_MAP = Object.fromEntries(
  TABLE_STATUSES.map((s) => [s.value, s])
);

// ─── Estado inicial del formulario ─────────────────────────────────────────
const INITIAL_FORM = {
  tableNumber: '',
  capacity: '',
  location: '',
  status: 'AVAILABLE',
};

// ─── Helper: extraer mensaje de error de forma segura ──────────────────────
const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

// ─── Componente principal ──────────────────────────────────────────────────
const Tables = () => {
  const { user } = useAuth();

  // Estados de datos y UI
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Estados del modal de formulario
  const [showModal, setShowModal] = useState(false);
  const [editingTable, setEditingTable] = useState(null);
  const [formData, setFormData] = useState({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Estados del modal de eliminar
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingTable, setDeletingTable] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Estados de restaurantes
  const [restaurants, setRestaurants] = useState([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);
  const [restaurantId, setRestaurantId] = useState(() => {
    const stored = localStorage.getItem('restaurantId');
    return stored ? Number(stored) : null;
  });

  // Mapa de búsqueda rápida: { id → nombre }
  const restaurantMap = Object.fromEntries(
    restaurants.map((r) => [r.id, r.name || 'No disponible'])
  );
  const restaurantName = restaurantId ? restaurantMap[restaurantId] || 'No disponible' : null;

  // Safe access: garantiza que tables siempre sea un array
  const safeTables = Array.isArray(tables) ? tables : [];

  // ─── Cargar restaurantes al montar (siempre) ─────────────────────────────
  useEffect(() => {
    const fetchRestaurantsList = async () => {
      setLoadingRestaurants(true);
      try {
        const data = await getRestaurants();
        const list = Array.isArray(data) ? data : [];
        setRestaurants(list);

        // Si aún no hay restaurantId, definir valor inicial:
        // user.restaurantId → localStorage → primer restaurante disponible
        setRestaurantId((prev) => {
          if (prev) return prev;
          if (user?.restaurantId) return Number(user.restaurantId);
          if (list.length > 0) return list[0].id;
          return null;
        });
      } catch {
        setRestaurants([]);
      } finally {
        setLoadingRestaurants(false);
      }
    };
    fetchRestaurantsList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persistir restaurantId en localStorage cuando cambie
  useEffect(() => {
    if (restaurantId) {
      localStorage.setItem('restaurantId', String(restaurantId));
    }
  }, [restaurantId]);

  // ─── Cargar mesas cuando cambie restaurantId ─────────────────────────────
  const fetchTables = async () => {
    if (!restaurantId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await getTablesByRestaurant(restaurantId);
      setTables(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (restaurantId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      fetchTables();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  // ─── Limpiar mensajes ────────────────────────────────────────────────────
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ─── Cambiar de restaurante desde el selector ────────────────────────────
  const handleRestaurantChange = (e) => {
    const id = Number(e.target.value);
    if (!id) return;
    setRestaurantId(id);
  };

  // ─── Abrir modal para crear ──────────────────────────────────────────────
  const handleOpenCreate = () => {
    setEditingTable(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
    setShowModal(true);
  };

  // ─── Abrir modal para editar ─────────────────────────────────────────────
  const handleOpenEdit = (table) => {
    if (!table) return;

    setEditingTable(table);
    setFormData({
      tableNumber: table.tableNumber ?? '',
      capacity: table.capacity ?? '',
      location: table.location ?? '',
      status: table.status || 'AVAILABLE',
    });
    setFormErrors({});
    setShowModal(true);
  };

  // ─── Cerrar modal ────────────────────────────────────────────────────────
  const handleCloseModal = () => {
    setShowModal(false);
    setEditingTable(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
  };

  // ─── Cambios en el formulario ────────────────────────────────────────────
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    if (formErrors[name]) {
      setFormErrors((prev) => {
        const updated = { ...prev };
        delete updated[name];
        return updated;
      });
    }
  };

  // ─── Validar formulario ──────────────────────────────────────────────────
  const validateForm = () => {
    const errors = {};

    const tableNumber = (formData.tableNumber || '').trim();
    const capacity = formData.capacity;

    if (!tableNumber) {
      errors.tableNumber = 'El número de mesa es obligatorio.';
    }

    if (
      capacity === '' ||
      capacity === null ||
      capacity === undefined
    ) {
      errors.capacity = 'La capacidad es obligatoria.';
    } else if (
      Number(capacity) < 1 ||
      !Number.isInteger(Number(capacity))
    ) {
      errors.capacity =
        'La capacidad debe ser un número entero positivo.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ─── Guardar (crear o actualizar) ────────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setFormErrors({});

    try {
      const payload = {
        restaurantId: Number(restaurantId),
        tableNumber: String(formData.tableNumber || '').trim(),
        capacity: Number(formData.capacity),
        location: (formData.location || '').trim(),
        status: formData.status || 'AVAILABLE',
      };

      if (editingTable) {
        await updateTable(editingTable.id, payload);
        setSuccessMessage('Mesa actualizada correctamente.');
      } else {
        await createTable(restaurantId, payload);
        setSuccessMessage('Mesa creada correctamente.');
      }

      handleCloseModal();
      await fetchTables();
    } catch (err) {
      const msg = getErrorMessage(err);
      if (showModal) {
        setFormErrors({ submit: msg });
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Abrir confirmación de eliminar ──────────────────────────────────────
  const handleOpenDelete = (table) => {
    if (!table) return;
    setDeletingTable(table);
    setShowDeleteModal(true);
  };

  // ─── Confirmar eliminación ───────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!deletingTable) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteTable(deletingTable.id);
      setSuccessMessage('Mesa eliminada correctamente.');
      setShowDeleteModal(false);
      setDeletingTable(null);
      await fetchTables();
    } catch (err) {
      setError(getErrorMessage(err));
      setShowDeleteModal(false);
      setDeletingTable(null);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Renderizar badge de estado ─────────────────────────────────────────
  const renderStatusBadge = (status) => {
    const config = STATUS_MAP[status] || {
      label: status || '—',
      cssClass: 'maintenance',
    };
    const cssStatus = (status || '').toLowerCase().replace(/_/g, '-');
    return (
      <span className={`badge-status ${cssStatus}`}>
        {config.label}
      </span>
    );
  };

  // ─── Cálculos para stats ─────────────────────────────────────────────────
  const stats = {
    total: safeTables.length,
    available: safeTables.filter((t) => t?.status === 'AVAILABLE').length,
    occupied: safeTables.filter((t) => t?.status === 'OCCUPIED').length,
    reserved: safeTables.filter((t) => t?.status === 'RESERVED').length,
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ═══ Page Header ═══════════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h1>Mesas</h1>
          <p className="page-description">
            Gestiona las mesas de tu restaurante
            {restaurantName && (
              <span> &middot; {restaurantName}</span>
            )}
            {loadingRestaurants && (
              <span className="ms-2 text-muted small">Cargando restaurantes...</span>
            )}
          </p>
        </div>

        <div className="page-header-actions">
          <div className="restaurant-selector-wrapper">
            <label htmlFor="restaurant-selector">Restaurante:</label>
            <select
              id="restaurant-selector"
              className="form-select form-select-sm"
              style={{ minWidth: '180px' }}
              value={restaurantId ?? ''}
              onChange={handleRestaurantChange}
              disabled={loadingRestaurants}
              aria-label="Seleccionar restaurante"
            >
              {restaurants.length === 0 && (
                <option value="">{loadingRestaurants ? 'Cargando...' : 'Sin restaurantes'}</option>
              )}
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'No disponible'}
                </option>
              ))}
            </select>
          </div>

          {restaurantId && canAccess(user, PERMISSIONS.MANAGE_TABLES) && (
            <button
              className="btn btn-primary d-flex align-items-center gap-2"
              onClick={handleOpenCreate}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Añadir Mesa
            </button>
          )}
        </div>
      </div>

      {/* ═══ Messages ══════════════════════════════════════════════════════ */}
      {successMessage && (
        <div className="alert alert-success d-flex align-items-center gap-2 mb-3" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span className="flex-grow-1">{successMessage}</span>
          <button type="button" className="btn-close" onClick={() => setSuccessMessage('')} aria-label="Cerrar" />
        </div>
      )}

      {error && (
        <div className="alert alert-danger d-flex align-items-center gap-2 mb-3" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="flex-grow-1">{error}</span>
          <button className="btn btn-outline-danger btn-sm ms-2" onClick={fetchTables} type="button">
            Reintentar
          </button>
        </div>
      )}

      {/* ═══ Estado: Sin restaurantes disponibles ═════════════════════════ */}
      {!loadingRestaurants && restaurants.length === 0 && !restaurantId && (
        <div className="app-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <path d="M9 3v18" />
              </svg>
            </div>
            <h5>No hay restaurantes disponibles</h5>
            <p>Crea un restaurante primero para gestionar sus mesas.</p>
            <a href="/restaurants" className="btn btn-primary" type="button">
              Ir a Restaurantes
            </a>
          </div>
        </div>
      )}

      {/* ═══ Estado: Cargando mesas ═══════════════════════════════════════ */}
      {restaurantId && loading && (
        <div className="loading-state">
          <div className="spinner-border mb-3" role="status" style={{ width: '2.25rem', height: '2.25rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="text-muted mb-0">Cargando mesas...</p>
        </div>
      )}

      {/* ═══ Estado: Vacío ════════════════════════════════════════════════ */}
      {restaurantId && !loading && !error && safeTables.length === 0 && (
        <div className="app-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <path d="M9 3v18" />
              </svg>
            </div>
            <h5>No hay mesas registradas</h5>
            <p>Crea la primera mesa para empezar a gestionar tu restaurante.</p>
            {canAccess(user, PERMISSIONS.MANAGE_TABLES) && (
              <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
                Crear Mesa
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ Data View ════════════════════════════════════════════════════ */}
      {restaurantId && !loading && !error && safeTables.length > 0 && (
        <>
          {/* ─── Stats Cards ────────────────────────────────────────────── */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                  <path d="M9 3v18" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.total}</div>
                <div className="stat-card-label">Total Mesas</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.available}</div>
                <div className="stat-card-label">Disponibles</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon danger">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.occupied}</div>
                <div className="stat-card-label">Ocupadas</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.reserved}</div>
                <div className="stat-card-label">Reservadas</div>
              </div>
            </div>
          </div>

          {/* ─── Table ──────────────────────────────────────────────────── */}
          <div className="app-card">
            <div className="app-table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="col-id">#</th>
                    <th>Mesa</th>
                    <th>Capacidad</th>
                    <th>Ubicación</th>
                    <th>Estado</th>
                    <th className="col-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {safeTables.map((table, index) => (
                    <tr key={table?.id ?? index}>
                      <td className="col-id">{table?.id ?? index + 1}</td>
                      <td className="fw-semibold">{table?.tableNumber || '—'}</td>
                      <td>
                        <span className="capacity-badge">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                          {table?.capacity ?? '—'}
                        </span>
                      </td>
                      <td>
                        {table?.location ? (
                          <span className="d-inline-flex align-items-center gap-1">
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                              <circle cx="12" cy="10" r="3" />
                            </svg>
                            {table.location}
                          </span>
                        ) : (
                          <span className="text-muted">—</span>
                        )}
                      </td>
                      <td>{renderStatusBadge(table?.status)}</td>
                      <td className="col-actions">
                        <div className="d-flex justify-content-end gap-1">
                          {canAccess(user, PERMISSIONS.MANAGE_TABLES) && (
                            <>
                              <button
                                className="btn-icon btn-edit"
                                onClick={() => handleOpenEdit(table)}
                                title="Editar mesa"
                                type="button"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                              <button
                                className="btn-icon btn-delete"
                                onClick={() => handleOpenDelete(table)}
                                title="Eliminar mesa"
                                type="button"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══ Modal: Crear / Editar ══════════════════════════════════════════ */}
      {showModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {editingTable ? 'Editar Mesa' : 'Nueva Mesa'}
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseModal} aria-label="Cerrar" />
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="modal-body">
                  {/* Error del submit */}
                  {formErrors.submit && (
                    <div className="alert alert-danger py-2" role="alert">
                      {formErrors.submit}
                    </div>
                  )}

                  <div className="row g-3">
                    {/* Número de mesa */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="table-number" className="form-label">
                        Número de Mesa <span className="text-danger">*</span>
                      </label>
                      <input
                        id="table-number"
                        type="text"
                        className={`form-control ${formErrors.tableNumber ? 'is-invalid' : ''}`}
                        name="tableNumber"
                        value={formData.tableNumber || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: M1, Terraza-2, 5"
                        required
                      />
                      {formErrors.tableNumber && (
                        <div className="invalid-feedback">{formErrors.tableNumber}</div>
                      )}
                    </div>

                    {/* Capacidad */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="table-capacity" className="form-label">
                        Capacidad <span className="text-danger">*</span>
                      </label>
                      <input
                        id="table-capacity"
                        type="number"
                        className={`form-control ${formErrors.capacity ? 'is-invalid' : ''}`}
                        name="capacity"
                        value={formData.capacity ?? ''}
                        onChange={handleFormChange}
                        placeholder="Ej: 4"
                        min="1"
                        step="1"
                        required
                      />
                      {formErrors.capacity && (
                        <div className="invalid-feedback">{formErrors.capacity}</div>
                      )}
                    </div>

                    {/* Ubicación */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="table-location" className="form-label">Ubicación</label>
                      <input
                        id="table-location"
                        type="text"
                        className="form-control"
                        name="location"
                        value={formData.location || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Terraza, Interior, Salón principal"
                      />
                    </div>

                    {/* Estado */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="table-status" className="form-label">Estado</label>
                      <select
                        id="table-status"
                        className="form-select"
                        name="status"
                        value={formData.status || 'AVAILABLE'}
                        onChange={handleFormChange}
                        aria-label="Estado de la mesa"
                      >
                        {TABLE_STATUSES.map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCloseModal}
                    disabled={submitting}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary d-flex align-items-center gap-2"
                    disabled={submitting}
                  >
                    {submitting && (
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    )}
                    {editingTable ? 'Actualizar Mesa' : 'Crear Mesa'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal: Confirmar Eliminación ════════════════════════════════════ */}
      {showDeleteModal && deletingTable && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header border-0">
                <h5 className="modal-title">Confirmar Eliminación</h5>
                <button type="button" className="btn-close" onClick={() => setShowDeleteModal(false)} aria-label="Cerrar" />
              </div>
              <div className="modal-body text-center py-4">
                <div className="mb-3">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <h6 className="mb-2">¿Estás seguro de eliminar esta mesa?</h6>
                <p className="text-muted mb-0">
                  Mesa: <strong>{deletingTable?.tableNumber || '—'}</strong>
                </p>
                {deletingTable?.location && (
                  <p className="text-muted small mb-0">
                    Ubicación: {deletingTable.location}
                  </p>
                )}
                <p className="text-muted small mt-2 mb-0">
                  Esta acción no se puede deshacer.
                </p>
              </div>
              <div className="modal-footer border-0 justify-content-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary px-4"
                  onClick={() => setShowDeleteModal(false)}
                  disabled={deleting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-danger px-4 d-flex align-items-center gap-2"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                >
                  {deleting && (
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                  )}
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tables;
