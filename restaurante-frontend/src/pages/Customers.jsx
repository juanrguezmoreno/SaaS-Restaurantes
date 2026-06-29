import { useState, useEffect } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getCustomers,
  createCustomer,
  updateCustomer,
  deleteCustomer,
} from '../services/customerService';
import { getRestaurants } from '../services/restaurantService';
import { canAccess, PERMISSIONS } from '../config/permissions';

// ─── Estado inicial del formulario ─────────────────────────────────────────
const INITIAL_FORM = {
  restaurantId: '',
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  notes: '',
};

// ─── Helper: extraer mensaje de error de forma segura ──────────────────────
const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

// ─── Componente principal ──────────────────────────────────────────────────
const Customers = () => {
  const { user } = useAuth();

  // Estados de datos y UI
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Estados del modal de formulario
  const [showModal, setShowModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Estados del modal de eliminar
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingCustomer, setDeletingCustomer] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Estados de restaurantes
  const [restaurants, setRestaurants] = useState([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);

  // Filtro de búsqueda
  const [searchQuery, setSearchQuery] = useState('');

  // Safe access: garantiza que customers siempre sea un array
  const safeCustomers = Array.isArray(customers) ? customers : [];

  // ─── Cargar restaurantes (una vez al montar) ─────────────────────────────
  useEffect(() => {
    const fetchRestaurantsList = async () => {
      setLoadingRestaurants(true);
      try {
        const data = await getRestaurants();
        setRestaurants(Array.isArray(data) ? data : []);
      } catch {
        setRestaurants([]);
      } finally {
        setLoadingRestaurants(false);
      }
    };
    fetchRestaurantsList();
  }, []);

  // ─── Cargar clientes ─────────────────────────────────────────────────────
  const fetchCustomers = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getCustomers();
      setCustomers(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  // Carga inicial
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchCustomers();
  }, []);

  // ─── Limpiar mensajes ────────────────────────────────────────────────────
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ─── Filtrado local por búsqueda ─────────────────────────────────────────
  const filteredCustomers = safeCustomers.filter((c) => {
    if (!searchQuery.trim()) return true;

    const q = searchQuery.toLowerCase().trim();
    const fullName = `${c.firstName || ''} ${c.lastName || ''}`.toLowerCase();
    const email = (c.email || '').toLowerCase();
    const phone = (c.phone || '').toLowerCase();

    return (
      fullName.includes(q) ||
      email.includes(q) ||
      phone.includes(q)
    );
  });

  // ─── Stats ───────────────────────────────────────────────────────────────
  const stats = {
    total: safeCustomers.length,
    withEmail: safeCustomers.filter((c) => c.email).length,
    withPhone: safeCustomers.filter((c) => c.phone).length,
  };

  // ─── Obtener nombre del restaurante por ID ───────────────────────────────
  const getRestaurantName = (restaurantId) => {
    if (!restaurantId) return '—';
    const rest = restaurants.find((r) => r.id === restaurantId);
    return rest ? rest.name : 'No disponible';
  };

  // ─── Decorar nombre completo ─────────────────────────────────────────────
  const getFullName = (customer) => {
    if (!customer) return '—';
    const first = (customer.firstName || '').trim();
    const last = (customer.lastName || '').trim();
    if (!first && !last) return '—';
    return `${first} ${last}`.trim();
  };

  // ─── Abrir modal para crear ──────────────────────────────────────────────
  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
    setShowModal(true);
  };

  // ─── Abrir modal para editar ─────────────────────────────────────────────
  const handleOpenEdit = (customer) => {
    if (!customer) return;

    setEditingCustomer(customer);
    setFormData({
      restaurantId: customer.restaurantId ?? '',
      firstName: customer.firstName || '',
      lastName: customer.lastName || '',
      email: customer.email || '',
      phone: customer.phone || '',
      notes: customer.notes || '',
    });
    setFormErrors({});
    setShowModal(true);
  };

  // ─── Cerrar modal ────────────────────────────────────────────────────────
  const handleCloseModal = () => {
    setShowModal(false);
    setEditingCustomer(null);
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
    const firstName = (formData.firstName || '').trim();
    const email = (formData.email || '').trim();

    if (!firstName) {
      errors.firstName = 'El nombre es obligatorio.';
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Correo electrónico no válido.';
    }

    if (!formData.restaurantId) {
      errors.restaurantId = 'El restaurante es obligatorio.';
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
        restaurantId: Number(formData.restaurantId),
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

      handleCloseModal();
      await fetchCustomers();
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
  const handleOpenDelete = (customer) => {
    if (!customer) return;
    setDeletingCustomer(customer);
    setShowDeleteModal(true);
  };

  // ─── Confirmar eliminación ───────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!deletingCustomer) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteCustomer(deletingCustomer.id);
      setSuccessMessage('Cliente eliminado correctamente.');
      setShowDeleteModal(false);
      setDeletingCustomer(null);
      await fetchCustomers();
    } catch (err) {
      setError(getErrorMessage(err));
      setShowDeleteModal(false);
      setDeletingCustomer(null);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Render ──────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ═══ Page Header ═══════════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h1>Clientes</h1>
          <p className="page-description">
            Gestiona los clientes de tus restaurantes
          </p>
        </div>

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
          <button className="btn btn-outline-danger btn-sm ms-2" onClick={fetchCustomers} type="button">
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
            <p>Crea tu primer cliente para empezar a gestionar tu negocio.</p>
            <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
              Crear Cliente
            </button>
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
                <div className="stat-card-value">{stats.withEmail}</div>
                <div className="stat-card-label">Con Email</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.withPhone}</div>
                <div className="stat-card-label">Con Teléfono</div>
              </div>
            </div>
          </div>

          {/* ─── Search / Filter ────────────────────────────────────────── */}
          <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
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
          </div>

          {/* ─── Table ──────────────────────────────────────────────────── */}
          <div className="app-card">
            <div className="app-table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="col-id">#</th>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th>Teléfono</th>
                    <th>Restaurante</th>
                    <th>Notas</th>
                    <th className="col-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredCustomers.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="text-center text-muted py-4">
                        {searchQuery
                          ? `No se encontraron clientes que coincidan con "${searchQuery}".`
                          : 'No hay clientes registrados.'}
                      </td>
                    </tr>
                  ) : (
                    filteredCustomers.map((customer, index) => (
                      <tr key={customer?.id ?? index}>
                        <td className="col-id">{customer?.id ?? index + 1}</td>
                        <td className="fw-semibold">{getFullName(customer)}</td>
                        <td>
                          {customer?.email ? (
                            <span className="d-inline-flex align-items-center gap-1">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                <polyline points="22,6 12,13 2,6" />
                              </svg>
                              <span className="text-truncate d-inline-block" style={{ maxWidth: '180px' }}>
                                {customer.email}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {customer?.phone ? (
                            <span className="d-inline-flex align-items-center gap-1">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                              </svg>
                              {customer.phone}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td style={{ maxWidth: '160px' }}>
                          <span className="text-truncate d-inline-block" style={{ maxWidth: '160px' }}>
                            {getRestaurantName(customer?.restaurantId)}
                          </span>
                        </td>
                        <td style={{ maxWidth: '150px' }}>
                          <span className="text-truncate d-inline-block text-muted" style={{ maxWidth: '150px' }}>
                            {customer?.notes || '—'}
                          </span>
                        </td>
                        <td className="col-actions">
                          <div className="d-flex justify-content-end gap-1">
                            {canAccess(user, PERMISSIONS.MANAGE_CUSTOMERS) && (
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
                                  className="btn-icon btn-delete"
                                  onClick={() => handleOpenDelete(customer)}
                                  title="Eliminar cliente"
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
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ═══ Modal: Crear / Editar ══════════════════════════════════════════ */}
      {showModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}
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
                    {/* Restaurante */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-restaurant" className="form-label">
                        Restaurante <span className="text-danger">*</span>
                      </label>
                      <select
                        id="cust-restaurant"
                        className={`form-select ${formErrors.restaurantId ? 'is-invalid' : ''}`}
                        name="restaurantId"
                        value={formData.restaurantId}
                        onChange={handleFormChange}
                        required
                        disabled={loadingRestaurants}
                      >
                        <option value="">Seleccionar restaurante...</option>
                        {restaurants.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name || 'No disponible'}
                          </option>
                        ))}
                      </select>
                      {formErrors.restaurantId && (
                        <div className="invalid-feedback">{formErrors.restaurantId}</div>
                      )}
                    </div>

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

                    {/* Notas */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-notes" className="form-label">Notas</label>
                      <input
                        id="cust-notes"
                        type="text"
                        className="form-control"
                        name="notes"
                        value={formData.notes || ''}
                        onChange={handleFormChange}
                        placeholder="Opcional: preferencias, observaciones..."
                      />
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
                    {editingCustomer ? 'Actualizar Cliente' : 'Crear Cliente'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal: Confirmar Eliminación ════════════════════════════════════ */}
      {showDeleteModal && deletingCustomer && (
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
                <h6 className="mb-2">¿Estás seguro de eliminar este cliente?</h6>
                <p className="text-muted mb-0">
                  <strong>{getFullName(deletingCustomer)}</strong>
                </p>
                {deletingCustomer?.email && (
                  <p className="text-muted small mb-0">
                    {deletingCustomer.email}
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

export default Customers;
