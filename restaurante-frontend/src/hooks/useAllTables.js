import { useState, useEffect, useCallback } from 'react';
import api from '../api/axios';
import { getRestaurants } from '../services/restaurantService';
import { extractArray } from '../lib/apiHelpers';

/**
 * Carga los restaurantes visibles y, para cada uno, sus mesas
 * (no existe un endpoint global GET /tables).
 */
export const useAllTables = ({ auto = true } = {}) => {
  const [restaurants, setRestaurants] = useState([]);
  const [tables, setTables] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const fetchedRestaurants = await getRestaurants();
      const restaurantList = Array.isArray(fetchedRestaurants) ? fetchedRestaurants : [];
      setRestaurants(restaurantList);

      if (restaurantList.length === 0) {
        setTables([]);
        return;
      }

      const promises = restaurantList.map((r) => api.get(`/restaurants/${r.id}/tables`).then((res) => extractArray(res)));
      const results = await Promise.allSettled(promises);
      const fetchedTables = results.flatMap(
        (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [])
      );
      setTables(fetchedTables);

      const failedCount = results.filter((r) => r.status === 'rejected').length;
      if (failedCount > 0) {
        setError(`No se pudieron cargar las mesas de ${failedCount} restaurante(s).`);
      }
    } catch (err) {
      setError(err?.message || 'Error al cargar las mesas.');
      setTables([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!auto) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchAll();
  }, [auto, fetchAll]);

  return { restaurants, tables, loading, error, refetch: fetchAll };
};
