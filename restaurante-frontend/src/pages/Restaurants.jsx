import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { canAccess, PERMISSIONS } from '../config/permissions';
import { createRestaurant, deleteRestaurant } from '../services/restaurantService';
import {
  getAdminRestaurants,
  getAdminRestaurantStats,
  PAGE_SIZE_OPTIONS,
  DEFAULT_PAGE_SIZE,
} from '../services/adminRestaurantService';
import QRModal from '../components/QRModal';
import RestaurantInfoForm from '../components/RestaurantInfoForm';
import RestaurantDetailModal from '../components/RestaurantDetailModal';
import ActionMenu from '../components/ActionMenu';
import Pagination from '../components/Pagination';

// ─── Estado inicial del formulario ───────────────────────────────────────
const INITIAL_FORM = {
  name: '',
  address: '',
  phone: '',
  email: '',
  description: '',
  openingTime: '',
  closingTime: '',
  capacity: '',
  defaultReservationDurationMinutes: '',
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

// ─── Helpers ─────────────────────────────────────────────────────────────

const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

const publicLinkFor = (restaurant) =>
  restaurant?.id ? `${window.location.origin}/public/reservar/${restaurant.id}` : '';

const sanitizeFileName = (name) => {
  const base = (name || 'restaurante')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // eliminar tildes
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `qr-${base || 'restaurante'}.png`;
};

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' });
};

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

// ─── Iconos del menú de acciones ─────────────────────────────────────────
const iconProps = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
};

