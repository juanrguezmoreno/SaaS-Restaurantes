import { useNotifications } from '../context/NotificationContext';
import { getRelativeTime } from '../services/notificationService';
import { useNavigate } from 'react-router-dom';

const Notifications = () => {
  const { notifications, loading, error, refresh } = useNotifications();
  const navigate = useNavigate();

  const handleNotificationClick = (notification) => {
    if (notification.linkTo) {
      navigate(notification.linkTo);
    }
  };

  const getPriorityLabel = (priority) => {
    switch (priority) {
      case 'alert': return 'Crítica';
      case 'warning': return 'Advertencia';
      case 'info': return 'Informativa';
      default: return '';
    }
  };

  return (
    <div className="notifications-page">
      {/* Page Header */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <h1>Centro de Notificaciones</h1>
          <p className="page-description">
            Mantente al tanto de lo que ocurre en tu restaurante
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          <button
            className="btn btn-secondary d-flex align-items-center gap-2"
            onClick={refresh}
            type="button"
            disabled={loading}
            title="Actualizar notificaciones"
          >
            {loading ? (
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
            ) : (
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="23 4 23 10 17 10" />
                <polyline points="1 20 1 14 7 14" />
                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
              </svg>
            )}
            Actualizar
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="exec-alert exec-alert-error mb-4" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
          <span className="flex-grow-1">{error}</span>
          <button className="exec-alert-btn" onClick={refresh} type="button">Reintentar</button>
        </div>
      )}

      {/* Loading state */}
      {loading && notifications.length === 0 && (
        <div className="loading-state">
          <div className="spinner-border mb-3" role="status" style={{ width: '2.25rem', height: '2.25rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="text-muted mb-0">Analizando datos del restaurante...</p>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && notifications.length === 0 && (
        <div className="app-card">
          <div className="empty-state">
            <div className="empty-state-icon" style={{ background: 'var(--success-light)', color: 'var(--success)' }}>
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h5>Todo funciona correctamente</h5>
            <p>No hay novedades que reportar. Sigue así, tu restaurante está bajo control.</p>
          </div>
        </div>
      )}

      {/* Notifications list */}
      {notifications.length > 0 && (
        <div className="notifications-list-full">
          {notifications.map((n) => {
            let priorityClass = 'info';
            let priorityBadgeClass = 'badge-info';
            if (n.priority === 'alert') {
              priorityClass = 'alert';
              priorityBadgeClass = 'badge-alert';
            } else if (n.priority === 'warning') {
              priorityClass = 'warning';
              priorityBadgeClass = 'badge-warning';
            }

            return (
              <div
                key={n.id}
                className={`notification-card-full ${priorityClass}`}
                onClick={() => handleNotificationClick(n)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleNotificationClick(n);
                  }
                }}
              >
                <div className="notification-full-left">
                  <div className={`notification-full-icon ${priorityClass}`}>
                    {n.icon}
                  </div>
                </div>
                <div className="notification-full-content">
                  <div className="notification-full-header">
                    <span className="notification-full-title">{n.title}</span>
                    <span className={`notification-full-badge ${priorityBadgeClass}`}>
                      {getPriorityLabel(n.priority)}
                    </span>
                    <span className="notification-full-time">
                      {getRelativeTime(n.timestamp)}
                    </span>
                  </div>
                  <p className="notification-full-desc">{n.description}</p>
                </div>
                {n.linkTo && (
                  <div className="notification-full-arrow">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="9 18 15 12 9 6" />
                    </svg>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Stats footer */}
      {notifications.length > 0 && (
        <div className="notifications-stats">
          <span>
            Mostrando {notifications.length} de {notifications.length} notificaciones
          </span>
          <span className="text-muted">
            · Actualizado hace unos segundos
          </span>
        </div>
      )}
    </div>
  );
};

export default Notifications;
