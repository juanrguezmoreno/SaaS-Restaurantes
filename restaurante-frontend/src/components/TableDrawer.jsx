import { useState, useEffect, useCallback } from 'react';

// ─── Formateo ────────────────────────────────────────────────────────────
const formatTime = (timeStr) => (timeStr ? String(timeStr).substring(0, 5) : '—');

const TableDrawer = ({
  open,
  table,
  isCreating,
  // eslint-disable-next-line no-unused-vars -- usado por los modos de las tareas 7/8
  restaurantId,
  restaurantName,
  reservation,
  otherReservations = [],
  getStatusInfo,
  statusUpdating,
  // eslint-disable-next-line no-unused-vars -- usado por los modos de las tareas 7/8
  canManageTables,
  // eslint-disable-next-line no-unused-vars -- usado por los modos de las tareas 7/8
  canManageReservations,
  onClose,
  onStatusChange,
}) => {
  const [mode, setMode] = useState('detail');

  // Al cambiar de mesa (o al pasar a modo creación) siempre se vuelve a 'detail'
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(isCreating ? 'create-table' : 'detail');
  }, [table?.id, isCreating]);

  // Cerrar con Escape
  useEffect(() => {
    if (!open) return undefined;
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const handleClose = useCallback(() => {
    setMode('detail');
    onClose();
  }, [onClose]);

  if (!open) return null;

  const statusInfo = table ? getStatusInfo(table.status) : null;

  return (
    <aside className="table-drawer" role="dialog" aria-label="Detalle de mesa">
      <div className="table-drawer-header">
        <h5 className="table-drawer-title d-flex align-items-center gap-2">
          {statusInfo && (
            <span className="table-drawer-badge-dot" style={{ backgroundColor: statusInfo.color }} />
          )}
          {mode === 'create-table'
            ? 'Nueva mesa'
            : `Mesa ${table?.tableNumber || table?.id}`}
        </h5>
        <button
          type="button"
          className="btn-close"
          onClick={handleClose}
          aria-label="Cerrar"
        />
      </div>

      <div className="table-drawer-body">
        {mode === 'detail' && table && (
          <>
            <div className="table-drawer-details">
              <div className="table-drawer-row">
                <span className="table-drawer-label">Restaurante</span>
                <span className="table-drawer-value">{restaurantName || '—'}</span>
              </div>
              <div className="table-drawer-row">
                <span className="table-drawer-label">Estado</span>
                <span className="table-drawer-value">
                  <span className="table-drawer-status-badge" style={{ backgroundColor: statusInfo.color }}>
                    {statusInfo.label}
                  </span>
                </span>
              </div>
              <div className="table-drawer-row">
                <span className="table-drawer-label">Capacidad</span>
                <span className="table-drawer-value">{table.capacity || '—'} personas</span>
              </div>
              <div className="table-drawer-row">
                <span className="table-drawer-label">Ubicación</span>
                <span className="table-drawer-value">{table.location || 'Sin ubicación'}</span>
              </div>
            </div>

            {reservation && (
              <div className="table-drawer-reservation">
                <p className="table-drawer-section-title">Reserva actual</p>
                <div className="table-drawer-row">
                  <span className="table-drawer-label">Cliente</span>
                  <span className="table-drawer-value">{reservation.customerName || '—'}</span>
                </div>
                {reservation.customerEmail && (
                  <div className="table-drawer-row">
                    <span className="table-drawer-label">Email</span>
                    <span className="table-drawer-value">{reservation.customerEmail}</span>
                  </div>
                )}
                <div className="table-drawer-row">
                  <span className="table-drawer-label">Hora</span>
                  <span className="table-drawer-value">{formatTime(reservation.reservationTime)}</span>
                </div>
                <div className="table-drawer-row">
                  <span className="table-drawer-label">Comensales</span>
                  <span className="table-drawer-value">{reservation.partySize || '—'}</span>
                </div>
                {reservation.notes && (
                  <div className="table-drawer-row">
                    <span className="table-drawer-label">Notas</span>
                    <span className="table-drawer-value">{reservation.notes}</span>
                  </div>
                )}
              </div>
            )}

            {otherReservations.length > 0 && (
              <div className="table-drawer-reservation">
                <p className="table-drawer-section-title">Otras reservas de hoy</p>
                {otherReservations.map((r) => (
                  <div className="table-drawer-row" key={r.id}>
                    <span className="table-drawer-label">{formatTime(r.reservationTime)}</span>
                    <span className="table-drawer-value">
                      {r.customerName || '—'} · {r.partySize || '—'}p
                    </span>
                  </div>
                ))}
              </div>
            )}

            <div className="table-drawer-actions">
              <p className="table-drawer-section-title">Acciones</p>

              <div className="table-drawer-status-group">
                <span className="table-drawer-label">Cambiar estado</span>
                <div className="table-drawer-status-options">
                  {['AVAILABLE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE']
                    .filter((key) => key !== table.status)
                    .map((key) => {
                      const st = getStatusInfo(key);
                      return (
                        <button
                          key={key}
                          className="table-drawer-status-btn"
                          onClick={() => onStatusChange(table, key)}
                          disabled={statusUpdating === table.id}
                          type="button"
                        >
                          {statusUpdating === table.id ? (
                            <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
                          ) : (
                            <span className="table-drawer-status-dot" style={{ backgroundColor: st.color }} />
                          )}
                          {st.label}
                        </button>
                      );
                    })}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </aside>
  );
};

export default TableDrawer;
