import publicApi from '../api/publicAxios';

// ─── Helpers de extracción ──────────────────────────────────────────────────

const extractItem = (response) => {
  if (!response || !response.data) return null;
  const body = response.data;
  if (body.id || body.name || body.reservationDate) return body;
  if (body.success && body.data) return body.data;
  if (body.data) return body.data;
  return body;
};

const handleError = (error) => {
  const status = error.response?.status;

  if (error.response && error.response.data) {
    const body = error.response.data;
    let message = body.message || body.error || 'Error del servidor';

    // Errores de validación (400): el detalle va en `data` como mapa
    // campo -> mensaje (ver GlobalExceptionHandler#handleMethodArgumentNotValid),
    // no en `message` (que solo dice "Error de validación").
    if (body.data && typeof body.data === 'object' && !Array.isArray(body.data)) {
      const fieldMessages = Object.values(body.data).filter((v) => typeof v === 'string');
      if (fieldMessages.length > 0) {
        message = fieldMessages.join(' ');
      }
    }

    const err = new Error(message);
    err.status = status;
    return err;
  }
  if (error.message) {
    error.status = status;
    return error;
  }
  const err = new Error('Error de conexión. Verifica que el servidor esté funcionando.');
  err.status = status;
  return err;
};

// ─── Helpers de normalización ───────────────────────────────────────────────

/**
 * Normaliza el formato de hora para el backend.
 * El backend Spring Boot espera LocalTime en formato HH:mm:ss.
 * El input type="time" del navegador produce HH:mm.
 *
 * @param {string} time - Hora en formato HH:mm o HH:mm:ss
 * @returns {string} Hora en formato HH:mm:ss
 */
const normalizeTimeForBackend = (time) => {
  if (!time) return '';
  if (/^\d{2}:\d{2}:\d{2}$/.test(time)) return time;
  if (/^\d{2}:\d{2}$/.test(time)) return `${time}:00`;
  return time;
};

// ─── Funciones públicas ─────────────────────────────────────────────────────

/**
 * Obtiene un restaurante por su ID (público).
 * Usa el endpoint público /api/v1/public/restaurants/{id}
 * @param {number} restaurantId
 */
export const fetchPublicRestaurant = async (restaurantId) => {
  try {
    const response = await publicApi.get(`/public/restaurants/${restaurantId}`);
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Crea una solicitud de reserva pública como PENDING.
 * No requiere autenticación. Los datos del cliente se envían inline.
 * El restauranteId va en la URL, no en el body.
 *
 * @param {object} data
 * @param {number}  data.restaurantId         - ID del restaurante (va en la URL)
 * @param {string}  data.customerName         - Nombre completo del solicitante
 * @param {string}  data.phone                - Teléfono del solicitante
 * @param {string}  data.email                - Email del solicitante
 * @param {string}  data.reservationDate      - Fecha (YYYY-MM-DD)
 * @param {string}  data.reservationTime      - Hora (HH:mm:ss)
 * @param {number}  data.partySize            - Número de comensales
 * @param {string}  [data.notes]              - Notas opcionales
 */
export const createPublicReservation = async (data) => {
  try {
    // Payload para el endpoint público:
    // POST /api/v1/public/restaurants/{restaurantId}/reservation-requests
    const payload = {
      customerName: data.customerName?.trim() || '',
      phone: data.phone?.trim() || '',
      email: data.email?.trim() || '',
      reservationDate: data.reservationDate,
      reservationTime: normalizeTimeForBackend(data.reservationTime),
      partySize: Number(data.partySize),
      notes: data.notes?.trim() || '',
    };

    const response = await publicApi.post(
      `/public/restaurants/${Number(data.restaurantId)}/reservation-requests`,
      payload
    );
    return extractItem(response);
  } catch (error) {
    throw handleError(error);
  }
};

/**
 * Franjas horarias del restaurante para el formulario público.
 * Solo devuelve hora y disponibilidad: el endpoint no expone datos de mesas
 * ni de otras reservas.
 *
 * @param {number} restaurantId
 * @param {string} date - formato YYYY-MM-DD
 * @param {number} partySize
 * @returns {Promise<Array<{time: string, available: boolean}>>}
 */
export const fetchPublicTimeSlots = async (restaurantId, date, partySize) => {
  try {
    const response = await publicApi.get(`/public/restaurants/${Number(restaurantId)}/time-slots`, {
      params: { date, partySize },
    });
    const body = response?.data;
    if (Array.isArray(body)) return body;
    if (Array.isArray(body?.data)) return body.data;
    return [];
  } catch (error) {
    throw handleError(error);
  }
};
