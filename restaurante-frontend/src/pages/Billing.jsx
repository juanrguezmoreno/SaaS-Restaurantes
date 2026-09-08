import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useEntitlements } from '../context/EntitlementsContext';
import { PLAN_LABELS, STATUS_LABELS } from '../config/features';
import {
  getSubscription,
  startCheckout,
  openPortal,
  changePlan,
  cancelSubscription,
  reactivateSubscription,
  setActiveRestaurant,
} from '../services/billingService';
import { getRestaurants } from '../services/restaurantService';
import PlanBadge from '../components/PlanBadge';
import PlanComparisonModal from '../components/PlanComparisonModal';

/** Plan alternativo al actual: con sólo dos planes no hace falta preguntar cuál. */
const OTRO_PLAN = { NORMAL: 'PRO', PRO: 'NORMAL' };

const formatFecha = (iso) => {
  if (!iso) return null;
  try {
    return new Intl.DateTimeFormat('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })
      .format(new Date(iso));
  } catch {
    return null;
  }
};

const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (err?.response?.data?.message) return err.response.data.message;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

/** Barra de uso frente al límite. Con límite null se muestra "Sin límite", no una barra al 0%. */
const UsageBar = ({ label, used, limit }) => {
  const sinLimite = limit === null || limit === undefined;
  const porcentaje = sinLimite ? 0 : Math.min(100, Math.round(((used ?? 0) / limit) * 100));
  return (
    <div className="usage-bar-row">
      <div className="usage-bar-header">
        <span className="usage-bar-label">{label}</span>
        <span className="usage-bar-value">
          {sinLimite ? 'Sin límite' : `${used ?? 0} de ${limit}`}
        </span>
      </div>
      {!sinLimite && (
        <div className="usage-bar-track">
          <div
            className={`usage-bar-fill ${porcentaje >= 100 ? 'usage-bar-fill--full' : ''}`}
            style={{ width: `${porcentaje}%` }}
          />
        </div>
      )}
    </div>
  );
};

/**
 * Página de facturación: plan contratado, uso frente a límites, reconciliación
 * de locales cuando el plan se ha reducido, y las acciones de cambiar de plan,
 * gestionar el pago o cancelar.
 */
const Billing = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const {
    plan, limits, usage, billingConfigured,
    loading: entitlementsLoading, refresh: refreshEntitlements, refreshAfterCheckout,
  } = useEntitlements();

  const [subscription, setSubscription] = useState(null);
  const [loadingSubscription, setLoadingSubscription] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  const [confirmingCheckout, setConfirmingCheckout] = useState(false);
  const [showComparison, setShowComparison] = useState(false);
  const [changingPlan, setChangingPlan] = useState(null);

  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [openingPortal, setOpeningPortal] = useState(false);

  const [restaurants, setRestaurants] = useState([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);
  const [activatingRestaurantId, setActivatingRestaurantId] = useState(null);

  // ─── Carga de la suscripción ─────────────────────────────────────────────
  const loadSubscription = useCallback(async () => {
    try {
      setLoadingSubscription(true);
      const data = await getSubscription();
      setSubscription(data);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoadingSubscription(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSubscription();
  }, [loadSubscription]);

  // ─── Vuelta de Stripe Checkout ───────────────────────────────────────────
  // El webhook puede tardar unos segundos: mientras tanto se muestra un aviso
  // en vez del plan viejo, que parecería que el pago no ha servido de nada.
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    if (params.get('checkout') === 'success') {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConfirmingCheckout(true);
      refreshAfterCheckout()
        .then(() => loadSubscription())
        .finally(() => setConfirmingCheckout(false));
      navigate('/settings/billing', { replace: true });
    } else if (params.get('checkout') === 'cancel') {
      // El usuario simplemente cambió de idea: no es un error.
      navigate('/settings/billing', { replace: true });
    }
    // Sólo debe reaccionar a la query string con la que se entra a la página.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Reconciliación de locales ───────────────────────────────────────────
  const necesitaReconciliar = limits?.maxRestaurants != null
    && (usage?.RESTAURANT ?? 0) > limits.maxRestaurants;

  useEffect(() => {
    if (!necesitaReconciliar) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingRestaurants(true);
    getRestaurants()
      .then((data) => {
        if (!cancelled) setRestaurants(Array.isArray(data) ? data : (data?.content ?? []));
      })
      .catch(() => {
        if (!cancelled) setRestaurants([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingRestaurants(false);
      });
    return () => {
      cancelled = true;
    };
  }, [necesitaReconciliar]);

  const handleElegirActivo = async (restaurantId) => {
    setActivatingRestaurantId(restaurantId);
    setError(null);
    try {
      await setActiveRestaurant(restaurantId);
      setSuccessMessage('Local activo actualizado.');
      await refreshEntitlements();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setActivatingRestaurantId(null);
    }
  };

  // ─── Cambio de plan (contratación o cambio ya suscrito) ─────────────────
  const handleChoosePlan = useCallback(async (planCode) => {
    setChangingPlan(planCode);
    setError(null);
    try {
      if (subscription?.stripeLinked) {
        // Ya hay una suscripción de Stripe activa: se cambia sin pasar por checkout.
        await changePlan(planCode);
        setSuccessMessage('Plan actualizado correctamente.');
        setShowComparison(false);
        await Promise.all([loadSubscription(), refreshEntitlements()]);
      } else {
        // Todavía no hay suscripción de pago: hay que contratarla en Stripe.
        const url = await startCheckout(planCode);
        window.location.href = url;
      }
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setChangingPlan(null);
    }
  }, [subscription, refreshEntitlements, loadSubscription]);

  // ─── Portal de facturación de Stripe ─────────────────────────────────────
  const handleOpenPortal = async () => {
    setOpeningPortal(true);
    setError(null);
    try {
      const url = await openPortal();
      window.location.href = url;
    } catch (err) {
      setError(getErrorMessage(err));
      setOpeningPortal(false);
    }
  };

  // ─── Cancelar / reactivar ─────────────────────────────────────────────
  const handleCancel = async (atPeriodEnd) => {
    setCancelling(true);
    setError(null);
    try {
      await cancelSubscription(atPeriodEnd);
      setSuccessMessage(atPeriodEnd
        ? 'Cancelación programada: conservas el acceso hasta el final del periodo ya pagado.'
        : 'Suscripción cancelada de inmediato.');
      setShowCancelModal(false);
      await Promise.all([loadSubscription(), refreshEntitlements()]);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setCancelling(false);
    }
  };

  const handleReactivate = async () => {
    setReactivating(true);
    setError(null);
    try {
      await reactivateSubscription();
      setSuccessMessage('Suscripción reactivada.');
      await Promise.all([loadSubscription(), refreshEntitlements()]);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setReactivating(false);
    }
  };

  // ─── Textos derivados del estado de la suscripción ───────────────────────
  // Se leen del propio objeto de suscripción, no del contexto de entitlements:
  // es la fuente autorizada para lo que se pinta en esta página.
  const estadoLabel = useMemo(
    () => STATUS_LABELS[subscription?.status]?.text ?? subscription?.status,
    [subscription],
  );

  const proximaFechaTexto = useMemo(() => {
    if (!subscription) return null;
    if (subscription.cancelAtPeriodEnd && subscription.currentPeriodEnd) {
      return `Tu suscripción se cancelará el ${formatFecha(subscription.currentPeriodEnd)}. Conservas el acceso hasta esa fecha.`;
    }
    if (subscription.status === 'TRIALING' && subscription.trialEnd) {
      return `Tu periodo de prueba termina el ${formatFecha(subscription.trialEnd)}.`;
    }
    if (subscription.currentPeriodEnd) {
      return `Próxima renovación: ${formatFecha(subscription.currentPeriodEnd)}.`;
    }
    return null;
  }, [subscription]);

  const otroPlan = plan ? OTRO_PLAN[plan] : null;

  return (
    <div className="billing-page">
      {/* ═══ Page Header ═══════════════════════════════════════════════ */}
      <div className="page-header">
        <div>
          <h1>Facturación</h1>
          <p className="page-description">Tu plan, tu consumo y el estado de tu suscripción.</p>
        </div>
      </div>

      {/* ═══ Mensajes ════════════════════════════════════════════════════ */}
      {successMessage && (
        <div className="alert alert-success d-flex align-items-center gap-2 mb-3" role="alert">
          <span className="flex-grow-1">{successMessage}</span>
          <button type="button" className="btn-close" onClick={() => setSuccessMessage('')} aria-label="Cerrar" />
        </div>
      )}
      {error && (
        <div className="alert alert-danger d-flex align-items-center gap-2 mb-3" role="alert">
          <span className="flex-grow-1">{error}</span>
          <button type="button" className="btn-close" onClick={() => setError(null)} aria-label="Cerrar" />
        </div>
      )}

      {confirmingCheckout && (
        <div className="alert alert-info d-flex align-items-center gap-2 mb-3" role="alert">
          <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
          <span>Estamos confirmando tu pago…</span>
        </div>
      )}

      {(loadingSubscription || entitlementsLoading) && !subscription && (
        <div className="text-center py-5">
          <span className="spinner-border" role="status" aria-hidden="true" />
        </div>
      )}

      {subscription && (
        <>
          {/* ═══ 1. Plan actual ══════════════════════════════════════════ */}
          <section className="billing-card">
            <div className="billing-card-header">
              <h2>Tu plan</h2>
              <PlanBadge plan={subscription.plan} status={subscription.status} size="lg" />
            </div>
            <div className="billing-plan-summary">
              <p className="billing-plan-status">
                Estado: <strong>{estadoLabel}</strong>
              </p>
              {proximaFechaTexto && <p className="text-secondary mb-0">{proximaFechaTexto}</p>}
              {subscription.legacyGrant && (
                <p className="billing-legacy-note">
                  Plan de cortesía activo — tu cuenta tiene acceso Pro sin cargo, por ser anterior
                  a la puesta en marcha de los pagos.
                </p>
              )}
            </div>
          </section>

          {/* ═══ 2. Uso frente a límites ═══════════════════════════════════ */}
          <section className="billing-card">
            <h2>Uso frente a tus límites</h2>
            <UsageBar label="Locales" used={usage?.RESTAURANT} limit={limits?.maxRestaurants} />
            <UsageBar label="Cuentas de usuario" used={usage?.USER_ACCOUNT} limit={limits?.maxUserAccounts} />
          </section>

          {/* ═══ 3. Reconciliación de locales ═══════════════════════════════ */}
          {necesitaReconciliar && (
            <section className="billing-card billing-card--warning">
              <h2>Elige qué local quieres mantener activo</h2>
              <p>
                Tu plan actual admite menos locales de los que tienes. No se ha borrado
                nada: elige cuál quieres mantener activo mientras el resto queda en pausa. Podrás
                volver a activarlos en cuanto amplíes el plan.
              </p>
              {loadingRestaurants ? (
                <div className="py-2">
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                </div>
              ) : (
                <ul className="billing-restaurant-list">
                  {restaurants.map((restaurant) => (
                    <li key={restaurant.id} className="billing-restaurant-item">
                      <span>{restaurant.name}</span>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-primary"
                        disabled={activatingRestaurantId === restaurant.id}
                        onClick={() => handleElegirActivo(restaurant.id)}
                      >
                        {activatingRestaurantId === restaurant.id ? 'Aplicando…' : 'Mantener activo'}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {/* ═══ 4. Acciones ═══════════════════════════════════════════════ */}
          <section className="billing-card">
            <h2>Gestionar suscripción</h2>

            {!billingConfigured && (
              <div className="alert alert-warning" role="alert">
                Los pagos no están configurados en este entorno: los botones de contratación
                están desactivados.
              </div>
            )}

            <div className="billing-actions">
              {otroPlan && (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={!billingConfigured || changingPlan === otroPlan}
                  onClick={() => handleChoosePlan(otroPlan)}
                >
                  {changingPlan === otroPlan ? 'Aplicando…' : `Cambiar a ${PLAN_LABELS[otroPlan] ?? otroPlan}`}
                </button>
              )}

              <button
                type="button"
                className="btn btn-outline-secondary"
                onClick={() => setShowComparison(true)}
              >
                Ver comparativa de planes
              </button>

              {subscription.stripeLinked && (
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  disabled={!billingConfigured || openingPortal}
                  onClick={handleOpenPortal}
                >
                  {openingPortal ? 'Abriendo…' : 'Gestionar método de pago'}
                </button>
              )}

              {subscription.stripeLinked && !subscription.cancelAtPeriodEnd && (
                <button
                  type="button"
                  className="btn btn-outline-danger"
                  onClick={() => setShowCancelModal(true)}
                >
                  Cancelar suscripción
                </button>
              )}

              {subscription.cancelAtPeriodEnd && (
                <button
                  type="button"
                  className="btn btn-outline-primary"
                  disabled={reactivating}
                  onClick={handleReactivate}
                >
                  {reactivating ? 'Reactivando…' : 'Reactivar suscripción'}
                </button>
              )}
            </div>
          </section>
        </>
      )}

      <PlanComparisonModal
        show={showComparison}
        onClose={() => setShowComparison(false)}
        currentPlan={plan}
        onChoosePlan={handleChoosePlan}
        billingConfigured={billingConfigured}
        changing={changingPlan}
      />

      {/* ═══ Modal: confirmar cancelación ═══════════════════════════════ */}
      {showCancelModal && (
        <div className="modal d-block" tabIndex={-1} role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Cancelar suscripción</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setShowCancelModal(false)}
                  disabled={cancelling}
                  aria-label="Cerrar"
                />
              </div>
              <div className="modal-body">
                <p>Elige cómo quieres cancelar:</p>
                <div className="billing-cancel-option">
                  <h6>Al final del periodo (recomendada)</h6>
                  <p className="text-secondary mb-2">
                    Conservas el acceso hasta la fecha que ya has pagado
                    {subscription?.currentPeriodEnd ? ` (${formatFecha(subscription.currentPeriodEnd)})` : ''}.
                    Puedes reactivarla en cualquier momento antes de esa fecha.
                  </p>
                  <button
                    type="button"
                    className="btn btn-primary"
                    disabled={cancelling}
                    onClick={() => handleCancel(true)}
                  >
                    Cancelar al final del periodo
                  </button>
                </div>
                <div className="billing-cancel-option">
                  <h6>Cancelar de inmediato</h6>
                  <p className="text-secondary mb-2">
                    Pierdes el acceso a las funciones de tu plan ahora mismo, aunque queden días
                    ya pagados.
                  </p>
                  <button
                    type="button"
                    className="btn btn-outline-danger"
                    disabled={cancelling}
                    onClick={() => handleCancel(false)}
                  >
                    Cancelar de inmediato
                  </button>
                </div>
              </div>
              <div className="modal-footer border-0">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCancelModal(false)}
                  disabled={cancelling}
                >
                  Volver
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Billing;
