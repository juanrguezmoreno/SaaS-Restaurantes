import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getEmployees,
  createEmployee,
  updateEmployee,
  toggleEmployeeActive,
} from '../services/employeeService';
import { getRestaurants } from '../services/restaurantService';
import { ROLES, ROLE_LABELS, canAccess, PERMISSIONS } from '../config/permissions';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

/** Puestos internos del restaurante */
const POSITIONS = [
  { value: 'WAITER', label: 'Camarero' },
  { value: 'CHEF', label: 'Cocinero' },
  { value: 'MANAGER', label: 'Encargado' },
  { value: 'RECEPTION', label: 'Recepción' },
  { value: 'HOST', label: 'Host' },
  { value: 'CLEANING', label: 'Limpieza' },
  { value: 'OTHER', label: 'Otro' },
];

const POSITION_LABEL_MAP = Object.fromEntries(POSITIONS.map((p) => [p.value, p.label]));

/** Roles que se pueden asignar al crear un usuario, según el rol del usuario actual */
const getAssignableRoles = (currentRole) => {
  switch (currentRole) {
    case ROLES.SUPER_ADMIN:
      return [ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE];
    case ROLES.ADMIN:
      return [ROLES.MANAGER, ROLES.EMPLOYEE];
    case ROLES.MANAGER:
      return [ROLES.EMPLOYEE];
    default:
      return [];
  }
};

/** Etiquetas de estado */
const STATUS_LABELS = {
  true: { label: 'Activo', className: 'available' },
  false: { label: 'Inactivo', className: 'maintenance' },
};

/** Roles de sistema que puede editar según el rol del usuario actual */
const canEditRole = (currentRole) => {
  return currentRole === ROLES.SUPER_ADMIN || currentRole === ROLES.ADMIN;
};

/** ¿Puede gestionar empleados fuera de su restaurant? */
const isFullAccess = (currentRole) => {
  return currentRole === ROLES.SUPER_ADMIN || currentRole === ROLES.ADMIN;
};

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

const getFullName = (employee) => {
  if (!employee) return '—';
  const first = (employee.firstName || '').trim();
  const last = (employee.lastName || '').trim();
  if (!first && !last) return '—';
  return `${first} ${last}`.trim();
};

const formatPosition = (position) => {
  return POSITION_LABEL_MAP[position] || position || '—';
};

const getRoleLabel = (role) => {
  return ROLE_LABELS[role] || role || '—';
};

// ═══════════════════════════════════════════════════════════════════════════════
// FORMULARIO INICIAL
// ═══════════════════════════════════════════════════════════════════════════════

const INITIAL_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  position: '',
  systemRole: ROLES.EMPLOYEE,
  restaurantIds: [],
  active: true,
  createUser: false,
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

