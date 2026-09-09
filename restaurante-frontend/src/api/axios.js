import axios from 'axios';

// Configurable por entorno (Vite): define VITE_API_URL en producción.
// Se normaliza para tolerar el valor con o sin /api/v1 y con o sin barra final:
// el backend siempre expone la API bajo /api/v1 (Constants.API_BASE_PATH).
const rawBaseUrl = (import.meta.env.VITE_API_URL || 'http://localhost:8080/api/v1').replace(/\/+$/, '');
const API_BASE_URL = rawBaseUrl.endsWith('/api/v1') ? rawBaseUrl : `${rawBaseUrl}/api/v1`;

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

// Interceptor de request: adjunta el token JWT automáticamente
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// Interceptor de response: maneja errores globales
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response) {
      const { status } = error.response;

      if (status === 401) {
        // Token expirado o inválido → limpiar sesión
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        // Notificar a AuthContext sin recargar la página
        window.dispatchEvent(new CustomEvent('auth:unauthorized'));
        // NO usar window.location.href — eso causa bucle de recarga infinito
      } else if (status === 403) {
        const { code, message, data } = error.response.data ?? {};
        if (code === 'PLAN_UPGRADE_REQUIRED' || code === 'PLAN_LIMIT_REACHED') {
          // Mismo patrón que auth:unauthorized: el interceptor no conoce la
          // interfaz, sólo avisa; quien decide qué mostrar es el componente.
          window.dispatchEvent(new CustomEvent('plan:upgrade-required', {
            detail: { code, message, ...(data ?? {}) },
          }));
        } else {
          // 403 por rol: no es un problema de plan y no debe ofrecer pagar.
          console.error('Acceso denegado: no tienes permisos para este recurso.');
        }
      } else if (status === 500) {
        console.error('Error interno del servidor. Intenta nuevamente más tarde.');
      }
    } else {
      // Error de red (servidor caído, CORS, etc.)
      console.error('Error de conexión. Verifica que el servidor esté funcionando.');
    }

    return Promise.reject(error);
  }
);

export default api;
