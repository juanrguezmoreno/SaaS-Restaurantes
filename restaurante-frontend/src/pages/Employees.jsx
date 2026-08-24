import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getUsers,
  getUserStats,
  createUser,
  updateUser,
  deleteUser,
  PAGE_SIZE_OPTIONS,
  DEFAULT_PAGE_SIZE,
} from '../services/userService';
import { ROLES, ROLE_LABELS, canAccess, PERMISSIONS, normalizeRole } from '../config/permissions';
import ActionMenu from '../components/ActionMenu';
import Pagination from '../components/Pagination';
import RestaurantMultiSelect from '../components/RestaurantMultiSelect';

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

/** Milisegundos de espera antes de consultar al escribir en el buscador. */
const SEARCH_DEBOUNCE_MS = 350;

/** Página vacía inicial: la pantalla nunca trabaja con datos indefinidos. */
const EMPTY_PAGE = {
  content: [],
  page: 0,
  size: DEFAULT_PAGE_SIZE,
  totalElements: 0,
  totalPages: 0,
  first: true,
  last: true,
  empty: true,
};

/**
 * Roles que se ofrecen en el filtro. No incluye SUPER_ADMIN porque no es un
 * empleado de ningún restaurante, sino el dueño de la plataforma.
 */
const FILTERABLE_ROLES = [ROLES.ADMIN, ROLES.MANAGER, ROLES.EMPLOYEE];

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

/**
 * Qué implica no asignar ningún restaurante. No es una advertencia inventada:
 * es la regla que aplica CurrentUserService.getVisibleRestaurantIds() y que el
 * formulario nunca había dicho en voz alta.
 */
const avisoSinRestaurantes = (rol) => {
  const normalizado = normalizeRole(rol);
  if (normalizado === ROLES.MANAGER) {
    return 'Sin restaurantes asignados verá todos los del tenant.';
  }
  if (normalizado === ROLES.EMPLOYEE) {
    return 'Sin restaurantes asignados no podrá ver ningún restaurante.';
  }
  return 'Un administrador ve todos los restaurantes de su tenant; la asignación no le afecta.';
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
  restaurants: [],
};

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

