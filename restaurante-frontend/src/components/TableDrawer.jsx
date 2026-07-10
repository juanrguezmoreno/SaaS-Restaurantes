import { useState, useEffect, useCallback } from 'react';
import { createTable, updateTable, deleteTable } from '../services/tableService';

// ─── Formateo ────────────────────────────────────────────────────────────
const formatTime = (timeStr) => (timeStr ? String(timeStr).substring(0, 5) : '—');

const STATUS_OPTIONS = ['AVAILABLE', 'RESERVED', 'OCCUPIED', 'MAINTENANCE'];

const EMPTY_TABLE_FORM = { tableNumber: '', capacity: '', location: '', status: 'AVAILABLE' };

const validateTableForm = (form) => {
  const errors = {};
  if (!String(form.tableNumber || '').trim()) {
    errors.tableNumber = 'El número de mesa es obligatorio.';
  }
  const capacity = form.capacity;
  if (capacity === '' || capacity === null || capacity === undefined) {
    errors.capacity = 'La capacidad es obligatoria.';
  } else if (Number(capacity) < 1 || !Number.isInteger(Number(capacity))) {
    errors.capacity = 'La capacidad debe ser un número entero positivo.';
  }
  return errors;
};

const getErrorMessage = (err) => {
  if (!err) return 'Error inesperado.';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message;
  return 'Error al procesar la solicitud.';
};

