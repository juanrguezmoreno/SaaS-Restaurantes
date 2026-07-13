import { useState } from 'react';
import { Link } from 'react-router-dom';
import { requestPasswordReset } from '../services/passwordResetService';

const NEUTRAL_MESSAGE = 'Si existe una cuenta asociada a este correo, recibirás instrucciones para restablecer tu contraseña.';

const ForgotPassword = () => {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    if (!email.trim()) {
      setError('El correo electrónico es obligatorio.');
      return;
    }

    setIsLoading(true);
    try {
      await requestPasswordReset(email.trim());
    } catch {
      // No revelamos si el fallo fue de red o del servidor: el mensaje de
      // éxito es siempre el mismo, exista o no la cuenta.
    } finally {
      setIsLoading(false);
      setSent(true);
    }
  };

  if (sent) {
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
            <h3 className="fw-bold mb-3">Correo enviado</h3>
            <p className="text-muted">{NEUTRAL_MESSAGE}</p>
            <Link to="/login" className="btn btn-primary btn-lg w-100 mt-3">
              Volver a inicio de sesión
            </Link>
          </div>
        </div>
      </div>
    );
  }

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
            <h3 className="fw-bold">¿Has olvidado tu contraseña?</h3>
            <p className="text-muted">Introduce tu correo y te enviaremos un enlace para restablecerla.</p>
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
            <div className="mb-4">
              <label htmlFor="email" className="form-label">
                Correo electrónico
              </label>
              <input
                type="email"
                id="email"
                className="form-control form-control-lg"
                placeholder="tu@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={isLoading}
                autoFocus
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
                  Enviando...
                </>
              ) : (
                'Enviar instrucciones'
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

export default ForgotPassword;