const Employees = () => {
  const { user } = useAuth();

  // ─── Consulta al backend: página, tamaño, texto, filtros y orden ───────
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [refreshKey, setRefreshKey] = useState(0);

  // ─── Estados de datos ──────────────────────────────────────────────────
  const [pageData, setPageData] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // ─── Métricas ──────────────────────────────────────────────────────────
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // ─── Modal de formulario (crear/editar) ────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [editingEmployee, setEditingEmployee] = useState(null);
  const [formData, setFormData] = useState({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // ─── Modal de eliminación ───────────────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingEmployee, setDeletingEmployee] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deletingError, setDeletingError] = useState(null);

  // Safe access
  const employees = useMemo(
    () => (Array.isArray(pageData.content) ? pageData.content : []),
    [pageData]
  );
  // ─── Rol del usuario actual ────────────────────────────────────────────
  const currentRole = user?.role || ROLES.EMPLOYEE;
  const assignableRoles = getAssignableRoles(currentRole);
  const canManageEmployees = canAccess(user, PERMISSIONS.MANAGE_EMPLOYEES);

  // ─── Debounce del buscador ─────────────────────────────────────────────
  // Cambiar el texto vuelve a la primera página, pero conserva filtros, orden y
  // tamaño. Los dos estados se actualizan juntos para lanzar UNA sola consulta.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ─── Cargar la página ──────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getUsers({
          page,
          size,
          search,
          role: filterRole || undefined,
          status: filterStatus || undefined,
          sort: sortField,
          direction: sortDirection,
        });
        if (cancelled) return;

        // La página pedida puede quedarse vacía al eliminar el último elemento:
        // se retrocede en vez de mostrar una tabla vacía sin explicación.
        if (data.content.length === 0 && data.totalElements > 0 && page > 0) {
          setPage(Math.max(0, Math.min(page - 1, Math.max(0, data.totalPages - 1))));
          return;
        }

        setPageData(data);
      } catch (err) {
        if (!cancelled) setError(getErrorMessage(err));
      } finally {
        if (!cancelled) {
          setLoading(false);
          setIsInitialLoad(false);
        }
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [page, size, search, filterRole, filterStatus, sortField, sortDirection, refreshKey]);

  // ─── Cargar métricas ───────────────────────────────────────────────────
  // Vienen de una consulta agregada del backend: no se derivan de la página.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setStatsLoading(true);
      try {
        const data = await getUserStats();
        if (!cancelled) setStats(data);
      } catch {
        // Un fallo de métricas no debe tapar la tabla.
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [refreshKey]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  // ─── Limpiar mensajes ─────────────────────────────────────────────────
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ══════════════════════════════════════════════════════════════════════════
  // DATOS DERIVADOS
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Nombres de restaurante de la fila. Ya vienen resueltos en el DTO, así que la
   * tabla no necesita cruzarlos contra la lista completa de restaurantes.
   */
  const getRestaurantNames = (emp) => {
    const names = Array.isArray(emp?.restaurantNames) ? emp.restaurantNames : [];
    return names.length > 0 ? names.join(', ') : '—';
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
    setPage(0);
  };

  /** Cabecera ordenable, con el mismo indicador que la tabla de restaurantes. */
  const sortableHeader = (field, label, extraClass = '') => {
    const isSorted = sortField === field;
    return (
      <th
        className={`is-sortable${isSorted ? ' is-sorted' : ''}${extraClass ? ` ${extraClass}` : ''}`}
        aria-sort={isSorted ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button type="button" className="sort-button" onClick={() => handleSort(field)}>
          <span>{label}</span>
          <svg
            className="sort-indicator"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            {isSorted && sortDirection === 'desc' ? (
              <polyline points="6 9 12 15 18 9" />
            ) : (
              <polyline points="6 15 12 9 18 15" />
            )}
          </svg>
        </button>
      </th>
    );
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
      // La fila trae las parejas ya emparejadas por el backend; assignedRestaurantIds
      // y restaurantNames son dos listas que no se corresponden entre sí.
      restaurants: Array.isArray(emp.assignedRestaurants) ? [...emp.assignedRestaurants] : [],
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
    const { name, value } = e.target;

    setFormData((prev) => ({ ...prev, [name]: value }));

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
    if (submitting) return;

    setSubmitting(true);
    setFormErrors({});

    try {
      const payload = {
        firstName: (formData.firstName || '').trim(),
        lastName: (formData.lastName || '').trim(),
        username: (formData.username || '').trim(),
        email: (formData.email || '').trim(),
        roles: [formData.role],
        // El backend sigue esperando identificadores; el nombre solo vive en la interfaz.
        restaurantIds: formData.restaurants.map((r) => Number(r.id)),
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
      refresh();
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
    // La bandera evita que dos clics rápidos lancen dos eliminaciones.
    if (!deletingEmployee || deleting) return;

    setDeleting(true);
    setDeletingError(null);
    try {
      await deleteUser(deletingEmployee.id);
      setSuccessMessage(`Empleado «${getFullName(deletingEmployee)}» eliminado correctamente.`);
      setShowDeleteModal(false);
      setDeletingEmployee(null);
      // Solo se recarga la página actual; si queda vacía, el efecto de carga
      // retrocede a la anterior.
      refresh();
    } catch (err) {
      setDeletingError(getErrorMessage(err));
    } finally {
      setDeleting(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ACCIONES DE FILA
  // ══════════════════════════════════════════════════════════════════════════

  /** Copia al portapapeles con respaldo para navegadores sin Clipboard API. */
  const copyToClipboard = async (text) => {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      try {
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        return true;
      } catch {
        return false;
      }
    }
  };

  const handleCopyEmail = async (emp) => {
    const copied = await copyToClipboard(emp?.email);
    if (copied) {
      setSuccessMessage('Email copiado al portapapeles.');
    } else {
      setError('No se pudo copiar el email.');
    }
  };

  /** Solo se ofrecen acciones que el backend ya soporta. */
  const buildActions = (emp) => {
    const actions = [];

    if (canManageEmployees) {
      actions.push({
        key: 'edit',
        label: 'Editar empleado',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        ),
        onSelect: () => handleOpenEdit(emp),
      });
    }

    actions.push({
      key: 'copy-email',
      label: 'Copiar email',
      icon: (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
        </svg>
      ),
      onSelect: () => handleCopyEmail(emp),
      disabled: !emp?.email,
      separatorBefore: canManageEmployees,
    });

    if (canManageEmployees) {
      actions.push({
        key: 'delete',
        label: 'Eliminar empleado',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="3 6 5 6 21 6" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        ),
        onSelect: () => handleOpenDelete(emp),
        danger: true,
        separatorBefore: true,
      });
    }

    return actions;
  };

  const handleClearFilters = () => {
    setSearchInput('');
    setFilterRole('');
    setFilterStatus('');
    setPage(0);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ESTADOS DERIVADOS DE LA VISTA
  // ══════════════════════════════════════════════════════════════════════════

  const hasFilters = search.length > 0 || filterRole !== '' || filterStatus !== '';
  const showEmptyDatabase = !isInitialLoad && !error && pageData.totalElements === 0 && !hasFilters;
  const showNoResults = !loading && !error && employees.length === 0 && hasFilters;
  const showTable = !isInitialLoad && !error && !showEmptyDatabase;

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
          <button className="btn btn-outline-danger btn-sm ms-2" onClick={refresh} type="button">
            Reintentar
          </button>
        </div>
      )}

      {/* ═══ Tarjetas de resumen ═══════════════════════════════════════════ */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
          </div>
          <div className="stat-card-info">
            {statsLoading ? (
              <>
                <span className="skeleton skeleton-line skeleton-line-value" />
                <span className="skeleton skeleton-line skeleton-line-label" />
              </>
            ) : (
              <>
                <div className="stat-card-value">{stats?.total ?? '—'}</div>
                <div className="stat-card-label">Total Empleados</div>
              </>
            )}
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
            {statsLoading ? (
              <>
                <span className="skeleton skeleton-line skeleton-line-value" />
                <span className="skeleton skeleton-line skeleton-line-label" />
              </>
            ) : (
              <>
                <div className="stat-card-value">{stats?.active ?? '—'}</div>
                <div className="stat-card-label">Activos</div>
              </>
            )}
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
            {statsLoading ? (
              <>
                <span className="skeleton skeleton-line skeleton-line-value" />
                <span className="skeleton skeleton-line skeleton-line-label" />
              </>
            ) : (
              <>
                <div className="stat-card-value">{stats?.inactive ?? '—'}</div>
                <div className="stat-card-label">Inactivos</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Carga inicial ═════════════════════════════════════════════════ */}
      {isInitialLoad && !error && (
        <div className="app-card" aria-busy="true">
          <div className="app-table-wrapper">
            <table className="app-table">
              <thead>
                <tr>
                  <th className="col-id">#</th>
                  <th>Empleado</th>
                  <th>Rol</th>
                  <th>Restaurantes</th>
                  <th>Estado</th>
                  <th>Alta</th>
                  <th className="col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }, (_, row) => (
                  <tr key={row}>
                    {Array.from({ length: 7 }, (_, cell) => (
                      <td key={cell}>
                        <span className="skeleton skeleton-line" style={{ width: '70%' }} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ═══ Sin empleados registrados ═════════════════════════════════════ */}
      {showEmptyDatabase && (
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

      {/* ═══ Tabla ═════════════════════════════════════════════════════════ */}
      {showTable && (
        <>
          <div className={`app-card${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
            {/* ─── Buscador y filtros ─────────────────────────────────────
                No se desmontan al refrescar, así el foco y el texto se
                mantienen mientras se escribe. */}
            <div className="table-toolbar">
              <div className="table-search">
                <span className="table-search-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                </span>
                <input
                  type="search"
                  className="form-control form-control-sm"
                  placeholder="Buscar por nombre, usuario, email o teléfono…"
                  value={searchInput}
                  onChange={(e) => setSearchInput(e.target.value)}
                  aria-label="Buscar empleados"
                />
                {searchInput && (
                  <button
                    type="button"
                    className="table-search-clear"
                    onClick={() => setSearchInput('')}
                    aria-label="Limpiar búsqueda"
                    title="Limpiar búsqueda"
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                )}
              </div>

              <div className="d-flex flex-wrap align-items-center gap-2">
                <select
                  className="form-select form-select-sm"
                  style={{ width: 'auto' }}
                  value={filterRole}
                  onChange={(e) => {
                    setFilterRole(e.target.value);
                    setPage(0);
                  }}
                  aria-label="Filtrar por rol"
                >
                  <option value="">Todos los roles</option>
                  {FILTERABLE_ROLES.map((role) => (
                    <option key={role} value={role}>
                      {ROLE_LABELS[role] || role}
                    </option>
                  ))}
                </select>

                <select
                  className="form-select form-select-sm"
                  style={{ width: 'auto' }}
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                    setPage(0);
                  }}
                  aria-label="Filtrar por estado"
                >
                  <option value="">Todos los estados</option>
                  <option value="active">Activos</option>
                  <option value="inactive">Inactivos</option>
                </select>

                {loading && (
                  <span className="d-flex align-items-center gap-2 text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                    <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    Actualizando…
                  </span>
                )}
              </div>
            </div>

            <div className="app-table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    {sortableHeader('id', '#', 'col-id')}
                    {sortableHeader('name', 'Empleado')}
                    <th>Rol</th>
                    <th>Restaurantes</th>
                    {sortableHeader('enabled', 'Estado')}
                    {sortableHeader('createdAt', 'Alta')}
                    <th className="col-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {showNoResults ? (
                    <tr className="no-results">
                      <td colSpan={7}>
                        <div>Ningún empleado coincide con los filtros aplicados.</div>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm mt-3"
                          onClick={handleClearFilters}
                        >
                          Limpiar filtros
                        </button>
                      </td>
                    </tr>
                  ) : (
                    employees.map((emp) => (
                      <tr key={emp.id}>
                        <td className="col-id">{emp.id}</td>
                        <td>
                          <div className="cell-primary">
                            <span className="cell-primary-title">{getFullName(emp)}</span>
                            <span className="cell-primary-meta">
                              {[emp.username, emp.email].filter(Boolean).join(' · ') || '—'}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span className="fw-medium">{getRoleLabel(getPrimaryRole(emp))}</span>
                        </td>
                        <td style={{ maxWidth: '220px' }}>
                          <span className="text-truncate d-inline-block" style={{ maxWidth: '220px' }}>
                            {getRestaurantNames(emp)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge-status ${STATUS_LABELS[emp.enabled !== false ? 'true' : 'false'].className}`}>
                            {STATUS_LABELS[emp.enabled !== false ? 'true' : 'false'].label}
                          </span>
                        </td>
                        <td className="text-nowrap">{formatDate(emp.createdAt)}</td>
                        <td className="col-actions">
                          <div className="d-flex justify-content-end">
                            <ActionMenu
                              items={buildActions(emp)}
                              label={`Acciones de ${getFullName(emp)}`}
                            />
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <Pagination
              page={pageData.page}
              size={size}
              totalElements={pageData.totalElements}
              totalPages={pageData.totalPages}
              sizeOptions={PAGE_SIZE_OPTIONS}
              itemLabel="empleados"
              disabled={loading}
              onPageChange={setPage}
              onSizeChange={(newSize) => {
                setSize(newSize);
                setPage(0);
              }}
            />
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

                  <div className="mb-3">
                    <label htmlFor="emp-restaurantes" className="form-label">
                      Restaurantes asignados
                    </label>
                    <RestaurantMultiSelect
                      id="emp-restaurantes"
                      value={formData.restaurants}
                      onChange={(seleccion) =>
                        setFormData((prev) => ({ ...prev, restaurants: seleccion }))
                      }
                      disabled={submitting}
                    />
                    {formData.restaurants.length === 0 && (
                      <div className="form-text">{avisoSinRestaurantes(formData.role)}</div>
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