const TableDrawer = ({
  open,
  table,
  isCreating,
  restaurantId,
  restaurantName,
  reservation,
  otherReservations = [],
  getStatusInfo,
  statusUpdating,
  canManageTables,
  // eslint-disable-next-line no-unused-vars -- usado por los modos de las tareas 7/8
  canManageReservations,
  onClose,
  onStatusChange,
  onTableCreated,
  onTableSaved,
  onTableDeleted,
}) => {
  const [mode, setMode] = useState('detail');
  const [tableForm, setTableForm] = useState(EMPTY_TABLE_FORM);
  const [tableFormErrors, setTableFormErrors] = useState({});
  const [savingTable, setSavingTable] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingTable, setDeletingTable] = useState(false);

  // Al cambiar de mesa (o al pasar a modo creación) siempre se vuelve a 'detail'
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(isCreating ? 'create-table' : 'detail');
    setConfirmingDelete(false);
    setTableFormErrors({});
    if (isCreating) {
      setTableForm(EMPTY_TABLE_FORM);
    } else if (table) {
      setTableForm({
        tableNumber: table.tableNumber ?? '',
        capacity: table.capacity ?? '',
        location: table.location ?? '',
        status: table.status || 'AVAILABLE',
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const handleTableFormChange = (e) => {
    const { name, value } = e.target;
    setTableForm((prev) => ({ ...prev, [name]: value }));
    setTableFormErrors((prev) => {
      if (!prev[name]) return prev;
      const updated = { ...prev };
      delete updated[name];
      return updated;
    });
  };

  const handleStartEditTable = () => {
    setTableForm({
      tableNumber: table.tableNumber ?? '',
      capacity: table.capacity ?? '',
      location: table.location ?? '',
      status: table.status || 'AVAILABLE',
    });
    setTableFormErrors({});
    setMode('edit-table');
  };

  const handleSubmitTableForm = async (e) => {
    e.preventDefault();
    const errors = validateTableForm(tableForm);
    if (Object.keys(errors).length > 0) {
      setTableFormErrors(errors);
      return;
    }

    setSavingTable(true);
    setTableFormErrors({});
    try {
      const payload = {
        restaurantId: Number(restaurantId),
        tableNumber: String(tableForm.tableNumber || '').trim(),
        capacity: Number(tableForm.capacity),
        location: (tableForm.location || '').trim(),
        status: tableForm.status || 'AVAILABLE',
      };

      if (mode === 'create-table') {
        const created = await createTable(restaurantId, payload);
        setMode('detail');
        if (onTableCreated) onTableCreated(created);
      } else {
        await updateTable(table.id, payload);
        setMode('detail');
        if (onTableSaved) onTableSaved();
      }
    } catch (err) {
      setTableFormErrors({ submit: getErrorMessage(err) });
    } finally {
      setSavingTable(false);
    }
  };

  const handleConfirmDeleteTable = async () => {
    setDeletingTable(true);
    try {
      await deleteTable(table.id);
      setConfirmingDelete(false);
      if (onTableDeleted) onTableDeleted();
    } catch (err) {
      setTableFormErrors({ submit: getErrorMessage(err) });
    } finally {
      setDeletingTable(false);
    }
  };

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

              {canManageTables && (
                <div className="table-drawer-action-buttons">
                  <button className="btn btn-outline-primary btn-sm" onClick={handleStartEditTable} type="button">
                    Editar mesa
                  </button>
                  <button
                    className="btn btn-outline-danger btn-sm"
                    onClick={() => {
                      setTableFormErrors({});
                      setConfirmingDelete(true);
                    }}
                    type="button"
                  >
                    Eliminar mesa
                  </button>
                </div>
              )}
            </div>
          </>
        )}

        {mode === 'detail' && table && confirmingDelete && (
          <div className="table-drawer-danger-zone">
            <p className="table-drawer-section-title">Eliminar mesa</p>
            <p className="table-drawer-danger-text">
              Se eliminará la mesa {table.tableNumber || table.id}. Esta acción no se puede deshacer.
            </p>
            {tableFormErrors.submit && (
              <div className="alert alert-danger py-2 px-3 small">{tableFormErrors.submit}</div>
            )}
            <div className="table-drawer-action-buttons">
              <button
                className="btn btn-danger btn-sm"
                onClick={handleConfirmDeleteTable}
                disabled={deletingTable}
                type="button"
              >
                {deletingTable ? 'Eliminando...' : 'Confirmar eliminación'}
              </button>
              <button
                className="btn btn-outline-secondary btn-sm"
                onClick={() => {
                  setTableFormErrors({});
                  setConfirmingDelete(false);
                }}
                disabled={deletingTable}
                type="button"
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {(mode === 'edit-table' || mode === 'create-table') && (
          <form onSubmit={handleSubmitTableForm} className="table-drawer-form">
            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-tableNumber">Número de mesa</label>
              <input
                id="drawer-tableNumber"
                name="tableNumber"
                className={`form-control ${tableFormErrors.tableNumber ? 'is-invalid' : ''}`}
                value={tableForm.tableNumber}
                onChange={handleTableFormChange}
              />
              {tableFormErrors.tableNumber && (
                <div className="invalid-feedback">{tableFormErrors.tableNumber}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-capacity">Capacidad</label>
              <input
                id="drawer-capacity"
                name="capacity"
                type="number"
                min="1"
                className={`form-control ${tableFormErrors.capacity ? 'is-invalid' : ''}`}
                value={tableForm.capacity}
                onChange={handleTableFormChange}
              />
              {tableFormErrors.capacity && (
                <div className="invalid-feedback">{tableFormErrors.capacity}</div>
              )}
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-location">Ubicación</label>
              <input
                id="drawer-location"
                name="location"
                className="form-control"
                value={tableForm.location}
                onChange={handleTableFormChange}
                placeholder="Terraza, salón principal..."
              />
            </div>

            <div className="mb-3">
              <label className="form-label" htmlFor="drawer-status">Estado</label>
              <select
                id="drawer-status"
                name="status"
                className="form-select"
                value={tableForm.status}
                onChange={handleTableFormChange}
              >
                {STATUS_OPTIONS.map((key) => (
                  <option key={key} value={key}>{getStatusInfo(key).label}</option>
                ))}
              </select>
            </div>

            {tableFormErrors.submit && (
              <div className="alert alert-danger py-2 px-3 small">{tableFormErrors.submit}</div>
            )}

            <div className="table-drawer-action-buttons">
              <button className="btn btn-primary btn-sm" type="submit" disabled={savingTable}>
                {savingTable ? 'Guardando...' : 'Guardar'}
              </button>
              <button
                className="btn btn-outline-secondary btn-sm"
                type="button"
                disabled={savingTable}
                onClick={() => (mode === 'create-table' ? handleClose() : setMode('detail'))}
              >
                Cancelar
              </button>
            </div>
          </form>
        )}
      </div>
    </aside>
  );
};

export default TableDrawer;
