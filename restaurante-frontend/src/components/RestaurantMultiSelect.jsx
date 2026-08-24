import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { getAdminRestaurants } from '../services/adminRestaurantService';

/** Cuántos resultados caben en la lista antes de pedir que se afine la búsqueda. */
const RESULTADOS = 10;

/** Retardo del buscador, el mismo que usan los listados. */
const RETARDO_MS = 350;

/**
 * Selector de varios restaurantes con búsqueda en el servidor.
 *
 * Sustituye a la rejilla de casillas que pintaba una por restaurante sobre un
 * catálogo completo de 500: con muchos restaurantes era intransitable. Aquí la
 * búsqueda la resuelve `GET /admin/restaurants`, que pagina y acota al tenant.
 *
 * El valor lleva el nombre además del identificador a propósito: así las
 * etiquetas de lo ya elegido se pintan siempre, aunque ese restaurante no
 * aparezca entre los resultados que se estén mostrando.
 *
 * Está hecho en React y no con el desplegable de Bootstrap porque el proyecto
 * solo carga su CSS, no su JavaScript; es el mismo motivo que en ActionMenu.
 *
 * @param {object} props
 * @param {Array<{id: number, name: string}>} props.value
 * @param {(seleccion: Array<{id: number, name: string}>) => void} props.onChange
 * @param {boolean} [props.disabled]
 * @param {string} [props.id] Identificador del campo de búsqueda.
 */
