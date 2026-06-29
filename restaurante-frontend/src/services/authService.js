import api from '../api/axios';

/**
 * Inicia sesión con credenciales de usuario.
 * @param {string} usernameOrEmail - Nombre de usuario o correo electrónico
 * @param {string} password - Contraseña
 * @returns {Promise<object>} - Respuesta con token y datos del usuario
 */
export const login = async (usernameOrEmail, password) => {
  try {
    const response = await api.post('/auth/login', {
      usernameOrEmail,
      password,
    });
    return response.data;
  } catch (error) {
    if (error.response && error.response.data) {
      throw error.response.data;
    }
    throw new Error('Error de conexión. Verifica que el servidor esté funcionando.', { cause: error });
  }
};
