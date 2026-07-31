import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import TimeSlotSelector from '../components/TimeSlotSelector';
import useTimeSlots from '../hooks/useTimeSlots';
import {
  fetchPublicRestaurant,
  fetchPublicTimeSlots,
  createPublicReservation,
} from '../services/publicReservationService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getTodayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Formatea una fecha YYYY-MM-DD a español legible */
const formatDate = (dateStr) => {
  if (!dateStr) return '';
  const parts = dateStr.split('-');
  if (parts.length !== 3) return dateStr;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return date.toLocaleDateString('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
};

/** Formatea horario HH:mm o HH:mm:ss a HH:mm */
const formatTimeShort = (time) => {
  if (!time) return null;
  const s = String(time);
  return s.length >= 5 ? s.substring(0, 5) : s;
};

/** Valida el formulario y devuelve objeto con errores */
const validateForm = (data) => {
  const errors = {};

  if (!data.name || !data.name.trim()) {
    errors.name = 'El nombre es obligatorio.';
  }

  if (!data.phone || !data.phone.trim()) {
    errors.phone = 'El teléfono es obligatorio.';
  } else if (!/^[\d\s+\-()]{6,20}$/.test(data.phone.trim())) {
    errors.phone = 'Introduce un teléfono válido (mínimo 6 dígitos).';
  }

  if (!data.email || !data.email.trim()) {
    errors.email = 'El email es obligatorio para recibir la confirmación.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    errors.email = 'Introduce un email válido.';
  }

  if (!data.reservationDate) {
    errors.reservationDate = 'Selecciona una fecha.';
  } else if (data.reservationDate < getTodayStr()) {
    errors.reservationDate = 'No puedes seleccionar una fecha pasada.';
  }

  if (!data.reservationTime) {
    errors.reservationTime = 'Selecciona una hora.';
  }

  const partySize = Number(data.partySize);
  if (!data.partySize || !Number.isInteger(partySize) || partySize < 1) {
    errors.partySize = 'Mínimo 1 persona.';
  } else if (partySize > 50) {
    errors.partySize = 'Máximo 50 personas por reserva.';
  }

  return errors;
};

/** Extrae mensaje de error legible */
const getSafeErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (err instanceof Error) return err.message || 'Error inesperado.';
  if (typeof err === 'string') return err;
  return 'Error inesperado.';
};

// ─── Componente principal ────────────────────────────────────────────────────

