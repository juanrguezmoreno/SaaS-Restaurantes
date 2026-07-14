import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getUsers,
  createUser,
  updateUser,
  deleteUser,
} from '../services/userService';
import { getRestaurants } from '../services/restaurantService';
import { ROLES, ROLE_LABELS, canAccess, PERMISSIONS, normalizeRole } from '../config/permissions';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

/** Roles que se pueden asignar al crear/editar un empleado, según el rol del usuario actual */
const getAssignableRoles = (currentRole) => {
  switch (currentRole) {
    case ROLES.SUPER_ADMIN:
      return [ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE];
    case ROLES.ADMIN:
      return [ROLES.MANAGER, ROLES.EMPLOYEE];
    default:
      return [];
  }
};

const STATUS_LABELS = {
  true: { label: 'Activo', className: 'available' },
  false: { label: 'Inactivo', className: 'maintenance' },
};

const SORT_FIELDS = {
  name: (u) => getFullName(u).toLowerCase(),
  username: (u) => (u.username || '').toLowerCase(),
  email: (u) => (u.email || '').toLowerCase(),
  role: (u) => getRoleLabel(getPrimaryRole(u)).toLowerCase(),
  createdAt: (u) => u.createdAt || '',
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

const getPrimaryRole = (employee) => {
  if (!employee || !employee.roles) return null;
  const rolesArray = Array.isArray(employee.roles) ? employee.roles : Array.from(employee.roles);
  if (rolesArray.length === 0) return null;
  return normalizeRole(rolesArray[0]);
};

const getRoleLabel = (role) => {
  if (!role) return '—';
  return ROLE_LABELS[role] || role;
};

const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: 'numeric' });
};

// ═══════════════════════════════════════════════════════════════════════════════
// FORMULARIO INICIAL
// ═══════════════════════════════════════════════════════════════════════════════

