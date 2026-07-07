import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getCustomers,
  getCustomerById,
  getCustomerReservations,
  createCustomer,
  updateCustomer,
  toggleCustomerActive,
} from '../services/customerService';
import { getRestaurants } from '../services/restaurantService';
import { canAccess, PERMISSIONS } from '../config/permissions';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

/** Estados de reserva traducidos */
const RESERVATION_STATUS_LABELS = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  COMPLETED: 'Completada',
  NO_SHOW: 'No presentado',
};

/** Clases CSS para las badges de estado de reserva */
const RESERVATION_STATUS_CLASS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'cancelled',
};

/** Etiquetas de estado del cliente */
const STATUS_CONFIG = {
  true: { label: 'Activo', className: 'available' },
  false: { label: 'Inactivo', className: 'maintenance' },
};

/** Opciones de filtro por estado */
const STATUS_FILTERS = [
  { value: '', label: 'Todos los estados' },
  { value: 'true', label: 'Activos' },
  { value: 'false', label: 'Inactivos' },
];

/** Estado inicial del formulario */
const INITIAL_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  notes: '',
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

/** Obtiene el nombre completo del cliente (fullName o firstName + lastName) */
const getFullName = (customer) => {
  if (!customer) return '—';
  if (customer.fullName) return customer.fullName.trim();
  const first = (customer.firstName || '').trim();
  const last = (customer.lastName || '').trim();
  if (!first && !last) return '—';
  return `${first} ${last}`.trim();
};

/** Formatea la hora (recorta HH:mm:ss a HH:mm) */
const formatTime = (time) => {
  if (!time) return '';
  return String(time).substring(0, 5);
};

/** Formatea una fecha ISO a dd/mm/aaaa */
const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

/** Obtiene la clase de badge para el estado del cliente */
const getStatusBadgeClass = (active) => {
  const config = active !== false ? STATUS_CONFIG.true : STATUS_CONFIG.false;
  return `badge-status ${config.className}`;
};

