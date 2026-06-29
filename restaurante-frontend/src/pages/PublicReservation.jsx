import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  fetchPublicRestaurant,
  createPublicReservation,
} from '../services/publicReservationService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Obtiene la fecha de hoy en formato YYYY-MM-DD */
const getTodayStr = () => {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

/** Valida el formulario y devuelve un objeto con errores */
const validateForm = (data) => {
  const errors = {};

  if (!data.name || !data.name.trim()) {
    errors.name = 'El nombre es obligatorio.';
  }

  if (!data.phone || !data.phone.trim()) {
    errors.phone = 'El teléfono es obligatorio.';
  } else if (!/^[\d\s+\-()]{6,20}$/.test(data.phone.trim())) {
    errors.phone = 'Introduce un teléfono válido.';
  }

  if (!data.email || !data.email.trim()) {
    errors.email = 'El email es obligatorio.';
  } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email.trim())) {
    errors.email = 'Introduce un email válido.';
  }

  if (!data.reservationDate) {
    errors.reservationDate = 'La fecha es obligatoria.';
  } else if (data.reservationDate < getTodayStr()) {
    errors.reservationDate = 'No puedes seleccionar una fecha pasada.';
  }

  if (!data.reservationTime) {
    errors.reservationTime = 'La hora es obligatoria.';
  }

  const partySize = Number(data.partySize);
  if (!data.partySize || !Number.isInteger(partySize) || partySize < 1) {
    errors.partySize = 'El número de personas debe ser al menos 1.';
  } else if (partySize > 50) {
    errors.partySize = 'Máximo 50 personas por reserva.';
  }

  return errors;
};

