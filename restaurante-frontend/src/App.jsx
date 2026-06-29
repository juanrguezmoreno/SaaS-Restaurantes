import { Routes, Route, Navigate } from 'react-router-dom';
import ProtectedRoute from './components/ProtectedRoute';
import PermissionRoute from './components/PermissionRoute';
import MainLayout from './layouts/MainLayout';
import PublicLayout from './layouts/PublicLayout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Customers from './pages/Customers';
import Employees from './pages/Employees';
import Reservations from './pages/Reservations';
import Restaurants from './pages/Restaurants';
import Tables from './pages/Tables';
import FloorPlan from './pages/FloorPlan';
import Notifications from './pages/Notifications';
import Analytics from './pages/Analytics';
import PublicReservation from './pages/PublicReservation';
import { NotificationProvider } from './context/NotificationContext';
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

      {/* Rutas protegidas con layout — NotificationProvider solo para rutas privadas */}
      <Route
        element={
          <ProtectedRoute>
            <NotificationProvider>
              <MainLayout />
            </NotificationProvider>
          </ProtectedRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/inicio" element={<Dashboard />} />

        {/* ── Operativa ── */}
        <Route path="/reservations" element={<PermissionRoute permission={PERMISSIONS.VIEW_RESERVATIONS}><Reservations /></PermissionRoute>} />
        <Route path="/floor-plan" element={<PermissionRoute permission={PERMISSIONS.VIEW_FLOOR_PLAN}><FloorPlan /></PermissionRoute>} />
        <Route path="/customers" element={<PermissionRoute permission={PERMISSIONS.VIEW_CUSTOMERS}><Customers /></PermissionRoute>} />

        {/* ── Negocio ── */}
        <Route path="/analytics" element={<PermissionRoute permission={PERMISSIONS.VIEW_ANALYTICS}><Analytics /></PermissionRoute>} />
        <Route path="/notifications" element={<PermissionRoute permission={PERMISSIONS.VIEW_NOTIFICATIONS}><Notifications /></PermissionRoute>} />

        {/* ── Administración ── */}
        <Route path="/restaurants" element={<PermissionRoute permission={PERMISSIONS.VIEW_RESTAURANTS}><Restaurants /></PermissionRoute>} />
        <Route path="/tables" element={<PermissionRoute permission={PERMISSIONS.VIEW_TABLES}><Tables /></PermissionRoute>} />
        <Route path="/employees" element={<PermissionRoute permission={PERMISSIONS.VIEW_EMPLOYEES}><Employees /></PermissionRoute>} />
      </Route>

      {/* Redirecciones - /inicio es la ruta canónica del dashboard */}
      <Route path="/" element={<Navigate to="/inicio" replace />} />
      <Route path="*" element={<Navigate to="/inicio" replace />} />
    </Routes>
  );
}

export default App;