const RestaurantMultiSelect = ({ value = [], onChange, disabled = false, id }) => {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState('');        // lo que se teclea
  const [busqueda, setBusqueda] = useState('');  // lo que se consulta
  const [resultados, setResultados] = useState([]);
  const [total, setTotal] = useState(0);
  const [cargando, setCargando] = useState(false);
  const [error, setError] = useState(null);
  const [activo, setActivo] = useState(-1);
  const [reintento, setReintento] = useState(0);

  const contenedorRef = useRef(null);
  const campoRef = useRef(null);
  const generado = useId();
  const campoId = id || `restaurant-select-${generado}`;
  const listaId = `${campoId}-lista`;

  const seleccion = useMemo(() => (Array.isArray(value) ? value : []), [value]);
  const idsElegidos = useMemo(
    () => new Set(seleccion.map((r) => Number(r.id))),
    [seleccion]
  );

  // Retardo del buscador: texto y consulta se separan para no pedir en cada tecla.
  useEffect(() => {
    const temporizador = setTimeout(() => setBusqueda(texto.trim()), RETARDO_MS);
    return () => clearTimeout(temporizador);
  }, [texto]);

  // Solo se consulta con la lista abierta: si nadie toca el selector, no se pide nada.
  useEffect(() => {
    if (!abierto) return undefined;
    let cancelado = false;

    const cargar = async () => {
      setCargando(true);
      setError(null);
      try {
        const pagina = await getAdminRestaurants({
          page: 0,
          size: RESULTADOS,
          search: busqueda,
          sort: 'name',
          direction: 'asc',
        });
        if (cancelado) return;
        setResultados(pagina.content);
        setTotal(pagina.totalElements);
        setActivo(pagina.content.length > 0 ? 0 : -1);
      } catch (err) {
        if (!cancelado) {
          setResultados([]);
          setTotal(0);
          setError(err?.message || 'Error al cargar los restaurantes.');
        }
      } finally {
        if (!cancelado) setCargando(false);
      }
    };

    cargar();
    return () => { cancelado = true; };
  }, [abierto, busqueda, reintento]);

  // Cierre por clic fuera, como en ActionMenu: sin esto la lista se queda abierta
  // por encima del resto del formulario.
  useEffect(() => {
    if (!abierto) return undefined;
    const alPulsarFuera = (evento) => {
      if (contenedorRef.current && !contenedorRef.current.contains(evento.target)) {
        setAbierto(false);
      }
    };
    document.addEventListener('mousedown', alPulsarFuera);
    return () => document.removeEventListener('mousedown', alPulsarFuera);
  }, [abierto]);

  const alternar = (restaurante) => {
    const rid = Number(restaurante.id);
    if (idsElegidos.has(rid)) {
      onChange(seleccion.filter((r) => Number(r.id) !== rid));
    } else {
      onChange([...seleccion, { id: rid, name: restaurante.name }]);
    }
  };

  const quitar = (rid) => onChange(seleccion.filter((r) => Number(r.id) !== Number(rid)));

  const alTeclear = (evento) => {
    if (evento.key === 'Escape') {
      evento.preventDefault();
      setAbierto(false);
      campoRef.current?.focus();
      return;
    }
    if (evento.key === 'ArrowDown' || evento.key === 'ArrowUp') {
      evento.preventDefault();
      if (!abierto) {
        setAbierto(true);
        return;
      }
      if (resultados.length === 0) return;
      const paso = evento.key === 'ArrowDown' ? 1 : -1;
      setActivo((actual) => {
        const siguiente = actual + paso;
        if (siguiente < 0) return resultados.length - 1;
        if (siguiente >= resultados.length) return 0;
        return siguiente;
      });
      return;
    }
    if (evento.key === 'Enter') {
      // El selector vive dentro de un formulario: sin esto, Enter lo enviaría.
      evento.preventDefault();
      if (abierto && activo >= 0 && resultados[activo]) {
        alternar(resultados[activo]);
      }
    }
  };

  const ocultos = Math.max(0, total - resultados.length);

  return (
    <div className="restaurant-select" ref={contenedorRef}>
      {seleccion.length > 0 && (
        <ul className="restaurant-select-chips">
          {seleccion.map((r) => (
            <li key={r.id} className="restaurant-select-chip">
              <span>{r.name || `Restaurante #${r.id}`}</span>
              <button
                type="button"
                onClick={() => quitar(r.id)}
                disabled={disabled}
                aria-label={`Quitar ${r.name || `restaurante ${r.id}`}`}
                title="Quitar"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <input
        ref={campoRef}
        id={campoId}
        type="text"
        className="form-control form-control-sm"
        placeholder="Buscar restaurante…"
        aria-label="Buscar restaurante"
        role="combobox"
        aria-expanded={abierto}
        aria-controls={abierto ? listaId : undefined}
        aria-autocomplete="list"
        autoComplete="off"
        value={texto}
        disabled={disabled}
        onFocus={() => setAbierto(true)}
        onClick={() => setAbierto(true)}
        onChange={(e) => setTexto(e.target.value)}
        onKeyDown={alTeclear}
      />

      {abierto && (
        <div className="restaurant-select-panel">
          {cargando && (
            <div className="restaurant-select-message">Buscando…</div>
          )}

          {!cargando && error && (
            <div className="restaurant-select-message" role="alert">
              <span>No se pudieron cargar los restaurantes.</span>
              <button
                type="button"
                className="btn btn-sm btn-link"
                onClick={() => setReintento((n) => n + 1)}
              >
                Reintentar
              </button>
            </div>
          )}

          {!cargando && !error && resultados.length === 0 && (
            <div className="restaurant-select-message">
              Ningún restaurante coincide con la búsqueda.
            </div>
          )}

          {!cargando && !error && resultados.length > 0 && (
            <>
              <ul className="restaurant-select-options" id={listaId} role="listbox" aria-multiselectable="true">
                {resultados.map((r, indice) => {
                  const elegido = idsElegidos.has(Number(r.id));
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={elegido}
                        className={`restaurant-select-option${indice === activo ? ' is-active' : ''}${elegido ? ' is-selected' : ''}`}
                        onMouseEnter={() => setActivo(indice)}
                        onClick={() => alternar(r)}
                      >
                        <span className="restaurant-select-check" aria-hidden="true">
                          {elegido ? '✓' : ''}
                        </span>
                        {r.name || `Restaurante #${r.id}`}
                      </button>
                    </li>
                  );
                })}
              </ul>

              {ocultos > 0 && (
                <div className="restaurant-select-message">
                  … y {ocultos} más, afina la búsqueda.
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default RestaurantMultiSelect;
