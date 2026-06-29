import { createContext, useState, useContext, useEffect, useCallback, useRef } from 'react';
import { getReservations } from '../services/reservationService';
import { getCustomers } from '../services/customerService';
import { getRestaurants } from '../services/restaurantService';
import api from '../api/axios';
import { generateNotifications } from '../services/notificationService';
import { useAuth } from './AuthContext';

const NotificationContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useNotifications = () => {
  const context = useContext(NotificationContext);
  if (!context) {
    throw new Error('useNotifications debe usarse dentro de un NotificationProvider');
  }
  return context;
};

/**
 * Extrae array de respuesta API (mismo patrón que otros servicios)
 */
const extractArray = (response) => {
  if (!response || !response.data) return [];
  const body = response.data;
  if (Array.isArray(body)) return body;
  if (body && Array.isArray(body.content)) return body.content;
  if (body && body.success && Array.isArray(body.data)) return body.data;
  if (body && Array.isArray(body.data)) return body.data;
  if (body && body.data && Array.isArray(body.data.content)) return body.data.content;
  return [];
};

export const NotificationProvider = ({ children }) => {
  const { user, token, loading: authLoading } = useAuth();

  const [notifications, setNotifications] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const intervalRef = useRef(null);
  const mountedRef = useRef(true);

  const fetchAndGenerate = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    setError(null);

    try {
      // Fetch real data from all sources
      const [reservationsRes, customersRes] = await Promise.allSettled([
        getReservations(),
        getCustomers(),
      ]);

      let reservations = [];
      let customers = [];
      let tables = [];

      if (reservationsRes.status === 'fulfilled' && Array.isArray(reservationsRes.value)) {
        reservations = reservationsRes.value;
      }

      if (customersRes.status === 'fulfilled' && Array.isArray(customersRes.value)) {
        customers = customersRes.value;
      }

      // Fetch restaurants + tables per restaurant (no existe GET /tables global)
      try {
        const restaurantsData = await getRestaurants();
        const restaurantList = Array.isArray(restaurantsData) ? restaurantsData : [];
        if (restaurantList.length > 0) {
          const tablesPromises = restaurantList.map((r) =>
            api.get(`/restaurants/${r.id}/tables`)
              .then((res) => extractArray(res))
              .catch(() => [])
          );
          const tableResults = await Promise.allSettled(tablesPromises);
          tables = tableResults.flatMap(
            (r) => (r.status === 'fulfilled' && Array.isArray(r.value) ? r.value : [])
          );
        }
      } catch {
        tables = [];
      }

      // Generate notifications from real data
      const generated = generateNotifications({
        reservations,
        tables,
        customers,
      });

      if (mountedRef.current) {
        setNotifications(generated);
        setError(null);
      }
    } catch (err) {
      if (mountedRef.current) {
        setError(err?.message || 'Error al generar notificaciones');
        setNotifications([]);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  // Initial fetch — solo si hay usuario autenticado
  useEffect(() => {
    // No hacer nada mientras se verifica la sesión
    if (authLoading) return;

    // Si no hay usuario/token, no hacer llamadas privadas
    if (!user || !token) {
      /* eslint-disable react-hooks/set-state-in-effect */
      setNotifications([]);
      setLoading(false);
      setError(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }

    mountedRef.current = true;
    fetchAndGenerate();

    // Refresh cada 30 segundos
    intervalRef.current = setInterval(() => {
      fetchAndGenerate();
    }, 30000);

    return () => {
      mountedRef.current = false;
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [authLoading, user, token, fetchAndGenerate]);

  // Also refresh on focus and visibility change — solo si hay usuario autenticado
  useEffect(() => {
    if (!user || !token) return;

    const handleRefresh = () => {
      fetchAndGenerate();
    };
    window.addEventListener('focus', handleRefresh);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        fetchAndGenerate();
      }
    });
    return () => {
      window.removeEventListener('focus', handleRefresh);
      document.removeEventListener('visibilitychange', handleRefresh);
    };
  }, [user, token, fetchAndGenerate]);

  const togglePanel = useCallback(() => {
    setPanelOpen((prev) => !prev);
  }, []);

  const closePanel = useCallback(() => {
    setPanelOpen(false);
  }, []);

  const unreadCount = notifications.filter((n) => n.priority === 'alert' || n.priority === 'warning').length;

  const value = {
    notifications,
    loading,
    error,
    panelOpen,
    togglePanel,
    closePanel,
    unreadCount,
    refresh: fetchAndGenerate,
  };

  return (
    <NotificationContext.Provider value={value}>
      {children}
    </NotificationContext.Provider>
  );
};

export default NotificationContext;
