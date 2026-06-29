import { useState } from 'react';
import { useNavigate, useLocation, Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Login = () => {
  const [usernameOrEmail, setUsernameOrEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const { login, isAuthenticated, loading } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  // Mientras se verifica la sesión, mostrar spinner
  if (loading) {
    return (
      <div className="d-flex justify-content-center align-items-center" style={{ minHeight: '100vh' }}>
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Verificando sesión...</span>
        </div>
      </div>
    );
  }

  // Si ya está autenticado, redirigir al dashboard (componente declarativo, no navigate())
  if (isAuthenticated) {
    const from = location.state?.from?.pathname || '/inicio';
    return <Navigate to={from} replace />;
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    // Validación básica
    if (!usernameOrEmail.trim()) {
      setError('El nombre de usuario o correo es obligatorio.');
      return;
    }
    if (!password.trim()) {
      setError('La contraseña es obligatoria.');
      return;
    }

    setIsLoading(true);

    try {
      const result = await login(usernameOrEmail.trim(), password);

      if (result.success) {
        // Redirigir al dashboard (o a la ruta que intentaba acceder)
        const from = location.state?.from?.pathname || '/inicio';
        navigate(from, { replace: true });
      } else {
        setError(result.message || 'Credenciales inválidas. Intenta de nuevo.');
      }
    } catch (err) {
      if (err?.message) {
        setError(err.message);
      } else {
        setError('Error al conectar con el servidor. Verifica tu conexión.');
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card card p-4">
        <div className="card-body">
          <div className="text-center mb-4">
            <div
              className="rounded-circle bg-primary text-white d-flex align-items-center justify-content-center mx-auto mb-3"
              style={{ width: '64px', height: '64px', fontSize: '1.5rem' }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <h3 className="fw-bold">Restaurant Manager</h3>
            <p className="text-muted">Inicia sesión para continuar</p>
          </div>

          {error && (
            <div className="alert alert-danger alert-custom d-flex align-items-center gap-2" role="alert">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <line x1="12" y1="8" x2="12" y2="12" />
                <line x1="12" y1="16" x2="12.01" y2="16" />
              </svg>
              <span>{error}</span>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            <div className="mb-3">
              <label htmlFor="usernameOrEmail" className="form-label">
                Usuario o Correo Electrónico
              </label>
              <input
                type="text"
                id="usernameOrEmail"
                className="form-control form-control-lg"
                placeholder="Ingresa tu usuario o correo"
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
                disabled={isLoading}
                autoFocus
                required
              />
            </div>

            <div className="mb-4">
              <label htmlFor="password" className="form-label">
                Contraseña
              </label>
              <input
                type="password"
                id="password"
                className="form-control form-control-lg"
                placeholder="Ingresa tu contraseña"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={isLoading}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary btn-lg w-100"
              disabled={isLoading}
            >
              {isLoading ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                  Iniciando sesión...
                </>
              ) : (
                'Iniciar Sesión'
              )}
            </button>
          </form>

          <div className="text-center mt-4">
            <small className="text-muted">
              Usa las credenciales proporcionadas por el administrador
            </small>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Login;
