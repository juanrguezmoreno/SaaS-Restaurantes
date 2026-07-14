import api from '../api/axios';
import { extractData } from '../lib/apiHelpers';

const RESOURCE = '/users';

const handleError = (error) => {
  if (error.response && error.response.data) {
    const body = error.response.data;

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
 * Obtiene todos los empleados (usuarios del sistema) visibles para el usuario actual.
 * Pide una página grande porque la tabla filtra/ordena en cliente.
 */
export const getUsers = async () => {
  try {
    const response = await api.get(RESOURCE, { params: { size: 1000, sort: 'createdAt', direction: 'desc' } });
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};

export const getUserById = async (id) => {
  const url = `${RESOURCE}/${id}`;
  try {
    const response = await api.get(url);
    const body = response.data;
    if (!body) return null;
    if (body.success && body.data) return body.data;
    if (body.data) return body.data;
    return body;
  } catch (error) {
    throw handleError(error);
  }
};

export const createUser = async (data) => {
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

export const updateUser = async (id, data) => {
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

export const deleteUser = async (id) => {
  const url = `${RESOURCE}/${id}`;
  try {
    const response = await api.delete(url);
    return response.data;
  } catch (error) {
    throw handleError(error);
  }
};