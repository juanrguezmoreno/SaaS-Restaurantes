import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const RESOURCE = '/restaurants';

/**
 * Obtiene todos los restaurantes.
 */
export const getRestaurants = async () => {
  try {
    // El endpoint pagina con size=10 por defecto: sin tamaño explícito, un
    // tenant con más de 10 restaurantes perdía el resto en silencio, tanto en
    // la pantalla de Restaurantes como en los desplegables que la usan.
    const response = await api.get(RESOURCE, { params: { size: 500 } });
    return extractData(response);
  } catch (error) {
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
