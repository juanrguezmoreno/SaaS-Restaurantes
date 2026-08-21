import { useEffect } from 'react';

// ─── Helpers ────────────────────────────────────────────────────────────────

const formatTime = (time) => {
  if (!time) return null;
  const str = String(time);
  return str.length >= 5 ? str.substring(0, 5) : str;
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const Field = ({ label, children }) => (
  <div>
    <div className="detail-field-label">{label}</div>
    <div className="detail-field-value">{children || '—'}</div>
  </div>
);

/**
 * Detalle de un restaurante, con su enlace público de reservas y las acciones
 * de código QR.
 *
 * Antes esos enlaces y botones se listaban para TODOS los restaurantes debajo
 * de la tabla, lo que crecía sin límite. Aquí se muestran solo para el
 * restaurante que se abre, y el QR se genera únicamente cuando se pide: este
 * componente no dibuja ningún QR por su cuenta.
 *
 * @param {object} props
 * @param {object} props.restaurant
 * @param {() => void} props.onClose
 * @param {() => void} [props.onEdit]         Ir a la configuración.
 * @param {() => void} [props.onShowQR]       Abrir el modal del QR.
 * @param {() => void} [props.onDownloadQR]   Descargar el QR.
 * @param {() => void} [props.onCopyLink]
 * @param {boolean} [props.downloadingQR]
 */
const RestaurantDetailModal = ({
  restaurant,
  onClose,
  onEdit,
  onShowQR,
  onDownloadQR,
  onCopyLink,
  downloadingQR = false,
}) => {
  // Cerrar con Escape, como el resto de los modales de la app.
  useEffect(() => {
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  if (!restaurant) return null;

  const publicLink = restaurant.id
    ? `${window.location.origin}/public/reservar/${restaurant.id}`
    : '';

  const schedule =
    restaurant.openingTime && restaurant.closingTime
      ? `${formatTime(restaurant.openingTime)} - ${formatTime(restaurant.closingTime)}`
      : null;

  return (
    <div
      className="modal d-block"
      tabIndex={-1}
      role="dialog"
      aria-labelledby="restaurant-detail-title"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-lg modal-dialog-centered modal-dialog-scrollable"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title" id="restaurant-detail-title">
              {restaurant.name || 'Restaurante'}
            </h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Cerrar" />
          </div>

          <div className="modal-body">
            {/* ─── Datos del restaurante ─────────────────────────────── */}
            <div className="detail-grid">
              <Field label="Cuenta">{restaurant.tenantName}</Field>
              <Field label="Identificador">{restaurant.id}</Field>
              <Field label="Dirección">{restaurant.address}</Field>
              <Field label="Teléfono">{restaurant.phone}</Field>
              <Field label="Email">{restaurant.email}</Field>
              <Field label="Capacidad">
                {restaurant.capacity ?? null}
              </Field>
              <Field label="Horario">{schedule}</Field>
              <Field label="Fecha de alta">{formatDate(restaurant.createdAt)}</Field>
              <Field label="Reservas online">
                <span
                  className={`badge-status ${restaurant.publicBookingEnabled ? 'available' : 'maintenance'}`}
                >
                  {restaurant.publicBookingEnabled ? 'Activas' : 'Desactivadas'}
                </span>
              </Field>
            </div>

            {/* ─── Reservas online ───────────────────────────────────── */}
            <div className="detail-section">
              <div className="detail-section-title">Reservas online</div>
              <p className="public-link-desc">
                Comparte este enlace o su código QR en WhatsApp, Instagram, Google Business o tu
                web para que tus clientes reserven online.
              </p>

              <span className="detail-link">{publicLink}</span>

              <div className="d-flex flex-wrap gap-2 mt-3">
                <button
                  type="button"
                  className="online-reservation-btn online-reservation-btn-copy"
                  onClick={onCopyLink}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                  </svg>
                  Copiar enlace
                </button>

                <a
                  className="online-reservation-btn online-reservation-btn-open"
                  href={publicLink}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                    <polyline points="15 3 21 3 21 9" />
                    <line x1="10" y1="14" x2="21" y2="3" />
                  </svg>
                  Abrir página
                </a>

                <button
                  type="button"
                  className="online-reservation-btn online-reservation-btn-qr-view"
                  onClick={onShowQR}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                  Ver QR
                </button>

                <button
                  type="button"
                  className="online-reservation-btn online-reservation-btn-qr-download"
                  onClick={onDownloadQR}
                  disabled={downloadingQR}
                >
                  {downloadingQR ? (
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                      <polyline points="7 10 12 15 17 10" />
                      <line x1="12" y1="15" x2="12" y2="3" />
                    </svg>
                  )}
                  Descargar QR
                </button>
              </div>
            </div>
          </div>

          <div className="modal-footer">
            <button type="button" className="btn btn-secondary" onClick={onClose}>
              Cerrar
            </button>
            {onEdit && (
              <button type="button" className="btn btn-primary" onClick={onEdit}>
                Editar restaurante
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RestaurantDetailModal;
