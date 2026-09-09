import { useEffect, useState } from 'react';
import { getPlans } from '../services/billingService';
import { FEATURE_LABELS, PLAN_LABELS } from '../config/features';

/**
 * Comparativa NORMAL vs PRO.
 *
 * Es una tabla honesta: sin cuentas atrás ni lenguaje de urgencia. El plan que
 * ya se tiene contratado se marca con "Tu plan" y su botón queda desactivado,
 * porque no tiene sentido ofrecer contratar lo que ya se tiene.
 */
const PlanComparisonModal = ({ show, onClose, currentPlan, onChoosePlan, billingConfigured = true, changing = null }) => {
  const [plans, setPlans] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    getPlans()
      .then((data) => {
        if (!cancelled) setPlans(data ?? []);
      })
      .catch(() => {
        if (!cancelled) setError('No se pudo cargar el catálogo de planes.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [show]);

  if (!show) return null;

  // Todas las funcionalidades que aparecen en algún plan, en el orden del catálogo.
  const featureCodes = Object.keys(FEATURE_LABELS);

  return (
    <div
      className="modal d-block"
      tabIndex={-1}
      role="dialog"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="modal-dialog modal-dialog-centered modal-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">Comparar planes</h5>
            <button type="button" className="btn-close" onClick={onClose} aria-label="Cerrar" />
          </div>

          <div className="modal-body">
            {!billingConfigured && (
              <div className="alert alert-warning" role="alert">
                Los pagos no están configurados en este entorno: puedes ver la comparativa,
                pero no contratar ni cambiar de plan desde aquí.
              </div>
            )}

            {loading && (
              <div className="text-center py-4">
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                <span className="ms-2">Cargando planes…</span>
              </div>
            )}

            {error && (
              <div className="alert alert-danger" role="alert">{error}</div>
            )}

            {!loading && !error && plans.length > 0 && (
              <div className="table-responsive">
                <table className="plan-comparison-table">
                  <thead>
                    <tr>
                      <th scope="col">Funcionalidad</th>
                      {plans.map((plan) => (
                        <th key={plan.code} scope="col">
                          {PLAN_LABELS[plan.code] ?? plan.name}
                          {plan.code === currentPlan && (
                            <span className="plan-comparison-current">Tu plan</span>
                          )}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <th scope="row">Locales</th>
                      {plans.map((plan) => (
                        <td key={plan.code}>
                          {plan.maxRestaurants == null ? 'Sin límite' : plan.maxRestaurants}
                        </td>
                      ))}
                    </tr>
                    <tr>
                      <th scope="row">Cuentas de usuario</th>
                      {plans.map((plan) => (
                        <td key={plan.code}>
                          {plan.maxUserAccounts == null ? 'Sin límite' : plan.maxUserAccounts}
                        </td>
                      ))}
                    </tr>
                    {featureCodes.map((code) => (
                      <tr key={code}>
                        <th scope="row" title={FEATURE_LABELS[code].description}>
                          {FEATURE_LABELS[code].name}
                        </th>
                        {plans.map((plan) => (
                          <td key={plan.code} className="text-center">
                            {plan.features?.includes(code) ? (
                              <span className="plan-comparison-check" aria-label="Incluida">✓</span>
                            ) : (
                              <span className="plan-comparison-cross" aria-label="No incluida">—</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <th scope="row" aria-hidden="true"></th>
                      {plans.map((plan) => {
                        const esActual = plan.code === currentPlan;
                        return (
                          <td key={plan.code}>
                            <button
                              type="button"
                              className={`btn btn-sm ${esActual ? 'btn-outline-secondary' : 'btn-primary'} w-100`}
                              disabled={esActual || !billingConfigured || changing === plan.code}
                              onClick={() => onChoosePlan(plan.code)}
                            >
                              {esActual
                                ? 'Tu plan'
                                : changing === plan.code
                                  ? 'Aplicando…'
                                  : `Cambiar a ${PLAN_LABELS[plan.code] ?? plan.name}`}
                            </button>
                          </td>
                        );
                      })}
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <div className="modal-footer border-0">
            <button type="button" className="btn btn-secondary" onClick={onClose}>Cerrar</button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlanComparisonModal;
