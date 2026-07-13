import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { resetPassword } from '../services/passwordResetService';

const MIN_LENGTH = 8;

const InvalidLinkCard = ({ message }) => (
  <div className="login-container">
    <div className="login-card card p-4">
      <div className="card-body text-center">
        <div
          className="rounded-circle bg-danger text-white d-flex align-items-center justify-content-center mx-auto mb-3"
          style={{ width: '64px', height: '64px' }}
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>
        <h3 className="fw-bold mb-3">Enlace no válido</h3>
        <p className="text-muted">{message}</p>
        <Link to="/forgot-password" className="btn btn-primary btn-lg w-100 mt-3">
          Solicitar un nuevo enlace
        </Link>
      </div>
    </div>
  </div>
);

const ResetPassword = () => {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token');

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [linkError, setLinkError] = useState(null);

  if (!token) {
    return (
      <InvalidLinkCard message="El enlace no incluye un token de recuperación. Solicita uno nuevo." />
    );
  }

  if (linkError) {
    return <InvalidLinkCard message={linkError} />;
  }

  if (success) {
    return (
      <div className="login-container">
        <div className="login-card card p-4">
          <div className="card-body text-center">
            <div
              className="rounded-circle bg-success text-white d-flex align-items-center justify-content-center mx-auto mb-3"
              style={{ width: '64px', height: '64px' }}
            >
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <polyline points="22 4 12 14.01 9 11.01" />
              </svg>
            </div>
            <h3 className="fw-bold mb-3">Contraseña actualizada</h3>
            <p className="text-muted">Ya puedes iniciar sesión con tu nueva contraseña.</p>
            <Link to="/login" className="btn btn-primary btn-lg w-100 mt-3">
              Ir a inicio de sesión
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!newPassword || newPassword.length < MIN_LENGTH) {
      setError(`La contraseña debe tener al menos ${MIN_LENGTH} caracteres.`);
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Las contraseñas no coinciden.');
      return;
    }

    setIsLoading(true);
    try {
      await resetPassword(token, newPassword);
      setSuccess(true);
    } catch (err) {
      // Un token inválido/expirado/usado es un error de estado del enlace,
      // no de los datos del formulario: se muestra la pantalla dedicada.
      if (err?.status && err.status < 500) {
        setLinkError(err.message || 'El enlace no es válido o ha caducado.');
      } else {
        setError('No hemos podido actualizar tu contraseña. Inténtalo de nuevo.');
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
            <h3 className="fw-bold">Restablecer contraseña</h3>
            <p className="text-muted">Introduce tu nueva contraseña.</p>
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
              <label htmlFor="newPassword" className="form-label">
                Nueva contraseña
              </label>
              <input
                type="password"
                id="newPassword"
                className="form-control form-control-lg"
                placeholder="Mínimo 8 caracteres"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                disabled={isLoading}
                autoFocus
                required
              />
            </div>

            <div className="mb-4">
              <label htmlFor="confirmPassword" className="form-label">
                Confirmar contraseña
              </label>
              <input
                type="password"
                id="confirmPassword"
                className="form-control form-control-lg"
                placeholder="Repite la contraseña"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
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
                  Actualizando...
                </>
              ) : (
                'Restablecer contraseña'
              )}
            </button>
          </form>

          <div className="text-center mt-4">
            <Link to="/login" className="text-decoration-none">
              Volver a inicio de sesión
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ResetPassword;
