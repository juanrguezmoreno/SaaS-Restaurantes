import { useState, useRef, useCallback, useMemo, useEffect, forwardRef, useImperativeHandle } from 'react';

// ═══════════════════════════════════════════════════════════════════════════════
// FloorPlanCanvas — Plano de sala interactivo
//
// Renderiza las mesas como elementos posicionados dentro de un contenedor tipo
// canvas. Soporta modo vista (click para info) y modo edición (drag & drop).
//
// Props:
//   tables          — Array de mesas a renderizar
//   editMode        — Si true, permite arrastrar mesas
//   selectedTableId — ID de mesa seleccionada (opcional)
//   onTableClick    — Callback cuando se hace clic en una mesa
//   onTableDragEnd  — Callback cuando termina un arrastre (tableId, x, y)
//   saving          — Si true, muestra indicador de guardado
//
// Ref expone: { getPositions: () => Array<{tableId, xPosition, yPosition, ...}> }
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
 * Obtiene las dimensiones y forma visual de una mesa.
 */
const getTableShape = (table) => {
  const shape = table.shape || 'ROUND';
  const dims = SHAPE_DEFAULTS[shape] || DEFAULT_DIMS;
  const w = table.width || dims.width;
  const h = table.height || dims.height;

  let borderRadius;
  switch (shape) {
    case 'ROUND':
      borderRadius = '50%';
      break;
    case 'SQUARE':
      borderRadius = '8px';
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
    editMode = false,
    selectedTableId = null,
    onTableClick,
    onTableDragEnd,
    saving = false,
  },
  ref
) {
  // ── Estado local ─────────────────────────────────────────────────────────
  const [localPositions, setLocalPositions] = useState({});
  const [draggingTableId, setDraggingTableId] = useState(null);
  const [dragOffset, setDragOffset] = useState({ x: 0, y: 0 });

  const canvasRef = useRef(null);
  const pointerStart = useRef({ x: 0, y: 0 });
  const hasDragged = useRef(false);
  const clickedTableRef = useRef(null);
  const tablesRef = useRef(tables);

  // Mantener referencia actualizada a tables para usarla en imperativa handle
  useEffect(() => {
    tablesRef.current = tables;
  }, [tables]);

  // ── Exponer método getPositions al padre via ref ─────────────────────────
  useImperativeHandle(
    ref,
    () => ({
      getPositions: () => {
        const currentTables = tablesRef.current;
        return currentTables.map((table, index) => {
          // Replicamos la lógica de getTablePosition aquí para evitar
          // dependencias circulares
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
            if (hasPosition) {
              pos = { x: table.xPosition, y: table.yPosition };
            } else {
              pos = autoLayoutPosition(index);
            }
          }
          const shape = table.shape || 'ROUND';
          const dims = SHAPE_DEFAULTS[shape] || DEFAULT_DIMS;
          return {
            tableId: table.id,
            xPosition: Math.round(pos.x),
            yPosition: Math.round(pos.y),
            width: table.width || dims.width,
            height: table.height || dims.height,
            shape: shape,
            rotation: table.rotation || 0,
          };
        });
      },
    }),
    [localPositions]
  );

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

  // ── Calcular dimensiones del canvas según contenido ──────────────────────
  const canvasDimensions = useMemo(() => {
    if (tables.length === 0) return { width: 800, height: 500 };

    let maxX = 800;
    let maxY = 500;

    tables.forEach((table, index) => {
      const pos = getTablePosition(table, index);
      const shape = SHAPE_DEFAULTS[table.shape || 'ROUND'] || DEFAULT_DIMS;
      const w = table.width || shape.width;
      const h = table.height || shape.height;
      if (pos.x + w + 60 > maxX) maxX = pos.x + w + 60;
      if (pos.y + h + 60 > maxY) maxY = pos.y + h + 60;
    });

    return { width: Math.max(maxX, 800), height: Math.max(maxY, 450) };
  }, [tables, getTablePosition]);

  // ── Handler: Iniciar drag o click ────────────────────────────────────────
  const handlePointerDown = useCallback(
    (e, table) => {
      pointerStart.current = { x: e.clientX, y: e.clientY };
      hasDragged.current = false;
      clickedTableRef.current = table;

      if (!editMode) return;

      const tableId = table.id;
      const index = tables.findIndex((t) => t.id === tableId);
      const pos = getTablePosition(table, index);

      const canvas = canvasRef.current;
      if (!canvas) return;

      const canvasRect = canvas.getBoundingClientRect();
      setDragOffset({
        x: e.clientX - canvasRect.left - pos.x,
        y: e.clientY - canvasRect.top - pos.y,
      });
      setDraggingTableId(tableId);

      e.target.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    },
    [editMode, tables, getTablePosition]
  );

  // ── Handler: Mover durante drag ──────────────────────────────────────────
  const handlePointerMove = useCallback(
    (e) => {
      if (draggingTableId === null || !editMode) return;

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

      setLocalPositions((prev) => ({
        ...prev,
        [draggingTableId]: { x: newX, y: newY },
      }));
    },
    [draggingTableId, dragOffset, editMode]
  );

  // ── Handler: Finalizar drag ──────────────────────────────────────────────
  const handlePointerUp = useCallback(() => {
    const tableId = draggingTableId;
    const table = clickedTableRef.current;

    if (tableId === null) return;

    if (hasDragged.current) {
      // Fue un arrastre → notificar al padre
      const pos = localPositions[tableId];
      if (pos && onTableDragEnd) {
        onTableDragEnd(tableId, pos.x, pos.y);
      }
    } else if (table && onTableClick) {
      // Fue un click sin arrastre → abrir info
      onTableClick(table);
    }

    setDraggingTableId(null);
    clickedTableRef.current = null;
  }, [draggingTableId, localPositions, onTableDragEnd, onTableClick]);

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
          <span>Arrastra las mesas para reubicarlas en el plano</span>
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
        className={`fpc-canvas ${editMode ? 'fpc-canvas-editable' : ''} ${draggingTableId !== null ? 'fpc-canvas-dragging' : ''}`}
        style={{ minHeight: `${canvasDimensions.height}px` }}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Mesas */}
        {tables.map((table, index) => {
          const pos = getTablePosition(table, index);
          const statusCfg = getStatusConfig(table.status);
          const { w, h, borderRadius } = getTableShape(table);
          const isSelected = table.id === selectedTableId;
          const isDragging = table.id === draggingTableId;

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
              onPointerDown={(e) => handlePointerDown(e, table)}
              role="button"
              tabIndex={0}
              aria-label={`Mesa ${table.tableNumber || table.id} — ${statusCfg.label}`}
              title={`Mesa ${table.tableNumber || table.id} — ${statusCfg.label}`}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  if (onTableClick) onTableClick(table);
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
            {saving ? 'Guardando...' : 'Arrastra las mesas para mover'}
          </span>
        )}
      </div>
    </div>
  );
});

export default FloorPlanCanvas;
