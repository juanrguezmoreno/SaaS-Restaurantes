import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import PermissionRoute from './components/PermissionRoute';
import MainLayout from './layouts/MainLayout';
import PublicLayout from './layouts/PublicLayout';
import Login from './pages/Login';
import Inicio from './pages/Inicio';
import Customers from './pages/Customers';
import Employees from './pages/Employees';
import Reservations from './pages/Reservations';
import Restaurants from './pages/Restaurants';
import Tables from './pages/Tables';
import FloorPlan from './pages/FloorPlan';
import PublicReservation from './pages/PublicReservation';
import { PERMISSIONS } from './config/permissions';

function App() {
  return (
    <Routes>
      {/* Rutas públicas (sin autenticación) */}
      <Route path="/login" element={<Login />} />
      <Route element={<PublicLayout />}>
        <Route path="/public/reservar/:restaurantId" element={<PublicReservation />} />
        <Route path="/r/:restaurantId" element={<PublicReservation />} />
      </Route>

      {/* Rutas protegidas con layout */}
      <Route
        element={
          <ProtectedRoute>
            <MainLayout />
          </ProtectedRoute>
        }
      >
        <Route path="/inicio" element={<PermissionRoute permission={PERMISSIONS.VIEW_DASHBOARD}><Inicio /></PermissionRoute>} />

        {/* ── Operativa ── */}
        <Route path="/reservations" element={<PermissionRoute permission={PERMISSIONS.VIEW_RESERVATIONS}><Reservations /></PermissionRoute>} />
        <Route path="/floor-plan" element={<PermissionRoute permission={PERMISSIONS.VIEW_FLOOR_PLAN}><FloorPlan /></PermissionRoute>} />
        <Route path="/customers" element={<PermissionRoute permission={PERMISSIONS.VIEW_CUSTOMERS}><Customers /></PermissionRoute>} />

        {/* ── Administración ── */}
        <Route path="/restaurants" element={<PermissionRoute permission={PERMISSIONS.VIEW_RESTAURANTS}><Restaurants /></PermissionRoute>} />
        <Route path="/tables" element={<PermissionRoute permission={PERMISSIONS.VIEW_TABLES}><Tables /></PermissionRoute>} />
        <Route path="/employees" element={<PermissionRoute permission={PERMISSIONS.VIEW_EMPLOYEES}><Employees /></PermissionRoute>} />
      </Route>

      {/* Redirecciones — /inicio es la ruta canónica; /dashboard y /analytics
          se mantienen por compatibilidad con enlaces existentes */}
      <Route path="/" element={<Navigate to="/inicio" replace />} />
      <Route path="/dashboard" element={<Navigate to="/inicio" replace />} />
      <Route path="/analytics" element={<Navigate to="/inicio" replace />} />
      <Route path="*" element={<Navigate to="/inicio" replace />} />
    </Routes>
  );
}

export default App;
