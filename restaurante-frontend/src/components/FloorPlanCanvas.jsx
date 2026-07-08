import { useState, useRef, useCallback, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';

// ═══════════════════════════════════════════════════════════════════════════════
// FloorPlanCanvas — Plano de sala interactivo
//
// Renderiza mesas y elementos decorativos (barra, puerta) posicionados dentro de
// un contenedor tipo canvas. Modo vista (click para info) y modo edición
// (drag & drop + panel de propiedades: forma de mesa, rotar/eliminar elemento).
//
// Props:
//   tables          — Array de mesas a renderizar
//   elements        — Array de elementos decorativos del servidor
//   editMode        — Si true, permite arrastrar y editar propiedades
//   selectedTableId — ID de mesa seleccionada (opcional, modo vista)
//   onTableClick    — Callback al hacer clic en una mesa (solo modo vista)
//   onTableDragEnd  — Callback al terminar un arrastre de mesa (tableId, x, y)
//   onLayoutChange  — Callback cuando cambia algo del layout (forma/elementos)
//   saving          — Si true, muestra indicador de guardado
//
// Ref expone: { getLayout, addElement, resetAutoLayout }
// ═══════════════════════════════════════════════════════════════════════════════

// ─── Configuración visual por estado ────────────────────────────────────────
const STATUS_CONFIG = {
  AVAILABLE: { label: 'Disponible', color: '#22c55e', bg: 'rgba(34, 197, 94, 0.12)' },
  RESERVED: { label: 'Reservada', color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.12)' },
  OCCUPIED: { label: 'Ocupada', color: '#ef4444', bg: 'rgba(239, 68, 68, 0.12)' },
  MAINTENANCE: { label: 'En mantenimiento', color: '#94a3b8', bg: 'rgba(148, 163, 184, 0.12)' },
};

const DEFAULT_STATUS = STATUS_CONFIG.MAINTENANCE;

// ─── Dimensiones por defecto según forma ────────────────────────────────────
const SHAPE_DEFAULTS = {
  ROUND: { width: 90, height: 90 },
  SQUARE: { width: 90, height: 90 },
  RECTANGLE: { width: 130, height: 85 },
};

const DEFAULT_DIMS = { width: 90, height: 90 };

const SHAPE_OPTIONS = [
  { value: 'ROUND', label: 'Redonda' },
  { value: 'SQUARE', label: 'Cuadrada' },
  { value: 'RECTANGLE', label: 'Rectangular' },
];

// ─── Configuración de elementos decorativos ────────────────────────────────
const ELEMENT_CONFIG = {
  BAR: { label: 'Barra', width: 200, height: 60 },
  DOOR: { label: 'Puerta', width: 80, height: 26 },
};

// ─── Auto-layout: cuadrícula de 5 columnas ─────────────────────────────────
const autoLayoutPosition = (index) => {
  const cols = 5;
  const marginX = 140;
  const marginY = 130;
  const startX = 50;
  const startY = 50;
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: startX + col * marginX, y: startY + row * marginY };
};

/**
 * Convierte los elementos del servidor al formato local de edición.
 * `key` es el identificador local (los nuevos aún no tienen id de BD).
 */
const normalizeElements = (elements) =>
  (Array.isArray(elements) ? elements : []).map((el) => ({
    key: `srv-${el.id}`,
    id: el.id,
    type: el.type,
    x: el.xPosition ?? 0,
    y: el.yPosition ?? 0,
    width: el.width || ELEMENT_CONFIG[el.type]?.width || 100,
    height: el.height || ELEMENT_CONFIG[el.type]?.height || 40,
    rotation: el.rotation || 0,
  }));

/**
 * Obtiene las dimensiones y forma visual de una mesa.
 * Si hay override local de forma, se usan las dimensiones por defecto
 * de la nueva forma (las guardadas corresponden a la forma anterior).
 */
const getTableShape = (table, shapeOverride) => {
  const shape = shapeOverride || table.shape || 'ROUND';
  const dims = SHAPE_DEFAULTS[shape] || DEFAULT_DIMS;
  const w = shapeOverride ? dims.width : table.width || dims.width;
  const h = shapeOverride ? dims.height : table.height || dims.height;

  let borderRadius;
  switch (shape) {
    case 'ROUND':
      borderRadius = '50%';
      break;
    case 'RECTANGLE':
      borderRadius = '6px';
      break;
    default:
      borderRadius = '8px';
  }

  return { w, h, borderRadius, shape };
};

// ═══ COMPONENTE PRINCIPAL ═══════════════════════════════════════════════════

