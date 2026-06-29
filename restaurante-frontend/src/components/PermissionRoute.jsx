import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccess, getPermissionDeniedContext } from '../config/permissions';

/**
 * Protege una ruta por permiso.
 * Si el usuario no tiene el permiso requerido, muestra una pantalla profesional
 * de "Acceso restringido" con mensaje contextual y acciones para volver.
 *
 * Uso:
 *   <PermissionRoute permission={PERMISSIONS.VIEW_ANALYTICS}>
 *     <Analytics />
 *   </PermissionRoute>
 */
const PermissionRoute = ({ children, permission }) => {
  const { user, isAuthenticated, loading } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { contextualMessage } = getPermissionDeniedContext(location.pathname);

  // Mientras se verifica la sesión
  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Verificando acceso...</span>
        </div>
      </div>
    );
  }

  // Si no está autenticado, redirigir al login
  if (!isAuthenticated) {
    return <Navigate to="/login" state={{ from: location }} replace />;
  }

  // Si no tiene permiso, mostrar página profesional de acceso denegado
  if (!canAccess(user, permission)) {
    return (
      <div className="permission-denied-page">
        <div className="permission-denied-card">
          {/* Icono de escudo con check */}
          <div className="permission-denied-icon">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <path d="M9 12l2 2 4-4" />
            </svg>
          </div>

          {/* Código sutil no protagonista */}
          <span className="permission-denied-code">403</span>

          {/* Título principal */}
          <h1 className="permission-denied-title">Acceso restringido</h1>

          {/* Mensaje contextual */}
          <p className="permission-denied-message">{contextualMessage}</p>

          {/* Mensaje secundario */}
          <p className="permission-denied-secondary">
            Si crees que deberías tener acceso, contacta con un administrador.
          </p>

          {/* Acciones */}
          <div className="permission-denied-actions">
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => navigate('/inicio')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
              Volver al Inicio
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => navigate('/reservations')}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
              </svg>
              Ir a Reservas
            </button>
          </div>
        </div>
      </div>
    );
  }

  return children;
};

export default PermissionRoute;
