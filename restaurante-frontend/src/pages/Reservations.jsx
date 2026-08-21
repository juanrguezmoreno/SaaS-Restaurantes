import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import api from '../api/axios';
import {
  getReservations,
  getReservationStats,
  getReservationsByDate,
  createReservation,
  updateReservation,
  deleteReservation,
  updateReservationStatus,
  getTimeSlots,
  PAGE_SIZE_OPTIONS,
  DEFAULT_PAGE_SIZE,
} from '../services/reservationService';
import { getRestaurants } from '../services/restaurantService';
import { getTablesByRestaurant } from '../services/tableService';
import { getCustomers } from '../services/customerService';
import QuickCustomerForm from '../components/QuickCustomerForm';
import TimeSlotSelector from '../components/TimeSlotSelector';
import Pagination from '../components/Pagination';
import ActionMenu from '../components/ActionMenu';
import useTimeSlots from '../hooks/useTimeSlots';
import { canAccess, PERMISSIONS } from '../config/permissions';
import { getLocalTodayString } from '../lib/reservationHelpers';

// ─── Estados posibles ─────────────────────────────────────────────────────
const RESERVATION_STATUSES = [
  { value: 'PENDING', label: 'Pendiente' },
  { value: 'CONFIRMED', label: 'Confirmada' },
  { value: 'CANCELLED', label: 'Cancelada' },
  { value: 'COMPLETED', label: 'Completada' },
  { value: 'NO_SHOW', label: 'No presentado' },
];

const STATUS_MAP = Object.fromEntries(
  RESERVATION_STATUSES.map((s) => [s.value, s])
);

/**
 * Las cinco vistas del panel. Cada una es una consulta al servidor, no un
 * filtro en memoria: antes de esto la pantalla descargaba la lista completa y
 * derivaba de ella siete vistas distintas.
 *
 * `countKey` es el campo de /reservations/stats que alimenta su contador.
 */
const VIEWS = [
  { value: 'solicitudes', label: 'Solicitudes', countKey: 'pendientes' },
  { value: 'hoy', label: 'Hoy', countKey: 'hoyConfirmadas' },
  { value: 'proximas', label: 'Próximas', countKey: 'proximasConfirmadas' },
  { value: 'historial', label: 'Historial', countKey: 'historial' },
  { value: 'todas', label: 'Todas', countKey: 'total' },
];

/** Vistas donde tiene sentido ofrecer estado y fecha: en las demás los fija la vista. */
const VIEWS_WITH_FILTERS = ['todas', 'historial'];

// ─── Estado inicial del formulario ─────────────────────────────────────────
const INITIAL_FORM = {
  customerId: '',
  restaurantId: '',
  diningTableId: '',
  reservationDate: '',
  reservationTime: '',
  partySize: '2',
  notes: '',
  status: 'PENDING',
};

// ─── Helper: extraer mensaje de error ──────────────────────────────────────
const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

