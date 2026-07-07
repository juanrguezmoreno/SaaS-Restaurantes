import api from '../api/axios';

const RESOURCE = '/employees';

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
    if (body.data.content && Array.isArray(body.data.content)) return body.data.content;
  }

  return [];
};

/**
 * Normaliza el error para extraer un mensaje legible.
 */
const handleError = (error) => {
  if (error.response && error.response.data) {
    const body = error.response.data;

    // Manejar 403 Forbidden específicamente
    if (error.response.status === 403) {
      return new Error(body.message || 'No tienes permisos para gestionar empleados.');
    }

    const message = body.message || body.error || 'Error del servidor';
    return new Error(message);
  }
  if (error.message) return error;
  return new Error('Error de conexión. Verifica que el servidor esté funcionando.');
};

/**
 * Obtiene todos los empleados visibles para el usuario actual.
 */
export const getEmployees = async () => {
  try {
    const response = await api.get(RESOURCE);
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Obtiene un empleado por su ID.
 * @param {number} id
 */
export const getEmployeeById = async (id) => {
  const url = `${RESOURCE}/${id}`;
  try {
    const response = await api.get(url);
    const body = response.data;

    if (!body) return null;

    // Si la respuesta es directamente el objeto empleado
    if (body.id || body.firstName) return body;

    // Si viene envuelto en { success, data }
    if (body.success && body.data) return body.data;

    // Si viene envuelto solo en { data }
    if (body.data) return body.data;

    return body;
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Crea un nuevo empleado.
 * @param {object} data - Datos del empleado
 * @returns {Promise<object>} - Objeto del empleado creado o null
 */
export const createEmployee = async (data) => {
  try {
    const response = await api.post(RESOURCE, data);
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Actualiza un empleado existente.
 * @param {number} id
 * @param {object} data - Datos actualizados
 * @returns {Promise<object>} - Objeto del empleado actualizado o null
 */
export const updateEmployee = async (id, data) => {
  const url = `${RESOURCE}/${id}`;
  try {
    const response = await api.put(url, data);
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Activa o desactiva un empleado (cambia su estado active).
 * @param {number} id
 * @param {boolean} active - Nuevo estado
 * @returns {Promise<object>} - Empleado actualizado
 */
export const toggleEmployeeActive = async (id, active) => {
  const url = `${RESOURCE}/${id}/active`;
  try {
    const response = await api.patch(url, { active });
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Elimina un empleado (físicamente, usar con precaución).
 * @param {number} id
 */
export const deleteEmployee = async (id) => {
  const url = `${RESOURCE}/${id}`;
  try {
    const response = await api.delete(url);
    return response.data;
  } catch (error) {
    throw handleError(error);
  }
};