const FloorPlanCanvas = forwardRef(function FloorPlanCanvas(
  {
    tables = [],
    elements = [],
    editMode = false,
    selectedTableId = null,
    onTableClick,
    onTableDragEnd,
    onLayoutChange,
    saving = false,
  },
  ref
) {
  // ── Estado local ─────────────────────────────────────────────────────────
  const [localPositions, setLocalPositions] = useState({});
  const [localShapes, setLocalShapes] = useState({});
  const [localElements, setLocalElements] = useState(() => normalizeElements(elements));
  // selectedItem: { kind: 'table', id } | { kind: 'element', key } | null
  const [selectedItem, setSelectedItem] = useState(null);
  // dragging: { kind: 'table', id } | { kind: 'element', key } | null
  const [dragging, setDragging] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const pointerStart = useRef({ x: 0, y: 0 });
  const hasDragged = useRef(false);
  const clickedTableRef = useRef(null);
  const tablesRef = useRef(tables);
  const newElementSeq = useRef(0);

  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  // Sincronizar elementos del servidor mientras no se está editando
  // (carga tardía tras el montaje y recargas tras guardar/cancelar)
  useEffect(() => {
    if (!editMode) setLocalElements(normalizeElements(elements));
  }, [elements, editMode]);

  // Al salir del modo edición se cierra el panel de propiedades
  useEffect(() => {
    if (!editMode) setSelectedItem(null);
  }, [editMode]);

  const notifyLayoutChange = useCallback(() => {
    if (onLayoutChange) onLayoutChange();
  }, [onLayoutChange]);

  // ── Obtener posición efectiva de una mesa ────────────────────────────────
  const getTablePosition = useCallback(
    (table, index) => {
      const local = localPositions[table.id];
      if (local) return local;

      const hasPosition =
        table.xPosition !== null &&
        table.xPosition !== undefined &&
        table.yPosition !== null &&
        table.yPosition !== undefined;
      if (hasPosition) {
        return { x: table.xPosition, y: table.yPosition };
      }

      return autoLayoutPosition(index);
    },
    [localPositions]
  );

  // ── API imperativa para el componente padre ──────────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      /**
       * Devuelve el estado final del plano: payload de mesas para
       * PUT /tables/layout y de elementos para PUT /floor-plan/elements.
       */
      getLayout: () => {
        const currentTables = tablesRef.current;
        const tablesPayload = currentTables.map((table, index) => {
          const local = localPositions[table.id];
          let pos;
          if (local) {
            pos = local;
          } else {
            const hasPosition =
              table.xPosition !== null &&
              table.xPosition !== undefined &&
              table.yPosition !== null &&
              table.yPosition !== undefined;
            pos = hasPosition
              ? { x: table.xPosition, y: table.yPosition }
              : autoLayoutPosition(index);
          }
          const shapeOverride = localShapes[table.id];
          const shape = shapeOverride || table.shape || 'ROUND';
          const dims = SHAPE_DEFAULTS[shape] || DEFAULT_DIMS;
          return {
            tableId: table.id,
            xPosition: Math.round(pos.x),
            yPosition: Math.round(pos.y),
            width: shapeOverride ? dims.width : table.width || dims.width,
            height: shapeOverride ? dims.height : table.height || dims.height,
            shape,
            rotation: table.rotation || 0,
          };
        });

        const elementsPayload = localElements.map((el) => ({
          id: el.id,
          type: el.type,
          xPosition: Math.round(el.x),
          yPosition: Math.round(el.y),
          width: el.width,
          height: el.height,
          rotation: el.rotation || 0,
        }));

        return { tables: tablesPayload, elements: elementsPayload };
      },

      /**
       * Inserta un elemento decorativo nuevo en el plano.
       * @param {'BAR'|'DOOR'} type
       */
      addElement: (type) => {
        const cfg = ELEMENT_CONFIG[type];
        if (!cfg) return;
        newElementSeq.current += 1;
        const key = `new-${newElementSeq.current}`;
        setLocalElements((prev) => [
          ...prev,
          {
            key,
            id: null,
            type,
            x: 60 + (prev.length % 6) * 30,
            y: 60 + (prev.length % 6) * 30,
            width: cfg.width,
            height: cfg.height,
            rotation: 0,
          },
        ]);
        setSelectedItem({ kind: 'element', key });
      },

      /**
       * Recoloca todas las mesas en la cuadrícula automática.
       * No afecta a los elementos decorativos.
       */
      resetAutoLayout: () => {
        const positions = {};
        tablesRef.current.forEach((table, index) => {
          positions[table.id] = autoLayoutPosition(index);
        });
        setLocalPositions(positions);
      },
    }),
    [localPositions, localShapes, localElements]
  );

  // ── Calcular dimensiones del canvas según contenido ──────────────────────
  const canvasDimensions = useMemo(() => {
    let maxX = 800;
    let maxY = 500;

    tables.forEach((table, index) => {
      const pos = getTablePosition(table, index);
      const { w, h } = getTableShape(table, localShapes[table.id]);
      if (pos.x + w + 60 > maxX) maxX = pos.x + w + 60;
      if (pos.y + h + 60 > maxY) maxY = pos.y + h + 60;
    });

    localElements.forEach((el) => {
      if (el.x + el.width + 60 > maxX) maxX = el.x + el.width + 60;
      if (el.y + el.height + 60 > maxY) maxY = el.y + el.height + 60;
    });

    return { width: Math.max(maxX, 800), height: Math.max(maxY, 450) };
  }, [tables, localElements, localShapes, getTablePosition]);

  // ── Handler: Iniciar drag o click sobre mesa/elemento ────────────────────
  // item: { kind: 'table', table, index } | { kind: 'element', element }
  const handleItemPointerDown = useCallback(
    (e, item) => {
      pointerStart.current = { x: e.clientX, y: e.clientY };
      hasDragged.current = false;
      clickedTableRef.current = item.kind === 'table' ? item.table : null;

      if (!editMode) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const canvasRect = canvas.getBoundingClientRect();

      let x;
      let y;
      if (item.kind === 'table') {
        const pos = getTablePosition(item.table, item.index);
        x = pos.x;
        y = pos.y;
        setDragging({ kind: 'table', id: item.table.id });
      } else {
        x = item.element.x;
        y = item.element.y;
        setDragging({ kind: 'element', key: item.element.key });
      }

      setDragOffset({
        x: e.clientX - canvasRect.left - x,
        y: e.clientY - canvasRect.top - y,
      });

      e.target.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [editMode, getTablePosition]
  );

  // ── Handler: Mover durante drag ──────────────────────────────────────────
  const handlePointerMove = useCallback(
    (e) => {
      if (!dragging || !editMode) return;

      // Detectar si realmente hubo arrastre (umbral 4px)
      const dx = Math.abs(e.clientX - pointerStart.current.x);
      const dy = Math.abs(e.clientY - pointerStart.current.y);
      if (dx > 4 || dy > 4) {
        hasDragged.current = true;
      }

      if (!hasDragged.current) return;

      const canvas = canvasRef.current;
      if (!canvas) return;

      const canvasRect = canvas.getBoundingClientRect();
      const newX = Math.max(0, e.clientX - canvasRect.left - dragOffset.x);
      const newY = Math.max(0, e.clientY - canvasRect.top - dragOffset.y);

      if (dragging.kind === 'table') {
        setLocalPositions((prev) => ({
          ...prev,
          [dragging.id]: { x: newX, y: newY },
        }));
      } else {
        setLocalElements((prev) =>
          prev.map((el) =>
            el.key === dragging.key ? { ...el, x: newX, y: newY } : el
          )
        );
      }
    },
    [dragging, dragOffset, editMode]
  );

  // ── Handler: Finalizar drag o click ──────────────────────────────────────
  const handlePointerUp = useCallback(() => {
    if (!dragging) {
      // Modo vista: click sin arrastre sobre una mesa → abrir info
      if (!editMode && !hasDragged.current && clickedTableRef.current && onTableClick) {
        onTableClick(clickedTableRef.current);
      }
      clickedTableRef.current = null;
      return;
    }

    if (hasDragged.current) {
      // Fue un arrastre → notificar al padre
      if (dragging.kind === 'table') {
        const pos = localPositions[dragging.id];
        if (pos && onTableDragEnd) {
          onTableDragEnd(dragging.id, pos.x, pos.y);
        }
      } else {
        notifyLayoutChange();
      }
    } else {
      // Click sin arrastre en modo edición → abrir panel de propiedades
      setSelectedItem(
        dragging.kind === 'table'
          ? { kind: 'table', id: dragging.id }
          : { kind: 'element', key: dragging.key }
      );
    }

    setDragging(null);
    clickedTableRef.current = null;
  }, [dragging, editMode, localPositions, onTableClick, onTableDragEnd, notifyLayoutChange]);

  // ── Acciones del panel de propiedades ────────────────────────────────────
  const handleShapeChange = useCallback(
    (tableId, shape) => {
      setLocalShapes((prev) => ({ ...prev, [tableId]: shape }));
      notifyLayoutChange();
    },
    [notifyLayoutChange]
  );

  const handleRotateElement = useCallback(
    (key) => {
      setLocalElements((prev) =>
        prev.map((el) =>
          el.key === key ? { ...el, rotation: ((el.rotation || 0) + 90) % 360 } : el
        )
      );
      notifyLayoutChange();
    },
    [notifyLayoutChange]
  );

  const handleRemoveElement = useCallback(
    (key) => {
      setLocalElements((prev) => prev.filter((el) => el.key !== key));
      setSelectedItem(null);
      notifyLayoutChange();
    },
    [notifyLayoutChange]
  );

  // ── Datos del ítem seleccionado para posicionar el panel ─────────────────
  const selectedInfo = useMemo(() => {
    if (!selectedItem || !editMode) return null;

    if (selectedItem.kind === 'table') {
      const index = tables.findIndex((t) => t.id === selectedItem.id);
      if (index === -1) return null;
      const table = tables[index];
      const pos = getTablePosition(table, index);
      const { w } = getTableShape(table, localShapes[table.id]);
      return { kind: 'table', table, x: pos.x + w + 12, y: pos.y };
    }

    const element = localElements.find((el) => el.key === selectedItem.key);
    if (!element) return null;
    return { kind: 'element', element, x: element.x + element.width + 12, y: element.y };
  }, [selectedItem, editMode, tables, localElements, localShapes, getTablePosition]);

  // ── Obtener configuración visual del estado ──────────────────────────────
  const getStatusConfig = useCallback((status) => {
    return STATUS_CONFIG[status] || DEFAULT_STATUS;
  }, []);

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="fpc-wrapper">
      {/* Barra de estado del modo edición */}
      {editMode && (
        <div className="fpc-info-bar">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
          </svg>
          <span>Arrastra mesas y elementos; haz clic en uno para editar sus propiedades</span>
          {saving && (
            <span className="fpc-saving-badge">
              <span className="spinner-border spinner-border-sm" role="status" aria-hidden="true" />
              {' '}Guardando...
            </span>
          )}
        </div>
      )}

      {/* Canvas */}
      <div
        ref={canvasRef}
        className={`fpc-canvas ${editMode ? 'fpc-canvas-editable' : ''} ${dragging ? 'fpc-canvas-dragging' : ''}`}
        style={{ minHeight: `${canvasDimensions.height}px` }}
        onPointerDown={(e) => {
          // Click en el fondo vacío → cerrar panel de propiedades
          if (e.target === canvasRef.current) setSelectedItem(null);
        }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Elementos decorativos (barra, puerta) */}
        {localElements.map((el) => {
          const cfg = ELEMENT_CONFIG[el.type] || { label: el.type };
          const isSelectedEl =
            editMode && selectedItem?.kind === 'element' && selectedItem.key === el.key;
          const isDraggingEl = dragging?.kind === 'element' && dragging.key === el.key;

          return (
            <div
              key={el.key}
              className={`fpc-element fpc-element-${(el.type || '').toLowerCase()} ${isSelectedEl ? 'fpc-element-selected' : ''}`}
              style={{
                left: `${el.x}px`,
                top: `${el.y}px`,
                width: `${el.width}px`,
                height: `${el.height}px`,
                transform: el.rotation ? `rotate(${el.rotation}deg)` : 'none',
                zIndex: isDraggingEl ? 100 : isSelectedEl ? 10 : 0,
                pointerEvents: editMode ? 'auto' : 'none',
                cursor: editMode ? 'grab' : 'default',
              }}
              onPointerDown={(e) => handleItemPointerDown(e, { kind: 'element', element: el })}
              role={editMode ? 'button' : 'img'}
              aria-label={cfg.label}
              title={cfg.label}
            >
              {el.type === 'DOOR' ? (
                <svg viewBox="0 0 48 26" width="100%" height="100%" preserveAspectRatio="none" aria-hidden="true">
                  <line x1="2" y1="24" x2="46" y2="24" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
                  <path d="M 8 24 A 18 18 0 0 1 26 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeDasharray="3 3" />
                  <line x1="8" y1="24" x2="26" y2="6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                <span className="fpc-element-label">{cfg.label}</span>
              )}
            </div>
          );
        })}

        {/* Mesas */}
        {tables.map((table, index) => {
          const pos = getTablePosition(table, index);
          const statusCfg = getStatusConfig(table.status);
          const { w, h, borderRadius } = getTableShape(table, localShapes[table.id]);
          const isSelected =
            table.id === selectedTableId ||
            (editMode && selectedItem?.kind === 'table' && selectedItem.id === table.id);
          const isDragging = dragging?.kind === 'table' && dragging.id === table.id;

          return (
            <div
              key={table.id}
              className={`fpc-table
                ${isSelected ? 'fpc-table-selected' : ''}
                ${isDragging ? 'fpc-table-dragging' : ''}
                ${editMode ? 'fpc-table-draggable' : ''}
              `}
              style={{
                left: `${pos.x}px`,
                top: `${pos.y}px`,
                width: `${w}px`,
                height: `${h}px`,
                borderRadius,
                borderColor: statusCfg.color,
                backgroundColor: statusCfg.bg,
                color: statusCfg.color,
                cursor: editMode ? 'grab' : 'pointer',
                zIndex: isDragging ? 100 : isSelected ? 10 : 1,
                transform: table.rotation ? `rotate(${table.rotation}deg)` : 'none',
              }}
              onPointerDown={(e) => handleItemPointerDown(e, { kind: 'table', table, index })}
              role="button"
              tabIndex={0}
              aria-label={`Mesa ${table.tableNumber || table.id} — ${statusCfg.label}`}
              title={`Mesa ${table.tableNumber || table.id} — ${statusCfg.label}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (editMode) {
                    setSelectedItem({ kind: 'table', id: table.id });
                  } else if (onTableClick) {
                    onTableClick(table);
                  }
                }
              }}
            >
              {/* Número de mesa */}
              <span className="fpc-table-number">
                {table.tableNumber || table.id}
              </span>

              {/* Capacidad (en mesas con espacio suficiente) */}
              {w >= 75 && h >= 75 && (
                <span className="fpc-table-capacity">
                  {table.capacity || '—'}
                </span>
              )}

              {/* Indicador de estado (barra inferior) */}
              <span
                className="fpc-table-status-bar"
                style={{ backgroundColor: statusCfg.color }}
              />
            </div>
          );
        })}

        {/* Panel flotante de propiedades (solo modo edición) */}
        {editMode && selectedInfo && (
          <div
            className="fpc-props-panel"
            style={{ left: `${selectedInfo.x}px`, top: `${selectedInfo.y}px` }}
            onPointerDown={(e) => e.stopPropagation()}
            role="dialog"
            aria-label="Propiedades del elemento seleccionado"
          >
            <button
              type="button"
              className="fpc-props-close"
              aria-label="Cerrar panel"
              onClick={() => setSelectedItem(null)}
            >
              ×
            </button>

            {selectedInfo.kind === 'table' ? (
              <>
                <div className="fpc-props-title">
                  Mesa {selectedInfo.table.tableNumber || selectedInfo.table.id}
                </div>
                <div className="fpc-props-label">Forma</div>
                {SHAPE_OPTIONS.map((opt) => {
                  const current =
                    localShapes[selectedInfo.table.id] || selectedInfo.table.shape || 'ROUND';
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      className={`fpc-props-btn ${current === opt.value ? 'fpc-props-btn-active' : ''}`}
                      onClick={() => handleShapeChange(selectedInfo.table.id, opt.value)}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </>
            ) : (
              <>
                <div className="fpc-props-title">
                  {ELEMENT_CONFIG[selectedInfo.element.type]?.label || selectedInfo.element.type}
                </div>
                <button
                  type="button"
                  className="fpc-props-btn"
                  onClick={() => handleRotateElement(selectedInfo.element.key)}
                >
                  Rotar 90°
                </button>
                <button
                  type="button"
                  className="fpc-props-btn fpc-props-btn-danger"
                  onClick={() => handleRemoveElement(selectedInfo.element.key)}
                >
                  Eliminar
                </button>
              </>
            )}
          </div>
        )}

        {/* Mensaje si no hay mesas */}
        {tables.length === 0 && (
          <div className="fpc-empty-canvas">
            <svg
              width="48"
              height="48"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity="0.3"
            >
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <line x1="9" y1="3" x2="9" y2="21" />
            </svg>
            <p>No hay mesas en este plano</p>
          </div>
        )}
      </div>

      {/* Leyenda de estados */}
      <div className="fpc-legend">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => (
          <div key={key} className="fpc-legend-item">
            <span className="fpc-legend-dot" style={{ backgroundColor: cfg.color }} />
            <span className="fpc-legend-label">{cfg.label}</span>
          </div>
        ))}
        {editMode && (
          <span className="fpc-legend-hint">
            {saving ? 'Guardando...' : 'Haz clic en una mesa o elemento para editarlo'}
          </span>
        )}
      </div>
    </div>
  );
});

export default FloorPlanCanvas;