/** Obtiene la etiqueta de estado del cliente */
const getStatusLabel = (active) => {
  const config = active !== false ? STATUS_CONFIG.true : STATUS_CONFIG.false;
  return config.label;
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

const Customers = () => {
  const { user } = useAuth();

  // ─── Estados de datos ──────────────────────────────────────────────────
  const [customers, setCustomers] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');
  // ─── Filtros ───────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRestaurantId, setFilterRestaurantId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // ─── Modal de formulario (crear/editar) ────────────────────────────────
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // ─── Modal de detalle del cliente ──────────────────────────────────────
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState(null);
  const [detailReservations, setDetailReservations] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // ─── Modal de cambio de estado (desactivar/reactivar) ──────────────────
  const [showToggleModal, setShowToggleModal] = useState(false);
  const [togglingCustomer, setTogglingCustomer] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [togglingError, setTogglingError] = useState(null);

  // Safe access
  const safeCustomers = useMemo(() => Array.isArray(customers) ? customers : [], [customers]);
  const safeRestaurants = useMemo(() => Array.isArray(restaurants) ? restaurants : [], [restaurants]);

  // ─── Permisos del usuario actual ───────────────────────────────────────
  const canManage = canAccess(user, PERMISSIONS.MANAGE_CUSTOMERS);

  // ─── Cargar restaurantes (una vez al montar) ───────────────────────────
  useEffect(() => {
    const fetchRestaurantsList = async () => {
      try {
        const data = await getRestaurants();
        setRestaurants(Array.isArray(data) ? data : []);
      } catch {
        setRestaurants([]);
      }
    };
    fetchRestaurantsList();
  }, []);

  // ─── Cargar clientes ──────────────────────────────────────────────────
  const fetchCustomers = useCallback(async (params = {}) => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCustomers(params);
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, []);

  // ─── Carga inicial + refetch con debounce ─────────────────────────────
  // Se usa setTimeout para evitar el warning de React 19
  // (llamar setState sincrónicamente en un effect).
  useEffect(() => {
    const buildParams = () => ({
      search: searchQuery || undefined,
      restaurantId: filterRestaurantId || undefined,
      active: filterStatus !== '' ? filterStatus : undefined,
    });

    const timer = setTimeout(() => {
      fetchCustomers(buildParams());
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, filterRestaurantId, filterStatus, fetchCustomers]);

  // ─── Limpiar mensajes ─────────────────────────────────────────────────
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ══════════════════════════════════════════════════════════════════════════
  // STATS
  // ══════════════════════════════════════════════════════════════════════════

  const stats = useMemo(() => {
    const total = safeCustomers.length;
    const active = safeCustomers.filter((c) => c.active !== false).length;
    const withEmail = safeCustomers.filter((c) => c.email).length;
    const withPhone = safeCustomers.filter((c) => c.phone).length;
    return { total, active, withEmail, withPhone };
  }, [safeCustomers]);

  // ══════════════════════════════════════════════════════════════════════════
  // NOMBRES DE RESTAURANTES
  // ══════════════════════════════════════════════════════════════════════════

  const getCustomerRestaurants = (customer) => {
    if (!customer) return '—';

    // Nuevo formato: restaurantNames (array de strings)
    if (customer.restaurantNames && Array.isArray(customer.restaurantNames)) {
      const names = customer.restaurantNames.filter(Boolean);
      if (names.length > 0) return names;
    }

    // Formato antiguo: restaurantId
    if (customer.restaurantId) {
      const rest = safeRestaurants.find((r) => Number(r.id) === Number(customer.restaurantId));
      return rest ? [rest.name] : [];
    }

    return [];
  };

  const getRestaurantsDisplay = (customer) => {
    const names = getCustomerRestaurants(customer);
    if (names.length === 0) return '—';
    return names.join(', ');
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL DE FORMULARIO: ABRIR / CERRAR
  // ══════════════════════════════════════════════════════════════════════════

  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
    setShowFormModal(true);
  };

  const handleOpenEdit = (customer) => {
    if (!customer) return;

    setEditingCustomer(customer);
    setFormData({
      firstName: customer.firstName || customer.fullName || '',
      lastName: customer.lastName || '',
      email: customer.email || '',
      phone: customer.phone || '',
      notes: customer.notes || '',
    });
    setFormErrors({});
    setShowFormModal(true);
  };

  const handleCloseFormModal = () => {
    setShowFormModal(false);
    setEditingCustomer(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FORMULARIO: CAMPOS Y VALIDACIÓN
  // ══════════════════════════════════════════════════════════════════════════

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

  const validateForm = () => {
    const errors = {};
    const firstName = (formData.firstName || '').trim();
    const email = (formData.email || '').trim();

    if (!firstName) {
      errors.firstName = 'El nombre es obligatorio.';
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Correo electrónico no válido.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FORMULARIO: GUARDAR
  // ══════════════════════════════════════════════════════════════════════════

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setFormErrors({});

    try {
      const payload = {
        firstName: (formData.firstName || '').trim(),
        lastName: (formData.lastName || '').trim(),
        email: (formData.email || '').trim(),
        phone: (formData.phone || '').trim(),
        notes: (formData.notes || '').trim(),
      };

      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, payload);
        setSuccessMessage('Cliente actualizado correctamente.');
      } else {
        await createCustomer(payload);
        setSuccessMessage('Cliente creado correctamente.');
      }

      handleCloseFormModal();
      // Recargar con los filtros actuales
      fetchCustomers({
        search: searchQuery || undefined,
        restaurantId: filterRestaurantId || undefined,
        active: filterStatus !== '' ? filterStatus : undefined,
      });
    } catch (err) {
      const msg = getErrorMessage(err);
      setFormErrors({ submit: msg });
    } finally {
      setSubmitting(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL DE DETALLE
  // ══════════════════════════════════════════════════════════════════════════

  const handleOpenDetail = async (customer) => {
    if (!customer) return;

    setShowDetailModal(true);
    setLoadingDetail(true);
    setDetailError(null);
    setDetailCustomer(null);
    setDetailReservations([]);

    try {
      // Cargar detalle del cliente y su historial de reservas en paralelo
      const [detailData, reservationsData] = await Promise.all([
        getCustomerById(customer.id),
        getCustomerReservations(customer.id),
      ]);
      setDetailCustomer(detailData || customer);
      setDetailReservations(Array.isArray(reservationsData) ? reservationsData : []);
    } catch (err) {
      // Si falla el detalle, mostrar al menos lo que tenemos
      setDetailCustomer(customer);
      setDetailReservations([]);
      setDetailError(getErrorMessage(err));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleCloseDetail = () => {
    setShowDetailModal(false);
    setDetailCustomer(null);
    setDetailReservations([]);
    setDetailError(null);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL DE CAMBIO DE ESTADO
  // ══════════════════════════════════════════════════════════════════════════

  const handleOpenToggle = (customer) => {
    if (!customer) return;
    setTogglingCustomer(customer);
    setTogglingError(null);
    setShowToggleModal(true);
  };

  const handleCloseToggle = () => {
    setShowToggleModal(false);
    setTogglingCustomer(null);
    setTogglingError(null);
  };

  const handleConfirmToggle = async () => {
    if (!togglingCustomer) return;

    setToggling(true);
    setTogglingError(null);
    try {
      await toggleCustomerActive(togglingCustomer.id);
      const newStatus = togglingCustomer.active !== false ? 'desactivado' : 'reactivado';
      setSuccessMessage(`Cliente ${newStatus} correctamente.`);
      setShowToggleModal(false);
      setTogglingCustomer(null);

      // Recargar con los filtros actuales
      fetchCustomers({
        search: searchQuery || undefined,
        restaurantId: filterRestaurantId || undefined,
        active: filterStatus !== '' ? filterStatus : undefined,
      });
    } catch (err) {
      setTogglingError(getErrorMessage(err));
    } finally {
      setToggling(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="customers-page">
      {/* ═══ Page Header ═══════════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h1>Clientes</h1>
          <p className="page-description">
            CRM ligero — gestiona tus clientes, consulta su historial de reservas y toma notas útiles.
          </p>
        </div>

        {canManage && (
          <div className="page-header-actions">
            <button
              className="btn btn-primary d-flex align-items-center gap-2"
              onClick={handleOpenCreate}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Añadir Cliente
            </button>
          </div>
        )}
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
          <button className="btn btn-outline-danger btn-sm ms-2" onClick={() => fetchCustomers()} type="button">
            Reintentar
          </button>
        </div>
      )}

      {/* ═══ Loading ═══════════════════════════════════════════════════════ */}
      {loading && (
        <div className="loading-state">
          <div className="spinner-border mb-3" role="status" style={{ width: '2.25rem', height: '2.25rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="text-muted mb-0">Cargando clientes...</p>
        </div>
      )}

      {/* ═══ Empty State ═══════════════════════════════════════════════════ */}
      {!loading && !error && safeCustomers.length === 0 && (
        <div className="app-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h5>No hay clientes registrados</h5>
            <p>Todavía no hay clientes en tu restaurante. Cuando los clientes hagan reservas, aparecerán aquí.</p>
            {canManage && (
              <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
                Añadir Cliente
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ Data View ═════════════════════════════════════════════════════ */}
      {!loading && !error && safeCustomers.length > 0 && (
        <>
          {/* ─── Stats Cards ────────────────────────────────────────────── */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.total}</div>
                <div className="stat-card-label">Total Clientes</div>
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
                <div className="stat-card-value">{stats.active}</div>
                <div className="stat-card-label">Activos</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                  <polyline points="22,6 12,13 2,6" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.withEmail}</div>
                <div className="stat-card-label">Con Email</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.withPhone}</div>
                <div className="stat-card-label">Con Teléfono</div>
              </div>
            </div>
          </div>

          {/* ─── Filters ────────────────────────────────────────────────── */}
          <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
            {/* Buscador */}
            <div className="d-flex align-items-center gap-2 flex-grow-1" style={{ maxWidth: '360px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Buscar por nombre, email o teléfono..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar clientes"
              />
              {searchQuery && (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setSearchQuery('')}
                  type="button"
                  aria-label="Limpiar búsqueda"
                >
                  Limpiar
                </button>
              )}
            </div>

            {/* Filtro por restaurante */}
            <select
              className="form-select form-select-sm"
              style={{ maxWidth: '220px' }}
              value={filterRestaurantId}
              onChange={(e) => setFilterRestaurantId(e.target.value)}
              aria-label="Filtrar por restaurante"
            >
              <option value="">Todos los restaurantes</option>
              {safeRestaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'No disponible'}
                </option>
              ))}
            </select>

            {/* Filtro por estado */}
            <select
              className="form-select form-select-sm"
              style={{ maxWidth: '180px' }}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="Filtrar por estado"
            >
              {STATUS_FILTERS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* ─── Table ──────────────────────────────────────────────────── */}
          <div className="app-card">
            <div className="app-table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Contacto</th>
                    <th>Restaurante(s)</th>
                    <th>Reservas</th>
                    <th>Última reserva</th>
                    <th>Estado</th>
                    <th className="col-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {/* Sin resultados de búsqueda/filtros */}
                  {safeCustomers.length > 0 && customers.length === 0 && (
                    <tr className="no-results">
                      <td colSpan={7} className="text-center text-muted py-4">
                        {searchQuery
                          ? `No se encontraron clientes que coincidan con "${searchQuery}".`
                          : 'No hay clientes con los filtros seleccionados.'}
                      </td>
                    </tr>
                  )}
                  {/* Filas */}
                  {customers.length > 0 && customers.map((customer, index) => {
                    const customerId = customer?.id ?? index;
                    const fullName = getFullName(customer);
                    const email = customer?.email || '';
                    const phone = customer?.phone || '';
                    const totalRes = customer?.totalReservations ?? 0;
                    const lastDate = customer?.lastReservationDate || '';
                    const lastTime = customer?.lastReservationTime || '';
                    const isActive = customer?.active !== false;
                    const restaurantNames = getCustomerRestaurants(customer);

                    return (
                      <tr key={customerId}>
                        {/* Cliente (nombre + email) */}
                        <td>
                          <div className="crm-customer-name">{fullName}</div>
                          {email && (
                            <div className="crm-customer-contact">
                              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                <polyline points="22,6 12,13 2,6" />
                              </svg>
                              <span className="text-truncate">{email}</span>
                            </div>
                          )}
                        </td>

                        {/* Contacto (teléfono) */}
                        <td>
                          {phone ? (
                            <span className="d-inline-flex align-items-center gap-1">
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                              </svg>
                              {phone}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>

                        {/* Restaurante(s) */}
                        <td>
                          {restaurantNames.length > 0 ? (
                            <div className="crm-restaurants-cell">
                              {restaurantNames.map((name, i) => (
                                <span key={i} className="crm-restaurant-badge">{name}</span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>

                        {/* Reservas */}
                        <td className="fw-semibold">{totalRes > 0 ? totalRes : <span className="text-muted fw-normal">0</span>}</td>

                        {/* Última reserva */}
                        <td>
                          {lastDate ? (
                            <span className="crm-last-reservation">
                              <span className="crm-last-date">{formatDate(lastDate)}</span>
                              {lastTime && <span className="crm-last-time">{formatTime(lastTime)}</span>}
                            </span>
                          ) : (
                            <span className="text-muted">Sin reservas</span>
                          )}
                        </td>

                        {/* Estado */}
                        <td>
                          <span className={getStatusBadgeClass(isActive)}>
                            {getStatusLabel(isActive)}
                          </span>
                        </td>

                        {/* Acciones */}
                        <td className="col-actions">
                          <div className="d-flex justify-content-end gap-1">
                            <button
                              className="btn-icon btn-view"
                              onClick={() => handleOpenDetail(customer)}
                              title="Ver detalle del cliente"
                              type="button"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                                <circle cx="12" cy="12" r="3" />
                              </svg>
                            </button>

                            {canManage && (
                              <>
                                <button
                                  className="btn-icon btn-edit"
                                  onClick={() => handleOpenEdit(customer)}
                                  title="Editar cliente"
                                  type="button"
                                >
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                  </svg>
                                </button>

                                <button
                                  className={`btn-icon ${isActive ? 'btn-delete' : 'btn-activate'}`}
                                  onClick={() => handleOpenToggle(customer)}
                                  title={isActive ? 'Desactivar cliente' : 'Reactivar cliente'}
                                  type="button"
                                >
                                  {isActive ? (
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="10" />
                                      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                                    </svg>
                                  ) : (
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                      <circle cx="12" cy="12" r="10" />
                                      <polyline points="12 6 12 12 16 14" />
                                    </svg>
                                  )}
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL: Crear / Editar
          ══════════════════════════════════════════════════════════════════ */}
      {showFormModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseFormModal} aria-label="Cerrar" />
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
                    {/* Nombre */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-firstName" className="form-label">
                        Nombre <span className="text-danger">*</span>
                      </label>
                      <input
                        id="cust-firstName"
                        type="text"
                        className={`form-control ${formErrors.firstName ? 'is-invalid' : ''}`}
                        name="firstName"
                        value={formData.firstName || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Laura"
                        required
                      />
                      {formErrors.firstName && <div className="invalid-feedback">{formErrors.firstName}</div>}
                    </div>

                    {/* Apellidos */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-lastName" className="form-label">Apellidos</label>
                      <input
                        id="cust-lastName"
                        type="text"
                        className="form-control"
                        name="lastName"
                        value={formData.lastName || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Gómez"
                      />
                    </div>

                    {/* Email */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-email" className="form-label">Email</label>
                      <input
                        id="cust-email"
                        type="email"
                        className={`form-control ${formErrors.email ? 'is-invalid' : ''}`}
                        name="email"
                        value={formData.email || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: laura.gomez@test.com"
                      />
                      {formErrors.email && <div className="invalid-feedback">{formErrors.email}</div>}
                    </div>

                    {/* Teléfono */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-phone" className="form-label">Teléfono</label>
                      <input
                        id="cust-phone"
                        type="tel"
                        className="form-control"
                        name="phone"
                        value={formData.phone || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: 600111222"
                      />
                    </div>

                    {/* Notas (textarea para mejor UX) */}
                    <div className="col-12">
                      <label htmlFor="cust-notes" className="form-label">
                        Notas del cliente
                        <span className="public-label-optional ms-1">(alergias, preferencias, celebraciones, observaciones internas)</span>
                      </label>
                      <textarea
                        id="cust-notes"
                        className="form-control"
                        name="notes"
                        value={formData.notes || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Prefiere mesa tranquila, alérgico a los frutos secos, celebra su cumpleaños en julio..."
                        rows={3}
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCloseFormModal}
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
                    {editingCustomer ? 'Actualizar Cliente' : 'Crear Cliente'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL: Detalle del cliente (CRM View)
          ══════════════════════════════════════════════════════════════════ */}
      {showDetailModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {detailCustomer ? getFullName(detailCustomer) : 'Detalle del Cliente'}
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseDetail} aria-label="Cerrar" />
              </div>

              <div className="modal-body">
                {/* Loading detail */}
                {loadingDetail && (
                  <div className="text-center py-4">
                    <div className="spinner-border mb-3" role="status" style={{ width: '2rem', height: '2rem' }}>
                      <span className="visually-hidden">Cargando detalle...</span>
                    </div>
                    <p className="text-muted mb-0">Cargando detalle del cliente...</p>
                  </div>
                )}

                {/* Error en detalle */}
                {!loadingDetail && detailError && (
                  <div className="alert alert-warning d-flex align-items-center gap-2 mb-3" role="alert">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>{detailError}</span>
                  </div>
                )}

                {/* Contenido del detalle */}
                {!loadingDetail && detailCustomer && (
                  <>
                    {/* ─── Info del cliente ───────────────────────────── */}
                    <div className="crm-detail-section">
                      <h6 className="crm-detail-section-title">Información del Cliente</h6>
                      <div className="crm-detail-grid">
                        <div className="crm-detail-field">
                          <span className="crm-detail-label">Nombre completo</span>
                          <span className="crm-detail-value">{getFullName(detailCustomer)}</span>
                        </div>
                        <div className="crm-detail-field">
                          <span className="crm-detail-label">Email</span>
                          <span className="crm-detail-value">{detailCustomer.email || '—'}</span>
                        </div>
                        <div className="crm-detail-field">
                          <span className="crm-detail-label">Teléfono</span>
                          <span className="crm-detail-value">{detailCustomer.phone || '—'}</span>
                        </div>
                        <div className="crm-detail-field">
                          <span className="crm-detail-label">Estado</span>
                          <span className={getStatusBadgeClass(detailCustomer.active !== false)}>
                            {getStatusLabel(detailCustomer.active !== false)}
                          </span>
                        </div>
                        <div className="crm-detail-field">
                          <span className="crm-detail-label">Restaurantes asociados</span>
                          <span className="crm-detail-value">
                            {getRestaurantsDisplay(detailCustomer) || '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ─── Notas ──────────────────────────────────────── */}
                    {detailCustomer.notes && (
                      <div className="crm-detail-section">
                        <h6 className="crm-detail-section-title">Notas</h6>
                        <div className="crm-detail-notes-box">
                          {detailCustomer.notes}
                        </div>
                      </div>
                    )}

                    {/* ─── Estadísticas básicas ────────────────────────── */}
                    <div className="crm-detail-section">
                      <h6 className="crm-detail-section-title">Estadísticas</h6>
                      <div className="crm-detail-stats-row">
                        <div className="crm-detail-stat-item">
                          <span className="crm-detail-stat-value">{detailCustomer.totalReservations ?? 0}</span>
                          <span className="crm-detail-stat-label">Total reservas</span>
                        </div>
                        <div className="crm-detail-stat-item">
                          <span className="crm-detail-stat-value" style={{ color: 'var(--success-text)' }}>{detailCustomer.confirmedReservations ?? 0}</span>
                          <span className="crm-detail-stat-label">Confirmadas</span>
                        </div>
                        <div className="crm-detail-stat-item">
                          <span className="crm-detail-stat-value" style={{ color: 'var(--danger-text)' }}>{detailCustomer.cancelledReservations ?? 0}</span>
                          <span className="crm-detail-stat-label">Canceladas</span>
                        </div>
                        {detailCustomer.lastReservationDate && (
                          <div className="crm-detail-stat-item">
                            <span className="crm-detail-stat-value" style={{ fontSize: '0.8125rem' }}>
                              {formatDate(detailCustomer.lastReservationDate)}
                            </span>
                            <span className="crm-detail-stat-label">Última reserva</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ─── Historial de reservas ──────────────────────── */}
                    <div className="crm-detail-section">
                      <h6 className="crm-detail-section-title">
                        Historial de Reservas
                        {detailReservations.length > 0 && (
                          <span className="crm-detail-count-badge">{detailReservations.length}</span>
                        )}
                      </h6>

                      {detailReservations.length === 0 ? (
                        <p className="text-muted mb-0" style={{ fontSize: '0.875rem' }}>
                          Este cliente no tiene reservas registradas.
                        </p>
                      ) : (
                        <div className="crm-history-table-wrapper">
                          <table className="crm-history-table">
                            <thead>
                              <tr>
                                <th>Fecha</th>
                                <th>Hora</th>
                                <th>Restaurante</th>
                                <th>Personas</th>
                                <th>Mesa</th>
                                <th>Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailReservations.map((res, idx) => {
                                const resId = res?.id ?? idx;
                                const resStatus = res?.status || '';
                                const statusLabel = RESERVATION_STATUS_LABELS[resStatus] || resStatus;
                                const statusClass = RESERVATION_STATUS_CLASS[resStatus] || '';

                                return (
                                  <tr key={resId}>
                                    <td>{formatDate(res.reservationDate)}</td>
                                    <td>{formatTime(res.reservationTime)}</td>
                                    <td>
                                      {res.restaurantName
                                        ? res.restaurantName
                                        : (res.restaurant?.name || '—')}
                                    </td>
                                    <td>{res.partySize ?? '—'}</td>
                                    <td>
                                      {res.diningTable
                                        ? res.diningTable.tableNumber || res.diningTable.name || `#${res.diningTable.id}`
                                        : (res.tableNumber || '—')}
                                    </td>
                                    <td>
                                      <span className={`badge-status ${statusClass}`}>{statusLabel}</span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="modal-footer">
                {detailCustomer && canManage && (
                  <button
                    type="button"
                    className="btn btn-outline-primary d-flex align-items-center gap-2"
                    onClick={() => {
                      handleCloseDetail();
                      handleOpenEdit(detailCustomer);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Editar Cliente
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={handleCloseDetail}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL: Confirmar cambio de estado (desactivar/reactivar)
          ══════════════════════════════════════════════════════════════════ */}
      {showToggleModal && togglingCustomer && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header border-0">
                <h5 className="modal-title">
                  {togglingCustomer.active !== false ? 'Desactivar Cliente' : 'Reactivar Cliente'}
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseToggle} aria-label="Cerrar" />
              </div>

              <div className="modal-body text-center py-4">
                <div className="mb-3">
                  <svg
                    width="44" height="44" viewBox="0 0 24 24"
                    fill="none"
                    stroke={togglingCustomer.active !== false ? '#ef4444' : 'var(--success)'}
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    {togglingCustomer.active !== false ? (
                      <>
                        <circle cx="12" cy="12" r="10" />
                        <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
                      </>
                    ) : (
                      <>
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </>
                    )}
                  </svg>
                </div>

                <h6 className="mb-2">
                  {togglingCustomer.active !== false
                    ? '¿Estás seguro de desactivar este cliente?'
                    : '¿Estás seguro de reactivar este cliente?'}
                </h6>
                <p className="text-muted mb-1">
                  <strong>{getFullName(togglingCustomer)}</strong>
                </p>
                {togglingCustomer.email && (
                  <p className="text-muted small mb-0">{togglingCustomer.email}</p>
                )}
                <p className="text-muted small mt-2 mb-0">
                  {togglingCustomer.active !== false
                    ? 'El cliente dejará de estar visible en listados activos, pero su historial de reservas se conservará.'
                    : 'El cliente volverá a estar visible en listados activos.'}
                </p>

                {togglingError && (
                  <div className="alert alert-danger py-2 mt-3 mb-0" role="alert">
                    {togglingError}
                  </div>
                )}
              </div>

              <div className="modal-footer border-0 justify-content-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary px-4"
                  onClick={handleCloseToggle}
                  disabled={toggling}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`btn px-4 d-flex align-items-center gap-2 ${togglingCustomer.active !== false ? 'btn-danger' : 'btn-success'}`}
                  onClick={handleConfirmToggle}
                  disabled={toggling}
                >
                  {toggling && (
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                  )}
                  {togglingCustomer.active !== false ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Customers;
