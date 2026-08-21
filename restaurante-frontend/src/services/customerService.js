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

/** Tamaños de página que ofrece la pantalla de clientes. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Tamaño de página por defecto, alineado con el del backend. */
export const DEFAULT_PAGE_SIZE = 25;

/** Página vacía, para no devolver nunca undefined a la pantalla. */
const emptyPage = (size = DEFAULT_PAGE_SIZE) => ({
  content: [],
  page: 0,
  size,
  totalElements: 0,
  totalPages: 0,
  first: true,
  last: true,
  empty: true,
});

/**
 * Obtiene una página de clientes visibles para el usuario actual.
 *
 * El backend pagina, busca, filtra por restaurante y segmento y ordena; antes se
 * pedía `size=500` y los segmentos se calculaban en el navegador. No se usa
 * `extractData` porque devuelve solo el array y descarta los metadatos de
 * paginación, que son justo lo que la pantalla necesita.
 *
 * @param {object} [params]
 * @param {number} [params.page=0]
 * @param {number} [params.size=25]
 * @param {string} [params.search]       - Nombre, email o teléfono
 * @param {number} [params.restaurantId] - Filtrar por restaurante
 * @param {string} [params.segment]      - recurrentes | nuevos | sin-venir
 * @param {string} [params.sort='name']
 * @param {'asc'|'desc'} [params.direction='asc']
 */
export const getCustomers = async (params = {}) => {
  const size = params.size ?? DEFAULT_PAGE_SIZE;
  try {
    const query = {
      page: params.page ?? 0,
      size,
      sort: params.sort || 'name',
      direction: params.direction === 'desc' ? 'desc' : 'asc',
    };
    const search = (params.search || '').trim();
    if (search) query.search = search;
    if (params.restaurantId) query.restaurantId = params.restaurantId;
    if (params.segment) query.segment = params.segment;

    const response = await api.get(RESOURCE, { params: query });
    const body = response?.data;
    if (!body || !Array.isArray(body.content)) {
      return emptyPage(size);
    }

    return {
      content: body.content,
      page: Number(body.page) || 0,
      size: Number(body.size) || size,
      totalElements: Number(body.totalElements) || 0,
      totalPages: Number(body.totalPages) || 0,
      first: Boolean(body.first),
      last: Boolean(body.last),
      empty: Boolean(body.empty),
    };
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Cifras de las tarjetas: total, recurrentes, nuevos este mes y sin venir en
 * tres meses. Las calcula el backend con una consulta agregada, no se derivan de
 * la página cargada.
 *
 * @param {number} [restaurantId] - Acota las cifras a un restaurante.
 */
export const getCustomerStats = async (restaurantId) => {
  try {
    const response = await api.get(`${RESOURCE}/stats`, {
      params: restaurantId ? { restaurantId } : undefined,
    });
    const body = response?.data;
    const data = body?.data ?? body ?? {};
    return {
      total: Number(data.total) || 0,
      recurrentes: Number(data.recurrentes) || 0,
      nuevosEsteMes: Number(data.nuevosEsteMes) || 0,
      sinVenir: Number(data.sinVenir) || 0,
    };
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

// Aquí vivía toggleCustomerActive, que llamaba a PATCH /customers/{id}/active.
// Ese endpoint no existe en el backend y la entidad Customer no tiene campo
// `active`: la llamada fallaba siempre. Se retira junto con la columna Estado y
// el filtro de estado de la pantalla.
