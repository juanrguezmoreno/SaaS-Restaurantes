import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FEATURE_LABELS } from '../config/features';

/** Nombre legible de cada recurso con cuota, para el detalle numérico del límite. */
const RESOURCE_LABELS = {
  RESTAURANT: 'locales',
  USER_ACCOUNT: 'cuentas de usuario',
};

// No reaparecer por el mismo motivo antes de que pase un minuto de haberse
// cerrado: "no abusar de ventanas de venta" es un requisito explícito.
const REAPARICION_MS = 60000;

/** Identifica "el mismo motivo": la feature bloqueada o el recurso agotado. */
const motivoDe = (detail) => detail?.feature ?? detail?.resource ?? detail?.code ?? null;

/**
 * Diálogo único de mejora de plan, montado en MainLayout.
 *
 * Escucha 'plan:upgrade-required', emitido por el interceptor de axios ante un
 * 403 de PLAN_UPGRADE_REQUIRED o PLAN_LIMIT_REACHED (nunca ante un 403 por rol:
 * eso lo filtra el propio interceptor). Explica qué función falta o qué límite
 * se alcanzó y ofrece un único camino: ir a facturación.
 */
const UpgradeModal = () => {
  const navigate = useNavigate();
  const [detail, setDetail] = useState(null);
  const [show, setShow] = useState(false);
  const suprimidoRef = useRef({ motivo: null, hasta: 0 });

  useEffect(() => {
    const escuchar = (event) => {
      const nuevoDetail = event.detail ?? {};
      const motivo = motivoDe(nuevoDetail);
      const { motivo: motivoSuprimido, hasta } = suprimidoRef.current;
      if (motivo && motivo === motivoSuprimido && Date.now() < hasta) {
        // Mismo motivo, cerrado hace menos de un minuto: no perseguir al usuario.
        return;
      }
      setDetail(nuevoDetail);
      setShow(true);
    };
    window.addEventListener('plan:upgrade-required', escuchar);
    return () => window.removeEventListener('plan:upgrade-required', escuchar);
  }, []);

  const cerrar = useCallback(() => {
    setShow(false);
    suprimidoRef.current = { motivo: motivoDe(detail), hasta: Date.now() + REAPARICION_MS };
  }, [detail]);

  useEffect(() => {
    if (!show) return undefined;
    const onKeyDown = (event) => {
      if (event.key === 'Escape') cerrar();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [show, cerrar]);

  if (!show || !detail) return null;

  const esLimite = detail.code === 'PLAN_LIMIT_REACHED';
  const featureInfo = !esLimite ? FEATURE_LABELS[detail.feature] : null;
  const recursoLabel = RESOURCE_LABELS[detail.resource] ?? 'unidades';

  const titulo = esLimite
    ? 'Has alcanzado el límite de tu plan'
    : (featureInfo?.name ?? 'Función disponible en un plan superior');

  const irAFacturacion = () => {
    cerrar();
    navigate('/settings/billing');
  };

  return (
    <div
      className="modal d-block"
      tabIndex={-1}
      role="dialog"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={cerrar}
    >
      <div
        className="modal-dialog modal-dialog-centered"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-content">
          <div className="modal-header">
            <h5 className="modal-title">{titulo}</h5>
            <button type="button" className="btn-close" onClick={cerrar} aria-label="Cerrar" />
          </div>

          <div className="modal-body">
            {esLimite ? (
              <p>
                Estás usando {detail.current} de {detail.limit} {recursoLabel}. Amplía tu plan
                para añadir más.
              </p>
            ) : (
              <p>{featureInfo?.description ?? detail.message}</p>
            )}
          </div>

          <div className="modal-footer border-0 flex-column align-items-stretch gap-2">
            <button type="button" className="btn btn-primary" onClick={irAFacturacion}>
              Actualizar a Pro
            </button>
            <button type="button" className="btn btn-link btn-sm" onClick={irAFacturacion}>
              Ver comparativa de planes
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default UpgradeModal;
