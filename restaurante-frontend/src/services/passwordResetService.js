import publicApi from '../api/publicAxios';

const handleError = (error) => {
  const status = error.response?.status;

  if (error.response && error.response.data) {
    const body = error.response.data;
    let message = body.message || body.error || 'Error del servidor';

    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
      const fieldMessages = Object.values(body.data).filter((v) => typeof v === 'string');
      if (fieldMessages.length > 0) {
        message = fieldMessages.join(' ');
      }
    }

    const err = new Error(message);
    err.status = status;
    return err;
  }
  if (error.message) {
    error.status = status;
    return error;
  }
  const err = new Error('Error de conexión. Verifica que el servidor esté funcionando.');
  err.status = status;
  return err;
};

/**
 * Solicita el envío del enlace de recuperación de contraseña.
 * El backend responde siempre 200 con un mensaje neutro, exista o no la cuenta.
 * @param {string} email
 */
export const requestPasswordReset = async (email) => {
  try {
    await publicApi.post('/auth/forgot-password', { email });
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Restablece la contraseña usando el token recibido por email.
 * @param {string} token
 * @param {string} newPassword
 */
export const resetPassword = async (token, newPassword) => {
  try {
    await publicApi.post('/auth/reset-password', { token, newPassword });
  } catch (error) {
    throw handleError(error);
  }
};
