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

/** Tamaños de página que ofrece la pantalla de reservas. */
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
 * Obtiene una página de reservas visibles para el usuario actual.
 *
 * El backend pagina, aplica la vista, busca, filtra y ordena. Antes se pedía
 * `size=9999` y de esa única lista salían siete vistas distintas calculadas en
 * el navegador. No se usa `extractData` porque devuelve solo el array y descarta
 * los metadatos de paginación, que son justo lo que la pantalla necesita.
 *
 * @param {object} [params]
 * @param {number} [params.page=0]
 * @param {number} [params.size=25]
 * @param {string} [params.view]         - solicitudes | hoy | proximas | historial | todas
 * @param {string} [params.search]       - Cliente, email o número de mesa
 * @param {number} [params.restaurantId]
 * @param {string} [params.status]       - PENDING | CONFIRMED | CANCELLED | COMPLETED | NO_SHOW
 * @param {string} [params.date]         - formato YYYY-MM-DD
 * @param {string} [params.sort='date']
 * @param {'asc'|'desc'} [params.direction='desc']
 */
export const getReservations = async (params = {}) => {
  const size = params.size ?? DEFAULT_PAGE_SIZE;
  try {
    const query = {
      page: params.page ?? 0,
      size,
      sort: params.sort || 'date',
      direction: params.direction === 'asc' ? 'asc' : 'desc',
    };
    const search = (params.search || '').trim();
    if (search) query.search = search;
    if (params.view) query.view = params.view;
    if (params.restaurantId) query.restaurantId = params.restaurantId;
    if (params.status) query.status = params.status;
    if (params.date) query.date = params.date;

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
 * Cifras del panel: total, pendientes, confirmadas de hoy, próximas, canceladas
 * futuras e historial. Las calcula el backend con una consulta agregada, así que
 * no se derivan de la página cargada y no cambian al filtrar.
 *
 * @param {object} [params]
 * @param {number} [params.restaurantId] - Acota las cifras a un restaurante.
 */
export const getReservationStats = async (params = {}) => {
  try {
    const response = await api.get(`${RESOURCE}/stats`, {
      params: params.restaurantId ? { restaurantId: params.restaurantId } : undefined,
    });
    const body = response?.data;
    const data = body?.data ?? body ?? {};
    return {
      total: Number(data.total) || 0,
      pendientes: Number(data.pendientes) || 0,
      hoyConfirmadas: Number(data.hoyConfirmadas) || 0,
      proximasConfirmadas: Number(data.proximasConfirmadas) || 0,
      canceladasFuturas: Number(data.canceladasFuturas) || 0,
      historial: Number(data.historial) || 0,
    };
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Reservas de un día concreto, para el calendario. Sin paginar: un día es un
 * volumen acotado por naturaleza. Antes el calendario filtraba en el navegador
 * la lista completa.
 *
 * @param {object} params
 * @param {string} params.date           - formato YYYY-MM-DD
 * @param {number} [params.restaurantId]
 */
export const getReservationsByDate = async ({ date, restaurantId } = {}) => {
  if (!date) return [];
  const page = await getReservations({
    page: 0,
    size: 100,
    date,
    restaurantId,
    sort: 'date',
    direction: 'asc',
  });
  return page.content;
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

/**
 * Obtiene las reservas de un restaurante para una fecha concreta.
 * @param {number} restaurantId
 * @param {string} date - formato YYYY-MM-DD
 */
export const getReservationsByRestaurantAndDate = async (restaurantId, date) => {
  try {
    const response = await api.get(`/restaurants/${restaurantId}/reservations`, {
      params: { date },
    });
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Franjas horarias del restaurante para una fecha y número de comensales.
 * La disponibilidad la calcula el backend; aquí no se filtra ni se genera nada.
 *
 * @param {number} restaurantId
 * @param {string} date - formato YYYY-MM-DD
 * @param {number} partySize
 * @returns {Promise<Array<{time: string, available: boolean}>>}
 */
export const getTimeSlots = async (restaurantId, date, partySize) => {
  try {
    const response = await api.get('/availability/time-slots', {
      params: { restaurantId, date, partySize },
    });
    return extractData(response);
  } catch (error) {
    throw handleError(error);
  }
};
