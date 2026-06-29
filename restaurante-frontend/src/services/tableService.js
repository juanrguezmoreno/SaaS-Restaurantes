import api from '../api/axios';

// ─── Endpoints ──────────────────────────────────────────────────────────────
const TABLES_RESOURCE = '/tables';
const getRestaurantTablesEndpoint = (restaurantId) =>
  `/restaurants/${restaurantId}/tables`;

// ─── Helpers de extracción (mismo patrón que restaurantService) ────────────

/**
 * Extrae el array de datos de la respuesta del backend.
 * Soporta múltiples formatos:
 *   - Array directo:  [...]
 *   - Paginado:       { content: [...] }
 *   - Envoltorio:     { success: true, data: [...] }
 *   - Anidado:        { data: { content: [...] } }
 *   - Fallback:       body (si es array) o []
 */
const extractData = (response) => {
  if (!response || !response.data) {
    return [];
  }

  const body = response.data;

  // Array directo
  if (Array.isArray(body)) {
    return body;
  }

  // Paginación de Spring Boot: { content: [...] }
  if (body && Array.isArray(body.content)) {
    return body.content;
  }

  // Envoltorio con success: { success: true, data: [...] }
  if (body && body.success && Array.isArray(body.data)) {
    return body.data;
  }

  // Envoltorio simple: { data: [...] }
  if (body && Array.isArray(body.data)) {
    return body.data;
  }

  // Envoltorio anidado: { data: { content: [...] } }
  if (body && body.data && Array.isArray(body.data.content)) {
    return body.data.content;
  }

  // data.data o data.body
  if (body && body.data) {
    if (Array.isArray(body.data)) return body.data;
    if (body.data.content && Array.isArray(body.data.content))
      return body.data.content;
  }

  return [];
};

/**
 * Normaliza el error para extraer un mensaje legible.
 */
const handleError = (error) => {
  if (error.response && error.response.data) {
    const body = error.response.data;
    const message =
      body.message || body.error || 'Error del servidor';
    return new Error(message);
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
