import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { getRestaurantById, updateRestaurant } from '../services/restaurantService';
import { getServicePeriods, saveServicePeriods } from '../services/servicePeriodService';
import RestaurantInfoForm from '../components/RestaurantInfoForm';
import ServiceSchedule from '../components/ServiceSchedule';

// ─── Helpers ─────────────────────────────────────────────────────────────────

const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

/** '13:00:00' → '13:00', que es lo que espera un <input type="time">. */
const aHoraCorta = (hora) => (hora ? String(hora).substring(0, 5) : '');

/** '13:00' → '13:00:00', que es lo que espera el backend. */
const aHoraLarga = (hora) => (hora ? `${String(hora).substring(0, 5)}:00` : null);

const aFormulario = (restaurante) => ({
  name: restaurante?.name || '',
  address: restaurante?.address || '',
  phone: restaurante?.phone || '',
  email: restaurante?.email || '',
  description: restaurante?.description || '',
  openingTime: aHoraCorta(restaurante?.openingTime),
  closingTime: aHoraCorta(restaurante?.closingTime),
  capacity: restaurante?.capacity ?? '',
  defaultReservationDurationMinutes: restaurante?.defaultReservationDurationMinutes ?? '',
});

const validarInformacion = (formData) => {
  const errors = {};
  const name = (formData.name || '').trim();
  const address = (formData.address || '').trim();
  const email = (formData.email || '').trim();

  if (!name) errors.name = 'El nombre es obligatorio.';
  if (!address) errors.address = 'La dirección es obligatoria.';
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = 'Correo electrónico no válido.';
  }

  const capacity = formData.capacity;
  if (capacity !== '' && capacity !== null && capacity !== undefined
      && (Number(capacity) < 0 || !Number.isInteger(Number(capacity)))) {
    errors.capacity = 'La capacidad debe ser un número entero positivo.';
  }

  const duration = formData.defaultReservationDurationMinutes;
  if (duration !== '' && duration !== null && duration !== undefined
      && (!Number.isInteger(Number(duration)) || Number(duration) < 15 || Number(duration) > 480)) {
    errors.defaultReservationDurationMinutes =
      'La duración debe ser un número entero entre 15 y 480 minutos.';
  }

  return errors;
};

let contadorClavesPeriodo = 0;
/** Clave estable de React; el backend no la conoce ni la necesita. */
const conClave = (periodo) => {
  contadorClavesPeriodo += 1;
  return { ...periodo, _key: `guardado-${periodo.id ?? contadorClavesPeriodo}` };
};

/** Quita el campo interno _key antes de enviar al backend. */
const aPayloadPeriodos = (periodos) =>
  periodos.map((periodo) => {
    const resto = { ...periodo };
    delete resto._key;
    return { ...resto, name: resto.name?.trim() || null };
  });

// ─── Componente principal ────────────────────────────────────────────────────