const PublicReservation = () => {
  const { restaurantId } = useParams();

  // Estados
  const [restaurant, setRestaurant] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState(null);

  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    email: '',
    reservationDate: '',
    reservationTime: '',
    partySize: '2',
    notes: '',
  });
  const [formErrors, setFormErrors] = useState({});

  const clearSelectedTime = useCallback(() => {
    setFormData((prev) => (prev.reservationTime ? { ...prev, reservationTime: '' } : prev));
  }, []);

  const { slots, loading: loadingSlots, error: slotsError, retry: retrySlots } = useTimeSlots({
    fetcher: fetchPublicTimeSlots,
    restaurantId,
    date: formData.reservationDate,
    partySize: formData.partySize,
    onReset: clearSelectedTime,
  });

  // ─── Cargar datos del restaurante ──────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const loadRestaurant = async () => {
      setLoading(true);
      setLoadError(null);

      try {
        const restData = await fetchPublicRestaurant(restaurantId);
        if (cancelled) return;

        if (!restData) {
          setLoadError('Restaurante no encontrado.');
          setLoading(false);
          return;
        }

        setRestaurant(restData);
      } catch {
        if (!cancelled) {
          setLoadError(
            'No pudimos cargar la información del restaurante. Inténtalo de nuevo más tarde.'
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadRestaurant();

    return () => {
      cancelled = true;
    };
  }, [restaurantId]);

  // ─── Manejar cambios en el formulario ──────────────────────────────────────
  const handleChange = useCallback((e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
    setFormErrors((prev) => {
      if (prev[name]) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return prev;
    });
    setSubmitError(null);
  }, []);

  // ─── Enviar formulario ─────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitError(null);

      const errors = validateForm(formData);
      if (Object.keys(errors).length > 0) {
        setFormErrors(errors);
        return;
      }

      setSubmitting(true);

      try {
        const payload = {
          restaurantId: Number(restaurantId),
          customerName: formData.name.trim(),
          phone: formData.phone.trim(),
          email: formData.email.trim(),
          reservationDate: formData.reservationDate,
          reservationTime: formData.reservationTime,
          partySize: Number(formData.partySize),
          notes: formData.notes ? formData.notes.trim() : '',
        };

        await createPublicReservation(payload);
        setSuccess(true);
      } catch (err) {
        const status = err?.status;
        const msg = getSafeErrorMessage(err);

        if (status === 409) {
          setFormData((prev) => ({ ...prev, reservationTime: '' }));
          retrySlots();
        }

        if (import.meta.env.DEV) {
          console.error('[PublicReservation] Error al enviar la solicitud:', {
            status,
            message: msg,
            error: err,
          });
        }

        if (status === 401 || status === 403) {
          setSubmitError(
            'El sistema de reservas online no está disponible en este momento. ' +
            'Por favor, contacta directamente con el restaurante.'
          );
        } else if (status && status < 500 && msg) {
          // Errores 4xx: el backend ya devuelve un mensaje seguro y en español
          // (validación, restaurante no encontrado, reservas públicas
          // deshabilitadas, etc.) — se lo mostramos tal cual al usuario.
          setSubmitError(msg);
        } else {
          setSubmitError(
            'No hemos podido enviar tu solicitud. Revisa los datos e inténtalo de nuevo.'
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [formData, restaurantId, retrySlots]
  );

  // ─── Resetear formulario para nueva reserva ────────────────────────────────
  const handleNewReservation = useCallback(() => {
    setSuccess(false);
    setFormData({
      name: '',
      phone: '',
      email: '',
      reservationDate: '',
      reservationTime: '',
      partySize: '2',
      notes: '',
    });
    setFormErrors({});
    setSubmitError(null);
  }, []);

  // ─── Render: Loading ──────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="public-page">
        <div className="public-loading">
          <div className="spinner-border mb-3" role="status" style={{ width: '2.5rem', height: '2.5rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="public-loading-text">Cargando información del restaurante...</p>
        </div>
      </div>
    );
  }

  // ─── Render: Error de carga ───────────────────────────────────────────────
  if (loadError) {
    return (
      <div className="public-page">
        <div className="public-error">
          <div className="public-error-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="public-error-title">Restaurante no disponible</h2>
          <p className="public-error-message">{loadError}</p>
        </div>
      </div>
    );
  }

  // ─── Render: Restaurante no encontrado ────────────────────────────────────
  if (!restaurant) {
    return (
      <div className="public-page">
        <div className="public-error">
          <div className="public-error-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
          <h2 className="public-error-title">Restaurante no encontrado</h2>
          <p className="public-error-message">
            El enlace que has utilizado no es válido. Comprueba la dirección o contacta con el restaurante.
          </p>
        </div>
      </div>
    );
  }

  // ─── Render: Éxito ────────────────────────────────────────────────────────
  if (success) {
    const partySize = Number(formData.partySize) || 0;
    return (
      <div className="public-page">
        <div className="public-success">
          <div className="public-success-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
              <polyline points="22 4 12 14.01 9 11.01" />
            </svg>
          </div>

          <h2 className="public-success-title">Solicitud enviada correctamente</h2>
          <p className="public-success-message">
            Hemos recibido tu solicitud. El restaurante te confirmar&aacute; por email.
          </p>

          <div className="public-success-detail-card">
            <div className="public-success-detail-row">
              <span className="public-success-detail-label">Restaurante</span>
              <span className="public-success-detail-value">{restaurant.name}</span>
            </div>
            <div className="public-success-detail-row">
              <span className="public-success-detail-label">Fecha</span>
              <span className="public-success-detail-value">{formatDate(formData.reservationDate)}</span>
            </div>
            <div className="public-success-detail-row">
              <span className="public-success-detail-label">Hora</span>
              <span className="public-success-detail-value">{formatTimeShort(formData.reservationTime)}</span>
            </div>
            <div className="public-success-detail-row">
              <span className="public-success-detail-label">Personas</span>
              <span className="public-success-detail-value">
                {partySize} {partySize === 1 ? 'persona' : 'personas'}
              </span>
            </div>
          </div>

          <button
            className="public-submit-btn public-success-btn"
            onClick={handleNewReservation}
            type="button"
          >
            Hacer otra reserva
          </button>
        </div>
      </div>
    );
  }

  // ─── Render: Formulario ────────────────────────────────────────────────────
  const today = getTodayStr();

  return (
    <div className="public-page">
      {/* ═══ HEADER: Info del restaurante ═══════════════════════════════════ */}
      <header className="public-header">
        <div className="public-header-brand">
          <div className="public-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <h1 className="public-header-title">{restaurant.name || 'Restaurante'}</h1>
          <p className="public-header-subtitle">Reserva tu mesa online</p>
        </div>

        {/* Datos del restaurante */}
        <div className="public-header-info">
          {restaurant.address && (
            <span className="public-header-info-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                <circle cx="12" cy="10" r="3" />
              </svg>
              {restaurant.address}
            </span>
          )}
          {restaurant.phone && (
            <span className="public-header-info-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
              </svg>
              {restaurant.phone}
            </span>
          )}
          {restaurant.openingTime && restaurant.closingTime && (
            <span className="public-header-info-item">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <polyline points="12 6 12 12 16 14" />
              </svg>
              {formatTimeShort(restaurant.openingTime)} &mdash; {formatTimeShort(restaurant.closingTime)}
            </span>
          )}
        </div>

        {restaurant.description && (
          <p className="public-header-desc">{restaurant.description}</p>
        )}
      </header>

      {/* ═══ FORMULARIO ════════════════════════════════════════════════════ */}
      <div className="public-card">
        <div className="public-card-header">
          <h2 className="public-card-title">Solicitar reserva</h2>
          <p className="public-card-subtitle">
            El restaurante revisar&aacute; tu solicitud y confirmar&aacute; la disponibilidad.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Error general */}
          {submitError && (
            <div className="public-alert public-alert-danger" role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span>{submitError}</span>
            </div>
          )}

          {/* Fila: Fecha + Personas */}
          <div className="public-form-row">
            <div className="public-form-group">
              <label htmlFor="res-date" className="public-label">
                Fecha <span className="text-danger">*</span>
              </label>
              <input
                id="res-date"
                type="date"
                name="reservationDate"
                className={`public-input ${formErrors.reservationDate ? 'public-input-error' : ''}`}
                value={formData.reservationDate}
                onChange={handleChange}
                min={today}
              />
              {formErrors.reservationDate && (
                <span className="public-field-error">{formErrors.reservationDate}</span>
              )}
            </div>

            <div className="public-form-group">
              <label htmlFor="res-party" className="public-label">
                N&uacute;mero de personas <span className="text-danger">*</span>
              </label>
              <input
                id="res-party"
                type="number"
                name="partySize"
                className={`public-input ${formErrors.partySize ? 'public-input-error' : ''}`}
                value={formData.partySize}
                onChange={handleChange}
                min="1"
                max="50"
                step="1"
                placeholder="Ej: 2"
              />
              {formErrors.partySize && (
                <span className="public-field-error">{formErrors.partySize}</span>
              )}
            </div>
          </div>

          {/* Hora */}
          <div className="public-form-group">
            <label className="public-label" htmlFor="reservationTime">Hora</label>
            <TimeSlotSelector
              slots={slots}
              value={formData.reservationTime}
              onChange={(time) => {
                setFormData((prev) => ({ ...prev, reservationTime: time }));
                setFormErrors((prev) => {
                  const next = { ...prev };
                  delete next.reservationTime;
                  return next;
                });
              }}
              loading={loadingSlots}
              error={slotsError}
              onRetry={retrySlots}
              disabled={!formData.reservationDate}
            />
            {formErrors.reservationTime && (
              <span className="public-field-error">{formErrors.reservationTime}</span>
            )}
          </div>

          <hr className="public-divider" />

          {/* Nombre */}
          <div className="public-form-group">
            <label htmlFor="res-name" className="public-label">
              Nombre <span className="text-danger">*</span>
            </label>
            <input
              id="res-name"
              type="text"
              name="name"
              className={`public-input ${formErrors.name ? 'public-input-error' : ''}`}
              value={formData.name}
              onChange={handleChange}
              placeholder="Tu nombre completo"
              autoComplete="name"
            />
            {formErrors.name && (
              <span className="public-field-error">{formErrors.name}</span>
            )}
          </div>

          {/* Fila: Teléfono + Email */}
          <div className="public-form-row">
            <div className="public-form-group">
              <label htmlFor="res-phone" className="public-label">
                Tel&eacute;fono <span className="text-danger">*</span>
              </label>
              <input
                id="res-phone"
                type="tel"
                name="phone"
                className={`public-input ${formErrors.phone ? 'public-input-error' : ''}`}
                value={formData.phone}
                onChange={handleChange}
                placeholder="Ej: 600 123 456"
                autoComplete="tel"
              />
              {formErrors.phone && (
                <span className="public-field-error">{formErrors.phone}</span>
              )}
            </div>

            <div className="public-form-group">
              <label htmlFor="res-email" className="public-label">
                Email <span className="text-danger">*</span>
              </label>
              <input
                id="res-email"
                type="email"
                name="email"
                className={`public-input ${formErrors.email ? 'public-input-error' : ''}`}
                value={formData.email}
                onChange={handleChange}
                placeholder="tu@email.com"
                autoComplete="email"
              />
              {formErrors.email && (
                <span className="public-field-error">{formErrors.email}</span>
              )}
            </div>
          </div>

          {/* Notas */}
          <div className="public-form-group">
            <label htmlFor="res-notes" className="public-label">
              Notas <span className="public-label-optional">(opcional)</span>
            </label>
            <textarea
              id="res-notes"
              name="notes"
              className="public-input public-textarea"
              value={formData.notes}
              onChange={handleChange}
              placeholder="Alergias, celebraciones, peticiones especiales..."
              rows={3}
            />
          </div>

          {/* Botón enviar */}
          <button
            type="submit"
            className="public-submit-btn"
            disabled={submitting}
          >
            {submitting ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                Enviando solicitud...
              </>
            ) : (
              'Enviar solicitud'
            )}
          </button>

          <p className="public-footer-text">
            Al enviar este formulario, aceptas que el restaurante gestione tus datos para procesar tu solicitud.
          </p>
        </form>
      </div>

      {/* ═══ FOOTER ════════════════════════════════════════════════════════ */}
      <footer className="public-footer">
        <p>
          Gestionado con <strong>Restaurant Manager</strong> &middot;{' '}
          <Link to="/login" className="public-footer-link">Acceso privado</Link>
        </p>
      </footer>
    </div>
  );
};

export default PublicReservation;
