import api from '../api/axios';

const RESOURCE = '/restaurants';

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
    // Si data es un array, devolverlo
    if (Array.isArray(body.data)) return body.data;
    // Si data tiene content, devolver content
    if (body.data.content && Array.isArray(body.data.content)) return body.data.content;
  }

  // Último recurso: si body es truthy pero no array, devolver array vacío
  // para evitar crashes en el frontend
  return [];
};

/**
 * Obtiene todos los restaurantes.
 */
export const getRestaurants = async () => {
  console.log('[restaurantService] getRestaurants — Request URL:', RESOURCE);
  try {
    const response = await api.get(RESOURCE);
    console.log('[restaurantService] getRestaurants — Response:', response.data);
    return extractData(response);
  } catch (error) {
    console.error('[restaurantService] getRestaurants — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Obtiene un restaurante por su ID.
 * @param {number} id
 */
export const getRestaurantById = async (id) => {
  const url = `${RESOURCE}/${id}`;
  console.log('[restaurantService] getRestaurantById — Request URL:', url);
  try {
    const response = await api.get(url);
    console.log('[restaurantService] getRestaurantById — Response:', response.data);
    const body = response.data;

    if (!body) return null;

    // Si la respuesta es directamente el objeto restaurante
    if (body.id || body.name) return body;

    // Si viene envuelto en { success, data }
    if (body.success && body.data) return body.data;

    // Si viene envuelto solo en { data }
    if (body.data) return body.data;

    return body;
  } catch (error) {
    console.error('[restaurantService] getRestaurantById — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Crea un nuevo restaurante.
 * @param {object} data - Datos del restaurante
 * @returns {Promise<object>} - Objeto del restaurante creado o null
 */
export const createRestaurant = async (data) => {
  console.log('[restaurantService] createRestaurant — Request URL:', RESOURCE, '— Body:', data);
  try {
    const response = await api.post(RESOURCE, data);
    console.log('[restaurantService] createRestaurant — Response:', response.data);
    // Normalizar la respuesta: extraer el objeto creado si viene envuelto
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    console.error('[restaurantService] createRestaurant — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Actualiza un restaurante existente.
 * @param {number} id
 * @param {object} data - Datos actualizados
 * @returns {Promise<object>} - Objeto del restaurante actualizado o null
 */
export const updateRestaurant = async (id, data) => {
  const url = `${RESOURCE}/${id}`;
  console.log('[restaurantService] updateRestaurant — Request URL:', url, '— Body:', data);
  try {
    const response = await api.put(url, data);
    console.log('[restaurantService] updateRestaurant — Response:', response.data);
    // Normalizar la respuesta
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    console.error('[restaurantService] updateRestaurant — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Elimina un restaurante por su ID.
 * @param {number} id
 */
export const deleteRestaurant = async (id) => {
  const url = `${RESOURCE}/${id}`;
  console.log('[restaurantService] deleteRestaurant — Request URL:', url);
  try {
    const response = await api.delete(url);
    console.log('[restaurantService] deleteRestaurant — Response:', response.data);
    return response.data;
  } catch (error) {
    console.error('[restaurantService] deleteRestaurant — Error:', error.response?.status, error.response?.data);
    throw handleError(error);
  }
};

/**
 * Normaliza el error para extraer un mensaje legible.
 */
function handleError(error) {
  if (error.response && error.response.data) {
    const body = error.response.data;
    const message = body.message || body.error || 'Error del servidor';
    return new Error(message);
  }
  if (error.message) {
    return error;
  }
  return new Error('Error de conexión. Verifica que el servidor esté funcionando.');
}
