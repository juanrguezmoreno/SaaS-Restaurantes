import { useNavigate } from 'react-router-dom';
import { useNotifications } from '../context/NotificationContext';
import { getRelativeTime } from '../services/notificationService';

const NotificationPanel = () => {
  const { notifications, loading, error, closePanel, refresh } = useNotifications();
  const navigate = useNavigate();

  const handleNotificationClick = (notification) => {
    closePanel();
    if (notification.linkTo) {
      navigate(notification.linkTo);
    }
  };

  const handleViewAll = () => {
    closePanel();
    navigate('/notifications');
  };

  return (
    <>
      {/* Backdrop for mobile */}
      <div className="notification-backdrop" onClick={closePanel} aria-hidden="true" />

      <div className="notification-panel" role="dialog" aria-label="Centro de notificaciones">
        {/* Header */}
        <div className="notification-panel-header">
          <h3 className="notification-panel-title">Notificaciones</h3>
          <button
            className="notification-panel-close"
            onClick={closePanel}
            type="button"
            aria-label="Cerrar panel"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className="notification-panel-body">
          {/* Loading state */}
          {loading && notifications.length === 0 && (
            <div className="notification-state">
              <div className="spinner-border spinner-border-sm mb-2" role="status" style={{ color: 'var(--primary)' }}>
                <span className="visually-hidden">Cargando...</span>
              </div>
              <p className="notification-state-text">Analizando datos...</p>
            </div>
          )}

          {/* Error state */}
          {error && (
            <div className="notification-state">
              <div className="notification-state-icon error">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <p className="notification-state-text">{error}</p>
              <button className="btn btn-sm btn-primary mt-2" onClick={refresh} type="button">
                Reintentar
              </button>
            </div>
          )}

          {/* Empty state */}
          {!loading && !error && notifications.length === 0 && (
            <div className="notification-state">
              <div className="notification-state-icon success">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <p className="notification-state-text">Todo funciona correctamente</p>
              <span className="notification-state-sub">No hay novedades que reportar</span>
            </div>
          )}

          {/* Notifications list */}
          {notifications.length > 0 && (
            <div className="notification-list">
              {notifications.map((n) => {
                let priorityClass = 'info';
                if (n.priority === 'alert') priorityClass = 'alert';
                else if (n.priority === 'warning') priorityClass = 'warning';

                return (
                  <div
                    key={n.id}
                    className={`notification-card ${priorityClass}`}
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
                    <div className="notification-card-icon">{n.icon}</div>
                    <div className="notification-card-content">
                      <div className="notification-card-title">{n.title}</div>
                      <div className="notification-card-desc">{n.description}</div>
                      <div className="notification-card-time">
                        {getRelativeTime(n.timestamp)}
                      </div>
                    </div>
                    <div className={`notification-card-priority ${priorityClass}`} />
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="notification-panel-footer">
          <button
            className="notification-view-all-btn"
            onClick={handleViewAll}
            type="button"
          >
            Ver todas las notificaciones
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
};

export default NotificationPanel;
