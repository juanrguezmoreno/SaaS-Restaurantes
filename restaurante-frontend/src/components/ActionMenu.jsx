import { useEffect, useId, useRef, useState } from 'react';

/**
 * Menú de acciones de fila (tres puntos).
 *
 * Reemplaza la hilera de iconos sin etiqueta: cada acción se lee con su nombre
 * y las destructivas quedan separadas y marcadas. Está implementado en React
 * porque el proyecto solo carga el CSS de Bootstrap, no su JavaScript, así que
 * `data-bs-toggle="dropdown"` no funcionaría; a cambio no añade dependencias.
 *
 * @param {object} props
 * @param {Array<{key: string, label: string, icon?: React.ReactNode,
 *   onSelect: () => void, danger?: boolean, disabled?: boolean,
 *   separatorBefore?: boolean}>} props.items
 * @param {string} [props.label] Texto accesible del botón.
 * @param {boolean} [props.disabled]
 */
const ActionMenu = ({ items = [], label = 'Acciones', disabled = false }) => {
  const [open, setOpen] = useState(false);
  const containerRef = useRef(null);
  const buttonRef = useRef(null);
  const menuId = useId();

  // Cierre por clic fuera y por Escape: sin esto el menú se queda abierto al
  // navegar por la tabla y se solapa con el de la fila siguiente.
  useEffect(() => {
    if (!open) return undefined;

    const handlePointerDown = (event) => {
      if (containerRef.current && !containerRef.current.contains(event.target)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelect = (item) => {
    if (item.disabled) return;
    setOpen(false);
    item.onSelect?.();
  };

  return (
    <div className="action-menu" ref={containerRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`action-menu-trigger${open ? ' is-open' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={label}
      >
        <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
          <circle cx="12" cy="5" r="1.75" />
          <circle cx="12" cy="12" r="1.75" />
          <circle cx="12" cy="19" r="1.75" />
        </svg>
      </button>

      {open && (
        <div className="action-menu-list" id={menuId} role="menu">
          {items.map((item) => (
            <div key={item.key} className="action-menu-entry">
              {item.separatorBefore && <div className="action-menu-separator" role="separator" />}
              <button
                type="button"
                role="menuitem"
                className={`action-menu-item${item.danger ? ' is-danger' : ''}`}
                onClick={() => handleSelect(item)}
                disabled={item.disabled}
              >
                {item.icon && <span className="action-menu-item-icon">{item.icon}</span>}
                <span>{item.label}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ActionMenu;
