import { useState, useEffect, useCallback, useMemo } from 'react';
import { useAuth } from '../context/AuthContext';
import {
  getCustomers,
  getCustomerStats,
  getCustomerById,
  getCustomerReservations,
  createCustomer,
  updateCustomer,
  PAGE_SIZE_OPTIONS,
  DEFAULT_PAGE_SIZE,
} from '../services/customerService';
import { getRestaurants } from '../services/restaurantService';
import { canAccess, PERMISSIONS } from '../config/permissions';
import ActionMenu from '../components/ActionMenu';
import Pagination from '../components/Pagination';

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTES
// ═══════════════════════════════════════════════════════════════════════════════

/** Estados de reserva traducidos */
const RESERVATION_STATUS_LABELS = {
  PENDING: 'Pendiente',
  CONFIRMED: 'Confirmada',
  CANCELLED: 'Cancelada',
  COMPLETED: 'Completada',
  NO_SHOW: 'No presentado',
};

/** Clases CSS para las badges de estado de reserva */
const RESERVATION_STATUS_CLASS = {
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  CANCELLED: 'cancelled',
  COMPLETED: 'completed',
  NO_SHOW: 'cancelled',
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

/** Estado inicial del formulario */
const INITIAL_FORM = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  notes: '',
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

/** Obtiene el nombre completo del cliente (fullName o firstName + lastName) */
const getFullName = (customer) => {
  if (!customer) return '—';
  if (customer.fullName) return customer.fullName.trim();
  const first = (customer.firstName || '').trim();
  const last = (customer.lastName || '').trim();
  if (!first && !last) return '—';
  return `${first} ${last}`.trim();
};

/** Formatea la hora (recorta HH:mm:ss a HH:mm) */
const formatTime = (time) => {
  if (!time) return '';
  return String(time).substring(0, 5);
};

/** Formatea una fecha ISO a dd/mm/aaaa */
const formatDate = (dateStr) => {
  if (!dateStr) return '—';
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
};

// Aquí vivían getStatusBadgeClass y getStatusLabel, que pintaban el estado del
// cliente a partir de `customer.active`. Ese campo no existe en la entidad
// Customer ni lo devuelve el backend, así que la comparación `active !== false`
// daba siempre «Activo» para todo el mundo.

// ═══════════════════════════════════════════════════════════════════════════════
// COMPONENTE PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════

const Customers = () => {
  const { user } = useAuth();

  // ─── Consulta al backend: página, tamaño, texto, filtros y orden ───────
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');
  const [search, setSearch] = useState('');
  const [filterRestaurantId, setFilterRestaurantId] = useState('');
  // Segmento activo elegido desde las tarjetas de cifras ('' = todos).
  const [segment, setSegment] = useState('');
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [refreshKey, setRefreshKey] = useState(0);

  // ─── Estados de datos ──────────────────────────────────────────────────
  const [pageData, setPageData] = useState(EMPTY_PAGE);
  const [restaurants, setRestaurants] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // ─── Cifras de las tarjetas ────────────────────────────────────────────
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // ─── Modal de formulario (crear/editar) ────────────────────────────────
  const [showFormModal, setShowFormModal] = useState(false);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [formData, setFormData] = useState({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // ─── Modal de detalle del cliente ──────────────────────────────────────
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailCustomer, setDetailCustomer] = useState(null);
  const [detailReservations, setDetailReservations] = useState([]);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(null);

  // Safe access
  const safeCustomers = useMemo(
    () => (Array.isArray(pageData.content) ? pageData.content : []),
    [pageData]
  );
  const safeRestaurants = useMemo(() => Array.isArray(restaurants) ? restaurants : [], [restaurants]);

  // ─── Permisos del usuario actual ───────────────────────────────────────
  const canManage = canAccess(user, PERMISSIONS.MANAGE_CUSTOMERS);

  // ─── Cargar restaurantes (una vez al montar) ───────────────────────────
  useEffect(() => {
    const fetchRestaurantsList = async () => {
      try {
        const data = await getRestaurants();
        setRestaurants(Array.isArray(data) ? data : []);
      } catch {
        setRestaurants([]);
      }
    };
    fetchRestaurantsList();
  }, []);

  // ─── Debounce del buscador ─────────────────────────────────────────────
  // Cambiar el texto vuelve a la primera página, pero conserva segmento,
  // restaurante, orden y tamaño. Los dos estados se actualizan juntos para
  // lanzar UNA sola consulta.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ─── Cargar la página ──────────────────────────────────────────────────
  // El backend resuelve texto, restaurante, segmento, orden y paginación.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getCustomers({
          page,
          size,
          search,
          restaurantId: filterRestaurantId || undefined,
          segment: segment || undefined,
          sort: sortField,
          direction: sortDirection,
        });
        if (cancelled) return;

        // La página pedida puede quedarse vacía: se retrocede en vez de mostrar
        // una tabla vacía sin explicación.
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
  }, [page, size, search, filterRestaurantId, segment, sortField, sortDirection, refreshKey]);

  // ─── Cargar las cifras ─────────────────────────────────────────────────
  // Vienen de una consulta agregada: contar la página daría un número sin
  // sentido, y es justo lo que hacía la versión anterior sobre la lista entera.
  // No dependen del segmento elegido: si cambiaran al pulsar una tarjeta, las
  // otras tres se moverían bajo el dedo.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setStatsLoading(true);
      try {
        const data = await getCustomerStats(filterRestaurantId || undefined);
        if (!cancelled) setStats(data);
      } catch {
        // Un fallo de cifras no debe tapar la tabla.
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [filterRestaurantId, refreshKey]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  // ─── Limpiar mensajes ─────────────────────────────────────────────────
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // ══════════════════════════════════════════════════════════════════════════
  // ESTADO DE LA VISTA
  // ══════════════════════════════════════════════════════════════════════════

  // Texto, restaurante, segmento, orden y paginación los resuelve el backend.
  // Aquí ya no queda ningún filtrado en cliente: antes el segmento se aplicaba
  // sobre la lista descargada, de modo que al paginar habría filtrado solo la
  // página. La tabla pinta exactamente lo que devuelve el servidor.
  const hasActiveFilters = Boolean(search || filterRestaurantId || segment);

  const handleClearFilters = () => {
    setSearchQuery('');
    setFilterRestaurantId('');
    setSegment('');
    setPage(0);
  };

  /** Pulsar la tarjeta ya activa la desactiva: es un interruptor, no un menú. */
  const toggleSegment = (value) => {
    setSegment((actual) => (actual === value ? '' : value));
    setPage(0);
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ORDEN
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

  /** Cabecera ordenable, con el mismo indicador que el resto de paneles. */
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
  // NOMBRES DE RESTAURANTES
  // ══════════════════════════════════════════════════════════════════════════

  const getCustomerRestaurants = (customer) => {
    if (!customer) return '—';

    // Nuevo formato: restaurantNames (array de strings)
    if (customer.restaurantNames && Array.isArray(customer.restaurantNames)) {
      const names = customer.restaurantNames.filter(Boolean);
      if (names.length > 0) return names;
    }

    // Formato antiguo: restaurantId
    if (customer.restaurantId) {
      const rest = safeRestaurants.find((r) => Number(r.id) === Number(customer.restaurantId));
      return rest ? [rest.name] : [];
    }

    return [];
  };

  const getRestaurantsDisplay = (customer) => {
    const names = getCustomerRestaurants(customer);
    if (names.length === 0) return '—';
    return names.join(', ');
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL DE FORMULARIO: ABRIR / CERRAR
  // ══════════════════════════════════════════════════════════════════════════

  const handleOpenCreate = () => {
    setEditingCustomer(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
    setShowFormModal(true);
  };

  const handleOpenEdit = (customer) => {
    if (!customer) return;

    setEditingCustomer(customer);
    setFormData({
      firstName: customer.firstName || customer.fullName || '',
      lastName: customer.lastName || '',
      email: customer.email || '',
      phone: customer.phone || '',
      notes: customer.notes || '',
    });
    setFormErrors({});
    setShowFormModal(true);
  };

  const handleCloseFormModal = () => {
    setShowFormModal(false);
    setEditingCustomer(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FORMULARIO: CAMPOS Y VALIDACIÓN
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

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // FORMULARIO: GUARDAR
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
        notes: (formData.notes || '').trim(),
      };

      if (editingCustomer) {
        await updateCustomer(editingCustomer.id, payload);
        setSuccessMessage('Cliente actualizado correctamente.');
      } else {
        await createCustomer(payload);
        setSuccessMessage('Cliente creado correctamente.');
      }

      handleCloseFormModal();
      // Solo se recarga la página actual, no la lista completa.
      refresh();
    } catch (err) {
      const msg = getErrorMessage(err);
      setFormErrors({ submit: msg });
    } finally {
      setSubmitting(false);
    }
  };

  // ══════════════════════════════════════════════════════════════════════════
  // MODAL DE DETALLE
  // ══════════════════════════════════════════════════════════════════════════

  const handleOpenDetail = async (customer) => {
    if (!customer) return;

    setShowDetailModal(true);
    setLoadingDetail(true);
    setDetailError(null);
    setDetailCustomer(null);
    setDetailReservations([]);

    try {
      // Cargar detalle del cliente y su historial de reservas en paralelo
      const [detailData, reservationsData] = await Promise.all([
        getCustomerById(customer.id),
        getCustomerReservations(customer.id),
      ]);
      setDetailCustomer(detailData || customer);
      setDetailReservations(Array.isArray(reservationsData) ? reservationsData : []);
    } catch (err) {
      // Si falla el detalle, mostrar al menos lo que tenemos
      setDetailCustomer(customer);
      setDetailReservations([]);
      setDetailError(getErrorMessage(err));
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleCloseDetail = () => {
    setShowDetailModal(false);
    setDetailCustomer(null);
    setDetailReservations([]);
    setDetailError(null);
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

  const handleCopyEmail = async (customer) => {
    const copied = await copyToClipboard(customer?.email);
    if (copied) {
      setSuccessMessage('Email copiado al portapapeles.');
    } else {
      setError('No se pudo copiar el email.');
    }
  };

  /** Solo acciones que el backend soporta de verdad. */
  const buildActions = (customer) => {
    const actions = [
      {
        key: 'detail',
        label: 'Ver detalles',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ),
        onSelect: () => handleOpenDetail(customer),
      },
    ];

    if (canManage) {
      actions.push({
        key: 'edit',
        label: 'Editar cliente',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
          </svg>
        ),
        onSelect: () => handleOpenEdit(customer),
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
      onSelect: () => handleCopyEmail(customer),
      disabled: !customer?.email,
      separatorBefore: true,
    });

    return actions;
  };

  // ══════════════════════════════════════════════════════════════════════════
  // ESTADOS DERIVADOS DE LA VISTA
  // ══════════════════════════════════════════════════════════════════════════

  // Sin clientes en absoluto: se muestra el estado vacío completo. Si hay
  // filtros puestos se mantiene la vista con el buscador, porque si no el
  // usuario se quedaba sin forma de borrar su búsqueda.
  const showEmptyDatabase =
    !isInitialLoad && !error && pageData.totalElements === 0 && !hasActiveFilters;
  const showNoResults = !loading && !error && safeCustomers.length === 0 && hasActiveFilters;
  const showTable = !isInitialLoad && !error && !showEmptyDatabase;

  // ══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ══════════════════════════════════════════════════════════════════════════

  return (
    <div className="customers-page">
      {/* ═══ Page Header ═══════════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h1>Clientes</h1>
          <p className="page-description">
            CRM ligero — gestiona tus clientes, consulta su historial de reservas y toma notas útiles.
          </p>
        </div>

        {canManage && (
          <div className="page-header-actions">
            <button
              className="btn btn-primary d-flex align-items-center gap-2"
              onClick={handleOpenCreate}
              type="button"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
              Añadir Cliente
            </button>
          </div>
        )}
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

      {/* ═══ Carga inicial ═════════════════════════════════════════════════
          Un esqueleto con la forma de la tabla reserva el espacio y adelanta
          qué va a aparecer; el spinner centrado no hacía ninguna de las dos. */}
      {isInitialLoad && !error && (
        <div className="app-card" aria-busy="true">
          <div className="app-table-wrapper">
            <table className="app-table">
              <thead>
                <tr>
                  <th>Cliente</th>
                  <th>Restaurante</th>
                  <th>Reservas</th>
                  <th>Última reserva</th>
                  <th className="col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 6 }, (_, row) => (
                  <tr key={row}>
                    {Array.from({ length: 5 }, (_, cell) => (
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

      {/* ═══ Empty State ═══════════════════════════════════════════════════
          Solo cuando no hay ningún cliente Y no hay filtros puestos. Si la
          búsqueda no devuelve nada se mantiene la vista con el buscador: de
          lo contrario el usuario se quedaba sin forma de borrar su búsqueda. */}
      {showEmptyDatabase && (
        <div className="app-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <h5>No hay clientes registrados</h5>
            <p>Todavía no hay clientes en tu restaurante. Cuando los clientes hagan reservas, aparecerán aquí.</p>
            {canManage && (
              <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
                Añadir Cliente
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ Data View ═════════════════════════════════════════════════════ */}
      {showTable && (
        <>
          {/* ─── Segmentos ──────────────────────────────────────────────────
              Cada tarjeta filtra la tabla por su segmento. Son interruptores:
              volver a pulsarlas quita el filtro. */}
          <div className="stats-grid">
            <button
              type="button"
              className="stat-card"
              onClick={() => setSegment('')}
              aria-pressed={segment === ''}
              title="Ver todos los clientes"
            >
              <span className="stat-card-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="9" cy="7" r="4" />
                  <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                  <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
              </span>
              <span className="stat-card-info">
                <span className="stat-card-value">{statsLoading ? "—" : (stats?.total ?? "—")}</span>
                <span className="stat-card-label">Total Clientes</span>
              </span>
            </button>
            <button
              type="button"
              className="stat-card"
              onClick={() => toggleSegment('recurrentes')}
              aria-pressed={segment === 'recurrentes'}
              title="Ver solo los clientes que han vuelto"
            >
              <span className="stat-card-icon success">
                {/* Flechas en ciclo: ha vuelto */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="17 1 21 5 17 9" />
                  <path d="M3 11V9a4 4 0 0 1 4-4h14" />
                  <polyline points="7 23 3 19 7 15" />
                  <path d="M21 13v2a4 4 0 0 1-4 4H3" />
                </svg>
              </span>
              <span className="stat-card-info">
                <span className="stat-card-value">{statsLoading ? "—" : (stats?.recurrentes ?? "—")}</span>
                <span className="stat-card-label">Recurrentes</span>
              </span>
            </button>
            <button
              type="button"
              className="stat-card"
              onClick={() => toggleSegment('nuevos')}
              aria-pressed={segment === 'nuevos'}
              title="Ver solo las altas de este mes"
            >
              <span className="stat-card-icon primary">
                {/* Persona con un más: alta reciente */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                  <circle cx="8.5" cy="7" r="4" />
                  <line x1="20" y1="8" x2="20" y2="14" />
                  <line x1="23" y1="11" x2="17" y2="11" />
                </svg>
              </span>
              <span className="stat-card-info">
                <span className="stat-card-value">{statsLoading ? "—" : (stats?.nuevosEsteMes ?? "—")}</span>
                <span className="stat-card-label">Nuevos este mes</span>
              </span>
            </button>
            <button
              type="button"
              className="stat-card"
              onClick={() => toggleSegment('sinVenir')}
              aria-pressed={segment === 'sinVenir'}
              title="Ver solo los clientes a recuperar"
            >
              <span className="stat-card-icon warning">
                {/* Reloj con flecha atrás: hace tiempo que no viene */}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v5h5" />
                  <path d="M3.05 13A9 9 0 1 0 6 5.3L3 8" />
                  <polyline points="12 7 12 12 15 14" />
                </svg>
              </span>
              <span className="stat-card-info">
                <span className="stat-card-value">{statsLoading ? "—" : (stats?.sinVenir ?? "—")}</span>
                <span className="stat-card-label">Sin venir en 3 meses</span>
              </span>
            </button>
          </div>

          {/* ─── Filters ────────────────────────────────────────────────── */}
          <div className="d-flex flex-wrap align-items-center gap-3 mb-3">
            {/* Buscador */}
            <div className="d-flex align-items-center gap-2 flex-grow-1" style={{ maxWidth: '360px' }}>
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
                aria-label="Buscar clientes"
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

            {/* Filtro por restaurante */}
            <select
              className="form-select form-select-sm"
              style={{ maxWidth: '220px' }}
              value={filterRestaurantId}
              onChange={(e) => {
                setFilterRestaurantId(e.target.value);
                setPage(0);
              }}
              aria-label="Filtrar por restaurante"
            >
              <option value="">Todos los restaurantes</option>
              {safeRestaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'No disponible'}
                </option>
              ))}
            </select>

            {/* Aquí había un filtro por estado activo/inactivo. Se retira: la
                entidad Customer no tiene campo `active`, así que «Inactivos»
                devolvía siempre cero y «Activos» devolvía todo. */}

            {loading && (
              <span className="d-flex align-items-center gap-2 text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Actualizando…
              </span>
            )}
          </div>

          {/* ─── Table ──────────────────────────────────────────────────── */}
          <div className={`app-card${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
            <div className="app-table-wrapper">
              <table className="app-table">
                <thead>
                  <tr>
                    {sortableHeader('name', 'Cliente')}
                    <th>Restaurante</th>
                    <th>Reservas</th>
                    <th>Última reserva</th>
                    <th className="col-actions">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {showNoResults ? (
                    <tr className="no-results">
                      <td colSpan={5}>
                        <div className="mb-2">
                          {search
                            ? `Ningún cliente coincide con «${search}».`
                            : 'Ningún cliente coincide con los filtros seleccionados.'}
                        </div>
                        <button className="btn btn-secondary btn-sm" onClick={handleClearFilters} type="button">
                          Limpiar búsqueda y filtros
                        </button>
                      </td>
                    </tr>
                  ) : (
                    safeCustomers.map((customer) => {
                      const fullName = getFullName(customer);
                      const email = customer?.email || '';
                      const phone = customer?.phone || '';
                      const totalRes = customer?.totalReservations ?? 0;
                      const lastDate = customer?.lastReservationDate || '';
                      const restaurantNames = getCustomerRestaurants(customer);

                      return (
                        <tr key={customer.id}>
                          {/* Cliente: nombre con el contacto como línea secundaria */}
                          <td>
                            <div className="cell-primary">
                              <span className="cell-primary-title">{fullName}</span>
                              <span className="cell-primary-meta">
                                {[email, phone].filter(Boolean).join(' · ') || '—'}
                              </span>
                            </div>
                          </td>

                          {/* Restaurante */}
                          <td>
                            {restaurantNames.length > 0 ? (
                              <div className="crm-restaurants-cell">
                                {restaurantNames.map((name, i) => (
                                  <span key={i} className="crm-restaurant-badge">{name}</span>
                                ))}
                              </div>
                            ) : (
                              <span className="text-muted">—</span>
                            )}
                          </td>

                          {/* Reservas */}
                          <td className="fw-semibold">
                            {totalRes > 0 ? totalRes : <span className="text-muted fw-normal">0</span>}
                          </td>

                          {/* Última reserva */}
                          <td className="text-nowrap">
                            {lastDate ? (
                              <span className="crm-last-date">{formatDate(lastDate)}</span>
                            ) : (
                              <span className="text-muted">Sin reservas</span>
                            )}
                          </td>

                          {/* Acciones */}
                          <td className="col-actions">
                            <div className="d-flex justify-content-end">
                              <ActionMenu
                                items={buildActions(customer)}
                                label={`Acciones de ${fullName}`}
                              />
                            </div>
                          </td>
                        </tr>
                      );
                    })
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
              itemLabel="clientes"
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

      {/* ══════════════════════════════════════════════════════════════════
          MODAL: Crear / Editar
          ══════════════════════════════════════════════════════════════════ */}
      {showFormModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {editingCustomer ? 'Editar Cliente' : 'Nuevo Cliente'}
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseFormModal} aria-label="Cerrar" />
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="modal-body">
                  {/* Error del submit */}
                  {formErrors.submit && (
                    <div className="alert alert-danger py-2" role="alert">
                      {formErrors.submit}
                    </div>
                  )}

                  <div className="row g-3">
                    {/* Nombre */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-firstName" className="form-label">
                        Nombre <span className="text-danger">*</span>
                      </label>
                      <input
                        id="cust-firstName"
                        type="text"
                        className={`form-control ${formErrors.firstName ? 'is-invalid' : ''}`}
                        name="firstName"
                        value={formData.firstName || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Laura"
                        required
                      />
                      {formErrors.firstName && <div className="invalid-feedback">{formErrors.firstName}</div>}
                    </div>

                    {/* Apellidos */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-lastName" className="form-label">Apellidos</label>
                      <input
                        id="cust-lastName"
                        type="text"
                        className="form-control"
                        name="lastName"
                        value={formData.lastName || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Gómez"
                      />
                    </div>

                    {/* Email */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-email" className="form-label">Email</label>
                      <input
                        id="cust-email"
                        type="email"
                        className={`form-control ${formErrors.email ? 'is-invalid' : ''}`}
                        name="email"
                        value={formData.email || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: laura.gomez@test.com"
                      />
                      {formErrors.email && <div className="invalid-feedback">{formErrors.email}</div>}
                    </div>

                    {/* Teléfono */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="cust-phone" className="form-label">Teléfono</label>
                      <input
                        id="cust-phone"
                        type="tel"
                        className="form-control"
                        name="phone"
                        value={formData.phone || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: 600111222"
                      />
                    </div>

                    {/* Notas (textarea para mejor UX) */}
                    <div className="col-12">
                      <label htmlFor="cust-notes" className="form-label">
                        Notas del cliente
                        <span className="public-label-optional ms-1">(alergias, preferencias, celebraciones, observaciones internas)</span>
                      </label>
                      <textarea
                        id="cust-notes"
                        className="form-control"
                        name="notes"
                        value={formData.notes || ''}
                        onChange={handleFormChange}
                        placeholder="Ej: Prefiere mesa tranquila, alérgico a los frutos secos, celebra su cumpleaños en julio..."
                        rows={3}
                        style={{ resize: 'vertical' }}
                      />
                    </div>
                  </div>
                </div>

                <div className="modal-footer">
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCloseFormModal}
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
                    {editingCustomer ? 'Actualizar Cliente' : 'Crear Cliente'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          MODAL: Detalle del cliente (CRM View)
          ══════════════════════════════════════════════════════════════════ */}
      {showDetailModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-xl modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {detailCustomer ? getFullName(detailCustomer) : 'Detalle del Cliente'}
                </h5>
                <button type="button" className="btn-close" onClick={handleCloseDetail} aria-label="Cerrar" />
              </div>

              <div className="modal-body">
                {/* Loading detail */}
                {loadingDetail && (
                  <div className="text-center py-4">
                    <div className="spinner-border mb-3" role="status" style={{ width: '2rem', height: '2rem' }}>
                      <span className="visually-hidden">Cargando detalle...</span>
                    </div>
                    <p className="text-muted mb-0">Cargando detalle del cliente...</p>
                  </div>
                )}

                {/* Error en detalle */}
                {!loadingDetail && detailError && (
                  <div className="alert alert-warning d-flex align-items-center gap-2 mb-3" role="alert">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                      <line x1="12" y1="9" x2="12" y2="13" />
                      <line x1="12" y1="17" x2="12.01" y2="17" />
                    </svg>
                    <span>{detailError}</span>
                  </div>
                )}

                {/* Contenido del detalle */}
                {!loadingDetail && detailCustomer && (
                  <>
                    {/* ─── Info del cliente ───────────────────────────── */}
                    <div className="crm-detail-section">
                      <h6 className="crm-detail-section-title">Información del Cliente</h6>
                      <div className="crm-detail-grid">
                        <div className="crm-detail-field">
                          <span className="crm-detail-label">Nombre completo</span>
                          <span className="crm-detail-value">{getFullName(detailCustomer)}</span>
                        </div>
                        <div className="crm-detail-field">
                          <span className="crm-detail-label">Email</span>
                          <span className="crm-detail-value">{detailCustomer.email || '—'}</span>
                        </div>
                        <div className="crm-detail-field">
                          <span className="crm-detail-label">Teléfono</span>
                          <span className="crm-detail-value">{detailCustomer.phone || '—'}</span>
                        </div>
                        <div className="crm-detail-field">
                          <span className="crm-detail-label">Restaurantes asociados</span>
                          <span className="crm-detail-value">
                            {getRestaurantsDisplay(detailCustomer) || '—'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* ─── Notas ──────────────────────────────────────── */}
                    {detailCustomer.notes && (
                      <div className="crm-detail-section">
                        <h6 className="crm-detail-section-title">Notas</h6>
                        <div className="crm-detail-notes-box">
                          {detailCustomer.notes}
                        </div>
                      </div>
                    )}

                    {/* ─── Estadísticas básicas ────────────────────────── */}
                    <div className="crm-detail-section">
                      <h6 className="crm-detail-section-title">Estadísticas</h6>
                      <div className="crm-detail-stats-row">
                        <div className="crm-detail-stat-item">
                          <span className="crm-detail-stat-value">{detailCustomer.totalReservations ?? 0}</span>
                          <span className="crm-detail-stat-label">Total reservas</span>
                        </div>
                        <div className="crm-detail-stat-item">
                          <span className="crm-detail-stat-value" style={{ color: 'var(--success-text)' }}>{detailCustomer.confirmedReservations ?? 0}</span>
                          <span className="crm-detail-stat-label">Confirmadas</span>
                        </div>
                        <div className="crm-detail-stat-item">
                          <span className="crm-detail-stat-value" style={{ color: 'var(--danger-text)' }}>{detailCustomer.cancelledReservations ?? 0}</span>
                          <span className="crm-detail-stat-label">Canceladas</span>
                        </div>
                        {detailCustomer.lastReservationDate && (
                          <div className="crm-detail-stat-item">
                            <span className="crm-detail-stat-value" style={{ fontSize: '0.8125rem' }}>
                              {formatDate(detailCustomer.lastReservationDate)}
                            </span>
                            <span className="crm-detail-stat-label">Última reserva</span>
                          </div>
                        )}
                      </div>
                    </div>

                    {/* ─── Historial de reservas ──────────────────────── */}
                    <div className="crm-detail-section">
                      <h6 className="crm-detail-section-title">
                        Historial de Reservas
                        {detailReservations.length > 0 && (
                          <span className="crm-detail-count-badge">{detailReservations.length}</span>
                        )}
                      </h6>

                      {detailReservations.length === 0 ? (
                        <p className="text-muted mb-0" style={{ fontSize: '0.875rem' }}>
                          Este cliente no tiene reservas registradas.
                        </p>
                      ) : (
                        <div className="crm-history-table-wrapper">
                          <table className="crm-history-table">
                            <thead>
                              <tr>
                                <th>Fecha</th>
                                <th>Hora</th>
                                <th>Restaurante</th>
                                <th>Personas</th>
                                <th>Mesa</th>
                                <th>Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {detailReservations.map((res, idx) => {
                                const resId = res?.id ?? idx;
                                const resStatus = res?.status || '';
                                const statusLabel = RESERVATION_STATUS_LABELS[resStatus] || resStatus;
                                const statusClass = RESERVATION_STATUS_CLASS[resStatus] || '';

                                return (
                                  <tr key={resId}>
                                    <td>{formatDate(res.reservationDate)}</td>
                                    <td>{formatTime(res.reservationTime)}</td>
                                    <td>
                                      {res.restaurantName
                                        ? res.restaurantName
                                        : (res.restaurant?.name || '—')}
                                    </td>
                                    <td>{res.partySize ?? '—'}</td>
                                    <td>
                                      {res.diningTable
                                        ? res.diningTable.tableNumber || res.diningTable.name || `#${res.diningTable.id}`
                                        : (res.tableNumber || '—')}
                                    </td>
                                    <td>
                                      <span className={`badge-status ${statusClass}`}>{statusLabel}</span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className="modal-footer">
                {detailCustomer && canManage && (
                  <button
                    type="button"
                    className="btn btn-outline-primary d-flex align-items-center gap-2"
                    onClick={() => {
                      handleCloseDetail();
                      handleOpenEdit(detailCustomer);
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                    </svg>
                    Editar Cliente
                  </button>
                )}
                <button type="button" className="btn btn-secondary" onClick={handleCloseDetail}>
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Aquí estaba el modal de desactivar/reactivar cliente. Llamaba a
          PATCH /customers/{id}/active, un endpoint que no existe, así que
          siempre fallaba. Se retira con el resto del estado inexistente. */}
    </div>
  );
};

export default Customers;
