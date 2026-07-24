import axios from 'axios';

/**
 * Instancia de Axios para endpoints públicos.
 * No incluye interceptores de JWT ni redirección al login.
 * Útil para páginas públicas como la reserva online de clientes.
 */
// Configurable por entorno (Vite): define VITE_API_URL en producción.
// Se normaliza para tolerar el valor con o sin /api/v1 y con o sin barra final:
// el backend siempre expone la API bajo /api/v1 (Constants.API_BASE_PATH).
const rawBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1').replace(/\/+$/, '');
const API_BASE_URL = rawBaseUrl.endsWith('/api/v1') ? rawBaseUrl : `${rawBaseUrl}/api/v1`;

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
