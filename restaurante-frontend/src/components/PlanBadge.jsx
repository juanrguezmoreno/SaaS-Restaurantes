import { PLAN_LABELS, STATUS_LABELS } from '../config/features';

/**
 * Distintivo del plan contratado. Discreto a propósito: informa, no vende.
 * Se reutiliza en la página de facturación, en la comparativa de planes y,
 * en el futuro, en cualquier otro sitio que necesite recordar el plan actual.
 */
const PlanBadge = ({ plan, status, size = 'md' }) => {
  if (!plan) return null;
  const estado = STATUS_LABELS[status];
  return (
    <span className={`plan-badge plan-badge--${plan.toLowerCase()} plan-badge--${size}`}>
      {PLAN_LABELS[plan] ?? plan}
      {estado && estado.tone !== 'success' && (
        <span className={`plan-badge__state plan-badge__state--${estado.tone}`}>
          {estado.text}
        </span>
      )}
    </span>
  );
};

export default PlanBadge;
