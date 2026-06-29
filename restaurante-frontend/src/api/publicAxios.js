import axios from 'axios';

/**
 * Instancia de Axios para endpoints públicos.
 * No incluye interceptores de JWT ni redirección al login.
 * Útil para páginas públicas como la reserva online de clientes.
 */
const API_BASE_URL = 'http://localhost:8080/api/v1';

const publicApi = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  timeout: 15000,
});

// Interceptor de respuesta solo para loguear errores, sin redirigir
publicApi.interceptors.response.use(
  (response) => response,
  (error) => {
    // No redirigir al login — es una API pública
    if (error.response) {
      const { status } = error.response;
      if (status === 500) {
        console.error('[publicApi] Error interno del servidor.');
      }
    }
    return Promise.reject(error);
  }
);

export default publicApi;
