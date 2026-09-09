import { useEffect, useState } from 'react';
import { Link, Outlet } from 'react-router-dom';
import Sidebar from '../components/Sidebar';
import Navbar from '../components/Navbar';
import UpgradeModal from '../components/UpgradeModal';
import { useAuth } from '../context/AuthContext';
import { useEntitlements } from '../context/EntitlementsContext';
import { canAccess, PERMISSIONS } from '../config/permissions';
import { getSubscription } from '../services/billingService';

/**
 * Banner de facturación: sólo aparece cuando hay algo que el usuario deba
 * resolver, nunca como reclamo permanente de venta.
 *
 * El pago pendiente y la cancelación programada salen de /billing/subscription,
 * restringido a ADMIN/SUPER_ADMIN en el backend: a un EMPLOYEE no se le pide
 * ese dato (le daría 403) y sólo se le muestra lo que sí puede saber, que sus
 * locales están bloqueados por el plan.
 */
const BillingBanner = () => {
  const { user } = useAuth();
  const { plan, limits, usage } = useEntitlements();
  const esAdministrador = canAccess(user, PERMISSIONS.MANAGE_BILLING);
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    if (!esAdministrador) return;
    let cancelado = false;
    getSubscription()
      .then((data) => {
        if (!cancelado) setSubscription(data);
      })
      .catch(() => {
        if (!cancelado) setSubscription(null);
      });
    return () => {
      cancelado = true;
    };
  }, [esAdministrador]);

  const localesBloqueados = plan
    && limits?.maxRestaurants != null
    && (usage?.RESTAURANT ?? 0) > limits.maxRestaurants;

  if (esAdministrador && subscription?.status === 'PAST_DUE') {
    return (
      <div className="alert alert-danger billing-banner" role="alert">
        Hay un pago pendiente en tu suscripción. Actualiza tu método de pago para no perder
        el acceso a tu plan. <Link to="/settings/billing">Ir a facturación</Link>
      </div>
    );
  }

  if (esAdministrador && subscription?.cancelAtPeriodEnd) {
    return (
      <div className="alert alert-warning billing-banner" role="alert">
        Tu suscripción está programada para cancelarse al final del periodo actual.{' '}
        <Link to="/settings/billing">Revisar suscripción</Link>
      </div>
    );
  }

  if (localesBloqueados) {
    return (
      <div className="alert alert-warning billing-banner" role="alert">
        Tienes más locales de los que permite tu plan actual: algunos han quedado en pausa.
        {esAdministrador && <> <Link to="/settings/billing">Elegir cuál mantener activo</Link></>}
      </div>
    );
  }

  return null;
};

const MainLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const toggleSidebar = () => {
    setSidebarOpen((prev) => !prev);
  };

  const closeSidebar = () => {
    setSidebarOpen(false);
  };

  return (
    <div className="app-layout">
      <Sidebar show={sidebarOpen} onClose={closeSidebar} />

      <div className="main-content">
        <Navbar onToggleSidebar={toggleSidebar} />

        <main className="content-wrapper">
          <BillingBanner />
          <Outlet />
        </main>
      </div>

      <UpgradeModal />
    </div>
  );
};

export default MainLayout;
