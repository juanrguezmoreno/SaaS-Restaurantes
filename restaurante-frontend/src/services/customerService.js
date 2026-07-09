import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const RESOURCE = '/customers';

/**
 * Extrae un objeto individual de la respuesta.
 */
const extractItem = (response) => {
  if (!response || !response.data) return null;
  const body = response.data;
  if (body && (body.id !== undefined || body.fullName || body.firstName)) return body;
  if (body && body.success && body.data) return body.data;
  if (body && body.data) return body.data;
  return body;
};

/**
 * Normaliza el error para extraer un mensaje legible.
 */
const handleError = (error) => {
  if (error.response && error.response.data) {
    const body = error.response.data;
    const message = body.message || body.error || 'Error del servidor';
    return new Error(message);
  }
  if (error.message) return error;
  return new Error('Error de conexión. Verifica que el servidor esté funcionando.');
};

/**
 * Obtiene la lista de clientes visibles para el usuario actual.
 * Soporta filtros opcionales: search, restaurantId, active.
 *
 * @param {object} [params]
 * @param {string} [params.search]     - Búsqueda por nombre, email o teléfono
 * @param {number} [params.restaurantId] - Filtrar por restaurante
 * @param {boolean|string} [params.active] - Filtrar por estado activo/inactivo
 */
export const getCustomers = async (params = {}) => {
  try {
    const queryParams = new URLSearchParams();
    if (params.search) queryParams.append('search', params.search);
    if (params.restaurantId) queryParams.append('restaurantId', params.restaurantId);
    if (params.active !== undefined && params.active !== '' && params.active !== null) {
      queryParams.append('active', params.active);
    }
    const query = queryParams.toString();
    const url = query ? `${RESOURCE}?${query}` : RESOURCE;
    const response = await api.get(url);
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Obtiene un cliente por su ID, incluyendo datos detallados
 * y estadísticas básicas (totalReservations, confirmedReservations, etc.).
 *
 * @param {number} id
 */
export const getCustomerById = async (id) => {
  try {
    const response = await api.get(`${RESOURCE}/${id}`);
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Obtiene el historial de reservas de un cliente específico.
 *
 * @param {number} id - ID del cliente
 */
export const getCustomerReservations = async (id) => {
  try {
    const response = await api.get(`${RESOURCE}/${id}/reservations`);
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Crea un nuevo cliente.
 *
 * @param {object} data - { firstName?, lastName?, fullName?, email?, phone?, notes?, restaurantId? }
 */
export const createCustomer = async (data) => {
  try {
    const response = await api.post(RESOURCE, data);
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Actualiza un cliente existente.
 *
 * @param {number} id
 * @param {object} data - Campos a actualizar
 */
export const updateCustomer = async (id, data) => {
  try {
    const response = await api.put(`${RESOURCE}/${id}`, data);
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Activa o desactiva un cliente (toggle).
 * No elimina físicamente al cliente.
 *
 * @param {number} id
 */
export const toggleCustomerActive = async (id) => {
  try {
    const response = await api.patch(`${RESOURCE}/${id}/active`);
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};
