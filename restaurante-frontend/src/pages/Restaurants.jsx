import { useState, useEffect } from 'react';
import {
  getRestaurants,
  createRestaurant,
  updateRestaurant,
  deleteRestaurant,
} from '../services/restaurantService';

// ─── Estado inicial del formulario ───────────────────────────────────────
const INITIAL_FORM = {
  name: '',
  address: '',
  phone: '',
  email: '',
  description: '',
  openingTime: '',
  closingTime: '',
  capacity: '',
};

// ─── Helper: extraer mensaje de error de forma segura ──────────────────
const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

// ─── Componente principal ────────────────────────────────────────────────
const Restaurants = () => {
  // Estados de datos y UI
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Estados del modal
  const [showModal, setShowModal] = useState(false);
  const [editingRestaurant, setEditingRestaurant] = useState(null);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // Estados del modal de eliminar
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingRestaurant, setDeletingRestaurant] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // Safe access: garantiza que restaurants siempre sea un array
  const safeRestaurants = Array.isArray(restaurants) ? restaurants : [];

  // ─── Cargar restaurantes ─────────────────────────────────────────────
  const fetchRestaurants = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getRestaurants();
      // Asegurar que lo que se guarda es un array válido
      setRestaurants(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
      // Si falla la recarga, mantener el array anterior (no se modifica)
    } finally {
      setLoading(false);
    }
  };

  // Carga inicial al montar el componente
  // fetchRestaurants se define fuera y solo se ejecuta una vez al montar.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRestaurants();
  }, []);

  // ─── Limpiar mensajes ─────────────────────────────────────────────────
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ─── Abrir modal para crear ───────────────────────────────────────────
  const handleOpenCreate = () => {
    setEditingRestaurant(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
    setShowModal(true);
  };

  // ─── Abrir modal para editar ──────────────────────────────────────────
  const handleOpenEdit = (restaurant) => {
    if (!restaurant) return;

    setEditingRestaurant(restaurant);
    setFormData({
      name: restaurant.name || '',
      address: restaurant.address || '',
      phone: restaurant.phone || '',
      email: restaurant.email || '',
      description: restaurant.description || '',
      openingTime: restaurant.openingTime
        ? String(restaurant.openingTime).substring(0, 5)
        : '',
      closingTime: restaurant.closingTime
        ? String(restaurant.closingTime).substring(0, 5)
        : '',
      capacity: restaurant.capacity ?? '',
    });
    setFormErrors({});
    setShowModal(true);
  };

  // ─── Cerrar modal ─────────────────────────────────────────────────────
  const handleCloseModal = () => {
    setShowModal(false);
    setEditingRestaurant(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
  };

  // ─── Cambios en el formulario ─────────────────────────────────────────
  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    // Limpiar error del campo al escribir
    if (formErrors[name]) {
      setFormErrors((prev) => {
        const updated = { ...prev };
        delete updated[name];
        return updated;
      });
    }
  };

  // ─── Validar formulario ───────────────────────────────────────────────
  const validateForm = () => {
    const errors = {};

    const name = (formData.name || '').trim();
    const address = (formData.address || '').trim();
    const email = (formData.email || '').trim();
    const capacity = formData.capacity;

    if (!name) {
      errors.name = 'El nombre es obligatorio.';
    }
    if (!address) {
      errors.address = 'La dirección es obligatoria.';
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Correo electrónico no válido.';
    }
    if (
      capacity !== '' &&
      capacity !== null &&
      capacity !== undefined &&
      (Number(capacity) < 0 || !Number.isInteger(Number(capacity)))
    ) {
      errors.capacity = 'La capacidad debe ser un número entero positivo.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ─── Guardar (crear o actualizar) ─────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setFormErrors({});

    try {
      // Convertir horarios al formato HH:mm:ss que espera el backend
      const payload = {
        name: (formData.name || '').trim(),
        address: (formData.address || '').trim(),
        phone: (formData.phone || '').trim(),
        email: (formData.email || '').trim(),
        description: (formData.description || '').trim(),
        openingTime: formData.openingTime
          ? `${String(formData.openingTime).substring(0, 5)}:00`
          : null,
        closingTime: formData.closingTime
          ? `${String(formData.closingTime).substring(0, 5)}:00`
          : null,
        capacity:
          formData.capacity !== '' && formData.capacity !== null
            ? Number(formData.capacity)
            : null,
      };

      if (editingRestaurant) {
        await updateRestaurant(editingRestaurant.id, payload);
        setSuccessMessage('Restaurante actualizado correctamente.');
      } else {
        await createRestaurant(payload);
        setSuccessMessage('Restaurante creado correctamente.');
      }

      // Cerrar modal y refrescar lista
      handleCloseModal();
      await fetchRestaurants();
    } catch (err) {
      // Si el modal sigue abierto, mostrar error en el formulario
      // Si ya se cerró, mostrar error global
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

  // ─── Abrir confirmación de eliminar ───────────────────────────────────
  const handleOpenDelete = (restaurant) => {
    if (!restaurant) return;
    setDeletingRestaurant(restaurant);
    setShowDeleteModal(true);
  };

  // ─── Confirmar eliminación ────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    if (!deletingRestaurant) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteRestaurant(deletingRestaurant.id);
      setSuccessMessage('Restaurante eliminado correctamente.');
      setShowDeleteModal(false);
      setDeletingRestaurant(null);
      await fetchRestaurants();
    } catch (err) {
      setError(getErrorMessage(err));
      setShowDeleteModal(false);
      setDeletingRestaurant(null);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Copiar enlace público de reservas ─────────────────────────────────
  const [linkCopiedId, setLinkCopiedId] = useState(null);

  const handleCopyPublicLink = (restaurant) => {
    if (!restaurant || !restaurant.id) return;
    const link = `${window.location.origin}/public/reservar/${restaurant.id}`;
    navigator.clipboard.writeText(link).then(() => {
      setLinkCopiedId(restaurant.id);
      setTimeout(() => setLinkCopiedId(null), 2500);
    }).catch(() => {
      // Fallback para navegadores sin clipboard API
      const textArea = document.createElement('textarea');
      textArea.value = link;
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setLinkCopiedId(restaurant.id);
      setTimeout(() => setLinkCopiedId(null), 2500);
    });
  };

  // ─── Abrir página pública de reservas ──────────────────────────────────
  const handleOpenPublicLink = (restaurant) => {
    if (!restaurant || !restaurant.id) return;
    const link = `${window.location.origin}/public/reservar/${restaurant.id}`;
    window.open(link, '_blank', 'noopener,noreferrer');
  };

  // ─── Generar enlace público ────────────────────────────────────────────
  const getPublicLink = (restaurant) => {
    if (!restaurant || !restaurant.id) return '#';
    return `${window.location.origin}/public/reservar/${restaurant.id}`;
  };

  // ─── Formatear horario seguro ─────────────────────────────────────────
  const formatTime = (time) => {
    if (!time) return null;
    const str = String(time);
    return str.length >= 5 ? str.substring(0, 5) : str;
  };

  // ─── Cálculos para stats ──────────────────────────────────────────────
  const totalCapacity = safeRestaurants.reduce(
    (sum, r) => sum + (Number(r.capacity) || 0),
    0
  );

  // ─── Render ───────────────────────────────────────────────────────────
  return (
    <div>
      {/* ═══ Page Header ═══════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <h1>Restaurantes</h1>
          <p className="page-description">
            Gestiona todos los restaurantes registrados
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
            Añadir Restaurante
          </button>
        </div>
      </div>

      {/* ═══ Messages ════════════════════════════════════════════════════ */}
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
          <button className="btn btn-outline-danger btn-sm ms-2" onClick={fetchRestaurants} type="button">
            Reintentar
          </button>
        </div>
      )}

      {/* ═══ Loading ═════════════════════════════════════════════════════ */}
      {loading && (
        <div className="loading-state">
          <div className="spinner-border mb-3" role="status" style={{ width: '2.25rem', height: '2.25rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="text-muted mb-0">Cargando restaurantes...</p>
        </div>
      )}

      {/* ═══ Empty State ════════════════════════════════════════════════ */}
      {!loading && !error && safeRestaurants.length === 0 && (
        <div className="app-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <h5>No hay restaurantes registrados</h5>
            <p>Crea tu primer restaurante para empezar a gestionar tu negocio.</p>
            <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
              Crear Restaurante
            </button>
          </div>
        </div>
      )}

      {/* ═══ Data View ═══════════════════════════════════════════════════ */}
      {!loading && !error && safeRestaurants.length > 0 && (
        <>
          {/* ─── Stats Cards ─────────────────────────────────────────── */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  <polyline points="9 22 9 12 15 12 15 22" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{safeRestaurants.length}</div>
                <div className="stat-card-label">Total Restaurantes</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{totalCapacity}</div>
                <div className="stat-card-label">Capacidad Total</div>
              </div>
            </div>
          </div>

          {/* ─── Table ───────────────────────────────────────────────── */}
          <div className="app-card">
            <div className="app-table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="col-id">#</th>
                    <th>Nombre</th>
                    <th>Dirección</th>
                    <th>Teléfono</th>
                    <th>Email</th>
                    <th>Capacidad</th>
                    <th>Horario</th>
                    <th className="col-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {safeRestaurants.map((restaurant, index) => (
                    <tr key={restaurant?.id ?? index}>
                      <td className="col-id">{restaurant?.id ?? index + 1}</td>
                      <td className="fw-semibold">{restaurant?.name || '—'}</td>
                      <td style={{ maxWidth: '200px' }}>
                        <span className="text-truncate d-inline-block" style={{ maxWidth: '200px' }}>
                          {restaurant?.address || '—'}
                        </span>
                      </td>
                      <td>{restaurant?.phone || '—'}</td>
                      <td>{restaurant?.email || '—'}</td>
                      <td>
                        <span className="capacity-badge">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                          {restaurant?.capacity ?? '—'}
                        </span>
                      </td>
                      <td className="text-nowrap">
                        {restaurant?.openingTime && restaurant?.closingTime
                          ? `${formatTime(restaurant.openingTime)} - ${formatTime(restaurant.closingTime)}`
                          : '—'}
                      </td>
                      <td className="col-actions">
                        <div className="d-flex justify-content-end gap-1">
                          <button
                            className={`btn-icon ${linkCopiedId === restaurant.id ? 'btn-copied' : 'btn-share'}`}
                            onClick={() => handleCopyPublicLink(restaurant)}
                            title={linkCopiedId === restaurant.id ? '¡Enlace copiado!' : 'Copiar enlace público de reservas'}
                            type="button"
                          >
                            {linkCopiedId === restaurant.id ? (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            ) : (
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
                                <polyline points="7 11 12 16 17 11" />
                                <line x1="12" y1="4" x2="12" y2="16" />
                              </svg>
                            )}
                          </button>
                          <button
                            className="btn-icon btn-edit"
                            onClick={() => handleOpenEdit(restaurant)}
                            title="Editar restaurante"
                            type="button"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </button>
                          <button
                            className="btn-icon btn-delete"
                            onClick={() => handleOpenDelete(restaurant)}
                            title="Eliminar restaurante"
                            type="button"
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                            </svg>
                          </button>
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

      {/* ═══ RESERVAS ONLINE ═══════════════════════════════════════════════ */}
      {!loading && !error && safeRestaurants.length > 0 && (
        <div className="app-card mt-4">
          <div className="app-card-body">
            {/* ─── Header ─────────────────────────────────────────────── */}
            <div className="d-flex align-items-center gap-2 mb-1">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--primary)', flexShrink: 0 }}>
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              <h3 className="mb-0" style={{ fontSize: '1rem', fontWeight: 600 }}>Reservas online</h3>
            </div>
            <p className="public-link-desc">
              Comparte este enlace en WhatsApp, Instagram, Google Business o tu web para que tus clientes puedan reservar online.
            </p>

            {/* ─── Lista de restaurantes ──────────────────────────────── */}
            <div className="online-reservations-list">
              {safeRestaurants.map((restaurant) => {
                const link = getPublicLink(restaurant);
                const isCopied = linkCopiedId === restaurant.id;
                return (
                  <div key={restaurant.id} className="online-reservation-item">
                    <div className="online-reservation-info">
                      <span className="online-reservation-name">
                        {restaurant.name || 'No disponible'}
                      </span>
                      <span className="online-reservation-link">{link}</span>
                    </div>
                    <div className="online-reservation-actions">
                      <button
                        type="button"
                        className={`online-reservation-btn online-reservation-btn-copy ${isCopied ? 'copied' : ''}`}
                        onClick={() => handleCopyPublicLink(restaurant)}
                        title="Copiar enlace"
                      >
                        {isCopied ? (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                            Enlace copiado
                          </>
                        ) : (
                          <>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                            </svg>
                            Copiar enlace
                          </>
                        )}
                      </button>
                      <button
                        type="button"
                        className="online-reservation-btn online-reservation-btn-open"
                        onClick={() => handleOpenPublicLink(restaurant)}
                        title="Abrir página pública de reservas"
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                          <polyline points="15 3 21 3 21 9" />
                          <line x1="10" y1="14" x2="21" y2="3" />
                        </svg>
                        Abrir página
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ─── QR Code Placeholder ────────────────────────────────── */}
            <div className="online-reservation-qr">
              <div className="online-reservation-qr-icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="3" width="7" height="7" rx="1" />
                  <rect x="14" y="3" width="7" height="7" rx="1" />
                  <rect x="3" y="14" width="7" height="7" rx="1" />
                  <rect x="14" y="14" width="7" height="7" rx="1" />
                  <line x1="5" y1="5" x2="5" y2="5.01" />
                  <line x1="16" y1="5" x2="16" y2="5.01" />
                  <line x1="5" y1="16" x2="5" y2="16.01" />
                  <line x1="16" y1="16" x2="18" y2="16" />
                  <line x1="18" y1="14" x2="18" y2="18" />
                  <line x1="14" y1="18" x2="18" y2="18" />
                </svg>
              </div>
              <div className="online-reservation-qr-text">
                <strong>Código QR</strong>
                <p>Próximamente podrás descargar un QR para imprimirlo en cartas, mesas o escaparate.</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal: Crear / Editar ════════════════════════════════════════ */}
      {showModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {editingRestaurant ? 'Editar Restaurante' : 'Nuevo Restaurante'}
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
                    {/* Nombre */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="rest-name" className="form-label">
                        Nombre <span className="text-danger">*</span>
                      </label>
                      <input
                        id="rest-name"
                        type="text"
                        className={`form-control ${formErrors.name ? 'is-invalid' : ''}`}
                        name="name"
                        value={formData.name || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Restaurante La Casa"
                        required
                      />
                      {formErrors.name && <div className="invalid-feedback">{formErrors.name}</div>}
                    </div>

                    {/* Capacidad */}
                    <div className="col-12 col-md-3">
                      <label htmlFor="rest-capacity" className="form-label">Capacidad</label>
                      <input
                        id="rest-capacity"
                        type="number"
                        className={`form-control ${formErrors.capacity ? 'is-invalid' : ''}`}
                        name="capacity"
                        value={formData.capacity ?? ''}
                        onChange={handleFormChange}
                        placeholder="Ej: 80"
                        min="0"
                        step="1"
                      />
                      {formErrors.capacity && <div className="invalid-feedback">{formErrors.capacity}</div>}
                    </div>

                    {/* Teléfono */}
                    <div className="col-12 col-md-3">
                      <label htmlFor="rest-phone" className="form-label">Teléfono</label>
                      <input
                        id="rest-phone"
                        type="text"
                        className="form-control"
                        name="phone"
                        value={formData.phone || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: 600123456"
                      />
                    </div>

                    {/* Dirección */}
                    <div className="col-12">
                      <label htmlFor="rest-address" className="form-label">
                        Dirección <span className="text-danger">*</span>
                      </label>
                      <input
                        id="rest-address"
                        type="text"
                        className={`form-control ${formErrors.address ? 'is-invalid' : ''}`}
                        name="address"
                        value={formData.address || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Calle Principal 123, Madrid"
                        required
                      />
                      {formErrors.address && <div className="invalid-feedback">{formErrors.address}</div>}
                    </div>

                    {/* Email */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="rest-email" className="form-label">Email</label>
                      <input
                        id="rest-email"
                        type="email"
                        className={`form-control ${formErrors.email ? 'is-invalid' : ''}`}
                        name="email"
                        value={formData.email || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: contacto@restaurante.com"
                      />
                      {formErrors.email && <div className="invalid-feedback">{formErrors.email}</div>}
                    </div>

                    {/* Apertura */}
                    <div className="col-6 col-md-3">
                      <label htmlFor="rest-opening" className="form-label">Hora Apertura</label>
                      <input
                        id="rest-opening"
                        type="time"
                        className="form-control"
                        name="openingTime"
                        value={formData.openingTime || ''}
                        onChange={handleFormChange}
                      />
                    </div>

                    {/* Cierre */}
                    <div className="col-6 col-md-3">
                      <label htmlFor="rest-closing" className="form-label">Hora Cierre</label>
                      <input
                        id="rest-closing"
                        type="time"
                        className="form-control"
                        name="closingTime"
                        value={formData.closingTime || ''}
                        onChange={handleFormChange}
                      />
                    </div>

                    {/* Descripción */}
                    <div className="col-12">
                      <label htmlFor="rest-description" className="form-label">Descripción</label>
                      <textarea
                        id="rest-description"
                        className="form-control"
                        name="description"
                        value={formData.description || ''}
                        onChange={handleFormChange}
                        rows={3}
                        placeholder="Breve descripción del restaurante..."
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
                    {editingRestaurant ? 'Actualizar' : 'Crear'} Restaurante
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal: Confirmar Eliminación ═════════════════════════════════ */}
      {showDeleteModal && deletingRestaurant && (
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
                <h6 className="mb-2">¿Estás seguro de eliminar este restaurante?</h6>
                <p className="text-muted mb-0">
                  <strong>{deletingRestaurant?.name || '—'}</strong>
                </p>
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

export default Restaurants;
