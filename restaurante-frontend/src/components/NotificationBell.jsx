import { useNotifications } from '../context/NotificationContext';
import NotificationPanel from './NotificationPanel';

const NotificationBell = () => {
  const { unreadCount, panelOpen, togglePanel, notifications, loading } = useNotifications();

  return (
    <div className="notification-bell-wrapper">
      <button
        className="notification-bell-btn"
        onClick={togglePanel}
        type="button"
        title="Notificaciones"
        aria-label={`Notificaciones${unreadCount > 0 ? `, ${unreadCount} sin leer` : ''}`}
        aria-expanded={panelOpen}
      >
        {/* Bell icon */}
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Badge count */}
        {unreadCount > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}

        {/* Small pulse dot when loading */}
        {loading && notifications.length === 0 && (
          <span className="notification-loading-dot" aria-hidden="true" />
        )}
      </button>

      {/* Dropdown Panel */}
      {panelOpen && <NotificationPanel />}
    </div>
  );
};

export default NotificationBell;
