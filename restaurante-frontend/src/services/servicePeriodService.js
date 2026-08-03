import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const periodsEndpoint = (restaurantId) => `/restaurants/${restaurantId}/service-periods`;

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
        return new Error('Los horarios enviados no son válidos. Revisa los periodos.');
      case 401:
        return new Error('No autorizado. Inicia sesión nuevamente.');
      case 403:
        return new Error('No tienes permiso para configurar este restaurante.');
      case 404:
        return new Error('El restaurante no existe o no está disponible.');
      case 500:
        return new Error('Error interno del servidor. Intenta nuevamente más tarde.');
      default:
        return new Error(`Error del servidor (${status}). Intenta de nuevo.`);
    }
  }

  if (error.message) return error;
  return new Error('No se ha podido contactar con el servidor.');
};

/**
 * Periodos de servicio del restaurante, ordenados por día y hora de inicio.
 * Una lista vacía significa que el restaurante usa el horario general.
 * @param {number|string} restaurantId
 */
export const getServicePeriods = async (restaurantId) => {
  try {
    const response = await api.get(periodsEndpoint(restaurantId));
    const datos = extractData(response);
    return Array.isArray(datos) ? datos : [];
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Reemplaza los periodos de la semana completa. El backend valida solapes,
 * duplicados y pertenencia al restaurante.
 * @param {number|string} restaurantId
 * @param {Array<{id: number|null, dayOfWeek: string, startTime: string, endTime: string, name: string|null}>} periods
 */
export const saveServicePeriods = async (restaurantId, periods) => {
  try {
    const response = await api.put(periodsEndpoint(restaurantId), periods);
    const datos = extractData(response);
    return Array.isArray(datos) ? datos : [];
  } catch (error) {
    throw handleError(error);
  }
};