const IconEye = () => (
  <svg {...iconProps}>
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const IconSettings = () => (
  <svg {...iconProps}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
  </svg>
);

const IconExternal = () => (
  <svg {...iconProps}>
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" />
    <line x1="10" y1="14" x2="21" y2="3" />
  </svg>
);

const IconCopy = () => (
  <svg {...iconProps}>
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </svg>
);

const IconQR = () => (
  <svg {...iconProps}>
    <rect x="3" y="3" width="7" height="7" rx="1" />
    <rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <rect x="14" y="14" width="7" height="7" rx="1" />
  </svg>
);

const IconDownload = () => (
  <svg {...iconProps}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
    <polyline points="7 10 12 15 17 10" />
    <line x1="12" y1="15" x2="12" y2="3" />
  </svg>
);

const IconTrash = () => (
  <svg {...iconProps}>
    <polyline points="3 6 5 6 21 6" />
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
  </svg>
);

/** Flecha del indicador de ordenación. */
const SortArrow = ({ direction }) => (
  <svg className="sort-indicator" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {direction === 'desc' ? <polyline points="6 9 12 15 18 9" /> : <polyline points="6 15 12 9 18 15" />}
  </svg>
);

// ─── Componente principal ────────────────────────────────────────────────
const Restaurants = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const canManage = canAccess(user, PERMISSIONS.MANAGE_RESTAURANTS);

  // Consulta al backend: página, tamaño, texto y orden.
  const [page, setPage] = useState(0);
  const [size, setSize] = useState(DEFAULT_PAGE_SIZE);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState('name');
  const [direction, setDirection] = useState('asc');
  const [refreshKey, setRefreshKey] = useState(0);

  // Datos y estado de la vista
  const [pageData, setPageData] = useState(EMPTY_PAGE);
  const [loading, setLoading] = useState(true);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [error, setError] = useState(null);
  const [successMessage, setSuccessMessage] = useState('');

  // Métricas
  const [stats, setStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(true);

  // Modales
  const [showModal, setShowModal] = useState(false);
  const [formData, setFormData] = useState(INITIAL_FORM);
  const [submitting, setSubmitting] = useState(false);
  const [formErrors, setFormErrors] = useState({});

  const [deletingRestaurant, setDeletingRestaurant] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const [detailRestaurant, setDetailRestaurant] = useState(null);
  const [qrRestaurant, setQRRestaurant] = useState(null);
  const [qrDownloadingId, setQRDownloadingId] = useState(null);

  const restaurants = useMemo(
    () => (Array.isArray(pageData.content) ? pageData.content : []),
    [pageData]
  );

  // ─── Debounce del buscador ────────────────────────────────────────────
  // Cambiar el texto vuelve a la primera página, pero conserva orden y tamaño.
  // Ambos estados se actualizan juntos para que solo se lance UNA consulta.
  useEffect(() => {
    const timer = setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(0);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // ─── Cargar la página ─────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const data = await getAdminRestaurants({ page, size, search, sort, direction });
        if (cancelled) return;

        // La página pedida puede haberse quedado vacía (por ejemplo, al borrar
        // el último elemento): se retrocede en vez de mostrar una tabla vacía.
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
  }, [page, size, search, sort, direction, refreshKey]);

  // ─── Cargar métricas ──────────────────────────────────────────────────
  // Vienen de una consulta agregada del backend: no se derivan de la página.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setStatsLoading(true);
      try {
        const data = await getAdminRestaurantStats();
        if (!cancelled) setStats(data);
      } catch {
        // Un fallo de métricas no debe tapar la tabla: se dejan en blanco.
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

  // ─── Limpiar mensajes de éxito ────────────────────────────────────────
  useEffect(() => {
    if (!successMessage) return undefined;
    const timer = setTimeout(() => setSuccessMessage(''), 4000);
    return () => clearTimeout(timer);
  }, [successMessage]);

  const refresh = useCallback(() => setRefreshKey((key) => key + 1), []);

  // ─── Ordenación ───────────────────────────────────────────────────────
  const handleSort = (field) => {
    if (sort === field) {
      setDirection((prev) => (prev === 'asc' ? 'desc' : 'asc'));
    } else {
      setSort(field);
      setDirection('asc');
    }
    setPage(0);
  };

  const sortableHeader = (field, label, extraClass = '') => {
    const isSorted = sort === field;
    return (
      <th
        className={`is-sortable${isSorted ? ' is-sorted' : ''}${extraClass ? ` ${extraClass}` : ''}`}
        aria-sort={isSorted ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button type="button" className="sort-button" onClick={() => handleSort(field)}>
          <span>{label}</span>
          <SortArrow direction={isSorted ? direction : 'asc'} />
        </button>
      </th>
    );
  };

  // ─── Formulario de creación ───────────────────────────────────────────
  const handleOpenCreate = () => {
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
    setShowModal(true);
  };

  const handleCloseModal = () => {
    setShowModal(false);
    setFormData({ ...INITIAL_FORM });
    setFormErrors({});
  };

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

    const name = (formData.name || '').trim();
    const address = (formData.address || '').trim();
    const email = (formData.email || '').trim();
    const capacity = formData.capacity;

    if (!name) errors.name = 'El nombre es obligatorio.';
    if (!address) errors.address = 'La dirección es obligatoria.';
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      errors.email = 'Correo electrónico no válido.';
    }
    if (
      capacity !== '' &&
      capacity !== null &&
      capacity !== undefined &&
      (Number(capacity) < 0 || !Number.isInteger(Number(capacity)))
    ) {
      errors.capacity = 'La capacidad debe ser un número entero positivo.';
    }

    const duration = formData.defaultReservationDurationMinutes;
    if (
      duration !== '' &&
      duration !== null &&
      duration !== undefined &&
      (!Number.isInteger(Number(duration)) || Number(duration) < 15 || Number(duration) > 480)
    ) {
      errors.defaultReservationDurationMinutes =
        'La duración debe ser un número entero entre 15 y 480 minutos.';
    }

    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!validateForm()) return;
    if (submitting) return;

    setSubmitting(true);
    setFormErrors({});

    try {
      const payload = {
        name: (formData.name || '').trim(),
        address: (formData.address || '').trim(),
        phone: (formData.phone || '').trim(),
        email: (formData.email || '').trim(),
        description: (formData.description || '').trim(),
        openingTime: formData.openingTime
          ? `${String(formData.openingTime).substring(0, 5)}:00`
          : null,
        closingTime: formData.closingTime
          ? `${String(formData.closingTime).substring(0, 5)}:00`
          : null,
        capacity:
          formData.capacity !== '' && formData.capacity !== null
            ? Number(formData.capacity)
            : null,
        defaultReservationDurationMinutes:
          formData.defaultReservationDurationMinutes !== '' &&
          formData.defaultReservationDurationMinutes !== null
            ? Number(formData.defaultReservationDurationMinutes)
            : null,
      };

      await createRestaurant(payload);
      setSuccessMessage('Restaurante creado correctamente.');
      handleCloseModal();
      refresh();
    } catch (err) {
      setFormErrors({ submit: getErrorMessage(err) });
    } finally {
      setSubmitting(false);
    }
  };

  // ─── Eliminación ──────────────────────────────────────────────────────
  const handleConfirmDelete = async () => {
    // La bandera evita que dos clics rápidos lancen dos borrados.
    if (!deletingRestaurant || deleting) return;

    setDeleting(true);
    setError(null);
    try {
      await deleteRestaurant(deletingRestaurant.id);
      setSuccessMessage(`Restaurante «${deletingRestaurant.name || '—'}» eliminado correctamente.`);
      setDeletingRestaurant(null);
      // Solo se recarga la página actual; si se queda vacía, el efecto de carga
      // retrocede a la anterior.
      refresh();
    } catch (err) {
      setError(getErrorMessage(err));
      setDeletingRestaurant(null);
    } finally {
      setDeleting(false);
    }
  };

  // ─── Acciones de enlace y QR ──────────────────────────────────────────
  const handleCopyLink = async (restaurant) => {
    const copied = await copyToClipboard(publicLinkFor(restaurant));
    if (copied) {
      setSuccessMessage('Enlace público copiado al portapapeles.');
    } else {
      setError('No se pudo copiar el enlace. Cópialo manualmente desde el detalle.');
    }
  };

  const handleOpenPublicPage = (restaurant) => {
    const link = publicLinkFor(restaurant);
    if (link) window.open(link, '_blank', 'noopener,noreferrer');
  };

  /**
   * Descarga el QR generándolo en ese momento. El módulo `qrcode` se importa de
   * forma diferida y solo se dibuja un QR: al cargar la pantalla no se genera
   * ninguno.
   */
  const handleDownloadQR = async (restaurant) => {
    if (!restaurant?.id || qrDownloadingId === restaurant.id) return;
    setQRDownloadingId(restaurant.id);

    try {
      const { default: QRCode } = await import('qrcode');
      const dataUrl = await QRCode.toDataURL(publicLinkFor(restaurant), {
        width: 512,
        margin: 2,
        color: { dark: '#1e1e2a', light: '#ffffff' },
      });

      const link = document.createElement('a');
      link.download = sanitizeFileName(restaurant.name);
      link.href = dataUrl;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      setSuccessMessage('Código QR descargado.');
    } catch {
      setError('No se pudo generar el código QR.');
    } finally {
      setQRDownloadingId(null);
    }
  };

  const buildActions = (restaurant) => {
    const actions = [
      {
        key: 'detail',
        label: 'Ver detalles',
        icon: <IconEye />,
        onSelect: () => setDetailRestaurant(restaurant),
      },
    ];

    if (canManage) {
      actions.push({
        key: 'edit',
        label: 'Editar restaurante',
        icon: <IconSettings />,
        onSelect: () => navigate(`/restaurants/${restaurant.id}/configuracion`),
      });
    }

    actions.push(
      {
        key: 'public',
        label: 'Abrir página pública',
        icon: <IconExternal />,
        onSelect: () => handleOpenPublicPage(restaurant),
        separatorBefore: true,
      },
      {
        key: 'copy',
        label: 'Copiar enlace público',
        icon: <IconCopy />,
        onSelect: () => handleCopyLink(restaurant),
      },
      {
        key: 'qr',
        label: 'Ver código QR',
        icon: <IconQR />,
        onSelect: () => setQRRestaurant(restaurant),
      },
      {
        key: 'qr-download',
        label: 'Descargar código QR',
        icon: <IconDownload />,
        onSelect: () => handleDownloadQR(restaurant),
        disabled: qrDownloadingId === restaurant.id,
      }
    );

    if (canManage) {
      actions.push({
        key: 'delete',
        label: 'Eliminar restaurante',
        icon: <IconTrash />,
        onSelect: () => setDeletingRestaurant(restaurant),
        danger: true,
        separatorBefore: true,
      });
    }

    return actions;
  };

  // ─── Estados derivados de la vista ────────────────────────────────────
  const hasSearch = search.length > 0;
  const showEmptyDatabase = !isInitialLoad && !error && pageData.totalElements === 0 && !hasSearch;
  const showNoResults = !loading && !error && restaurants.length === 0 && hasSearch;
  const showTable = !isInitialLoad && !error && !showEmptyDatabase;

  // Filas de esqueleto: reservan el espacio de la tabla en la primera carga.
  const skeletonRows = Array.from({ length: 6 }, (_, i) => i);

  return (
    <div>
      {/* ═══ Page Header ═══════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <h1>Restaurantes</h1>
          <p className="page-description">Gestiona todos los restaurantes registrados</p>
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
              Añadir Restaurante
            </button>
          </div>
        )}
      </div>

      {/* ═══ Mensajes ════════════════════════════════════════════════════ */}
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

      {/* ═══ Tarjetas de resumen ═════════════════════════════════════════ */}
      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-card-icon primary">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
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
                <div className="stat-card-value">{stats?.totalRestaurants ?? '—'}</div>
                <div className="stat-card-label">Total Restaurantes</div>
              </>
            )}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon success">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
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
                <div className="stat-card-value">{stats?.totalCapacity ?? '—'}</div>
                <div className="stat-card-label">Capacidad Total</div>
              </>
            )}
          </div>
        </div>

        <div className="stat-card">
          <div className="stat-card-icon warning">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
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
                <div className="stat-card-value">{stats?.publicBookingEnabledCount ?? '—'}</div>
                <div className="stat-card-label">Con Reservas Online</div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ═══ Carga inicial ═══════════════════════════════════════════════ */}
      {isInitialLoad && !error && (
        <div className="app-card" aria-busy="true">
          <div className="app-table-wrapper">
            <table className="app-table">
              <thead>
                <tr>
                  <th className="col-id">#</th>
                  <th>Restaurante</th>
                  <th>Cuenta</th>
                  <th>Capacidad</th>
                  <th>Reservas online</th>
                  <th>Alta</th>
                  <th className="col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {skeletonRows.map((row) => (
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

      {/* ═══ Sin restaurantes registrados ════════════════════════════════ */}
      {showEmptyDatabase && (
        <div className="app-card">
          <div className="empty-state">
            <div className="empty-state-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                <polyline points="9 22 9 12 15 12 15 22" />
              </svg>
            </div>
            <h5>No hay restaurantes registrados</h5>
            <p>Crea tu primer restaurante para empezar a gestionar tu negocio.</p>
            {canManage && (
              <button className="btn btn-primary" onClick={handleOpenCreate} type="button">
                Crear Restaurante
              </button>
            )}
          </div>
        </div>
      )}

      {/* ═══ Tabla ═══════════════════════════════════════════════════════ */}
      {showTable && (
        <div className={`app-card${loading ? ' is-refreshing' : ''}`} aria-busy={loading}>
          {/* ─── Buscador ──────────────────────────────────────────────
              Nunca se desmonta al refrescar, así el foco y el texto se
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
                placeholder="Buscar por nombre, email, teléfono, dirección o cuenta…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                aria-label="Buscar restaurantes"
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

            {loading && (
              <span className="d-flex align-items-center gap-2 text-muted" style={{ fontSize: 'var(--text-xs)' }}>
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                Actualizando…
              </span>
            )}
          </div>

          <div className="app-table-wrapper">
            <table className="app-table">
              <thead>
                <tr>
                  {sortableHeader('id', '#', 'col-id')}
                  {sortableHeader('name', 'Restaurante')}
                  <th>Cuenta</th>
                  {sortableHeader('capacity', 'Capacidad')}
                  <th>Reservas online</th>
                  {sortableHeader('createdAt', 'Alta')}
                  <th className="col-actions">Acciones</th>
                </tr>
              </thead>
              <tbody>
                {showNoResults ? (
                  <tr className="no-results">
                    <td colSpan={7}>
                      <div>Ningún restaurante coincide con «{search}».</div>
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm mt-3"
                        onClick={() => setSearchInput('')}
                      >
                        Limpiar búsqueda
                      </button>
                    </td>
                  </tr>
                ) : (
                  restaurants.map((restaurant) => (
                    <tr key={restaurant.id}>
                      <td className="col-id">{restaurant.id}</td>
                      <td>
                        <div className="cell-primary">
                          <span className="cell-primary-title">{restaurant.name || '—'}</span>
                          <span className="cell-primary-meta">
                            {[restaurant.address, restaurant.email].filter(Boolean).join(' · ') || '—'}
                          </span>
                        </div>
                      </td>
                      <td>{restaurant.tenantName || '—'}</td>
                      <td>
                        <span className="capacity-badge">
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                            <circle cx="9" cy="7" r="4" />
                            <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                          </svg>
                          {restaurant.capacity ?? '—'}
                        </span>
                      </td>
                      <td>
                        <span
                          className={`badge-status ${restaurant.publicBookingEnabled ? 'available' : 'maintenance'}`}
                        >
                          {restaurant.publicBookingEnabled ? 'Activas' : 'Desactivadas'}
                        </span>
                      </td>
                      <td className="text-nowrap">{formatDate(restaurant.createdAt)}</td>
                      <td className="col-actions">
                        <div className="d-flex justify-content-end">
                          <ActionMenu
                            items={buildActions(restaurant)}
                            label={`Acciones de ${restaurant.name || 'restaurante'}`}
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
            itemLabel="restaurantes"
            disabled={loading}
            onPageChange={setPage}
            onSizeChange={(newSize) => {
              setSize(newSize);
              setPage(0);
            }}
          />
        </div>
      )}

      {/* ═══ Modal: Crear ════════════════════════════════════════════════ */}
      {showModal && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-lg modal-dialog-scrollable">
            <div className="modal-content">
              <div className="modal-header">
                <h5 className="modal-title">Nuevo Restaurante</h5>
                <button type="button" className="btn-close" onClick={handleCloseModal} aria-label="Cerrar" />
              </div>

              <form onSubmit={handleSubmit} noValidate>
                <div className="modal-body">
                  {formErrors.submit && (
                    <div className="alert alert-danger py-2" role="alert">
                      {formErrors.submit}
                    </div>
                  )}

                  <RestaurantInfoForm
                    formData={formData}
                    formErrors={formErrors}
                    onChange={handleFormChange}
                  />
                </div>

                <div className="modal-footer">
                  <button type="button" className="btn btn-secondary" onClick={handleCloseModal} disabled={submitting}>
                    Cancelar
                  </button>
                  <button type="submit" className="btn btn-primary d-flex align-items-center gap-2" disabled={submitting}>
                    {submitting && (
                      <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                    )}
                    Crear Restaurante
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal: Confirmar eliminación ════════════════════════════════ */}
      {deletingRestaurant && (
        <div className="modal d-block" tabIndex="-1" role="dialog" style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <div className="modal-dialog modal-dialog-centered">
            <div className="modal-content">
              <div className="modal-header border-0">
                <h5 className="modal-title">Confirmar Eliminación</h5>
                <button
                  type="button"
                  className="btn-close"
                  onClick={() => setDeletingRestaurant(null)}
                  disabled={deleting}
                  aria-label="Cerrar"
                />
              </div>
              <div className="modal-body text-center py-4">
                <div className="mb-3">
                  <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke="#ef4444" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                </div>
                <h6 className="mb-2">¿Estás seguro de eliminar este restaurante?</h6>
                <p className="text-muted mb-0">
                  <strong>{deletingRestaurant.name || '—'}</strong>
                </p>
                <p className="text-muted small mt-2 mb-0">Esta acción no se puede deshacer.</p>
              </div>
              <div className="modal-footer border-0 justify-content-center gap-2">
                <button
                  type="button"
                  className="btn btn-secondary px-4"
                  onClick={() => setDeletingRestaurant(null)}
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
                  {deleting && <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />}
                  Eliminar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modal: Detalle ══════════════════════════════════════════════ */}
      {detailRestaurant && (
        <RestaurantDetailModal
          restaurant={detailRestaurant}
          onClose={() => setDetailRestaurant(null)}
          onEdit={
            canManage
              ? () => navigate(`/restaurants/${detailRestaurant.id}/configuracion`)
              : undefined
          }
          onCopyLink={() => handleCopyLink(detailRestaurant)}
          onShowQR={() => setQRRestaurant(detailRestaurant)}
          onDownloadQR={() => handleDownloadQR(detailRestaurant)}
          downloadingQR={qrDownloadingId === detailRestaurant.id}
        />
      )}

      {/* ═══ Modal: QR ═══════════════════════════════════════════════════ */}
      {qrRestaurant && (
        <QRModal restaurant={qrRestaurant} onClose={() => setQRRestaurant(null)} />
      )}
    </div>
  );
};

export default Restaurants;