const RestaurantSettings = () => {
  const { restaurantId } = useParams();
  const navigate = useNavigate();

  const [restaurante, setRestaurante] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  const [infoForm, setInfoForm] = useState(aFormulario(null));
  const [infoGuardada, setInfoGuardada] = useState(aFormulario(null));
  const [infoErrors, setInfoErrors] = useState({});
  const [guardandoInfo, setGuardandoInfo] = useState(false);
  const [infoExito, setInfoExito] = useState('');

  const [periodos, setPeriodos] = useState([]);
  const [periodosGuardados, setPeriodosGuardados] = useState([]);
  const [guardandoPeriodos, setGuardandoPeriodos] = useState(false);
  const [periodosError, setPeriodosError] = useState('');
  const [periodosExito, setPeriodosExito] = useState('');

  // ─── Carga inicial ─────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelado = false;

    const cargar = async () => {
      setLoading(true);
      setLoadError(null);
      try {
        const [datos, periodosCargados] = await Promise.all([
          getRestaurantById(restaurantId),
          getServicePeriods(restaurantId),
        ]);
        if (cancelado) return;
        if (!datos) {
          setLoadError('Restaurante no encontrado.');
          return;
        }
        setRestaurante(datos);
        setInfoForm(aFormulario(datos));
        setInfoGuardada(aFormulario(datos));
        const conClaves = periodosCargados.map(conClave);
        setPeriodos(conClaves);
        setPeriodosGuardados(conClaves);
      } catch (err) {
        if (!cancelado) setLoadError(getErrorMessage(err));
      } finally {
        if (!cancelado) setLoading(false);
      }
    };

    cargar();
    return () => { cancelado = true; };
  }, [restaurantId]);

  // ─── Cambios sin guardar ───────────────────────────────────────────────────
  const infoSucia = useMemo(
    () => JSON.stringify(infoForm) !== JSON.stringify(infoGuardada),
    [infoForm, infoGuardada]
  );

  const periodosSucios = useMemo(
    () => JSON.stringify(aPayloadPeriodos(periodos)) !== JSON.stringify(aPayloadPeriodos(periodosGuardados)),
    [periodos, periodosGuardados]
  );

  const haySinGuardar = infoSucia || periodosSucios;

  // Avisa al cerrar la pestaña o recargar. Navegar por el menú lateral no queda
  // cubierto: useBlocker exige un data router y la app monta BrowserRouter.
  useEffect(() => {
    if (!haySinGuardar) return undefined;
    const avisar = (e) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', avisar);
    return () => window.removeEventListener('beforeunload', avisar);
  }, [haySinGuardar]);

  const handleInfoChange = useCallback((e) => {
    const { name, value } = e.target;
    setInfoForm((prev) => ({ ...prev, [name]: value }));
    setInfoExito('');
    setInfoErrors((prev) => {
      if (!prev[name]) return prev;
      const siguiente = { ...prev };
      delete siguiente[name];
      return siguiente;
    });
  }, []);

  const handleGuardarInfo = async (e) => {
    e.preventDefault();
    const errores = validarInformacion(infoForm);
    if (Object.keys(errores).length > 0) {
      setInfoErrors(errores);
      return;
    }

    setGuardandoInfo(true);
    setInfoErrors({});
    setInfoExito('');

    try {
      const payload = {
        name: (infoForm.name || '').trim(),
        address: (infoForm.address || '').trim(),
        phone: (infoForm.phone || '').trim(),
        email: (infoForm.email || '').trim(),
        description: (infoForm.description || '').trim(),
        openingTime: aHoraLarga(infoForm.openingTime),
        closingTime: aHoraLarga(infoForm.closingTime),
        capacity: infoForm.capacity !== '' && infoForm.capacity !== null
          ? Number(infoForm.capacity) : null,
        defaultReservationDurationMinutes:
          infoForm.defaultReservationDurationMinutes !== ''
          && infoForm.defaultReservationDurationMinutes !== null
            ? Number(infoForm.defaultReservationDurationMinutes) : null,
      };

      await updateRestaurant(restaurantId, payload);
      setInfoGuardada(infoForm);
      setRestaurante((prev) => ({ ...prev, ...payload }));
      setInfoExito('Datos del restaurante guardados correctamente.');
    } catch (err) {
      setInfoErrors({ submit: getErrorMessage(err) });
    } finally {
      setGuardandoInfo(false);
    }
  };

  const handleCambioPeriodos = useCallback((siguientes) => {
    setPeriodos(siguientes);
    setPeriodosExito('');
    setPeriodosError('');
  }, []);

  const handleGuardarPeriodos = async () => {
    setGuardandoPeriodos(true);
    setPeriodosError('');
    setPeriodosExito('');

    try {
      const guardados = await saveServicePeriods(restaurantId, aPayloadPeriodos(periodos));
      const conClaves = guardados.map(conClave);
      setPeriodos(conClaves);
      setPeriodosGuardados(conClaves);
      setPeriodosExito('Horarios de servicio guardados correctamente.');
    } catch (err) {
      setPeriodosError(getErrorMessage(err));
    } finally {
      setGuardandoPeriodos(false);
    }
  };

  const handleVolver = () => {
    if (haySinGuardar && !window.confirm('Hay cambios sin guardar. ¿Seguro que quieres salir?')) {
      return;
    }
    navigate('/restaurants');
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center py-5">
        <div className="spinner-border mb-3" role="status">
          <span className="visually-hidden">Cargando...</span>
        </div>
        <p style={{ color: 'var(--text-secondary)' }}>Cargando configuración del restaurante...</p>
      </div>
    );
  }

  if (loadError) {
    return (
      <div>
        <div className="alert alert-danger" role="alert">{loadError}</div>
        <button className="btn btn-outline-secondary" onClick={() => navigate('/restaurants')} type="button">
          Volver a Restaurantes
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* ═══ Cabecera ═══════════════════════════════════════════════════════ */}
      <div className="page-header d-flex flex-wrap justify-content-between align-items-start gap-3">
        <div>
          <h1>{restaurante?.name || 'Restaurante'}</h1>
          <p className="page-description">Configuración del restaurante</p>
        </div>
        <div className="page-header-actions">
          <button
            className="btn btn-outline-secondary d-flex align-items-center gap-2"
            onClick={handleVolver}
            type="button"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Volver a Restaurantes
          </button>
        </div>
      </div>

      {/* ═══ Información ════════════════════════════════════════════════════ */}
      <div className="app-card mb-4">
        <div className="app-card-body">
          <h2 className="h5 fw-semibold mb-3">Información</h2>

          {infoErrors.submit && (
            <div className="alert alert-danger py-2" role="alert">{infoErrors.submit}</div>
          )}
          {infoExito && (
            <div className="alert alert-success py-2" role="alert">{infoExito}</div>
          )}

          <form onSubmit={handleGuardarInfo} noValidate>
            <RestaurantInfoForm
              formData={infoForm}
              formErrors={infoErrors}
              onChange={handleInfoChange}
            />

            <div className="d-flex justify-content-end mt-3">
              <button
                type="submit"
                className="btn btn-primary d-flex align-items-center gap-2"
                disabled={!infoSucia || guardandoInfo}
              >
                {guardandoInfo && (
                  <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                )}
                Guardar información
              </button>
            </div>
          </form>
        </div>
      </div>

      {/* ═══ Horarios de servicio ═══════════════════════════════════════════ */}
      <div className="app-card">
        <div className="app-card-body">
          <h2 className="h5 fw-semibold mb-3">Horarios de servicio</h2>

          {periodos.length === 0 && (
            <div className="alert alert-info py-2" role="alert">
              Este restaurante utiliza el horario general ({aHoraCorta(restaurante?.openingTime) || '—'}
              {' – '}{aHoraCorta(restaurante?.closingTime) || '—'}) para todos los días.
              Al añadir el primer servicio, esta configuración pasará a regir la semana completa y los
              días que queden vacíos se considerarán cerrados.
            </div>
          )}

          {periodosError && (
            <div className="alert alert-danger py-2" role="alert">{periodosError}</div>
          )}
          {periodosExito && (
            <div className="alert alert-success py-2" role="alert">{periodosExito}</div>
          )}

          <ServiceSchedule
            periods={periodos}
            onChange={handleCambioPeriodos}
            disabled={guardandoPeriodos}
          />

          <div className="d-flex justify-content-end mt-3">
            <button
              type="button"
              className="btn btn-primary d-flex align-items-center gap-2"
              onClick={handleGuardarPeriodos}
              disabled={!periodosSucios || guardandoPeriodos}
            >
              {guardandoPeriodos && (
                <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
              )}
              Guardar horarios
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default RestaurantSettings;
