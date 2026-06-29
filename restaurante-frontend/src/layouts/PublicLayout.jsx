import { Outlet } from 'react-router-dom';

/**
 * Layout público para páginas sin autenticación.
 * No incluye sidebar, navbar privada ni datos de usuario.
 * Diseño limpio y centrado para landing de reserva online.
 */
const PublicLayout = () => {
  return (
    <div className="public-layout">
      <Outlet />
    </div>
  );
};

export default PublicLayout;