// ─── Componente principal ──────────────────────────────────────────────────
const Reservations = () => {
  const { user } = useAuth();

  // ─── Estados del listado ───────────────────────────────────────────────
  // La página, la vista, los filtros y el orden viajan al servidor; aquí solo
  // se guarda lo que se ha pedido y lo que ha devuelto.
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchQuery, setSearchQuery] = useState('');  // lo que se teclea
  const [search, setSearch] = useState('');            // lo que se consulta
  const [sortField, setSortField] = useState('date');
  const [sortDirection, setSortDirection] = useState('desc');
  const [pageData, setPageData] = useState(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // ─── Estados de referencias (selectores) ───────────────────────────────
  const [restaurants, setRestaurants] = useState([]);
  const [loadingRestaurants, setLoadingRestaurants] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [restaurantsLoadError, setRestaurantsLoadError] = useState(null);
  const [customers, setCustomers] = useState([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [customersLoadError, setCustomersLoadError] = useState(null);
  const [tables, setTables] = useState([]);
  const [loadingTables, setLoadingTables] = useState(false);
  // eslint-disable-next-line no-unused-vars
  const [tablesLoadError, setTablesLoadError] = useState(null);

  // ─── Estados de filtros ────────────────────────────────────────────────
  const [filterRestaurantId, setFilterRestaurantId] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDate, setFilterDate] = useState('');

  // ─── Vista activa ─────────────────────────────────────────────────────
  const [view, setView] = useState('solicitudes');

  // ─── Estados del modal de formulario ───────────────────────────────────
  const [showModal, setShowModal] = useState(false);
  const [editingReservation, setEditingReservation] = useState(null);
  const [formData, setFormData] = useState({ ...INITIAL_FORM });
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  // ─── Estados del modal de eliminar ─────────────────────────────────────
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deletingReservation, setDeletingReservation] = useState(null);
  const [deleting, setDeleting] = useState(false);

  // ─── Wizard de Nueva Reserva ──────────────────────────────────────────
  const WIZARD_STEPS = [
    { id: 1, title: 'Restaurante', subtitle: 'Elige el restaurante' },
    { id: 2, title: 'Fecha y hora', subtitle: 'Cuándo y para cuántos' },
    { id: 3, title: 'Mesa', subtitle: 'Selecciona la mesa disponible' },
    { id: 4, title: 'Confirmar', subtitle: 'Cliente y resumen final' },
  ];

  const INITIAL_WIZARD = {
    restaurantId: '',
    restaurantName: '',
    reservationDate: '',
    reservationTime: '',
    partySize: '2',
    selectedTable: null,
    customerId: '',
    notes: '',
  };

  const [showWizard, setShowWizard] = useState(false);
  const [wizardStep, setWizardStep] = useState(0);
  const [wizardData, setWizardData] = useState({ ...INITIAL_WIZARD });
  const [wizardError, setWizardError] = useState('');
  const [wizardSubmitting, setWizardSubmitting] = useState(false);
  const [availableTables, setAvailableTables] = useState([]);
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [availabilityChecked, setAvailabilityChecked] = useState(false);
  const [wizardSuccess, setWizardSuccess] = useState(false);
  const [showQuickCustomer, setShowQuickCustomer] = useState(false);
  const [quickCustomerSuccess, setQuickCustomerSuccess] = useState(false);

  // ─── Franjas horarias del wizard ────────────────────────────────────────
  const clearWizardTime = useCallback(() => {
    setWizardData((prev) => (prev.reservationTime ? { ...prev, reservationTime: '' } : prev));
    setAvailableTables([]);
    setAvailabilityChecked(false);
  }, []);

  const {
    slots: wizardSlots,
    loading: loadingWizardSlots,
    error: wizardSlotsError,
    retry: retryWizardSlots,
  } = useTimeSlots({
    fetcher: getTimeSlots,
    restaurantId: wizardData.restaurantId,
    date: wizardData.reservationDate,
    partySize: wizardData.partySize,
    onReset: clearWizardTime,
  });

  // ─── Estados del calendario diario ──────────────────────────────────────
  const [viewMode, setViewMode] = useState('table');
  const [calendarDate, setCalendarDate] = useState(() => {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  });
  const [calendarRestaurantId, setCalendarRestaurantId] = useState('');
  const [detailReservation, setDetailReservation] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);

  // ─── Filas de la página actual ─────────────────────────────────────────
  const rows = useMemo(() => pageData?.content ?? [], [pageData]);

  /** Fuerza una recarga del listado y de las cifras tras crear, editar o borrar. */
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  const fetchRestaurantsList = useCallback(async () => {
    setLoadingRestaurants(true);
    setRestaurantsLoadError(null);
    try {
      const data = await getRestaurants();
      setRestaurants(Array.isArray(data) ? data : []);
    } catch (err) {
      setRestaurants([]);
      setRestaurantsLoadError(getErrorMessage(err));
    } finally {
      setLoadingRestaurants(false);
    }
  }, []);

  const fetchCustomers = useCallback(async () => {
    setLoadingCustomers(true);
    setCustomersLoadError(null);
    try {
      // getCustomers devuelve un sobre paginado desde que el listado de clientes
      // pasó a paginar en servidor. Aquí solo alimenta el desplegable del
      // formulario, así que se pide el tamaño máximo que admite el backend; si
      // el cliente no aparece, el asistente tiene alta rápida.
      const data = await getCustomers({ size: 100, sort: 'name', direction: 'asc' });
      setCustomers(Array.isArray(data?.content) ? data.content : []);
    } catch (err) {
      setCustomers([]);
      setCustomersLoadError(getErrorMessage(err));
    } finally {
      setLoadingCustomers(false);
    }
  }, []);

  // Inicialización de los selectores (restaurantes y clientes del formulario).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchRestaurantsList();
    fetchCustomers();
  }, [fetchRestaurantsList, fetchCustomers]);

  // ─── Retardo del buscador ──────────────────────────────────────────────
  // Búsqueda y página se actualizan en el mismo render para que salga una sola
  // petición, no dos.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchQuery.trim());
      setPage(0);
    }, 350);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  // ─── Carga de la página ────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getReservations({
          page,
          size,
          view,
          search,
          restaurantId: filterRestaurantId || undefined,
          status: filterStatus || undefined,
          date: filterDate || undefined,
          sort: sortField,
          direction: sortDirection,
        });
        if (cancelled) return;

        // Si la página actual se ha quedado vacía tras borrar, se retrocede.
        if (data.content.length === 0 && data.totalElements > 0 && page > 0) {
          setPage((p) => Math.max(0, Math.min(p - 1, data.totalPages - 1)));
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
    return () => { cancelled = true; };
  }, [page, size, view, search, filterRestaurantId, filterStatus, filterDate,
      sortField, sortDirection, refreshKey]);

  // ─── Cifras del panel ──────────────────────────────────────────────────
  // No dependen de la vista ni de los filtros: si dependieran, los números
  // cambiarían al pulsar una pestaña y dejarían de servir de referencia.
  useEffect(() => {
    let cancelled = false;

    const loadStats = async () => {
      setStatsLoading(true);
      try {
        const data = await getReservationStats({ restaurantId: filterRestaurantId || undefined });
        if (!cancelled) setStats(data);
      } catch {
        // Las cifras son informativas: si fallan, la tabla sigue sirviendo.
        if (!cancelled) setStats(null);
      } finally {
        if (!cancelled) setStatsLoading(false);
      }
    };

    loadStats();
    return () => { cancelled = true; };
  }, [filterRestaurantId, refreshKey]);

  // ─── Cargar mesas cuando cambia restaurantId en el FORMULARIO ──────────
  useEffect(() => {
    const restaurantIdNum = Number(formData.restaurantId);
    if (!restaurantIdNum) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTables([]);
      return;
    }
    const fetchTables = async () => {
      setLoadingTables(true);
      setTablesLoadError(null);
      try {
        const data = await getTablesByRestaurant(restaurantIdNum);
        setTables(Array.isArray(data) ? data : []);
      } catch (err) {
        setTables([]);
        setTablesLoadError(getErrorMessage(err));
      } finally {
        setLoadingTables(false);
      }
    };
    fetchTables();
  }, [formData.restaurantId]);

  // ─── Limpiar mensajes ──────────────────────────────────────────────────
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(''), 4000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  const [changingStatus, setChangingStatus] = useState(null); // id de la reserva sobre la que se actúa

  // Aquí vivían el filtrado local, las cuatro cifras y las listas de cada
  // pestaña, todas derivadas de la lista completa. Ahora las calcula el
  // servidor: al paginar, derivarlas del navegador habría pasado a contar y
  // filtrar solo la página visible.

  /** Cambia de vista volviendo a la primera página y soltando filtros que ya no aplican. */
  const handleViewChange = (nextView) => {
    if (nextView === view) return;
    setView(nextView);
    setPage(0);
    if (!VIEWS_WITH_FILTERS.includes(nextView)) {
      // En las vistas que ya fijan el estado, arrastrar estos filtros dejaría
      // la tabla vacía sin que se vea por qué.
      setFilterStatus('');
      setFilterDate('');
    }
  };

  /** Ordena por un campo; repetir el mismo campo invierte el sentido. */
  const handleSort = (field) => {
    if (field === sortField) {
      setSortDirection((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
    setPage(0);
  };

  /** Hay algún filtro puesto: distingue «no hay nada» de «no hay resultados». */
  const hasFilters = Boolean(filterRestaurantId || filterStatus || filterDate || search);

  /** Qué decir cuando la vista está vacía sin filtros de por medio. */
  const emptyViewMessage = {
    solicitudes: 'No hay solicitudes pendientes por gestionar.',
    hoy: 'No hay reservas confirmadas para hoy.',
    proximas: 'No hay reservas confirmadas próximas.',
    historial: 'Todavía no hay reservas en el historial.',
    todas: 'No hay reservas registradas.',
  }[view];

  /** Cabecera pulsable con indicador de sentido. */
  const sortableHeader = (field, label, extraClass = '') => {
    const isActive = sortField === field;
    return (
      <th className={`is-sortable ${extraClass}`.trim()} aria-sort={isActive ? (sortDirection === 'asc' ? 'ascending' : 'descending') : 'none'}>
        <button type="button" className="sort-button" onClick={() => handleSort(field)}>
          {label}
          <span className="sort-indicator" aria-hidden="true">
            {isActive ? (sortDirection === 'asc' ? '▲' : '▼') : '↕'}
          </span>
        </button>
      </th>
    );
  };

  // ─── Helpers de formato ────────────────────────────────────────────────
  const formatDate = (dateStr) => {
    if (!dateStr) return '—';
    const isoDate = String(dateStr).substring(0, 10);
    const d = new Date(`${isoDate}T12:00:00`);
    if (isNaN(d.getTime())) return isoDate;
    return d.toLocaleDateString('es-ES', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
    });
  };

  const formatTime = (timeStr) => {
    if (!timeStr) return '—';
    return String(timeStr).substring(0, 5);
  };

  const getCustomerName = (r) => {
    // Intentar con r.customer (objeto embebido) o r.customerName
    const c = r.customer;
    if (c) {
      if (c.name) return c.name;
      if (c.firstName && c.lastName) return `${c.firstName} ${c.lastName}`;
      if (c.firstName) return c.firstName;
    }
    if (r.customerName) return r.customerName;
    return `Cliente #${r.customerId || '?'}`;
  };

  const getTableLabel = (r) => {
    const t = r.diningTable || r.table;
    if (t) {
      const parts = [];
      if (t.tableNumber) parts.push(`Mesa ${t.tableNumber}`);
      if (t.location) parts.push(t.location);
      if (t.capacity) parts.push(`${t.capacity} pers.`);
      return parts.join(' · ') || `Mesa #${t.id || r.diningTableId}`;
    }
    if (r.diningTableId) {
      return `Mesa #${r.diningTableId}`;
    }
    return 'Pendiente de asignar';
  };

  const getRestaurantName = (r) => {
    // Intentar con objeto embebido r.restaurant
    const rest = r.restaurant;
    if (rest && rest.name) return rest.name;

    // Buscar en la lista local de restaurantes
    if (r.restaurantId && restaurants.length > 0) {
      const found = restaurants.find((res) => String(res.id) === String(r.restaurantId));
      if (found && found.name) return found.name;
    }

    return r.restaurantId
      ? 'No disponible'
      : '—';
  };

  // ─── Render badge de estado ────────────────────────────────────────────
  const renderStatusBadge = (status) => {
    const cfg = STATUS_MAP[status] || {
      label: status || '—',
    };
    const cssClass = (status || '').toLowerCase();
    return <span className={`badge-status ${cssClass}`}>{cfg.label}</span>;
  };

  // ─── Render acciones de fila ───────────────────────────────────────────
  /**
   * Acciones de una fila, para el menú de tres puntos.
   *
   * Recoge lo que antes estaba repartido en una hilera de iconos sin etiqueta y
   * un desplegable de Bootstrap manipulado a mano por el DOM. Los cambios de
   * estado respetan la misma matriz de transiciones que valida el backend: los
   * estados finales no admiten salida.
   */
  const buildActions = (r) => {
    if (!r) return [];

    const items = [
      {
        key: 'detalle',
        label: 'Ver detalles',
        onSelect: () => handleOpenDetail(r),
      },
    ];

    const esFinal = ['CANCELLED', 'COMPLETED', 'NO_SHOW'].includes(r.status);

    if (canAccess(user, PERMISSIONS.MANAGE_RESERVATIONS)) {
      items.push({
        key: 'editar',
        label: 'Editar reserva',
        onSelect: () => handleOpenEdit(r),
      });
    }

    if (!esFinal) {
      // Transiciones permitidas por el backend desde cada estado.
      const permitidas = r.status === 'PENDING'
        ? ['CONFIRMED', 'CANCELLED']
        : ['CANCELLED', 'COMPLETED', 'NO_SHOW'];

      permitidas.forEach((estado, indice) => {
        items.push({
          key: `estado-${estado}`,
          label: `Marcar como ${STATUS_MAP[estado]?.label?.toLowerCase() || estado}`,
          separatorBefore: indice === 0,
          disabled: changingStatus === r.id,
          onSelect: () => handleStatusChange(r, estado),
        });
      });
    }

    if (canAccess(user, PERMISSIONS.MANAGE_RESERVATIONS)) {
      items.push({
        key: 'eliminar',
        label: 'Eliminar reserva',
        danger: true,
        separatorBefore: true,
        onSelect: () => handleOpenDelete(r),
      });
    }

    return items;
  };

  // ─── Handlers del modal de formulario ──────────────────────────────────
  const handleOpenCreate = () => {
    // Abrir wizard multi-paso en lugar del modal tradicional
    const preselected = restaurants.find((r) => String(r.id) === String(filterRestaurantId));
    setWizardData({
      ...INITIAL_WIZARD,
      restaurantId: filterRestaurantId || '',
      restaurantName: preselected?.name || '',
    });
    setWizardStep(0);
    setWizardError('');
    setWizardSubmitting(false);
    setAvailableTables([]);
    setAvailabilityChecked(false);
    setWizardSuccess(false);
    setShowQuickCustomer(false);
    setQuickCustomerSuccess(false);
    setShowWizard(true);
  };

  const handleOpenEdit = (reservation) => {
    if (!reservation) return;

    setEditingReservation(reservation);
    setFormData({
      customerId: reservation.customerId ?? '',
      restaurantId: reservation.restaurantId ?? '',
      diningTableId: reservation.diningTableId ?? '',
      reservationDate: reservation.reservationDate
        ? String(reservation.reservationDate).substring(0, 10)
        : '',
      reservationTime: reservation.reservationTime
        ? String(reservation.reservationTime).substring(0, 5)
        : '',
      partySize: reservation.partySize ?? '2',
      notes: reservation.notes || '',
      status: reservation.status || 'PENDING',
    });
    setFormErrors({});
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setEditingReservation(null);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
  };

  const handleFormChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));

    // Limpiar mesa si cambia el restaurante
    if (name === 'restaurantId') {
      setFormData((prev) => ({ ...prev, diningTableId: '' }));
    }

    if (formErrors[name]) {
      setFormErrors((prev) => {
        const updated = { ...prev };
        delete updated[name];
        return updated;
      });
    }
  };

  // ─── Handlers del Wizard ──────────────────────────────────────────────
  const handleWizardChange = (field, value) => {
    setWizardData((prev) => ({ ...prev, [field]: value }));
    setWizardError('');
    // Si cambia restaurante, reiniciar mesas disponibles
    if (field === 'restaurantId') {
      setAvailableTables([]);
      setAvailabilityChecked(false);
      setWizardData((prev) => ({ ...prev, selectedTable: null }));
      const restaurant = restaurants.find((r) => String(r.id) === String(value));
      setWizardData((prev) => ({ ...prev, restaurantName: restaurant?.name || '' }));
    }
  };

  const canGoNext = (step) => {
    switch (step) {
      case 0: return !!wizardData.restaurantId;
      case 1: {
        const ps = Number(wizardData.partySize);
        return !!wizardData.reservationDate
          && !!wizardData.reservationTime
          && ps >= 1 && Number.isInteger(ps);
      }
      case 2: return !!wizardData.selectedTable;
      case 3: return !!wizardData.customerId;
      default: return false;
    }
  };

  const handleNextStep = () => {
    if (wizardStep === 1 && !availabilityChecked) {
      checkAvailability();
      return;
    }
    if (wizardStep < WIZARD_STEPS.length - 1) {
      setWizardStep((s) => s + 1);
    }
  };

  const handlePrevStep = () => {
    if (wizardStep > 0) {
      setWizardStep((s) => s - 1);
      setWizardError('');
    }
  };

  // ─── Check availability ──────────────────────────────────────────────
  const checkAvailability = async () => {
    setCheckingAvailability(true);
    setWizardError('');
    setAvailableTables([]);

    const payload = {
      restaurantId: Number(wizardData.restaurantId),
      date: wizardData.reservationDate,
      time: `${String(wizardData.reservationTime).substring(0, 5)}:00`,
      partySize: Number(wizardData.partySize),
    };

    try {
      const res = await api.post('/availability/tables', payload);
      const body = res.data;
      let tables;
      if (Array.isArray(body)) {
        tables = body;
      } else if (body?.data && Array.isArray(body.data)) {
        tables = body.data;
      } else if (body?.content && Array.isArray(body.content)) {
        tables = body.content;
      } else if (body?.tables && Array.isArray(body.tables)) {
        tables = body.tables;
      } else {
        throw new Error('El servidor devolvió un formato de disponibilidad inesperado.');
      }

      // El endpoint devuelve tableId (no id): normalizar para que funcionen
      // la selección, las keys de React y el diningTableId del payload.
      const normalizedTables = tables.map((t) => ({ ...t, id: t.id ?? t.tableId }));

      setAvailableTables(normalizedTables);
      setAvailabilityChecked(true);
      setWizardStep(2);

      if (tables.length === 0) {
        setWizardError('No hay mesas disponibles para los criterios seleccionados.');
      }
    } catch (err) {
      const msg = err?.message || 'Error al verificar disponibilidad.';
      setWizardError(msg);
    } finally {
      setCheckingAvailability(false);
    }
  };

  // ─── Seleccionar mesa en wizard ──────────────────────────────────────
  const handleSelectTable = (table) => {
    setWizardData((prev) => ({ ...prev, selectedTable: table }));
    setWizardError('');
  };

  // ─── Alta rápida de cliente desde el wizard ───────────────────────────
  const handleQuickCustomerCreated = async (customer) => {
    setCustomers((prev) => {
      if (prev.some((c) => c.id === customer.id)) return prev;
      return [...prev, customer];
    });
    handleWizardChange('customerId', String(customer.id));
    setShowQuickCustomer(false);
    setQuickCustomerSuccess(true);
    await fetchCustomers();
  };

  // ─── Cerrar wizard ───────────────────────────────────────────────────
  const handleCloseWizard = () => {
    setShowWizard(false);
    setWizardStep(0);
    setWizardData({ ...INITIAL_WIZARD });
    setWizardError('');
    setAvailableTables([]);
    setAvailabilityChecked(false);
    setWizardSuccess(false);
    setShowQuickCustomer(false);
    setQuickCustomerSuccess(false);
  };

  // ─── Confirmar y crear reserva ───────────────────────────────────────
  const handleConfirmReservation = async () => {
    if (!wizardData.selectedTable || !wizardData.customerId) return;

    setWizardSubmitting(true);
    setWizardError('');

    try {
      const payload = {
        customerId: Number(wizardData.customerId),
        diningTableId: Number(wizardData.selectedTable.id),
        restaurantId: Number(wizardData.restaurantId),
        reservationDate: wizardData.reservationDate,
        reservationTime: `${String(wizardData.reservationTime).substring(0, 5)}:00`,
        partySize: Number(wizardData.partySize),
        notes: (wizardData.notes || '').trim(),
        status: 'CONFIRMED',
      };

      await createReservation(payload);
      setWizardSuccess(true);
      refresh();
    } catch (err) {
      const msg = err?.message || 'Error al crear la reserva.';
      setWizardError(msg);
    } finally {
      setWizardSubmitting(false);
    }
  };

  // ─── Handlers del detalle modal ────────────────────────────────────────
  const handleOpenDetail = (reservation) => {
    setDetailReservation(reservation);
    setShowDetailModal(true);
  };

  const handleCloseDetail = () => {
    setDetailReservation(null);
    setShowDetailModal(false);
  };

  // ─── Calendario: consulta propia por día ───────────────────────────────
  // Antes filtraba en el navegador la lista completa. Un día es un volumen
  // acotado por naturaleza, así que se pide sin paginar.
  const [calendarData, setCalendarData] = useState([]);
  const [calendarLoading, setCalendarLoading] = useState(false);

  useEffect(() => {
    if (viewMode !== 'calendar' || !calendarDate) return undefined;
    let cancelled = false;

    const loadDay = async () => {
      setCalendarLoading(true);
      try {
        const data = await getReservationsByDate({
          date: calendarDate,
          restaurantId: calendarRestaurantId || undefined,
        });
        if (!cancelled) setCalendarData(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setCalendarData([]);
      } finally {
        if (!cancelled) setCalendarLoading(false);
      }
    };

    loadDay();
    return () => { cancelled = true; };
  }, [viewMode, calendarDate, calendarRestaurantId, refreshKey]);

  const groupedByHour = useMemo(() => {
    const groups = {};
    calendarData.forEach((r) => {
      const hour = r.reservationTime ? String(r.reservationTime).substring(0, 5) : '00:00';
      if (!groups[hour]) groups[hour] = [];
      groups[hour].push(r);
    });
    // Ordenar horas cronológicamente
    const sorted = Object.keys(groups).sort((a, b) => a.localeCompare(b));
    return sorted.map((hour) => ({
      hour,
      reservations: groups[hour].sort((a, b) => {
        const tA = a.reservationTime || '';
        const tB = b.reservationTime || '';
        return tA.localeCompare(tB);
      }),
    }));
  }, [calendarData]);

  // ─── Validar formulario ────────────────────────────────────────────────
  const validateForm = () => {
    const errors = {};

    if (!formData.customerId) {
      errors.customerId = 'El cliente es obligatorio.';
    }
    if (!formData.restaurantId) {
      errors.restaurantId = 'El restaurante es obligatorio.';
    }
    if (!formData.diningTableId) {
      errors.diningTableId = 'La mesa es obligatoria.';
    }
    if (!formData.reservationDate) {
      errors.reservationDate = 'La fecha es obligatoria.';
    }
    if (!formData.reservationTime) {
      errors.reservationTime = 'La hora es obligatoria.';
    }
    const partySize = Number(formData.partySize);
    if (!formData.partySize || partySize < 1 || !Number.isInteger(partySize)) {
      errors.partySize = 'Debe ser un número entero mayor a 0.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  // ─── Guardar (crear o actualizar) ──────────────────────────────────────
  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;

    setSubmitting(true);

    try {
      const basePayload = {
        customerId: Number(formData.customerId),
        restaurantId: Number(formData.restaurantId),
        diningTableId: Number(formData.diningTableId),
        reservationDate: formData.reservationDate,
        reservationTime: `${String(formData.reservationTime).substring(0, 5)}:00`,
        partySize: Number(formData.partySize),
        notes: (formData.notes || '').trim(),
      };

      if (editingReservation) {
        // El backend ignora "status" en el PUT: el estado solo cambia vía
        // el menú "Cambiar estado" (PATCH /reservations/{id}/status).
        await updateReservation(editingReservation.id, basePayload);
        setSuccessMessage('Reserva actualizada correctamente.');
      } else {
        await createReservation({ ...basePayload, status: formData.status || 'PENDING' });
        setSuccessMessage('Reserva creada correctamente.');
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

  // ─── Handlers de eliminar ──────────────────────────────────────────────
  const handleOpenDelete = (reservation) => {
    if (!reservation) return;
    setDeletingReservation(reservation);
    setShowDeleteModal(true);
  };

  const handleConfirmDelete = async () => {
    if (!deletingReservation) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteReservation(deletingReservation.id);
      setSuccessMessage('Reserva eliminada correctamente.');
      setShowDeleteModal(false);
      setDeletingReservation(null);
      refresh();
    } catch (err) {
      setError(getErrorMessage(err));
      setShowDeleteModal(false);
      setDeletingReservation(null);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Handler de cambio de estado ───────────────────────────────────────
  const handleStatusChange = async (reservation, newStatus) => {
    if (!reservation || !newStatus) return;
    if (reservation.status === newStatus) return;
    if (changingStatus === reservation.id) return;

    setChangingStatus(reservation.id);
    try {
      const updated = await updateReservationStatus(reservation.id, newStatus);

      if (newStatus === 'CONFIRMED') {
        // Verificar si el backend indica que el cliente no tiene email
        const hasEmail = !(
          updated?.customerEmail === null ||
          updated?.customerEmail === undefined ||
          updated?.customerEmail === '' ||
          updated?.emailSent === false ||
          updated?.notificationSent === false
        );
        setSuccessMessage(
          hasEmail
            ? 'Reserva confirmada. El cliente será notificado.'
            : 'Reserva confirmada, pero el cliente no tiene email registrado.'
        );
      } else if (newStatus === 'CANCELLED') {
        const hasEmail = !(
          updated?.customerEmail === null ||
          updated?.customerEmail === undefined ||
          updated?.customerEmail === ''
        );
        setSuccessMessage(
          hasEmail
            ? 'Reserva rechazada. El cliente será notificado.'
            : 'Reserva rechazada. El cliente no tiene email registrado, no se le notificará.'
        );
      } else {
        setSuccessMessage(`Estado actualizado a "${STATUS_MAP[newStatus]?.label || newStatus}".`);
      }

      refresh();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setChangingStatus(null);
    }
  };

  // ─── Verificar si hay clientes ─────────────────────────────────────────
  const noCustomers = !loadingCustomers && !customersLoadError && customers.length === 0;

  // ─── Render ────────────────────────────────────────────────────────────
  return (
    <div>
      {/* ═══ Page Header ═══════════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <h1>Reservas</h1>
          <p className="page-description">
            Gestiona todas las reservas del restaurante
          </p>
        </div>

        <div className="d-flex align-items-center gap-2" style={{ flexShrink: 0 }}>
          {/* Toggle vista: Lista / Calendario */}
          <div className="view-toggle" role="tablist" aria-label="Cambiar vista">
            <button
              className={`view-toggle-btn ${viewMode === 'table' ? 'active' : ''}`}
              onClick={() => setViewMode('table')}
              type="button"
              role="tab"
              aria-selected={viewMode === 'table'}
              title="Vista tabla"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                <line x1="3" y1="9" x2="21" y2="9" />
                <line x1="3" y1="15" x2="21" y2="15" />
                <line x1="9" y1="3" x2="9" y2="21" />
              </svg>
              Lista
            </button>
            <button
              className={`view-toggle-btn ${viewMode === 'calendar' ? 'active' : ''}`}
              onClick={() => setViewMode('calendar')}
              type="button"
              role="tab"
              aria-selected={viewMode === 'calendar'}
              title="Vista calendario diario"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                <line x1="16" y1="2" x2="16" y2="6" />
                <line x1="8" y1="2" x2="8" y2="6" />
                <line x1="3" y1="10" x2="21" y2="10" />
                <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01" />
              </svg>
              Calendario
            </button>
          </div>

          <button
            className="btn btn-primary d-flex align-items-center gap-2"
            onClick={handleOpenCreate}
            type="button"
            title="Nueva reserva"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="12" y1="5" x2="12" y2="19" />
              <line x1="5" y1="12" x2="19" y2="12" />
            </svg>
            Nueva Reserva
          </button>
        </div>
      </div>

      {customersLoadError && (
        <div className="alert alert-warning d-flex justify-content-between align-items-center">
          <span>No se pudieron cargar los clientes: {customersLoadError}</span>
          <button type="button" className="btn btn-sm btn-outline-secondary" onClick={fetchCustomers}>
            Reintentar
          </button>
        </div>
      )}


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

      {/* ═══ Pestañas: cada una es una consulta al servidor ════════════════ */}
      <div className="reservations-tabs" role="tablist" aria-label="Cambiar vista de reservas">
        {VIEWS.map((v) => {
          const count = stats ? stats[v.countKey] : null;
          return (
            <button
              key={v.value}
              className={`reservations-tab ${view === v.value ? 'active' : ''}`}
              onClick={() => handleViewChange(v.value)}
              type="button"
              role="tab"
              aria-selected={view === v.value}
              aria-controls="reservations-panel"
            >
              {v.label}
              {!statsLoading && count > 0 && (
                <span className="reservations-tab-badge">{count}</span>
              )}
            </button>
          );
        })}
      </div>

      {/* ═══ Barra de herramientas ═════════════════════════════════════════ */}
      <div className="table-toolbar">
        <div className="table-search">
          <label htmlFor="reservation-search" className="visually-hidden">
            Buscar reservas
          </label>
          <input
            id="reservation-search"
            type="search"
            className="form-control form-control-sm"
            placeholder="Buscar por cliente, email o mesa…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>

        <div className="d-flex flex-wrap align-items-center gap-3">
          <div className="d-flex align-items-center gap-2">
            <label htmlFor="filter-restaurant" className="form-label mb-0 text-nowrap text-muted small fw-medium">
              Restaurante:
            </label>
            <select
              id="filter-restaurant"
              className="form-select form-select-sm"
              style={{ minWidth: '160px' }}
              value={filterRestaurantId}
              onChange={(e) => {
                setFilterRestaurantId(e.target.value);
                setPage(0);
              }}
              aria-label="Filtrar por restaurante"
            >
              <option value="">Todos</option>
              {restaurants.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name || 'No disponible'}
                </option>
              ))}
            </select>
          </div>

          {/* Estado y fecha solo donde no los fija ya la vista. */}
          {VIEWS_WITH_FILTERS.includes(view) && (
            <>
              <div className="d-flex align-items-center gap-2">
                <label htmlFor="filter-status" className="form-label mb-0 text-nowrap text-muted small fw-medium">
                  Estado:
                </label>
                <select
                  id="filter-status"
                  className="form-select form-select-sm"
                  style={{ minWidth: '140px' }}
                  value={filterStatus}
                  onChange={(e) => {
                    setFilterStatus(e.target.value);
                    setPage(0);
                  }}
                  aria-label="Filtrar por estado"
                >
                  <option value="">Todos</option>
                  {RESERVATION_STATUSES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>

              <div className="d-flex align-items-center gap-2">
                <label htmlFor="filter-date" className="form-label mb-0 text-nowrap text-muted small fw-medium">
                  Fecha:
                </label>
                <input
                  id="filter-date"
                  type="date"
                  className="form-control form-control-sm"
                  style={{ minWidth: '150px' }}
                  value={filterDate}
                  onChange={(e) => {
                    setFilterDate(e.target.value);
                    setPage(0);
                  }}
                  aria-label="Filtrar por fecha"
                />
              </div>
            </>
          )}

          {(filterRestaurantId || filterStatus || filterDate || searchQuery) && (
            <button
              className="btn btn-sm btn-secondary"
              onClick={() => {
                setFilterRestaurantId('');
                setFilterStatus('');
                setFilterDate('');
                setSearchQuery('');
                setPage(0);
              }}
              type="button"
            >
              Limpiar filtros
            </button>
          )}
        </div>
      </div>

      {/* ═══ Datos ═════════════════════════════════════════════════════════ */}
      {!error && (
        <>
          {/* ─── Tarjetas ───────────────────────────────────────────────── */}
          {/* Las calcula el servidor y no dependen de la vista: pulsar una
              pestaña no cambia los números. */}
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-card-icon primary">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{statsLoading ? '—' : (stats?.total ?? 0)}</div>
                <div className="stat-card-label">Total Reservas</div>
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
                <div className="stat-card-value">
                  {statsLoading ? '—' : ((stats?.hoyConfirmadas ?? 0) + (stats?.proximasConfirmadas ?? 0))}
                </div>
                <div className="stat-card-label">Confirmadas</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon warning">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z" />
                  <line x1="12" y1="8" x2="12" y2="12" />
                  <line x1="12" y1="16" x2="12.01" y2="16" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{statsLoading ? '—' : (stats?.pendientes ?? 0)}</div>
                <div className="stat-card-label">Pendientes</div>
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-icon danger">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <line x1="15" y1="9" x2="9" y2="15" />
                  <line x1="9" y1="9" x2="15" y2="15" />
                </svg>
              </div>
              <div className="stat-card-info">
                <div className="stat-card-value">{statsLoading ? '—' : (stats?.canceladasFuturas ?? 0)}</div>
                <div className="stat-card-label">Canceladas</div>
              </div>
            </div>
          </div>

          {viewMode === 'table' ? (
            /* ─── Tabla única, paginada por el servidor ──────────────────── */
            <div
              id="reservations-panel"
              role="tabpanel"
              className={`app-card${loading && !isInitialLoad ? ' is-refreshing' : ''}`}
            >
              {isInitialLoad ? (
                <div className="loading-state">
                  <div className="spinner-border mb-3" role="status" style={{ width: '2.25rem', height: '2.25rem' }}>
                    <span className="visually-hidden">Cargando...</span>
                  </div>
                  <p className="text-muted mb-0">Cargando reservas...</p>
                </div>
              ) : (
                <>
                  <div className="app-table-wrapper">
                    <table className="app-table">
                      <thead>
                        <tr>
                          <th className="col-id">#</th>
                          {sortableHeader('customer', 'Cliente')}
                          <th>Mesa</th>
                          <th>Restaurante</th>
                          {sortableHeader('date', 'Fecha y hora', 'text-nowrap')}
                          {sortableHeader('partySize', 'Personas')}
                          {sortableHeader('status', 'Estado')}
                          <th className="col-actions">Acciones</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? (
                          <tr>
                            <td colSpan={8} className="text-center text-muted py-4">
                              {hasFilters ? (
                                <>
                                  No se encontraron reservas con los filtros actuales.
                                  <button
                                    type="button"
                                    className="btn btn-sm btn-link"
                                    onClick={() => {
                                      setFilterRestaurantId('');
                                      setFilterStatus('');
                                      setFilterDate('');
                                      setSearchQuery('');
                                      setPage(0);
                                    }}
                                  >
                                    Limpiar filtros
                                  </button>
                                </>
                              ) : (
                                emptyViewMessage
                              )}
                            </td>
                          </tr>
                        ) : (
                          rows.map((r, index) => (
                            <tr key={r?.id ?? index}>
                              <td className="col-id">{r?.id ?? index + 1}</td>
                              <td>
                                <div className="cell-primary">{getCustomerName(r)}</div>
                                {r?.customerEmail && (
                                  <div className="cell-secondary">{r.customerEmail}</div>
                                )}
                              </td>
                              <td>{getTableLabel(r)}</td>
                              <td>{getRestaurantName(r)}</td>
                              <td className="text-nowrap">
                                <div className="cell-primary">{formatDate(r.reservationDate)}</div>
                                <div className="cell-secondary">{formatTime(r.reservationTime)}</div>
                              </td>
                              <td>
                                <span className="capacity-badge">
                                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                                    <circle cx="9" cy="7" r="4" />
                                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                  </svg>
                                  {r?.partySize ?? '—'}
                                </span>
                              </td>
                              <td>{renderStatusBadge(r?.status)}</td>
                              <td className="col-actions">
                                <ActionMenu
                                  items={buildActions(r)}
                                  label={`Acciones de la reserva ${r?.id ?? ''}`}
                                />
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>

                  <Pagination
                    page={pageData?.page ?? 0}
                    size={size}
                    totalElements={pageData?.totalElements ?? 0}
                    totalPages={pageData?.totalPages ?? 0}
                    sizeOptions={PAGE_SIZE_OPTIONS}
                    itemLabel="reservas"
                    disabled={loading}
                    onPageChange={setPage}
                    onSizeChange={(nuevoTamano) => {
                      setSize(nuevoTamano);
                      setPage(0);
                    }}
                  />
                </>
              )}
            </div>
          ) : (
            /* ─── Calendario Diario ─────────────────────────────── */
            <div className="res-calendar">
              {/* Selectores del calendario */}
              <div className="res-calendar-toolbar">
                <div className="res-calendar-nav">
                  <button
                    className="res-calendar-nav-btn"
                    onClick={() => {
                      const d = new Date(`${calendarDate}T12:00:00`);
                      d.setDate(d.getDate() - 1);
                      const y = d.getFullYear();
                      const m = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      setCalendarDate(`${y}-${m}-${day}`);
                    }}
                    type="button"
                    title="Día anterior"
                    aria-label="Día anterior"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="15 18 9 12 15 6" /></svg>
                  </button>
                  <input
                    type="date"
                    className="form-control form-control-sm"
                    value={calendarDate}
                    onChange={(e) => setCalendarDate(e.target.value)}
                    style={{ maxWidth: '170px', fontSize: '0.8125rem' }}
                    aria-label="Seleccionar fecha"
                  />
                  <button
                    className="res-calendar-nav-btn"
                    onClick={() => {
                      const d = new Date(`${calendarDate}T12:00:00`);
                      d.setDate(d.getDate() + 1);
                      const y = d.getFullYear();
                      const m = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      setCalendarDate(`${y}-${m}-${day}`);
                    }}
                    type="button"
                    title="Día siguiente"
                    aria-label="Día siguiente"
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="9 18 15 12 9 6" /></svg>
                  </button>
                  <button
                    className="res-calendar-today-btn"
                    onClick={() => {
                      const d = new Date();
                      const y = d.getFullYear();
                      const m = String(d.getMonth() + 1).padStart(2, '0');
                      const day = String(d.getDate()).padStart(2, '0');
                      setCalendarDate(`${y}-${m}-${day}`);
                    }}
                    type="button"
                    title="Ir a hoy"
                    aria-label="Ir a hoy"
                  >
                    Hoy
                  </button>
                </div>

                <div className="res-calendar-filter">
                  <select
                    className="form-select form-select-sm"
                    value={calendarRestaurantId}
                    onChange={(e) => setCalendarRestaurantId(e.target.value)}
                    style={{ minWidth: '160px', fontSize: '0.8125rem' }}
                    aria-label="Filtrar calendario por restaurante"
                  >
                    <option value="">Todos los restaurantes</option>
                    {restaurants.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name || 'No disponible'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Timeline */}
              {calendarLoading ? (
                <div className="loading-state">
                  <div className="spinner-border mb-3" role="status" style={{ width: '2.25rem', height: '2.25rem' }}>
                    <span className="visually-hidden">Cargando...</span>
                  </div>
                  <p className="text-muted mb-0">Cargando el día...</p>
                </div>
              ) : groupedByHour.length === 0 ? (
                <div className="res-calendar-empty">
                  <div className="res-calendar-empty-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                      <line x1="16" y1="2" x2="16" y2="6" />
                      <line x1="8" y1="2" x2="8" y2="6" />
                      <line x1="3" y1="10" x2="21" y2="10" />
                    </svg>
                  </div>
                  <p>No hay reservas para esta fecha</p>
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {new Date(calendarDate + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                  </span>
                </div>
              ) : (
                <div className="res-calendar-timeline">
                  {groupedByHour.map((group) => (
                    <div key={group.hour} className="res-calendar-hour-group">
                      <div className="res-calendar-hour-label">
                        <span className="res-calendar-hour-time">{group.hour}</span>
                        <span className="res-calendar-hour-line" />
                      </div>
                      <div className="res-calendar-hour-cards">
                        {group.reservations.map((r) => (
                          <div
                            key={r.id}
                            className={`res-calendar-card ${(r.status || '').toLowerCase()}`}
                            onClick={() => handleOpenDetail(r)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleOpenDetail(r); } }}
                            title="Ver detalle de reserva"
                          >
                            <div className="res-calendar-card-header">
                              <span className="res-calendar-card-table">
                                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                                  <path d="M9 3v18" />
                                </svg>
                                {getTableLabel(r)}
                              </span>
                              {renderStatusBadge(r.status)}
                            </div>
                            <div className="res-calendar-card-body">
                              <span className="res-calendar-card-client">{getCustomerName(r)}</span>
                              <span className="res-calendar-card-meta">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                  <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                  <circle cx="12" cy="7" r="4" />
                                </svg>
                                {r.partySize || '?'} {r.partySize === 1 ? 'persona' : 'personas'}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* ═══ Modal: Detalle de Reserva (desde calendario) ════════════════ */}
      {showDetailModal && detailReservation && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered" style={{ maxWidth: '480px' }}>
            <div className="modal-content" style={{ borderRadius: 'var(--radius-lg)', border: 'none' }}>
              <div className="modal-header border-0 pb-0" style={{ padding: '1.25rem 1.5rem 0' }}>
                <h5 className="modal-title fw-bold" style={{ fontSize: '1.05rem' }}>Detalle de Reserva</h5>
                <button type="button" className="btn-close" onClick={handleCloseDetail} aria-label="Cerrar" />
              </div>
              <div className="modal-body" style={{ padding: '1.25rem 1.5rem' }}>
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <span style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>#{detailReservation.id || '—'}</span>
                  {renderStatusBadge(detailReservation.status)}
                </div>

                <div className="res-detail-grid">
                  <div className="res-detail-item">
                    <span className="res-detail-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                        <circle cx="12" cy="7" r="4" />
                      </svg>
                      Cliente
                    </span>
                    <span className="res-detail-value">{getCustomerName(detailReservation)}</span>
                  </div>

                  <div className="res-detail-item">
                    <span className="res-detail-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                        <polyline points="9 22 9 12 15 12 15 22" />
                      </svg>
                      Restaurante
                    </span>
                    <span className="res-detail-value">{getRestaurantName(detailReservation)}</span>
                  </div>

                  <div className="res-detail-item">
                    <span className="res-detail-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
                        <path d="M9 3v18" />
                      </svg>
                      Mesa
                    </span>
                    <span className="res-detail-value">{getTableLabel(detailReservation)}</span>
                  </div>

                  <div className="res-detail-item">
                    <span className="res-detail-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
                        <line x1="16" y1="2" x2="16" y2="6" />
                        <line x1="8" y1="2" x2="8" y2="6" />
                        <line x1="3" y1="10" x2="21" y2="10" />
                      </svg>
                      Fecha
                    </span>
                    <span className="res-detail-value">{formatDate(detailReservation.reservationDate)}</span>
                  </div>

                  <div className="res-detail-item">
                    <span className="res-detail-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <circle cx="12" cy="12" r="10" />
                        <polyline points="12 6 12 12 16 14" />
                      </svg>
                      Hora
                    </span>
                    <span className="res-detail-value">{formatTime(detailReservation.reservationTime)}</span>
                  </div>

                  <div className="res-detail-item">
                    <span className="res-detail-label">
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                        <circle cx="9" cy="7" r="4" />
                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                      </svg>
                      Personas
                    </span>
                    <span className="res-detail-value">{detailReservation.partySize || '—'}</span>
                  </div>

                  {detailReservation.holdStatus === 'ACTIVE' && (
                    <div className="res-detail-item">
                      <span className="res-detail-label">Bloqueo de mesa</span>
                      <span className="res-detail-value">
                        Activo hasta {new Date(detailReservation.holdExpiresAt).toLocaleString('es-ES')}
                      </span>
                    </div>
                  )}
                </div>

                {detailReservation.notes && (
                  <div className="mt-3 pt-3" style={{ borderTop: '1px solid var(--border)' }}>
                    <span className="res-detail-label d-block mb-1">Notas</span>
                    <p className="mb-0" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>{detailReservation.notes}</p>
                  </div>
                )}
              </div>
              <div className="modal-footer border-0 pt-0" style={{ padding: '0 1.5rem 1.25rem' }}>
                <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handleCloseDetail}>Cerrar</button>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => { handleCloseDetail(); handleOpenEdit(detailReservation); }}>
                  Editar reserva
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal: Crear / Editar ══════════════════════════════════════════ */}
      {showModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">
                  {editingReservation ? 'Editar Reserva' : 'Nueva Reserva'}
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

                  {/* Sin clientes */}
                  {noCustomers && (
                    <div className="alert alert-warning py-2" role="alert">
                      No hay clientes disponibles. Cree un cliente antes de registrar una reserva.
                    </div>
                  )}

                  <div className="row g-3">
                    {/* Cliente */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="res-customer" className="form-label">
                        Cliente <span className="text-danger">*</span>
                      </label>
                      <select
                        id="res-customer"
                        className={`form-select ${formErrors.customerId ? 'is-invalid' : ''}`}
                        name="customerId"
                        value={formData.customerId}
                        onChange={handleFormChange}
                        required
                        disabled={loadingCustomers || noCustomers}
                      >
                        <option value="">Seleccionar cliente...</option>
                        {customers.map((c) => {
                          const label = c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || `Cliente #${c.id}`;
                          return (
                            <option key={c.id} value={c.id}>
                              {label}
                            </option>
                          );
                        })}
                      </select>
                      {formErrors.customerId && (
                        <div className="invalid-feedback">{formErrors.customerId}</div>
                      )}
                    </div>

                    {/* Restaurante */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="res-restaurant" className="form-label">
                        Restaurante <span className="text-danger">*</span>
                      </label>
                      <select
                        id="res-restaurant"
                        className={`form-select ${formErrors.restaurantId ? 'is-invalid' : ''}`}
                        name="restaurantId"
                        value={formData.restaurantId}
                        onChange={handleFormChange}
                        required
                        disabled={loadingRestaurants}
                      >
                        <option value="">Seleccionar restaurante...</option>
                        {restaurants.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name || 'No disponible'}
                          </option>
                        ))}
                      </select>
                      {formErrors.restaurantId && (
                        <div className="invalid-feedback">{formErrors.restaurantId}</div>
                      )}
                    </div>

                    {/* Mesa (depende del restaurante) */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="res-table" className="form-label">
                        Mesa <span className="text-danger">*</span>
                      </label>
                      <select
                        id="res-table"
                        className={`form-select ${formErrors.diningTableId ? 'is-invalid' : ''}`}
                        name="diningTableId"
                        value={formData.diningTableId}
                        onChange={handleFormChange}
                        required
                        disabled={!formData.restaurantId || loadingTables}
                      >
                        <option value="">
                          {!formData.restaurantId
                            ? 'Primero seleccione un restaurante'
                            : loadingTables
                              ? 'Cargando mesas...'
                              : tables.length === 0
                                ? 'No hay mesas disponibles'
                                : 'Seleccionar mesa...'}
                        </option>
                        {tables.map((t) => {
                          const label = [
                            `Mesa ${t.tableNumber || t.id}`,
                            t.location,
                            t.capacity ? `${t.capacity} pers.` : '',
                          ]
                            .filter(Boolean)
                            .join(' · ');
                          return (
                            <option key={t.id} value={t.id}>
                              {label}
                            </option>
                          );
                        })}
                      </select>
                      {formErrors.diningTableId && (
                        <div className="invalid-feedback">{formErrors.diningTableId}</div>
                      )}
                    </div>

                    {/* Estado */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="res-status" className="form-label">Estado</label>
                      <select
                        id="res-status"
                        className="form-select"
                        name="status"
                        value={formData.status}
                        onChange={handleFormChange}
                        aria-label="Estado de la reserva"
                        disabled={!!editingReservation}
                      >
                        {(editingReservation ? RESERVATION_STATUSES : RESERVATION_STATUSES.filter((s) => s.value === 'PENDING' || s.value === 'CONFIRMED')).map((s) => (
                          <option key={s.value} value={s.value}>
                            {s.label}
                          </option>
                        ))}
                      </select>
                      <div className="form-text">
                        {editingReservation
                          ? 'El estado se cambia desde el menú "Cambiar estado" de la tabla.'
                          : 'Una reserva solo puede crearse como Pendiente o Confirmada.'}
                      </div>
                    </div>

                    {/* Fecha */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="res-date" className="form-label">
                        Fecha <span className="text-danger">*</span>
                      </label>
                      <input
                        id="res-date"
                        type="date"
                        className={`form-control ${formErrors.reservationDate ? 'is-invalid' : ''}`}
                        name="reservationDate"
                        value={formData.reservationDate}
                        onChange={handleFormChange}
                        required
                      />
                      {formErrors.reservationDate && (
                        <div className="invalid-feedback">{formErrors.reservationDate}</div>
                      )}
                    </div>

                    {/* Hora */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="res-time" className="form-label">
                        Hora <span className="text-danger">*</span>
                      </label>
                      <input
                        id="res-time"
                        type="time"
                        className={`form-control ${formErrors.reservationTime ? 'is-invalid' : ''}`}
                        name="reservationTime"
                        value={formData.reservationTime}
                        onChange={handleFormChange}
                        required
                      />
                      {formErrors.reservationTime && (
                        <div className="invalid-feedback">{formErrors.reservationTime}</div>
                      )}
                    </div>

                    {/* Número de personas */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="res-party" className="form-label">
                        N° Personas <span className="text-danger">*</span>
                      </label>
                      <input
                        id="res-party"
                        type="number"
                        className={`form-control ${formErrors.partySize ? 'is-invalid' : ''}`}
                        name="partySize"
                        value={formData.partySize}
                        onChange={handleFormChange}
                        placeholder="Ej: 2"
                        min="1"
                        step="1"
                        required
                      />
                      {formErrors.partySize && (
                        <div className="invalid-feedback">{formErrors.partySize}</div>
                      )}
                    </div>

                    {/* Notas */}
                    <div className="col-12 col-md-6">
                      <label htmlFor="res-notes" className="form-label">Notas</label>
                      <input
                        id="res-notes"
                        type="text"
                        className="form-control"
                        name="notes"
                        value={formData.notes}
                        onChange={handleFormChange}
                        placeholder="Opcional: alérgenos, celebración, etc."
                      />
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
                    disabled={submitting || noCustomers}
                  >
                    {submitting && (
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    )}
                    {editingReservation ? 'Actualizar Reserva' : 'Crear Reserva'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal: Wizard de Nueva Reserva ═══════════════════════════════ */}
      {showWizard && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.6)', zIndex: 1060 }}>
          <div className="modal-dialog modal-dialog-centered modal-lg" style={{ maxWidth: wizardSuccess ? '480px' : '720px' }}>
            <div className="modal-content" style={{ borderRadius: '16px', border: 'none', boxShadow: '0 25px 60px rgba(0,0,0,0.3)' }}>
              {/* ─── Header ─────────────────────────────────────────────── */}
              <div className="modal-header border-0 pb-0 pt-4 px-4" style={{ position: 'relative' }}>
                {!wizardSuccess && (
                  <>
                    <h5 className="modal-title fw-bold" style={{ fontSize: '1.25rem' }}>
                      {wizardStep === 3 ? 'Confirmar Reserva' : 'Nueva Reserva'}
                    </h5>
                    <button type="button" className="btn-close" onClick={handleCloseWizard} aria-label="Cerrar" disabled={wizardSubmitting} />
                  </>
                )}
              </div>

              <div className="modal-body px-4 py-3">
                {wizardSuccess ? (
                  /* ─── Éxito ───────────────────────────────── */
                  <div className="text-center py-4">
                    <div className="mb-3" style={{ width: 64, height: 64, borderRadius: '50%', background: 'var(--success-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto' }}>
                      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    </div>
                    <h5 className="fw-bold mb-2">Reserva Creada</h5>
                    <p className="mb-1" style={{ color: 'var(--text-secondary)' }}>
                      {wizardData.restaurantName || 'Restaurante'}
                    </p>
                    <p className="mb-3" style={{ color: 'var(--text-secondary)' }}>
                      {wizardData.reservationDate} a las {String(wizardData.reservationTime).substring(0, 5)} &middot; {wizardData.partySize} {wizardData.partySize === '1' ? 'persona' : 'personas'}
                    </p>
                    <div className="d-flex gap-2 justify-content-center">
                      <button className="btn btn-outline-secondary" onClick={handleCloseWizard}>Cerrar</button>
                      <button className="btn btn-primary" onClick={() => { handleCloseWizard(); handleOpenCreate(); }}>Nueva Reserva</button>
                    </div>
                  </div>
                ) : (
                  <>
                    {/* ─── Progress Steps ──────────────────────────────── */}
                    <div className="wizard-steps d-flex justify-content-between mb-4" style={{ position: 'relative', padding: '0 8px' }}>
                      <div style={{ position: 'absolute', top: '20px', left: '24px', right: '24px', height: '2px', background: 'var(--border)', zIndex: 0 }}>
                        <div style={{ height: '100%', width: `${(wizardStep / (WIZARD_STEPS.length - 1)) * 100}%`, background: 'var(--primary)', transition: 'width 0.4s ease', borderRadius: '2px' }} />
                      </div>
                      {WIZARD_STEPS.map((step, idx) => {
                        const isActive = idx <= wizardStep;
                        const isCurrent = idx === wizardStep;
                        return (
                          <div key={step.id} className="d-flex flex-column align-items-center" style={{ zIndex: 1, cursor: 'default', width: '60px' }}>
                            <div
                              style={{
                                width: '40px', height: '40px', borderRadius: '50%',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontWeight: 700, fontSize: '0.85rem',
                                background: isActive ? 'var(--primary)' : 'var(--hover-color)',
                                color: isActive ? '#fff' : 'var(--text-secondary)',
                                border: isCurrent ? '3px solid var(--primary-hover)' : 'none',
                                transition: 'all 0.3s ease',
                              }}
                            >
                              {step.id}
                            </div>
                            <span style={{
                              fontSize: '0.65rem', marginTop: '6px', textAlign: 'center',
                              fontWeight: isCurrent ? 600 : 400,
                              color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                              lineHeight: 1.2, maxWidth: '72px',
                            }}>
                              {step.title}
                            </span>
                          </div>
                        );
                      })}
                    </div>

                    {/* ─── Error ────────────────────────────────────────── */}
                    {wizardError && (
                      <div className="alert alert-danger py-2 small" role="alert">
                        {wizardError}
                      </div>
                    )}

                    {/* ─── Step Content ─────────────────────────────────── */}
                    <div style={{ minHeight: '260px' }}>
                      {/* Step 0: Restaurante */}
                      {wizardStep === 0 && (
                        <div>
                          <h6 className="fw-semibold mb-3">Selecciona el restaurante</h6>
                          <div className="row g-3">
                            {restaurants.length === 0 ? (
                              <div className="col-12 text-center py-4" style={{ color: 'var(--text-secondary)' }}>
                                <p className="mb-2">No hay restaurantes disponibles.</p>
                                <Link to="/restaurants" className="btn btn-sm btn-outline-primary">Ir a Restaurantes</Link>
                              </div>
                            ) : (
                              restaurants.map((r) => {
                                const selected = String(r.id) === String(wizardData.restaurantId);
                                return (
                                  <div key={r.id} className="col-sm-6">
                                    <div
                                      className="wizard-card-option"
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleWizardChange('restaurantId', String(r.id)); } }}
                                      onClick={() => handleWizardChange('restaurantId', String(r.id))}
                                      style={{
                                        padding: '16px', borderRadius: '12px', cursor: 'pointer',
                                        border: selected ? '2px solid var(--primary)' : '2px solid var(--border)',
                                        background: selected ? 'var(--primary-light)' : 'var(--bg-card)',
                                        transition: 'all 0.2s ease',
                                      }}
                                    >
                                      <div className="d-flex align-items-center gap-3">
                                        <div style={{
                                          width: 44, height: 44, borderRadius: '10px',
                                          background: selected ? 'var(--primary)' : 'var(--hover-color)',
                                          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                                        }}>
                                          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke={selected ? '#fff' : 'var(--text-secondary)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                                            <polyline points="9 22 9 12 15 12 15 22" />
                                          </svg>
                                        </div>
                                        <div>
                                          <div className="fw-semibold" style={{ fontSize: '0.95rem' }}>{r.name || 'No disponible'}</div>
                                          <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                            {r.address || r.city || r.phone || ''}
                                          </div>
                                        </div>
                                      </div>
                                    </div>
                                  </div>
                                );
                              })
                            )}
                          </div>
                        </div>
                      )}

                      {/* Step 1: Fecha y Hora */}
                      {wizardStep === 1 && (
                        <div>
                          <h6 className="fw-semibold mb-3">¿Cuándo será la reserva?</h6>
                          <div className="row g-4">
                            <div className="col-md-6">
                              <label className="form-label fw-medium" htmlFor="wizardDate">Fecha</label>
                              <input
                                id="wizardDate"
                                type="date"
                                className="form-control form-control-lg"
                                value={wizardData.reservationDate}
                                min={getLocalTodayString()}
                                onChange={(e) => handleWizardChange('reservationDate', e.target.value)}
                              />
                            </div>
                          </div>
                          {wizardData.reservationDate && (
                            <p className="mt-3 small" style={{ color: 'var(--text-secondary)' }}>
                              {new Date(wizardData.reservationDate + 'T12:00:00').toLocaleDateString('es-ES', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}
                            </p>
                          )}

                          <h6 className="fw-semibold mb-3 mt-4">Número de comensales</h6>
                          <div className="d-flex align-items-center gap-3 mb-4" style={{ maxWidth: '320px' }}>
                            <button
                              type="button"
                              className="btn btn-outline-secondary"
                              style={{ width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => {
                                const v = Math.max(1, Number(wizardData.partySize) - 1);
                                handleWizardChange('partySize', String(v));
                              }}
                              disabled={Number(wizardData.partySize) <= 1}
                            >
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="5" y1="12" x2="19" y2="12" /></svg>
                            </button>
                            <div style={{ fontSize: '2.5rem', fontWeight: 700, minWidth: '60px', textAlign: 'center', color: 'var(--primary)' }}>
                              {wizardData.partySize}
                            </div>
                            <button
                              type="button"
                              className="btn btn-outline-secondary"
                              style={{ width: 48, height: 48, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
                              onClick={() => {
                                const v = Math.min(20, Number(wizardData.partySize) + 1);
                                handleWizardChange('partySize', String(v));
                              }}
                              disabled={Number(wizardData.partySize) >= 20}
                            >
                              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>
                            </button>
                          </div>
                          <div style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
                            {Number(wizardData.partySize) === 1 ? '1 persona' : `${wizardData.partySize} personas`}
                            {Number(wizardData.partySize) > 8 && ' — Recomendamos contactar al restaurante para grupos grandes.'}
                          </div>

                          <div className="mb-3">
                            <label className="form-label" htmlFor="wizardTime">Hora</label>
                            <TimeSlotSelector
                              slots={wizardSlots}
                              value={wizardData.reservationTime}
                              onChange={(time) => handleWizardChange('reservationTime', time)}
                              loading={loadingWizardSlots}
                              error={wizardSlotsError}
                              onRetry={retryWizardSlots}
                              disabled={!wizardData.reservationDate}
                            />
                          </div>
                        </div>
                      )}

                      {/* Step 2: Seleccionar Mesa */}
                      {wizardStep === 2 && (
                        <div>
                          <h6 className="fw-semibold mb-3">
                            {checkingAvailability ? 'Verificando disponibilidad...' : 'Selecciona una mesa disponible'}
                          </h6>
                          {checkingAvailability ? (
                            <div className="text-center py-5">
                              <div className="spinner-border" role="status" style={{ color: 'var(--primary)' }}>
                                <span className="visually-hidden">Verificando...</span>
                              </div>
                              <p className="mt-2 small" style={{ color: 'var(--text-secondary)' }}>Buscando mesas disponibles...</p>
                            </div>
                          ) : availableTables.length === 0 ? (
                            <div className="text-center py-4">
                              <p style={{ color: 'var(--text-secondary)' }}>No hay mesas disponibles.</p>
                              <button className="btn btn-outline-secondary btn-sm" onClick={() => { setAvailabilityChecked(false); setWizardStep(1); }}>
                                Cambiar fecha / hora
                              </button>
                            </div>
                          ) : (
                            <div className="row g-3" style={{ maxHeight: '280px', overflowY: 'auto' }}>
                              {availableTables.map((table) => {
                                const selected = wizardData.selectedTable?.id === table.id;
                                const capacity = table.capacity || table.numberOfSeats || 0;
                                return (
                                  <div key={table.id} className="col-sm-6">
                                    <div
                                      className="wizard-card-option"
                                      role="button"
                                      tabIndex={0}
                                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleSelectTable(table); } }}
                                      onClick={() => handleSelectTable(table)}
                                      style={{
                                        padding: '14px', borderRadius: '12px', cursor: 'pointer',
                                        border: selected ? '2px solid var(--primary)' : '2px solid var(--border)',
                                        background: selected ? 'var(--primary-light)' : 'var(--bg-card)',
                                        transition: 'all 0.2s ease',
                                      }}
                                    >
                                      <div className="d-flex align-items-center justify-content-between">
                                        <div className="d-flex align-items-center gap-3">
                                          <div style={{
                                            width: 44, height: 44, borderRadius: '10px',
                                            background: selected ? 'var(--primary)' : 'var(--hover-color)',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            fontSize: '1.1rem',
                                          }}>
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={selected ? '#fff' : 'var(--text-secondary)'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                              <circle cx="5" cy="6" r="2"/>
                                              <circle cx="19" cy="6" r="2"/>
                                              <path d="M3 12h18"/>
                                              <path d="M5 12v6"/>
                                              <path d="M19 12v6"/>
                                              <path d="M9 12v6"/>
                                              <path d="M15 12v6"/>
                                            </svg>
                                          </div>
                                          <div>
                                            <div className="fw-semibold" style={{ fontSize: '0.9rem' }}>
                                              Mesa {table.tableNumber || `#${table.id}`}
                                            </div>
                                            <div style={{ fontSize: '0.8rem', color: 'var(--text-secondary)' }}>
                                              Capacidad: {capacity} {capacity === 1 ? 'persona' : 'personas'}
                                            </div>
                                          </div>
                                        </div>
                                        {selected && (
                                          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--primary)" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Step 3: Confirmar */}
                      {wizardStep === 3 && (
                        <div>
                          <h6 className="fw-semibold mb-3">Cliente y resumen</h6>

                          {/* Seleccionar cliente */}
                          <div className="mb-3">
                            <div className="d-flex justify-content-between align-items-center">
                              <label className="form-label fw-medium mb-0">Cliente</label>
                              {!showQuickCustomer && (
                                <button
                                  type="button"
                                  className="btn btn-link btn-sm p-0"
                                  onClick={() => { setQuickCustomerSuccess(false); setShowQuickCustomer(true); }}
                                >
                                  + Nuevo cliente
                                </button>
                              )}
                            </div>
                            <select
                              className={`form-select ${wizardData.customerId ? 'is-valid' : ''}`}
                              value={wizardData.customerId}
                              onChange={(e) => {
                                handleWizardChange('customerId', e.target.value);
                                setQuickCustomerSuccess(false);
                              }}
                            >
                              <option value="">Seleccionar cliente...</option>
                              {customers.map((c) => (
                                <option key={c.id} value={String(c.id)}>
                                  {c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim() || `Cliente #${c.id}`}
                                </option>
                              ))}
                            </select>
                            {customers.length === 0 && !showQuickCustomer && (
                              <p className="mt-2 small" style={{ color: 'var(--warning-text)' }}>
                                No hay clientes registrados. Usa &quot;+ Nuevo cliente&quot; para crear el primero.
                              </p>
                            )}
                            {quickCustomerSuccess && (
                              <p className="mt-2 small" style={{ color: 'var(--success)' }}>
                                Cliente creado correctamente.
                              </p>
                            )}
                          </div>

                          {showQuickCustomer && (
                            <QuickCustomerForm
                              restaurantId={wizardData.restaurantId}
                              onCreated={handleQuickCustomerCreated}
                              onCancel={() => setShowQuickCustomer(false)}
                            />
                          )}

                          {/* Notas */}
                          <div className="mb-3">
                            <label className="form-label fw-medium">Notas (opcional)</label>
                            <textarea
                              className="form-control"
                              rows="2"
                              value={wizardData.notes}
                              onChange={(e) => handleWizardChange('notes', e.target.value)}
                              placeholder="Alergias, preferencias, ocasión especial..."
                              style={{ fontSize: '0.9rem' }}
                            />
                          </div>

                          {/* Resumen */}
                          <div className="p-3 rounded-3" style={{ background: 'var(--bg-body)', border: '1px solid var(--border)' }}>
                            <h6 className="fw-semibold mb-2" style={{ fontSize: '0.85rem', color: 'var(--text-secondary)' }}>RESUMEN DE LA RESERVA</h6>
                            <table style={{ width: '100%', fontSize: '0.9rem' }}>
                              <tbody>
                                <tr>
                                  <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Restaurante</td>
                                  <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 500 }}>{wizardData.restaurantName}</td>
                                </tr>
                                <tr>
                                  <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Fecha</td>
                                  <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 500 }}>
                                    {new Date(wizardData.reservationDate + 'T12:00:00').toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' })}
                                  </td>
                                </tr>
                                <tr>
                                  <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Hora</td>
                                  <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 500 }}>{String(wizardData.reservationTime).substring(0, 5)}</td>
                                </tr>
                                <tr>
                                  <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Comensales</td>
                                  <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 500 }}>{wizardData.partySize}</td>
                                </tr>
                                <tr>
                                  <td style={{ padding: '4px 0', color: 'var(--text-secondary)' }}>Mesa</td>
                                  <td style={{ padding: '4px 0', textAlign: 'right', fontWeight: 500 }}>
                                    Mesa {wizardData.selectedTable?.tableNumber || `#${wizardData.selectedTable?.id}`}
                                    {wizardData.selectedTable && ` (Cap. ${wizardData.selectedTable.capacity || wizardData.selectedTable.numberOfSeats || '?'})`}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* ─── Footer / Navigation ─────────────────────────── */}
                    <div className="d-flex justify-content-between align-items-center mt-4 pt-3 border-top">
                      <div>
                        {wizardStep > 0 && (
                          <button type="button" className="btn btn-outline-secondary btn-sm" onClick={handlePrevStep} disabled={wizardSubmitting}>
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="me-1"><polyline points="15 18 9 12 15 6" /></svg>
                            Volver
                          </button>
                        )}
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <span style={{ fontSize: '0.75rem', color: 'var(--text-secondary)' }}>
                          Paso {wizardStep + 1} de {WIZARD_STEPS.length}
                        </span>
                        {wizardStep === WIZARD_STEPS.length - 1 ? (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleConfirmReservation}
                            disabled={!canGoNext(3) || wizardSubmitting}
                          >
                            {wizardSubmitting ? (
                              <>
                                <span className="spinner-border spinner-border-sm me-1" role="status" />
                                Creando...
                              </>
                            ) : 'Confirmar y Crear'}
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="btn btn-primary"
                            onClick={handleNextStep}
                            disabled={!canGoNext(wizardStep) || checkingAvailability}
                          >
                            {checkingAvailability ? (
                              <>
                                <span className="spinner-border spinner-border-sm me-1" role="status" />
                                Verificando...
                              </>
                            ) : wizardStep === 1 ? 'Buscar Mesas' : 'Continuar'}
                          </button>
                        )}
                        {!wizardSubmitting && (
                          <button type="button" className="btn btn-light btn-sm" onClick={handleCloseWizard}>Cancelar</button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal: Confirmar Eliminación ════════════════════════════════════ */}
      {showDeleteModal && deletingReservation && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header border-0">
                <h5 className="modal-title">Confirmar Eliminación</h5>
                <button type="button" className="btn-close" onClick={() => setShowDeleteModal(false)} aria-label="Cerrar" />
              </div>
              <div className="modal-body text-center py-4">
                <div className="mb-3">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <h6 className="mb-2">¿Estás seguro de eliminar esta reserva?</h6>
                <p className="text-muted mb-0">
                  Cliente: <strong>{getCustomerName(deletingReservation)}</strong>
                </p>
                <p className="text-muted small mt-2 mb-0">
                  Esta acción no se puede deshacer.
                </p>
              </div>
              <div className="modal-footer border-0 justify-content-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary px-4"
                  onClick={() => setShowDeleteModal(false)}
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

export default Reservations;
