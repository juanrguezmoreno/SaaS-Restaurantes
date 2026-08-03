import { useState } from 'react';

/**
 * Editor semanal de periodos de servicio.
 *
 * Controlado: no guarda nada ni consulta al backend. Recibe la lista plana de
 * periodos y devuelve la lista modificada por onChange; el contenedor decide
 * cuándo persistirla.
 *
 * Un día sin periodos está cerrado. El backend valida solapes y duplicados: aquí
 * no se replica esa lógica para no tener dos reglas que puedan discrepar.
 */

const DIAS = [
  { id: 'MONDAY', etiqueta: 'Lunes' },
  { id: 'TUESDAY', etiqueta: 'Martes' },
  { id: 'WEDNESDAY', etiqueta: 'Miércoles' },
  { id: 'THURSDAY', etiqueta: 'Jueves' },
  { id: 'FRIDAY', etiqueta: 'Viernes' },
  { id: 'SATURDAY', etiqueta: 'Sábado' },
  { id: 'SUNDAY', etiqueta: 'Domingo' },
];

/** '13:00:00' → '13:00', que es lo que espera un <input type="time">. */
const aHoraCorta = (hora) => (hora ? String(hora).substring(0, 5) : '');

/** '13:00' → '13:00:00', que es lo que espera el backend. */
const aHoraLarga = (hora) => (hora ? `${String(hora).substring(0, 5)}:00` : '');

let contadorClaves = 0;
/** Clave estable de React para periodos que aún no tienen id de base de datos. */
const nuevaClave = () => {
  contadorClaves += 1;
  return `nuevo-${contadorClaves}`;
};

const ServiceSchedule = ({ periods = [], onChange, disabled = false }) => {
  const [copiandoDesde, setCopiandoDesde] = useState(null);
  const [destinosCopia, setDestinosCopia] = useState([]);

  const periodosDe = (dia) => periods.filter((p) => p.dayOfWeek === dia);

  const añadirPeriodo = (dia) => {
    onChange([
      ...periods,
      {
        _key: nuevaClave(),
        id: null,
        dayOfWeek: dia,
        startTime: '13:00:00',
        endTime: '16:00:00',
        name: '',
      },
    ]);
  };

  const eliminarPeriodo = (clave) => {
    onChange(periods.filter((p) => p._key !== clave));
  };

  const actualizarPeriodo = (clave, campo, valor) => {
    onChange(periods.map((p) => (p._key === clave ? { ...p, [campo]: valor } : p)));
  };

  const cerrarDia = (dia) => {
    onChange(periods.filter((p) => p.dayOfWeek !== dia));
  };

  const abrirCopia = (dia) => {
    setCopiandoDesde(dia);
    setDestinosCopia([]);
  };

  const alternarDestino = (dia) => {
    setDestinosCopia((prev) => (prev.includes(dia) ? prev.filter((d) => d !== dia) : [...prev, dia]));
  };

  const confirmarCopia = () => {
    const origen = periodosDe(copiandoDesde);
    // Los días destino se reemplazan por completo, y las copias son periodos
    // nuevos (id nulo): nunca se reutiliza la fila de otro día.
    const sinDestinos = periods.filter((p) => !destinosCopia.includes(p.dayOfWeek));
    const copias = destinosCopia.flatMap((dia) =>
      origen.map((p) => ({
        _key: nuevaClave(),
        id: null,
        dayOfWeek: dia,
        startTime: p.startTime,
        endTime: p.endTime,
        name: p.name,
      }))
    );
    onChange([...sinDestinos, ...copias]);
    setCopiandoDesde(null);
    setDestinosCopia([]);
  };

  return (
    <div className="service-schedule">
      {DIAS.map(({ id, etiqueta }) => {
        const delDia = periodosDe(id);
        return (
          <div key={id} className="service-day">
            <div className="service-day-header">
              <h3 className="service-day-title">{etiqueta}</h3>
              <div className="service-day-actions">
                {/* El texto visible se mantiene corto y el nombre accesible lleva
                    el día, para que cada botón sea distinguible sin repetir
                    "lunes", "martes"... siete veces en pantalla. */}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-primary"
                  onClick={() => añadirPeriodo(id)}
                  disabled={disabled}
                  aria-label={`Añadir servicio en ${etiqueta.toLowerCase()}`}
                >
                  Añadir servicio
                </button>
                {delDia.length > 0 && (
                  <>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => abrirCopia(id)}
                      disabled={disabled}
                      aria-label={`Copiar horarios de ${etiqueta.toLowerCase()}`}
                    >
                      Copiar a otros días
                    </button>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-secondary"
                      onClick={() => cerrarDia(id)}
                      disabled={disabled}
                      aria-label={`Marcar ${etiqueta.toLowerCase()} como cerrado`}
                    >
                      Marcar como cerrado
                    </button>
                  </>
                )}
              </div>
            </div>

            {delDia.length === 0 ? (
              <p className="service-day-closed">Cerrado</p>
            ) : (
              <ul className="service-period-list">
                {delDia.map((periodo) => (
                  <li key={periodo._key} className="service-period">
                    <input
                      type="time"
                      className="form-control form-control-sm"
                      aria-label={`Hora de inicio en ${etiqueta.toLowerCase()}`}
                      value={aHoraCorta(periodo.startTime)}
                      onChange={(e) => actualizarPeriodo(periodo._key, 'startTime', aHoraLarga(e.target.value))}
                      disabled={disabled}
                    />
                    <span className="service-period-separator">–</span>
                    <input
                      type="time"
                      className="form-control form-control-sm"
                      aria-label={`Hora de fin en ${etiqueta.toLowerCase()}`}
                      value={aHoraCorta(periodo.endTime)}
                      onChange={(e) => actualizarPeriodo(periodo._key, 'endTime', aHoraLarga(e.target.value))}
                      disabled={disabled}
                    />
                    <input
                      type="text"
                      className="form-control form-control-sm"
                      aria-label={`Nombre del servicio en ${etiqueta.toLowerCase()}`}
                      placeholder="Nombre (opcional)"
                      maxLength={50}
                      value={periodo.name || ''}
                      onChange={(e) => actualizarPeriodo(periodo._key, 'name', e.target.value)}
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-danger"
                      onClick={() => eliminarPeriodo(periodo._key)}
                      disabled={disabled}
                      aria-label={`Eliminar servicio de ${etiqueta.toLowerCase()}`}
                    >
                      Eliminar
                    </button>
                  </li>
                ))}
              </ul>
            )}

            {copiandoDesde === id && (
              <div className="service-copy-panel">
                <p className="service-copy-title">Copiar estos horarios a:</p>
                <div className="service-copy-days">
                  {DIAS.filter((d) => d.id !== id).map((destino) => (
                    <label key={destino.id} className="service-copy-day">
                      <input
                        type="checkbox"
                        checked={destinosCopia.includes(destino.id)}
                        onChange={() => alternarDestino(destino.id)}
                      />
                      {destino.etiqueta}
                    </label>
                  ))}
                </div>
                <div className="service-copy-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={confirmarCopia}
                    disabled={destinosCopia.length === 0}
                  >
                    Copiar
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-light"
                    onClick={() => setCopiandoDesde(null)}
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default ServiceSchedule;
