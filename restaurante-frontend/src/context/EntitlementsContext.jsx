import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getEntitlements } from '../services/billingService';
import { useAuth } from './AuthContext';

const EntitlementsContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useEntitlements = () => {
  const context = useContext(EntitlementsContext);
  if (!context) {
    throw new Error('useEntitlements debe usarse dentro de un EntitlementsProvider');
  }
  return context;
};

/** Estado cerrado: sin features y sin cuota. Es el punto de partida y el de error. */
const ESTADO_VACIO = {
  plan: null, status: null, hasAccess: false,
  features: [], limits: {}, usage: {},
};

/**
 * Contexto de funcionalidades contratadas (entitlements).
 *
 * IMPORTANTE: este contexto nunca autoriza nada, sólo decide qué se pinta. Quien
 * autoriza de verdad es el backend, que responde 403 aunque alguien manipule este
 * estado en el navegador.
 */
export const EntitlementsProvider = ({ children }) => {
  const { token } = useAuth();
  const [entitlements, setEntitlements] = useState(ESTADO_VACIO);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!token) {
      setEntitlements(ESTADO_VACIO);
      setLoading(false);
      return;
    }
    try {
      setEntitlements(await getEntitlements());
    } catch {
      // Cerrado por defecto: un fallo de red nunca debe regalar funciones de pago.
      // El backend seguiría negándolas, pero pintar candados es más honesto que
      // mostrar botones que van a fallar.
      setEntitlements(ESTADO_VACIO);
    } finally {
      setLoading(false);
    }
  }, [token]);

  // Al montar (o al cambiar el token) se consulta el plan contratado.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  /**
   * Tras volver de Stripe, el webhook puede tardar unos segundos en llegar. Se
   * reconsulta con espera creciente en vez de mostrar el plan viejo y parecer
   * que el pago no ha servido de nada.
   */
  const refreshAfterCheckout = useCallback(async (intentos = 5) => {
    for (let i = 0; i < intentos; i += 1) {
      const datos = await getEntitlements().catch(() => null);
      if (datos?.hasAccess) {
        setEntitlements(datos);
        return datos;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
    return refresh();
  }, [refresh]);

  const hasFeature = useCallback(
    (feature) => Boolean(entitlements.features?.includes(feature)),
    [entitlements.features],
  );

  const isAtLimit = useCallback((resource) => {
    const limite = resource === 'RESTAURANT'
      ? entitlements.limits?.maxRestaurants
      : entitlements.limits?.maxUserAccounts;
    if (limite === null || limite === undefined) return false; // ilimitado
    return (entitlements.usage?.[resource] ?? 0) >= limite;
  }, [entitlements.limits, entitlements.usage]);

  return (
    <EntitlementsContext.Provider
      value={{ ...entitlements, loading, hasFeature, isAtLimit, refresh, refreshAfterCheckout }}
    >
      {children}
    </EntitlementsContext.Provider>
  );
};
