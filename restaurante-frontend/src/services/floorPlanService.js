import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

// ─── Endpoints ──────────────────────────────────────────────────────────────
const getElementsEndpoint = (restaurantId) =>
  `/restaurants/${restaurantId}/floor-plan/elements`;

/**
 * Normaliza el error para extraer un mensaje legible.
 */
const handleError = (error) => {
  if (error.response) {
    const { status, data: body } = error.response;

    if (body) {
      const message = body.message || body.error;
      if (message) return new Error(message);
    }

    switch (status) {
      case 400:
        return new Error('Solicitud inválida. Revisa los datos enviados.');
      case 401:
        return new Error('No autorizado. Inicia sesión nuevamente.');
      case 403:
        return new Error('No tienes permiso para realizar esta acción.');
      case 404:
        return new Error('El servicio de elementos del plano no está disponible (404). Verifica que el servidor backend esté actualizado.');
      case 500:
        return new Error('Error interno del servidor. Intenta nuevamente más tarde.');
      default:
        return new Error(`Error del servidor (${status}). Intenta de nuevo.`);
    }
  }

  if (error.message) {
    return error;
  }

  return new Error(
    'Error de conexión. Verifica que el servidor esté funcionando.'
  );
};

// ─── Funciones API ───────────────────────────────────────────────────────────

/**
 * Obtiene los elementos decorativos del plano de un restaurante.
 * @param {number} restaurantId - ID del restaurante
 */
export const getFloorPlanElements = async (restaurantId) => {
  const url = getElementsEndpoint(restaurantId);
  try {
    const response = await api.get(url);
    return extractData(response);
  } catch (error) {
    console.error('[floorPlanService] getFloorPlanElements — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Reemplaza los elementos decorativos del plano de un restaurante.
 * Los elementos con id se actualizan, sin id se crean, y los omitidos se eliminan.
 * @param {number} restaurantId - ID del restaurante
 * @param {Array<{id?: number, type: string, xPosition: number, yPosition: number, width?: number, height?: number, rotation?: number}>} elements
 */
export const saveFloorPlanElements = async (restaurantId, elements) => {
  const url = getElementsEndpoint(restaurantId);
  try {
    const response = await api.put(url, elements);
    return extractData(response);
  } catch (error) {
    console.error('[floorPlanService] saveFloorPlanElements — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};
