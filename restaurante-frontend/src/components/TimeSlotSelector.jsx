/**
 * Rejilla de franjas horarias para los formularios de reserva (privado y público).
 *
 * No consulta nada: recibe las franjas ya calculadas por el backend, que es quien
 * decide qué horas existen y cuáles admiten reserva. Ver el hook useTimeSlots.
 */

/** '13:00:00' → '13:00'. Las franjas llegan del backend como LocalTime. */
const toShortTime = (time) => String(time || '').substring(0, 5);

const TimeSlotSelector = ({
  slots = [],
  value = '',
  onChange,
  loading = false,
  error = null,
  onRetry,
  disabled = false,
}) => {
  if (loading) {
    return (
      <div className="time-slot-state" role="status">
        <span className="spinner-border spinner-border-sm" aria-hidden="true" />
        <span>Buscando horarios disponibles…</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="time-slot-state time-slot-state-error">
        <span>{error}</span>
        <button type="button" className="btn btn-sm btn-outline-secondary" onClick={onRetry}>
          Reintentar
        </button>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <div className="time-slot-state">
        No hay horarios disponibles para la fecha y el número de personas seleccionados.
      </div>
    );
  }

  return (
    <div className="time-slot-grid" role="group" aria-label="Franjas horarias disponibles">
      {slots.map((slot) => {
        const selected = slot.time === value;
        return (
          <button
            key={slot.time}
            type="button"
            className={`time-slot${selected ? ' time-slot-selected' : ''}`}
            aria-pressed={selected}
            disabled={disabled || !slot.available}
            onClick={() => onChange(slot.time)}
          >
            <span className="time-slot-hour">{toShortTime(slot.time)}</span>
            {!slot.available && <span className="time-slot-tag">Completo</span>}
          </button>
        );
      })}
    </div>
  );
};

export default TimeSlotSelector;