const Employees = () => {
  const { user } = useAuth();

  // ─── Estados de datos ──────────────────────────────────────────────────
  const [employees, setEmployees] = useState([]);
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // ─── Filtros ───────────────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [filterRestaurant, setFilterRestaurant] = useState('');
  const [filterStatus, setFilterStatus] = useState('all');
  const [filterPosition, setFilterPosition] = useState('');

  // ─── Modal de formulario (crear/editar) ────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [formData, setFormData] = useState({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);

  // ─── Modal de cambio de estado (desactivar/reactivar) ──────────────────
  const [showStatusModal, setShowStatusModal] = useState(false);
  const [togglingEmployee, setTogglingEmployee] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [togglingError, setTogglingError] = useState(null);

  // Safe access (wrapped in useMemo to avoid changing reference on every render)
  const safeEmployees = useMemo(() => Array.isArray(employees) ? employees : [], [employees]);
  const safeRestaurants = useMemo(() => Array.isArray(restaurants) ? restaurants : [], [restaurants]);

  // ─── Rol del usuario actual ────────────────────────────────────────────
  const currentRole = user?.role || ROLES.EMPLOYEE;
  const assignableRoles = getAssignableRoles(currentRole);
  const canManageAll = isFullAccess(currentRole);
  const canManageRole = canEditRole(currentRole);
  const canManageEmployees = canAccess(user, PERMISSIONS.MANAGE_EMPLOYEES);

  // ─── Cargar restaurantes (una vez al montar) ───────────────────────────
  useEffect(() => {
    const fetchRestaurantsList = async () => {
      setLoadingRestaurants(true);
      try {
        const data = await getRestaurants();
        setRestaurants(Array.isArray(data) ? data : []);
      } catch {
        setRestaurants([]);
      } finally {
        setLoadingRestaurants(false);
      }
    };
    fetchRestaurantsList();
  }, []);

  // ─── Cargar empleados ──────────────────────────────────────────────────
  const fetchEmployees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getEmployees();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
      // Si el error es 403, mostrar mensaje específico
      if (err.message && err.message.includes('No tienes permisos')) {
        setError(err.message);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchEmployees();
  }, [fetchEmployees]);

  // ─── Limpiar mensajes ─────────────────────────────────────────────────
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ══════════════════════════════════════════════════════════════════════════
  // FILTRADO
  // ══════════════════════════════════════════════════════════════════════════

  const filteredEmployees = useMemo(() => {
    return safeEmployees.filter((emp) => {
      // Búsqueda por nombre/email/teléfono
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim();
        const fullName = getFullName(emp).toLowerCase();
        const email = (emp.email || '').toLowerCase();
        const phone = (emp.phone || '').toLowerCase();
        if (
          !fullName.includes(q) &&
          !email.includes(q) &&
          !phone.includes(q)
        ) {
          return false;
        }
      }

      // Filtro por restaurante
      if (filterRestaurant) {
        const restId = Number(filterRestaurant);
        const empRestIds = emp.restaurantIds || [];
        if (!empRestIds.includes(restId) && emp.restaurantId !== restId) {
          // También verificar si tiene un único restaurantId
          if (!emp.restaurantIds && emp.restaurantId !== restId) {
            return false;
          }
        }
      }

      // Filtro por estado
      if (filterStatus === 'active' && !emp.active) return false;
      if (filterStatus === 'inactive' && emp.active) return false;

      // Filtro por puesto
      if (filterPosition && emp.position !== filterPosition) return false;

      return true;
    });
  }, [safeEmployees, searchQuery, filterRestaurant, filterStatus, filterPosition]);

  // ══════════════════════════════════════════════════════════════════════════
  // STATS
  // ══════════════════════════════════════════════════════════════════════════

  const stats = useMemo(() => {
    const total = safeEmployees.length;
    const active = safeEmployees.filter((e) => e.active).length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [safeEmployees]);

  // ══════════════════════════════════════════════════════════════════════════
  // NOMBRES DE RESTAURANTES
  // ══════════════════════════════════════════════════════════════════════════

  const getRestaurantNames = (emp) => {
    // Intentar con restaurantIds primero
    const ids = emp.restaurantIds || (emp.restaurantId ? [emp.restaurantId] : []);
    if (ids.length === 0) return '—';

    return ids
      .map((id) => {
        const rest = safeRestaurants.find((r) => Number(r.id) === Number(id));
        return rest ? rest.name : null;
      })
      .filter(Boolean)
      .join(', ') || '—';
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL: ABRIR / CERRAR
  // ══════════════════════════════════════════════════════════════════════════

  const handleOpenCreate = () => {
    setEditingEmployee(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
    setShowModal(true);
  };

  const handleOpenEdit = (emp) => {
    if (!emp) return;

    setEditingEmployee(emp);
    setFormData({
      firstName: emp.firstName || '',
      lastName: emp.lastName || '',
      email: emp.email || '',
      phone: emp.phone || '',
      position: emp.position || '',
      systemRole: emp.systemRole || ROLES.EMPLOYEE,
      restaurantIds: emp.restaurantIds || (emp.restaurantId ? [emp.restaurantId] : []),
      active: emp.active !== false,
      createUser: emp.hasSystemAccess || false,
    });
    setFormErrors({});
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingEmployee(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FORMULARIO: CAMBIOS
  // ══════════════════════════════════════════════════════════════════════════

  const handleFormChange = (e) => {
    const { name, value, type, checked } = e.target;

    if (type === 'checkbox' && name === 'restaurantIds') {
      // Toggle de restaurante en la lista multi-select
      const restId = Number(value);
      setFormData((prev) => {
        const current = [...prev.restaurantIds];
        if (checked) {
          if (!current.includes(restId)) current.push(restId);
        } else {
          const idx = current.indexOf(restId);
          if (idx !== -1) current.splice(idx, 1);
        }
        return { ...prev, restaurantIds: current };
      });
    } else if (type === 'checkbox') {
      setFormData((prev) => ({ ...prev, [name]: checked }));
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }

    // Limpiar error del campo al escribir
    if (formErrors[name]) {
      setFormErrors((prev) => {
        const updated = { ...prev };
        delete updated[name];
        return updated;
      });
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FORMULARIO: VALIDACIÓN
  // ══════════════════════════════════════════════════════════════════════════

  const validateForm = () => {
    const errors = {};
    const firstName = (formData.firstName || '').trim();
    const email = (formData.email || '').trim();

    if (!firstName) {
      errors.firstName = 'El nombre es obligatorio.';
    }

    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Correo electrónico no válido.';
    }

    if (!formData.position) {
      errors.position = 'El puesto es obligatorio.';
    }

    // Si se va a crear acceso al sistema, validar campos adicionales
    if (formData.createUser) {
      if (!formData.systemRole) {
        errors.systemRole = 'El rol de acceso es obligatorio.';
      }
      if (!email) {
        errors.email = 'El email es obligatorio para crear acceso al sistema.';
      }
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // GUARDAR (CREAR / ACTUALIZAR)
  // ══════════════════════════════════════════════════════════════════════════

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);
    setFormErrors({});

    try {
      const payload = {
        firstName: (formData.firstName || '').trim(),
        lastName: (formData.lastName || '').trim(),
        email: (formData.email || '').trim(),
        phone: (formData.phone || '').trim(),
        position: formData.position,
        active: formData.active,
        restaurantIds: formData.restaurantIds,
        createUser: formData.createUser,
      };

      if (formData.createUser) {
        payload.systemRole = formData.systemRole;
      }

      if (editingEmployee) {
        await updateEmployee(editingEmployee.id, payload);
        setSuccessMessage('Empleado actualizado correctamente.');
      } else {
        await createEmployee(payload);
        setSuccessMessage('Empleado creado correctamente.');
      }

      handleCloseModal();
      await fetchEmployees();
    } catch (err) {
      const msg = getErrorMessage(err);
      if (showModal) {
        setFormErrors({ submit: msg });
      } else {
        setError(msg);
      }
    } finally {
      setSubmitting(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // CAMBIAR ESTADO (DESACTIVAR / REACTIVAR)
  // ══════════════════════════════════════════════════════════════════════════

  const handleOpenStatusToggle = (emp) => {
    if (!emp) return;
    setTogglingEmployee(emp);
    setTogglingError(null);
    setShowStatusModal(true);
  };

  const handleCloseStatusToggle = () => {
    setShowStatusModal(false);
    setTogglingEmployee(null);
    setTogglingError(null);
  };

  const handleConfirmStatusToggle = async () => {
    if (!togglingEmployee) return;

    setToggling(true);
    setTogglingError(null);
    try {
      const newActive = !togglingEmployee.active;
      await toggleEmployeeActive(togglingEmployee.id, newActive);
      setSuccessMessage(
        newActive
          ? 'Empleado reactivado correctamente.'
          : 'Empleado desactivado correctamente.'
      );
      setShowStatusModal(false);
      setTogglingEmployee(null);
      await fetchEmployees();
    } catch (err) {
      setTogglingError(getErrorMessage(err));
    } finally {
      setToggling(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // PERMISOS POR FILA: ¿PUEDE EDITAR?
  // ══════════════════════════════════════════════════════════════════════════

  const canEditEmployee = (emp) => {
    if (!canManageEmployees) return false;
    // SUPER_ADMIN y ADMIN pueden editar todo
    if (canManageAll) return true;
    // MANAGER solo puede editar EMPLOYEE de sus restaurantes
    if (currentRole === ROLES.MANAGER) {
      const empRole = emp.systemRole || ROLES.EMPLOYEE;
      return empRole === ROLES.EMPLOYEE;
    }
    return false;
  };

  const canToggleActiveEmployee = () => {
    if (!canManageEmployees) return false;
    if (canManageAll) return true;
    // MANAGER no debería desactivar empleados
    return false;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div>
      {/* ═══ Page Header ═══════════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h1>Empleados</h1>
          <p className="page-description">
            Gestiona el equipo de tus restaurantes y controla quién tiene acceso al sistema
          </p>
        </div>

        <div className="page-header-actions">
          {canManageEmployees && (
            <button
              className="btn btn-primary d-flex align-items-center gap-2"
              onClick={handleOpenCreate}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Añadir Empleado
            </button>
          )}
        </div>
      </div>

      {/* ═══ Messages ══════════════════════════════════════════════════════ */}
      {successMessage && (
        <div className="alert alert-success d-flex align-items-center gap-2 mb-3" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
            <polyline points="22 4 12 14.01 9 11.01" />
          </svg>
          <span className="flex-grow-1">{successMessage}</span>
          <button type="button" className="btn-close" onClick={() => setSuccessMessage('')} aria-label="Cerrar" />
        </div>
      )}

      {error && (
        <div className="alert alert-danger d-flex align-items-center gap-2 mb-3" role="alert">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <span className="flex-grow-1">{error}</span>
          <button className="btn btn-outline-danger btn-sm ms-2" onClick={fetchEmployees} type="button">
            Reintentar
          </button>
        </div>
      )}

      {/* ═══ Loading ═══════════════════════════════════════════════════════ */}
      {loading && (
        <div className="loading-state">
          <div className="spinner-border mb-3" role="status" style={{ width: '2.25rem', height: '2.25rem' }}>
            <span className="visually-hidden">Cargando...</span>
          </div>
          <p className="text-muted mb-0">Cargando empleados...</p>
        </div>
      )}

      {/* ═══ Empty State ═══════════════════════════════════════════════════ */}
      {!loading && !error && safeEmployees.length === 0 && (
        <div className="app-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
            </div>
            <h5>No hay empleados registrados</h5>
            <p>Añade tu primer empleado y asígnale un puesto y permisos de acceso.</p>
            {canManageEmployees && (
              <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
                Añadir Empleado
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ Data View ═════════════════════════════════════════════════════ */}
      {!loading && !error && safeEmployees.length > 0 && (
        <>
          {/* ─── Stats Cards ────────────────────────────────────────────── */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                  <circle cx="12" cy="7" r="4" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.total}</div>
                <div className="stat-card-label">Total Empleados</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon success">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                  <polyline points="22 4 12 14.01 9 11.01" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.active}</div>
                <div className="stat-card-label">Activos</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{stats.inactive}</div>
                <div className="stat-card-label">Inactivos</div>
              </div>
            </div>
          </div>

          {/* ─── Search & Filters ───────────────────────────────────────── */}
          <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
            <div className="d-flex align-items-center gap-2 flex-grow-1" style={{ maxWidth: '320px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Buscar por nombre, email o teléfono..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                aria-label="Buscar empleados"
              />
              {searchQuery && (
                <button
                  className="btn btn-sm btn-secondary"
                  onClick={() => setSearchQuery('')}
                  type="button"
                  aria-label="Limpiar búsqueda"
                >
                  Limpiar
                </button>
              )}
            </div>

            <select
              className="form-select form-select-sm"
              style={{ maxWidth: '180px' }}
              value={filterRestaurant}
              onChange={(e) => setFilterRestaurant(e.target.value)}
              aria-label="Filtrar por restaurante"
            >
              <option value="">Todos los restaurantes</option>
              {safeRestaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'No disponible'}
                </option>
              ))}
            </select>

            <select
              className="form-select form-select-sm"
              style={{ maxWidth: '140px' }}
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              aria-label="Filtrar por estado"
            >
              <option value="all">Todos los estados</option>
              <option value="active">Activos</option>
              <option value="inactive">Inactivos</option>
            </select>

            <select
              className="form-select form-select-sm"
              style={{ maxWidth: '160px' }}
              value={filterPosition}
              onChange={(e) => setFilterPosition(e.target.value)}
              aria-label="Filtrar por puesto"
            >
              <option value="">Todos los puestos</option>
              {POSITIONS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* ─── Table ──────────────────────────────────────────────────── */}
          <div className="app-card">
            <div className="app-table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="col-id">#</th>
                    <th>Nombre</th>
                    <th>Email</th>
                    <th>Teléfono</th>
                    <th>Puesto</th>
                    <th>Rol de acceso</th>
                    <th>Restaurantes</th>
                    <th>Estado</th>
                    <th className="col-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center text-muted py-4">
                        {searchQuery || filterRestaurant || filterStatus !== 'all' || filterPosition
                          ? 'No se encontraron empleados que coincidan con los filtros.'
                          : 'No hay empleados registrados.'}
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp, index) => (
                      <tr key={emp?.id ?? index}>
                        <td className="col-id">{emp?.id ?? index + 1}</td>
                        <td className="fw-semibold">{getFullName(emp)}</td>
                        <td>
                          {emp?.email ? (
                            <span className="d-inline-flex align-items-center gap-1">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                                <path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" />
                                <polyline points="22,6 12,13 2,6" />
                              </svg>
                              <span className="text-truncate d-inline-block" style={{ maxWidth: '180px' }}>
                                {emp.email}
                              </span>
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          {emp?.phone ? (
                            <span className="d-inline-flex align-items-center gap-1">
                              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)' }}>
                                <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                              </svg>
                              {emp.phone}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className="badge-status" style={{ backgroundColor: 'var(--primary-light)', color: 'var(--primary)', textTransform: 'none', letterSpacing: 'normal' }}>
                            {formatPosition(emp.position)}
                          </span>
                        </td>
                        <td>
                          {emp.hasSystemAccess && emp.systemRole ? (
                            <span className="fw-medium">
                              {getRoleLabel(emp.systemRole)}
                            </span>
                          ) : (
                            <span className="text-muted">Sin acceso</span>
                          )}
                        </td>
                        <td style={{ maxWidth: '200px' }}>
                          <span className="text-truncate d-inline-block" style={{ maxWidth: '200px' }}>
                            {getRestaurantNames(emp)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge-status ${STATUS_LABELS[emp.active !== false ? 'true' : 'false'].className}`}>
                            {STATUS_LABELS[emp.active !== false ? 'true' : 'false'].label}
                          </span>
                        </td>
                        <td className="col-actions">
                          <div className="d-flex justify-content-end gap-1">
                            {canEditEmployee(emp) && (
                              <button
                                className="btn-icon btn-edit"
                                onClick={() => handleOpenEdit(emp)}
                                title="Editar empleado"
                                type="button"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                </svg>
                              </button>
                            )}
                            {canToggleActiveEmployee() && (
                              <button
                                className={`btn-icon ${emp.active !== false ? 'btn-delete' : 'btn-edit'}`}
                                onClick={() => handleOpenStatusToggle(emp)}
                                title={emp.active !== false ? 'Desactivar empleado' : 'Reactivar empleado'}
                                type="button"
                              >
                                {emp.active !== false ? (
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="8" y1="12" x2="16" y2="12" />
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <circle cx="12" cy="12" r="10" />
                                    <line x1="12" y1="8" x2="12" y2="16" />
                                    <line x1="8" y1="12" x2="16" y2="12" />
                                  </svg>
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: CREAR / EDITAR EMPLEADO
          ══════════════════════════════════════════════════════════════════════ */}
      {showModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {editingEmployee ? 'Editar Empleado' : 'Nuevo Empleado'}
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseModal} aria-label="Cerrar" />
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="modal-body">
                  {/* Error del submit */}
                  {formErrors.submit && (
                    <div className="alert alert-danger py-2" role="alert">
                      {formErrors.submit}
                    </div>
                  )}

                  {/* ─── Datos personales ──────────────────────────────── */}
                  <h6 className="fw-semibold mb-3" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    DATOS PERSONALES
                  </h6>
                  <div className="row g-3 mb-3">
                    {/* Nombre */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="emp-firstName" className="form-label">
                        Nombre <span className="text-danger">*</span>
                      </label>
                      <input
                        id="emp-firstName"
                        type="text"
                        className={`form-control ${formErrors.firstName ? 'is-invalid' : ''}`}
                        name="firstName"
                        value={formData.firstName || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Ana"
                        required
                      />
                      {formErrors.firstName && <div className="invalid-feedback">{formErrors.firstName}</div>}
                    </div>

                    {/* Apellidos */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="emp-lastName" className="form-label">Apellidos</label>
                      <input
                        id="emp-lastName"
                        type="text"
                        className="form-control"
                        name="lastName"
                        value={formData.lastName || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: García López"
                      />
                    </div>

                    {/* Email */}
                    <div className={`col-12 ${formData.createUser || editingEmployee ? 'col-md-6' : 'col-md-6'}`}>
                      <label htmlFor="emp-email" className="form-label">
                        Email
                        {formData.createUser && <span className="text-danger"> *</span>}
                      </label>
                      <input
                        id="emp-email"
                        type="email"
                        className={`form-control ${formErrors.email ? 'is-invalid' : ''}`}
                        name="email"
                        value={formData.email || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: ana.garcia@restaurante.com"
                        disabled={!!editingEmployee}
                      />
                      {formErrors.email && <div className="invalid-feedback">{formErrors.email}</div>}
                      {editingEmployee && (
                        <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                          El email no se puede modificar.
                        </div>
                      )}
                    </div>

                    {/* Teléfono */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="emp-phone" className="form-label">Teléfono</label>
                      <input
                        id="emp-phone"
                        type="tel"
                        className="form-control"
                        name="phone"
                        value={formData.phone || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: 600111222"
                      />
                    </div>
                  </div>

                  {/* ─── Puesto y rol ───────────────────────────────────── */}
                  <h6 className="fw-semibold mb-3" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    PUESTO Y ACCESO
                  </h6>
                  <div className="row g-3 mb-3">
                    {/* Puesto */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="emp-position" className="form-label">
                        Puesto <span className="text-danger">*</span>
                      </label>
                      <select
                        id="emp-position"
                        className={`form-select ${formErrors.position ? 'is-invalid' : ''}`}
                        name="position"
                        value={formData.position || ''}
                        onChange={handleFormChange}
                        required
                      >
                        <option value="">Seleccionar puesto...</option>
                        {POSITIONS.map((p) => (
                          <option key={p.value} value={p.value}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      {formErrors.position && <div className="invalid-feedback">{formErrors.position}</div>}
                    </div>

                    {/* Crear acceso al sistema (solo en creación) */}
                    <div className="col-12 col-md-6 d-flex align-items-end pb-2">
                      {!editingEmployee && (
                        <div className="form-check">
                          <input
                            id="emp-createUser"
                            type="checkbox"
                            className="form-check-input"
                            name="createUser"
                            checked={formData.createUser}
                            onChange={handleFormChange}
                          />
                          <label htmlFor="emp-createUser" className="form-check-label" style={{ cursor: 'pointer' }}>
                            Crear acceso al sistema
                          </label>
                        </div>
                      )}
                      {editingEmployee && formData.createUser && (
                        <div className="text-muted" style={{ fontSize: '0.8125rem' }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="me-1">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="12" y1="16" x2="12" y2="12" />
                            <line x1="12" y1="8" x2="12.01" y2="8" />
                          </svg>
                          Tiene acceso al sistema.
                        </div>
                      )}
                    </div>

                    {/* Rol de sistema (visible solo si createUser está marcado o si editing) */}
                    {(formData.createUser || editingEmployee) && (
                      <div className="col-12 col-md-6">
                        <label htmlFor="emp-systemRole" className="form-label">
                          Rol de acceso
                          {formData.createUser && <span className="text-danger"> *</span>}
                        </label>
                        <select
                          id="emp-systemRole"
                          className={`form-select ${formErrors.systemRole ? 'is-invalid' : ''}`}
                          name="systemRole"
                          value={formData.systemRole || ''}
                          onChange={handleFormChange}
                          disabled={editingEmployee && !canManageRole}
                        >
                          {!formData.systemRole && (
                            <option value="">Seleccionar rol...</option>
                          )}
                          {assignableRoles.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_LABELS[role] || role}
                            </option>
                          ))}
                        </select>
                        {formErrors.systemRole && <div className="invalid-feedback">{formErrors.systemRole}</div>}
                        {editingEmployee && !canManageRole && (
                          <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                            No tienes permisos para cambiar el rol de acceso.
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* ─── Restaurantes asignados ─────────────────────────── */}
                  <h6 className="fw-semibold mb-3" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    RESTAURANTES ASIGNADOS
                  </h6>
                  <div className="row g-2 mb-3">
                    {loadingRestaurants ? (
                      <div className="col-12">
                        <div className="d-flex align-items-center gap-2 text-muted" style={{ fontSize: '0.8125rem' }}>
                          <div className="spinner-border spinner-border-sm" role="status" />
                          Cargando restaurantes...
                        </div>
                      </div>
                    ) : safeRestaurants.length === 0 ? (
                      <div className="col-12">
                        <p className="text-muted mb-0" style={{ fontSize: '0.8125rem' }}>
                          No hay restaurantes disponibles para asignar.
                        </p>
                      </div>
                    ) : (
                      safeRestaurants.map((r) => (
                        <div key={r.id} className="col-12 col-md-6">
                          <div className="form-check">
                            <input
                              id={`emp-rest-${r.id}`}
                              type="checkbox"
                              className="form-check-input"
                              name="restaurantIds"
                              value={r.id}
                              checked={formData.restaurantIds.includes(Number(r.id))}
                              onChange={handleFormChange}
                            />
                            <label htmlFor={`emp-rest-${r.id}`} className="form-check-label" style={{ cursor: 'pointer', fontSize: '0.8125rem' }}>
                              {r.name || 'No disponible'}
                            </label>
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  {/* ─── Estado activo ──────────────────────────────────── */}
                  <h6 className="fw-semibold mb-3" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    ESTADO
                  </h6>
                  <div className="row g-3">
                    <div className="col-12">
                      <div className="form-check">
                        <input
                          id="emp-active"
                          type="checkbox"
                          className="form-check-input"
                          name="active"
                          checked={formData.active}
                          onChange={handleFormChange}
                        />
                        <label htmlFor="emp-active" className="form-check-label" style={{ cursor: 'pointer' }}>
                          {formData.active ? 'Empleado activo' : 'Empleado inactivo'}
                        </label>
                      </div>
                      <div className="text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                        {formData.active
                          ? 'El empleado podrá acceder al sistema y aparecerá en los listados activos.'
                          : 'El empleado no podrá acceder al sistema y quedará oculto de los listados activos.'}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCloseModal}
                    disabled={submitting}
                  >
                    Cancelar
                  </button>
                  <button
                    type="submit"
                    className="btn btn-primary d-flex align-items-center gap-2"
                    disabled={submitting}
                  >
                    {submitting && (
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    )}
                    {editingEmployee ? 'Actualizar Empleado' : 'Crear Empleado'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          MODAL: DESACTIVAR / REACTIVAR EMPLEADO
          ══════════════════════════════════════════════════════════════════════ */}
      {showStatusModal && togglingEmployee && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header border-0">
                <h5 className="modal-title">
                  {togglingEmployee.active !== false ? 'Desactivar Empleado' : 'Reactivar Empleado'}
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseStatusToggle} aria-label="Cerrar" />
              </div>

              <div className="modal-body text-center py-4">
                <div className="mb-3">
                  {togglingEmployee.active !== false ? (
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                  ) : (
                    <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#22c55e" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="12" y1="8" x2="12" y2="16" />
                      <line x1="8" y1="12" x2="16" y2="12" />
                    </svg>
                  )}
                </div>

                <h6 className="mb-2">
                  {togglingEmployee.active !== false
                    ? '¿Estás seguro de desactivar este empleado?'
                    : '¿Estás seguro de reactivar este empleado?'}
                </h6>

                <p className="text-muted mb-1">
                  <strong>{getFullName(togglingEmployee)}</strong>
                </p>
                {togglingEmployee.position && (
                  <p className="text-muted small mb-0">
                    {formatPosition(togglingEmployee.position)}
                    {togglingEmployee.systemRole && ` · ${getRoleLabel(togglingEmployee.systemRole)}`}
                  </p>
                )}

                {togglingEmployee.active !== false && (
                  <p className="text-muted small mt-3 mb-0">
                    El empleado perderá el acceso al sistema hasta que sea reactivado.
                  </p>
                )}
                {togglingEmployee.active === false && (
                  <p className="text-muted small mt-3 mb-0">
                    El empleado recuperará el acceso al sistema.
                  </p>
                )}

                {togglingError && (
                  <div className="alert alert-danger py-2 mt-3 mb-0" role="alert">
                    {togglingError}
                  </div>
                )}
              </div>

              <div className="modal-footer border-0 justify-content-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary px-4"
                  onClick={handleCloseStatusToggle}
                  disabled={toggling}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className={`btn px-4 d-flex align-items-center gap-2 ${togglingEmployee.active !== false ? 'btn-danger' : 'btn-primary'}`}
                  onClick={handleConfirmStatusToggle}
                  disabled={toggling}
                >
                  {toggling && (
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                  )}
                  {togglingEmployee.active !== false ? 'Desactivar' : 'Reactivar'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Employees;
