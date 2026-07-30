import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Carga las franjas horarias de un restaurante y las mantiene sincronizadas con
 * el restaurante, la fecha y el número de comensales seleccionados.
 *
 * Vive aquí y no en cada página porque el formulario privado y el público
 * necesitan exactamente el mismo comportamiento: recargar en cada cambio, limpiar
 * la hora elegida antes de recargar y descartar respuestas obsoletas.
 *
 * @param {object}   params
 * @param {Function} params.fetcher      - (restaurantId, date, partySize) => Promise<slots>
 * @param {number|string} params.restaurantId
 * @param {string}   params.date         - YYYY-MM-DD
 * @param {number|string} params.partySize
 * @param {Function} [params.onReset]    - se invoca al cambiar cualquier dependencia
 */
const useTimeSlots = ({ fetcher, restaurantId, date, partySize, onReset }) => {
  const [slots, setSlots] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [reloadToken, setReloadToken] = useState(0);

  // En refs para que cambiar de callback no vuelva a disparar la consulta.
  const fetcherRef = useRef(fetcher);
  const onResetRef = useRef(onReset);
  // eslint-disable-next-line react-hooks/refs
  fetcherRef.current = fetcher;
  // eslint-disable-next-line react-hooks/refs
  onResetRef.current = onReset;

  // Identifica la petición en curso: si llega la respuesta de una anterior
  // (más lenta), se descarta en vez de pisar a la más reciente.
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (onResetRef.current) {
      onResetRef.current();
    }

    const size = Number(partySize);
    if (!restaurantId || !date || !size || size < 1) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlots([]);
      setError(null);
      setLoading(false);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setError(null);

    fetcherRef.current(Number(restaurantId), date, size)
      .then((data) => {
        if (requestId !== requestIdRef.current) return;
        setSlots(Array.isArray(data) ? data : []);
      })
      .catch((err) => {
        if (requestId !== requestIdRef.current) return;
        setSlots([]);
        setError(err?.message || 'No se han podido cargar los horarios.');
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) return;
        setLoading(false);
      });
  }, [restaurantId, date, partySize, reloadToken]);

  const retry = useCallback(() => setReloadToken((t) => t + 1), []);

  return { slots, loading, error, retry };
};

export default useTimeSlots;
