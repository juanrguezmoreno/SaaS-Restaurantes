import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import NotificationBell from './NotificationBell';
import { ROLE_LABELS, normalizeRole } from '../config/permissions';

// ─── Mapa de breadcrumbs ──────────────────────────────────────────────────
const breadcrumbMap = {
  '/dashboard': { parent: null, label: 'Inicio' },
  '/inicio': { parent: null, label: 'Inicio' },
  '/restaurants': { parent: null, label: 'Restaurantes' },
  '/tables': { parent: null, label: 'Gestión de mesas' },
  '/customers': { parent: null, label: 'Clientes' },
  '/employees': { parent: null, label: 'Empleados' },
  '/reservations': { parent: null, label: 'Reservas' },
  '/floor-plan': { parent: null, label: 'Plano de sala' },
  '/notifications': { parent: null, label: 'Notificaciones' },
  '/analytics': { parent: null, label: 'Analítica' },
};

const parentLabels = {
  '/restaurants': 'Restaurantes',
};

const Navbar = ({ onToggleSidebar }) => {
  const { user, logout } = useAuth();
  const { isDarkMode, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  // Determinar breadcrumb
  const routeKey = location.pathname;
  const bc = breadcrumbMap[routeKey] || null;

  return (
    <header className="app-header">
      <div className="app-header-left">
        <button
          className="header-hamburger"
          onClick={onToggleSidebar}
          aria-label="Toggle sidebar"
          type="button"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        {bc && (
          <div className="header-breadcrumb">
            {bc.parent && (
              <>
                <span className="header-breadcrumb-parent">{parentLabels[bc.parent] || bc.parent}</span>
                <span className="header-breadcrumb-separator">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </span>
              </>
            )}
            <span className="header-breadcrumb-current">{bc.label}</span>
          </div>
        )}
      </div>

      <div className="app-header-right">
        {user && (
          <div className="header-user">
            <div className="header-user-avatar">
              {user.username ? user.username.charAt(0).toUpperCase() : '?'}
            </div>
            <div className="header-user-info">
              <span className="header-user-name">
                {user.username || 'Usuario'}
              </span>
              <span className="header-user-role">{ROLE_LABELS[normalizeRole(user.role)] || user.role}</span>
            </div>
          </div>
        )}

        {/* Notification Bell */}
        <NotificationBell />

        {/* Theme Toggle Button */}
        <button
          className="header-theme-btn"
          onClick={toggleTheme}
          type="button"
          title={isDarkMode ? 'Modo claro' : 'Modo oscuro'}
          aria-label={isDarkMode ? 'Cambiar a modo claro' : 'Cambiar a modo oscuro'}
        >
          {isDarkMode ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="5" />
              <line x1="12" y1="1" x2="12" y2="3" />
              <line x1="12" y1="21" x2="12" y2="23" />
              <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
              <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
              <line x1="1" y1="12" x2="3" y2="12" />
              <line x1="21" y1="12" x2="23" y2="12" />
              <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
              <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
            </svg>
          )}
        </button>

        <button
          className="header-logout-btn"
          onClick={handleLogout}
          type="button"
          title="Cerrar sesión"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
          <span className="d-none d-sm-inline">Salir</span>
        </button>
      </div>
    </header>
  );
};

export default Navbar;
