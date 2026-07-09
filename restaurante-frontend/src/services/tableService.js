import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

// ─── Endpoints ──────────────────────────────────────────────────────────────
const TABLES_RESOURCE = '/tables';
const getRestaurantTablesEndpoint = (restaurantId) =>
  `/restaurants/${restaurantId}/tables`;

/**
 * Normaliza el error para extraer un mensaje legible.
 * Proporciona mensajes específicos según el código HTTP.
 */
const handleError = (error) => {
  if (error.response) {
    const { status, data: body } = error.response;

    // Intentar obtener mensaje del cuerpo de la respuesta
    if (body) {
      const message = body.message || body.error;
      if (message) return new Error(message);
    }

    // Mensajes por código de estado
    switch (status) {
      case 400:
        return new Error('Solicitud inválida. Revisa los datos enviados.');
      case 401:
        return new Error('No autorizado. Inicia sesión nuevamente.');
      case 403:
        return new Error('No tienes permiso para realizar esta acción.');
      case 404:
        return new Error('El servicio de guardado no está disponible (404). Verifica que el servidor backend esté actualizado y funcionando.');
      case 409:
        return new Error('Conflicto. El recurso ya existe.');
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

// ─── Funciones CRUD ─────────────────────────────────────────────────────────

/**
 * Obtiene todas las mesas de un restaurante.
 * @param {number} restaurantId - ID del restaurante
 */
export const getTablesByRestaurant = async (restaurantId) => {
  const url = getRestaurantTablesEndpoint(restaurantId);
  console.log('[tableService] getTablesByRestaurant — Request URL:', url);
  try {
    const response = await api.get(url);
    console.log('[tableService] getTablesByRestaurant — Response:', response.data);
    return extractData(response);
  } catch (error) {
    console.error('[tableService] getTablesByRestaurant — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Obtiene una mesa por su ID.
 * @param {number} id - ID de la mesa
 */
export const getTableById = async (id) => {
  const url = `${TABLES_RESOURCE}/${id}`;
  console.log('[tableService] getTableById — Request URL:', url);
  try {
    const response = await api.get(url);
    console.log('[tableService] getTableById — Response:', response.data);
    const body = response.data;

    if (!body) return null;

    if (body.id) return body;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;

    return body;
  } catch (error) {
    console.error('[tableService] getTableById — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Crea una nueva mesa en un restaurante.
 * @param {number} restaurantId - ID del restaurante
 * @param {object} data - Datos de la mesa
 */
export const createTable = async (restaurantId, data) => {
  const url = getRestaurantTablesEndpoint(restaurantId);
  console.log('[tableService] createTable — Request URL:', url, '— Body:', data);
  try {
    const response = await api.post(url, data);
    console.log('[tableService] createTable — Response:', response.data);
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    console.error('[tableService] createTable — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Actualiza una mesa existente.
 * @param {number} id - ID de la mesa
 * @param {object} data - Datos actualizados
 */
export const updateTable = async (id, data) => {
  const url = `${TABLES_RESOURCE}/${id}`;
  console.log('[tableService] updateTable — Request URL:', url, '— Body:', data);
  try {
    const response = await api.put(url, data);
    console.log('[tableService] updateTable — Response:', response.data);
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    console.error('[tableService] updateTable — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Actualiza el estado de una mesa (PATCH).
 * @param {number} id - ID de la mesa
 * @param {string} status - Nuevo estado (AVAILABLE, OCCUPIED, RESERVED, MAINTENANCE)
 */
export const updateTableStatus = async (id, status) => {
  const url = `${TABLES_RESOURCE}/${id}/status`;
  console.log('[tableService] updateTableStatus — Request URL:', url, '— Status:', status);
  try {
    const response = await api.patch(url, { status });
    console.log('[tableService] updateTableStatus — Response:', response.data);
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    console.error('[tableService] updateTableStatus — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Guarda el layout completo de mesas de un restaurante (posición, tamaño, forma).
 * Endpoint batch: PUT /restaurants/{restaurantId}/tables/layout
 *
 * @param {number} restaurantId - ID del restaurante
 * @param {Array<{tableId: number, xPosition: number, yPosition: number, width?: number, height?: number, shape?: string, rotation?: number}>} layoutData - Array con posiciones de cada mesa
 */
export const updateTablesLayout = async (restaurantId, layoutData) => {
  const url = `/restaurants/${restaurantId}/tables/layout`;
  console.log('[tableService] updateTablesLayout — Request URL:', url, '— Body:', layoutData);
  try {
    const response = await api.put(url, layoutData);
    console.log('[tableService] updateTablesLayout — Response:', response.data);
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    console.error('[tableService] updateTablesLayout — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Elimina una mesa por su ID.
 * @param {number} id - ID de la mesa
 */
export const deleteTable = async (id) => {
  const url = `${TABLES_RESOURCE}/${id}`;
  console.log('[tableService] deleteTable — Request URL:', url);
  try {
    const response = await api.delete(url);
    console.log('[tableService] deleteTable — Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('[tableService] deleteTable — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};
