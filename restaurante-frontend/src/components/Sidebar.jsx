import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccess, SIDEBAR_PERMISSIONS, ROLE_LABELS, normalizeRole } from '../config/permissions';

// ─── SVG icons para cada ruta ──────────────────────────────────────────────
const icons = {
  dashboard: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  restaurants: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  ),
  tables: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
    </svg>
  ),
  customers: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  ),
  employees: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  ),
  reservations: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  ),
  floorPlan: (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <rect x="14" y="14" width="7" height="7" rx="1" />
      <circle cx="6.5" cy="6.5" r="1.5" />
      <circle cx="17.5" cy="6.5" r="1.5" />
      <circle cx="6.5" cy="17.5" r="1.5" />
      <circle cx="17.5" cy="17.5" r="1.5" />
    </svg>
  ),
};

// ─── Grupos de navegación ──────────────────────────────────────────────────
// Organizado por áreas de producto: Operativa, Negocio, Administración.
// Dashboard queda aparte como entrada principal.
const navGroups = [
  {
    items: [
      { path: '/inicio', label: 'Inicio', icon: 'dashboard' },
    ],
  },
  {
    title: 'OPERATIVA',
    items: [
      { path: '/reservations', label: 'Reservas', icon: 'reservations' },
      { path: '/floor-plan', label: 'Plano de sala', icon: 'floorPlan' },
      { path: '/customers', label: 'Clientes', icon: 'customers' },
    ],
  },
  {
    title: 'ADMINISTRACIÓN',
    items: [
      { path: '/restaurants', label: 'Restaurantes', icon: 'restaurants' },
      { path: '/employees', label: 'Empleados', icon: 'employees' },
    ],
  },
];

const Sidebar = ({ show, onClose }) => {
  const { user } = useAuth();
  const location = useLocation();

  const handleLinkClick = () => {
    if (onClose) onClose();
  };

  return (
    <>
      {/* Overlay para móvil */}
      {show && (
        <div
          className="sidebar-overlay"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.5)',
            zIndex: 999,
          }}
          onClick={onClose}
        />
      )}

      <aside className={`sidebar ${show ? 'open' : ''}`}>
        {/* Logo */}
        <div className="sidebar-brand">
          <div className="sidebar-brand-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <span className="sidebar-brand-text">Restaurant Manager</span>
        </div>

        {/* Navegación */}
        <nav aria-label="Navegación principal">
          <ul className="sidebar-nav">
            {navGroups.map((group, gi) => {
              // Filtrar items del grupo según permisos del usuario
              const visibleItems = group.items.filter((item) => {
                const required = SIDEBAR_PERMISSIONS[item.path];
                return !required || canAccess(user, required);
              });
              // No renderizar grupos vacíos
              if (visibleItems.length === 0) return null;
              return (
                <li key={gi} className="sidebar-nav-group">
                  {group.title && (
                    <span className="sidebar-section-title">{group.title}</span>
                  )}
                  <ul className="sidebar-nav-items">
                    {visibleItems.map((item) => {
                      const isActivePath = location.pathname === item.path;
                      return (
                        <li key={item.path} className="nav-item">
                          <NavLink
                            to={item.path}
                            className={`nav-link ${isActivePath ? 'active' : ''}`}
                            onClick={handleLinkClick}
                          >
                            {icons[item.icon]}
                            <span>{item.label}</span>
                          </NavLink>
                        </li>
                      );
                    })}
                  </ul>
                </li>
              );
            })}
          </ul>
        </nav>

        {/* Footer con usuario */}
        {user && (
          <div className="sidebar-footer">
            <div className="sidebar-user">
              <div className="sidebar-user-avatar">
                {user.username ? user.username.charAt(0).toUpperCase() : '?'}
              </div>
              <div>
                <div className="sidebar-user-name">
                  {user.username || 'Usuario'}
                </div>
                {user.email && (
                  <span className="sidebar-user-email">{user.email}</span>
                )}
                <span className="sidebar-user-role">{ROLE_LABELS[normalizeRole(user.role)] || user.role}</span>
              </div>
            </div>
          </div>
        )}
      </aside>
    </>
  );
};

export default Sidebar;
