import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const RESOURCE = '/reservations';

const extractItem = (response) => {
  if (!response || !response.data) return null;
  const body = response.data;
  if (body.id || body.reservationDate) return body;
  if (body.success && body.data) return body.data;
  if (body.data) return body.data;
  return body;
};

const handleError = (error) => {
  if (error.response && error.response.data) {
    const body = error.response.data;
    const message = body.message || body.error || 'Error del servidor';
    return new Error(message);
  }
  if (error.message) return error;
  return new Error('Error de conexión. Verifica que el servidor esté funcionando.');
};

// ─── Funciones CRUD ─────────────────────────────────────────────────────────

/**
 * Obtiene todas las reservas.
 * Se solicita un tamaño grande para evitar paginación que oculte registros.
 * El orden se aplica por defecto en backend (reservationDate DESC, reservationTime DESC).
 */
export const getReservations = async () => {
  try {
    const response = await api.get(`${RESOURCE}?size=9999`);
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Obtiene una reserva por su ID.
 * @param {number} id
 */
export const getReservationById = async (id) => {
  try {
    const response = await api.get(`${RESOURCE}/${id}`);
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Crea una nueva reserva.
 * @param {object} data - { customerId, diningTableId, restaurantId, reservationDate, reservationTime, partySize, notes, status }
 */
export const createReservation = async (data) => {
  try {
    const response = await api.post(RESOURCE, data);
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Actualiza una reserva existente.
 * @param {number} id
 * @param {object} data
 */
export const updateReservation = async (id, data) => {
  try {
    const response = await api.put(`${RESOURCE}/${id}`, data);
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Elimina una reserva por su ID.
 * @param {number} id
 */
export const deleteReservation = async (id) => {
  try {
    const response = await api.delete(`${RESOURCE}/${id}`);
    return response.data;
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Actualiza el estado de una reserva (PATCH).
 * @param {number} id
 * @param {string} status - PENDING | CONFIRMED | CANCELLED | COMPLETED
 */
export const updateReservationStatus = async (id, status) => {
  try {
    const response = await api.patch(`${RESOURCE}/${id}/status`, { status });
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};