/** Extrae un mensaje de error legible */
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
      } catch (err) {
        if (!cancelled) {
          setLoadError(
            err?.message === 'Error del servidor'
              ? 'No pudimos cargar la información del restaurante. Inténtalo de nuevo más tarde.'
              : getSafeErrorMessage(err)
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
    // Limpiar error del campo al escribir
    setFormErrors((prev) => {
      if (prev[name]) {
        const next = { ...prev };
        delete next[name];
        return next;
      }
      return prev;
    });
    // Limpiar errores generales
    setSubmitError(null);
  }, []);

  // ─── Enviar formulario ─────────────────────────────────────────────────────
  const handleSubmit = useCallback(
    async (e) => {
      e.preventDefault();
      setSubmitError(null);

      // Validar
      const errors = validateForm(formData);
      if (Object.keys(errors).length > 0) {
        setFormErrors(errors);
        return;
      }

      setSubmitting(true);

      try {
        // Enviar solicitud de reserva como PENDING
        // No se comprueba disponibilidad — es una solicitud que el restaurante revisará
        // Nota: restaurantId se pasa para que createPublicReservation lo ponga en la URL
        // phone y email coinciden con los nombres de campo del formulario y del DTO backend
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

        // Mostrar éxito
        setSuccess(true);
      } catch (err) {
        const msg = getSafeErrorMessage(err);

        // Si el backend aún no soporta creación pública de reservas,
        // mostramos un mensaje claro y accionable.
        if (
          msg.toLowerCase().includes('unauthorized') ||
          msg.toLowerCase().includes('autenticación') ||
          msg.toLowerCase().includes('token') ||
          msg.toLowerCase().includes('403')
        ) {
          setSubmitError(
            'El sistema de reservas online no está disponible en este momento. ' +
            'Por favor, contacta directamente con el restaurante para hacer tu reserva.'
          );
        } else if (
          msg.toLowerCase().includes('deserialize') ||
          msg.toLowerCase().includes('localtime') ||
          msg.toLowerCase().includes('formato') ||
          msg.toLowerCase().includes('formato de hora') ||
          msg.toLowerCase().includes('cannot deserialize')
        ) {
          setSubmitError(
            'No se pudo enviar la solicitud. Revisa la fecha y la hora e inténtalo de nuevo.'
          );
        } else {
          setSubmitError(
            'No se pudo enviar la solicitud. Revisa los datos e inténtalo de nuevo.'
          );
        }
      } finally {
        setSubmitting(false);
      }
    },
    [formData, restaurantId]
  );

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

  // ─── Render: Sin restaurante ──────────────────────────────────────────────
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
          <p className="public-error-message">El enlace que has utilizado no es válido. Comprueba la dirección o contacta con el restaurante.</p>
        </div>
      </div>
    );
  }

  // ─── Render: Éxito ────────────────────────────────────────────────────────
  if (success) {
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
            Hemos recibido tu solicitud de reserva para <strong>{restaurant.name || 'el restaurante'}</strong>.
          </p>
          <p className="public-success-detail">
            {formData.reservationDate && formData.reservationTime && (
              <>Fecha: {formData.reservationDate} a las {formData.reservationTime}</>
            )}
            {formData.partySize && <> · {formData.partySize} {Number(formData.partySize) === 1 ? 'persona' : 'personas'}</>}
          </p>
          <p className="public-success-secondary">
            El restaurante revisará tu solicitud y te confirmará la disponibilidad.
          </p>
          <button
            className="public-submit-btn"
            onClick={() => {
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
            }}
            type="button"
            style={{ marginTop: '1rem' }}
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
      {/* Header del restaurante */}
      <header className="public-header">
        <div className="public-header-brand">
          <div className="public-header-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div>
            <h1 className="public-header-title">{restaurant.name || 'Restaurante'}</h1>
            <p className="public-header-subtitle">Solicita tu reserva online</p>
          </div>
        </div>
        {restaurant.description && (
          <p className="public-header-desc">{restaurant.description}</p>
        )}
      </header>

      {/* Card del formulario */}
      <div className="public-card">
        <div className="public-card-header">
          <h2 className="public-card-title">Solicitar reserva</h2>
          <p className="public-card-subtitle">
            El restaurante revisará tu solicitud y confirmará la disponibilidad.
          </p>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          {/* Error general de submit */}
          {submitError && (
            <div className="public-alert public-alert-danger" role="alert">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              <span>{submitError}</span>
            </div>
          )}

          {/* Fecha y hora */}
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
              <label htmlFor="res-time" className="public-label">
                Hora <span className="text-danger">*</span>
              </label>
              <input
                id="res-time"
                type="time"
                name="reservationTime"
                className={`public-input ${formErrors.reservationTime ? 'public-input-error' : ''}`}
                value={formData.reservationTime}
                onChange={handleChange}
              />
              {formErrors.reservationTime && (
                <span className="public-field-error">{formErrors.reservationTime}</span>
              )}
            </div>
          </div>

          {/* Personas */}
          <div className="public-form-group">
            <label htmlFor="res-party" className="public-label">
              Número de personas <span className="text-danger">*</span>
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

          {/* Línea separadora */}
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

          {/* Teléfono y Email */}
          <div className="public-form-row">
            <div className="public-form-group">
              <label htmlFor="res-phone" className="public-label">
                Teléfono <span className="text-danger">*</span>
              </label>
              <input
                id="res-phone"
                type="tel"
                name="phone"
                className={`public-input ${formErrors.phone ? 'public-input-error' : ''}`}
                value={formData.phone}
                onChange={handleChange}
                placeholder="Ej: 600123456"
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

          {/* Botón submit */}
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
            Al enviar este formulario, aceptas que el restaurante gestione tus datos para gestionar tu solicitud.
          </p>
        </form>
      </div>

      {/* Footer */}
      <footer className="public-footer">
        <p>
          Funciona con <strong>Restaurant Manager</strong> ·{' '}
          <Link to="/login" className="public-footer-link">Acceso privado</Link>
        </p>
      </footer>
    </div>
  );
};

export default PublicReservation;
