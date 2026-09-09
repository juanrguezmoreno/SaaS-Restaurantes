import api from '../api/axios';

/**
 * Cliente de la API de facturación.
 *
 * Ninguna función de aquí decide nada: el backend es el que autoriza. Lo que se
 * lee por aquí sólo sirve para pintar la interfaz.
 */

export const getEntitlements = async () => {
  const { data } = await api.get('/billing/entitlements');
  return data.data;
};

export const getPlans = async () => {
  const { data } = await api.get('/billing/plans');
  return data.data;
};

export const getSubscription = async () => {
  const { data } = await api.get('/billing/subscription');
  return data.data;
};

/** Devuelve la URL de Stripe Checkout a la que hay que redirigir. */
export const startCheckout = async (planCode) => {
  const { data } = await api.post('/billing/checkout', { planCode });
  return data.data.url;
};

export const openPortal = async () => {
  const { data } = await api.post('/billing/portal');
  return data.data.url;
};

export const changePlan = async (planCode) => {
  const { data } = await api.post('/billing/change-plan', { planCode });
  return data.data;
};

export const cancelSubscription = async (atPeriodEnd = true) => {
  const { data } = await api.post('/billing/cancel', { atPeriodEnd });
  return data.data;
};

export const reactivateSubscription = async () => {
  const { data } = await api.post('/billing/reactivate');
  return data.data;
};

export const setActiveRestaurant = async (restaurantId) => {
  const { data } = await api.post('/billing/active-restaurant', { restaurantId });
  return data.data;
};
