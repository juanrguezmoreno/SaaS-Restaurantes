import api from '../api/axios';

const RESOURCE = '/admin/restaurants';

/** Tamaños de página que ofrece el panel. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Tamaño de página por defecto, alineado con el del backend. */
export const DEFAULT_PAGE_SIZE = 25;

/** Campos por los que el backend admite ordenar (lista cerrada allí también). */
export const SORT_FIELDS = ['id', 'name', 'capacity', 'createdAt'];

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
 * Obtiene una página de restaurantes para el panel de administración.
 *
 * A diferencia del resto de servicios, aquí NO se usa `extractData`: esa
 * ayuda devuelve solo el array y descarta los metadatos de paginación, que son
 * justo lo que necesita la pantalla para pintar los controles.
 *
 * @param {object} [params]
 * @param {number} [params.page=0]
 * @param {number} [params.size=25]
 * @param {string} [params.search]
 * @param {string} [params.sort='name']
 * @param {'asc'|'desc'} [params.direction='asc']
 * @returns {Promise<{content: object[], page: number, size: number,
 *   totalElements: number, totalPages: number, first: boolean, last: boolean,
 *   empty: boolean}>}
 */
export const getAdminRestaurants = async (params = {}) => {
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
 * Métricas del panel: total de restaurantes, capacidad acumulada y cuántos
 * tienen las reservas online activas. Las calcula el backend con una consulta
 * agregada, no se derivan de la página cargada.
 *
 * @returns {Promise<{totalRestaurants: number, totalCapacity: number,
 *   publicBookingEnabledCount: number}>}
 */
export const getAdminRestaurantStats = async () => {
  try {
    const response = await api.get(`${RESOURCE}/stats`);
    const body = response?.data;
    const data = body?.data ?? body ?? {};
    return {
      totalRestaurants: Number(data.totalRestaurants) || 0,
      totalCapacity: Number(data.totalCapacity) || 0,
      publicBookingEnabledCount: Number(data.publicBookingEnabledCount) || 0,
    };
  } catch (error) {
    throw handleError(error);
  }
};