const INITIAL_FORM = {
  firstName: '',
  lastName: '',
  username: '',
  email: '',
  password: '',
  role: ROLES.EMPLOYEE,
  restaurantIds: [],
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

  // ─── Filtros y orden ───────────────────────────────────────────────────
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');

  // ─── Modal de formulario (crear/editar) ────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [formData, setFormData] = useState({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);

  // ─── Modal de eliminación ───────────────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingEmployee, setDeletingEmployee] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingError, setDeletingError] = useState(null);

  // Safe access
  const safeEmployees = useMemo(() => Array.isArray(employees) ? employees : [], [employees]);
  const safeRestaurants = useMemo(() => Array.isArray(restaurants) ? restaurants : [], [restaurants]);

  // ─── Rol del usuario actual ────────────────────────────────────────────
  const currentRole = user?.role || ROLES.EMPLOYEE;
  const assignableRoles = getAssignableRoles(currentRole);
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
      const data = await getUsers();
      setEmployees(Array.isArray(data) ? data : []);
    } catch (err) {
      setError(getErrorMessage(err));
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
  // FILTRADO Y ORDEN
  // ══════════════════════════════════════════════════════════════════════════

  const filteredEmployees = useMemo(() => {
    let result = safeEmployees.filter((emp) => {
      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      const fullName = getFullName(emp).toLowerCase();
      const username = (emp.username || '').toLowerCase();
      const email = (emp.email || '').toLowerCase();
      return fullName.includes(q) || username.includes(q) || email.includes(q);
    });

    const keyFn = SORT_FIELDS[sortField] || SORT_FIELDS.name;
    result = [...result].sort((a, b) => {
      const ka = keyFn(a);
      const kb = keyFn(b);
      if (ka < kb) return sortDirection === 'asc' ? -1 : 1;
      if (ka > kb) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return result;
  }, [safeEmployees, searchQuery, sortField, sortDirection]);

  // ══════════════════════════════════════════════════════════════════════════
  // STATS
  // ══════════════════════════════════════════════════════════════════════════

  const stats = useMemo(() => {
    const total = safeEmployees.length;
    const active = safeEmployees.filter((e) => e.enabled).length;
    const inactive = total - active;
    return { total, active, inactive };
  }, [safeEmployees]);

  const getRestaurantNames = (emp) => {
    const ids = emp.assignedRestaurantIds
      ? Array.from(emp.assignedRestaurantIds)
      : (emp.restaurantId ? [emp.restaurantId] : []);
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
  // ORDEN: CAMBIO DE COLUMNA
  // ══════════════════════════════════════════════════════════════════════════

  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortIndicator = (field) => {
    if (sortField !== field) return '';
    return sortDirection === 'asc' ? ' ▲' : ' ▼';
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL: ABRIR / CERRAR
  // ══════════════════════════════════════════════════════════════════════════

  const handleOpenCreate = () => {
    setEditingEmployee(null);
    setFormData({ ...INITIAL_FORM, role: assignableRoles[assignableRoles.length - 1] || ROLES.EMPLOYEE });
    setFormErrors({});
    setShowModal(true);
  };

  const handleOpenEdit = (emp) => {
    if (!emp) return;
    setEditingEmployee(emp);
    setFormData({
      firstName: emp.firstName || '',
      lastName: emp.lastName || '',
      username: emp.username || '',
      email: emp.email || '',
      password: '',
      role: getPrimaryRole(emp) || ROLES.EMPLOYEE,
      restaurantIds: emp.assignedRestaurantIds ? Array.from(emp.assignedRestaurantIds) : (emp.restaurantId ? [emp.restaurantId] : []),
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
    } else {
      setFormData((prev) => ({ ...prev, [name]: value }));
    }

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
    const username = (formData.username || '').trim();
    const email = (formData.email || '').trim();
    const password = formData.password || '';

    if (!firstName) {
      errors.firstName = 'El nombre es obligatorio.';
    }

    if (!username) {
      errors.username = 'El usuario es obligatorio.';
    } else if (username.length < 3) {
      errors.username = 'El usuario debe tener al menos 3 caracteres.';
    }

    if (!email) {
      errors.email = 'El email es obligatorio.';
    } else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Correo electrónico no válido.';
    }

    if (!editingEmployee && !password) {
      errors.password = 'La contraseña es obligatoria.';
    } else if (password && password.length < 6) {
      errors.password = 'La contraseña debe tener al menos 6 caracteres.';
    }

    if (!formData.role) {
      errors.role = 'El rol es obligatorio.';
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
        username: (formData.username || '').trim(),
        email: (formData.email || '').trim(),
        roles: [formData.role],
        restaurantIds: formData.restaurantIds,
      };

      // Contraseña: obligatoria al crear, opcional al editar.
      // Nunca se envía vacía en edición para no sobrescribir la existente.
      if (!editingEmployee) {
        payload.password = formData.password;
      } else if (formData.password) {
        payload.password = formData.password;
      }

      if (editingEmployee) {
        await updateUser(editingEmployee.id, payload);
        setSuccessMessage('Empleado actualizado correctamente.');
      } else {
        await createUser(payload);
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
  // ELIMINAR
  // ══════════════════════════════════════════════════════════════════════════

  const handleOpenDelete = (emp) => {
    if (!emp) return;
    setDeletingEmployee(emp);
    setDeletingError(null);
    setShowDeleteModal(true);
  };

  const handleCloseDelete = () => {
    setShowDeleteModal(false);
    setDeletingEmployee(null);
    setDeletingError(null);
  };

  const handleConfirmDelete = async () => {
    if (!deletingEmployee) return;

    setDeleting(true);
    setDeletingError(null);
    try {
      await deleteUser(deletingEmployee.id);
      setSuccessMessage('Empleado eliminado correctamente.');
      setShowDeleteModal(false);
      setDeletingEmployee(null);
      await fetchEmployees();
    } catch (err) {
      setDeletingError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
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
              Nuevo empleado
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
            <p>Añade tu primer empleado y asígnale un rol y restaurantes.</p>
            {canManageEmployees && (
              <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
                Nuevo empleado
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

          {/* ─── Search ─────────────────────────────────────────────────── */}
          <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
            <div className="d-flex align-items-center gap-2 flex-grow-1" style={{ maxWidth: '320px' }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--text-muted)', flexShrink: 0 }}>
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                className="form-control form-control-sm"
                placeholder="Buscar por nombre, usuario o email..."
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
          </div>

          {/* ─── Table ──────────────────────────────────────────────────── */}
          <div className="app-card">
            <div className="app-table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    <th className="col-id">#</th>
                    <th role="button" onClick={() => handleSort('name')}>Nombre{sortIndicator('name')}</th>
                    <th role="button" onClick={() => handleSort('username')}>Usuario{sortIndicator('username')}</th>
                    <th role="button" onClick={() => handleSort('email')}>Email{sortIndicator('email')}</th>
                    <th role="button" onClick={() => handleSort('role')}>Rol{sortIndicator('role')}</th>
                    <th>Restaurantes</th>
                    <th>Estado</th>
                    <th role="button" onClick={() => handleSort('createdAt')}>Fecha de creación{sortIndicator('createdAt')}</th>
                    <th className="col-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredEmployees.length === 0 ? (
                    <tr>
                      <td colSpan={9} className="text-center text-muted py-4">
                        No se encontraron empleados que coincidan con la búsqueda.
                      </td>
                    </tr>
                  ) : (
                    filteredEmployees.map((emp, index) => (
                      <tr key={emp?.id ?? index}>
                        <td className="col-id">{emp?.id ?? index + 1}</td>
                        <td className="fw-semibold">{getFullName(emp)}</td>
                        <td>{emp?.username || '—'}</td>
                        <td>
                          {emp?.email ? (
                            <span className="text-truncate d-inline-block" style={{ maxWidth: '180px' }}>
                              {emp.email}
                            </span>
                          ) : (
                            <span className="text-muted">—</span>
                          )}
                        </td>
                        <td>
                          <span className="fw-medium">{getRoleLabel(getPrimaryRole(emp))}</span>
                        </td>
                        <td style={{ maxWidth: '200px' }}>
                          <span className="text-truncate d-inline-block" style={{ maxWidth: '200px' }}>
                            {getRestaurantNames(emp)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge-status ${STATUS_LABELS[emp.enabled !== false ? 'true' : 'false'].className}`}>
                            {STATUS_LABELS[emp.enabled !== false ? 'true' : 'false'].label}
                          </span>
                        </td>
                        <td>{formatDate(emp.createdAt)}</td>
                        <td className="col-actions">
                          <div className="d-flex justify-content-end gap-1">
                            {canManageEmployees && (
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
                            {canManageEmployees && (
                              <button
                                className="btn-icon btn-delete"
                                onClick={() => handleOpenDelete(emp)}
                                title="Eliminar empleado"
                                type="button"
                              >
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <polyline points="3 6 5 6 21 6" />
                                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                                </svg>
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

                    <div className="col-12 col-md-6">
                      <label htmlFor="emp-username" className="form-label">
                        Usuario <span className="text-danger">*</span>
                      </label>
                      <input
                        id="emp-username"
                        type="text"
                        className={`form-control ${formErrors.username ? 'is-invalid' : ''}`}
                        name="username"
                        value={formData.username || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: ana.garcia"
                        required
                      />
                      {formErrors.username && <div className="invalid-feedback">{formErrors.username}</div>}
                    </div>

                    <div className="col-12 col-md-6">
                      <label htmlFor="emp-email" className="form-label">
                        Email <span className="text-danger">*</span>
                      </label>
                      <input
                        id="emp-email"
                        type="email"
                        className={`form-control ${formErrors.email ? 'is-invalid' : ''}`}
                        name="email"
                        value={formData.email || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: ana.garcia@restaurante.com"
                        required
                      />
                      {formErrors.email && <div className="invalid-feedback">{formErrors.email}</div>}
                    </div>

                    <div className="col-12 col-md-6">
                      <label htmlFor="emp-password" className="form-label">
                        Contraseña {!editingEmployee && <span className="text-danger">*</span>}
                      </label>
                      <input
                        id="emp-password"
                        type="password"
                        className={`form-control ${formErrors.password ? 'is-invalid' : ''}`}
                        name="password"
                        value={formData.password || ''}
                        onChange={handleFormChange}
                        placeholder={editingEmployee ? 'Dejar en blanco para no cambiarla' : 'Mínimo 6 caracteres'}
                        required={!editingEmployee}
                      />
                      {formErrors.password && <div className="invalid-feedback">{formErrors.password}</div>}
                    </div>
                  </div>

                  {/* ─── Rol y restaurantes ─────────────────────────────── */}
                  <h6 className="fw-semibold mb-3" style={{ fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                    ROL Y ACCESO
                  </h6>
                  <div className="row g-3 mb-3">
                    <div className="col-12 col-md-6">
                      <label htmlFor="emp-role" className="form-label">
                        Rol <span className="text-danger">*</span>
                      </label>
                      <select
                        id="emp-role"
                        className={`form-select ${formErrors.role ? 'is-invalid' : ''}`}
                        name="role"
                        value={formData.role || ''}
                        onChange={handleFormChange}
                      >
                        {assignableRoles.map((role) => (
                          <option key={role} value={role}>
                            {ROLE_LABELS[role] || role}
                          </option>
                        ))}
                      </select>
                      {formErrors.role && <div className="invalid-feedback">{formErrors.role}</div>}
                    </div>
                  </div>

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
          MODAL: ELIMINAR EMPLEADO
          ══════════════════════════════════════════════════════════════════════ */}
      {showDeleteModal && deletingEmployee && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header border-0">
                <h5 className="modal-title">Eliminar Empleado</h5>
                <button type="button" className="btn-close" onClick={handleCloseDelete} aria-label="Cerrar" />
              </div>

              <div className="modal-body text-center py-4">
                <div className="mb-3">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="8" y1="12" x2="16" y2="12" />
                  </svg>
                </div>

                <h6 className="mb-2">¿Estás seguro de eliminar este empleado?</h6>

                <p className="text-muted mb-1">
                  <strong>{getFullName(deletingEmployee)}</strong>
                </p>
                <p className="text-muted small mb-0">
                  {deletingEmployee.username} · {getRoleLabel(getPrimaryRole(deletingEmployee))}
                </p>

                <p className="text-muted small mt-3 mb-0">
                  Esta acción no se puede deshacer. El empleado perderá el acceso al sistema.
                </p>

                {deletingError && (
                  <div className="alert alert-danger py-2 mt-3 mb-0" role="alert">
                    {deletingError}
                  </div>
                )}
              </div>

              <div className="modal-footer border-0 justify-content-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary px-4"
                  onClick={handleCloseDelete}
                  disabled={deleting}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  className="btn btn-danger px-4 d-flex align-items-center gap-2"
                  onClick={handleConfirmDelete}
                  disabled={deleting}
                >
                  {deleting && (
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                  )}
                  Eliminar
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
