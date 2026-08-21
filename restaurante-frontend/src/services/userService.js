import api from '../api/axios';

const RESOURCE = '/users';

/** Tamaños de página que ofrece la pantalla de empleados. */
export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];

/** Tamaño de página por defecto, alineado con el del backend. */
export const DEFAULT_PAGE_SIZE = 25;

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
 * Obtiene una página de empleados visibles para el usuario actual.
 *
 * El backend pagina, busca, filtra y ordena; antes se pedía `size=1000` y todo
 * eso se hacía en el navegador. No se usa `extractData` porque devuelve solo el
 * array y descarta los metadatos de paginación, que son justo lo que la pantalla
 * necesita para pintar los controles.
 *
 * @param {object} [params]
 * @param {number} [params.page=0]
 * @param {number} [params.size=25]
 * @param {string} [params.search]    - Usuario, email, teléfono o nombre
 * @param {string} [params.role]      - ADMIN | MANAGER | EMPLOYEE | SUPER_ADMIN
 * @param {string} [params.status]    - 'active' | 'inactive'
 * @param {string} [params.sort='name']
 * @param {'asc'|'desc'} [params.direction='asc']
 */
export const getUsers = async (params = {}) => {
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
    if (params.role) query.role = params.role;
    if (params.status) query.status = params.status;

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
 * Métricas de empleados: total, activos e inactivos. Las calcula el backend con
 * una consulta agregada, no se derivan de la página cargada.
 */
export const getUserStats = async () => {
  try {
    const response = await api.get(`${RESOURCE}/stats`);
    const body = response?.data;
    const data = body?.data ?? body ?? {};
    return {
      total: Number(data.total) || 0,
      active: Number(data.active) || 0,
      inactive: Number(data.inactive) || 0,
    };
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