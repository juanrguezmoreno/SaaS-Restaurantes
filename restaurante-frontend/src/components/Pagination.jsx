import { useMemo } from 'react';
import { buildPageItems } from '../lib/pagination';

/**
 * Controles de paginación para tablas servidas por el backend.
 *
 * Muestra el rango visible sobre el total, la navegación compacta y el selector
 * de tamaño de página. No decide nada por sí mismo: informa de la intención con
 * `onPageChange` / `onSizeChange` y quien lo usa pide los datos.
 *
 * @param {object} props
 * @param {number} props.page          Página actual (base 0).
 * @param {number} props.size          Tamaño de página actual.
 * @param {number} props.totalElements Total de registros del backend.
 * @param {number} props.totalPages    Total de páginas del backend.
 * @param {number[]} [props.sizeOptions]
 * @param {string} [props.itemLabel]   Nombre del recurso en plural.
 * @param {boolean} [props.disabled]   Desactiva todo mientras se carga.
 */
const Pagination = ({
  page = 0,
  size = 25,
  totalElements = 0,
  totalPages = 0,
  sizeOptions = [10, 25, 50, 100],
  itemLabel = 'registros',
  disabled = false,
  onPageChange,
  onSizeChange,
}) => {
  const safeTotalPages = Math.max(0, Number(totalPages) || 0);
  const safePage = Math.max(0, Number(page) || 0);
  const safeTotal = Math.max(0, Number(totalElements) || 0);

  const pageItems = useMemo(
    () => buildPageItems(safePage, safeTotalPages),
    [safePage, safeTotalPages]
  );

  const isFirst = safePage <= 0;
  const isLast = safeTotalPages === 0 || safePage >= safeTotalPages - 1;

  // Rango humano: "Mostrando 1–25 de 487 restaurantes".
  const from = safeTotal === 0 ? 0 : safePage * size + 1;
  const to = safeTotal === 0 ? 0 : Math.min(safeTotal, safePage * size + size);

  const goTo = (target) => {
    if (disabled) return;
    if (target < 0 || (safeTotalPages > 0 && target > safeTotalPages - 1)) return;
    if (target === safePage) return;
    onPageChange?.(target);
  };

  return (
    <div className="table-pagination">
      <div className="table-pagination-summary">
        {safeTotal === 0
          ? `Sin ${itemLabel}`
          : `Mostrando ${from}–${to} de ${safeTotal} ${itemLabel}`}
      </div>

      <div className="table-pagination-controls">
        <nav aria-label="Paginación de resultados">
          <ul className="pagination pagination-sm mb-0">
            <li className={`page-item${isFirst || disabled ? ' disabled' : ''}`}>
              <button
                type="button"
                className="page-link"
                onClick={() => goTo(safePage - 1)}
                disabled={isFirst || disabled}
                aria-label="Página anterior"
              >
                Anterior
              </button>
            </li>

            {pageItems.map((item) =>
              typeof item === 'number' ? (
                <li
                  key={item}
                  className={`page-item${item === safePage ? ' active' : ''}${disabled ? ' disabled' : ''}`}
                >
                  <button
                    type="button"
                    className="page-link"
                    onClick={() => goTo(item)}
                    disabled={disabled}
                    aria-label={`Página ${item + 1}`}
                    aria-current={item === safePage ? 'page' : undefined}
                  >
                    {item + 1}
                  </button>
                </li>
              ) : (
                <li key={item} className="page-item disabled">
                  <span className="page-link">…</span>
                </li>
              )
            )}

            <li className={`page-item${isLast || disabled ? ' disabled' : ''}`}>
              <button
                type="button"
                className="page-link"
                onClick={() => goTo(safePage + 1)}
                disabled={isLast || disabled}
                aria-label="Página siguiente"
              >
                Siguiente
              </button>
            </li>
          </ul>
        </nav>

        <div className="table-pagination-size">
          <label htmlFor="page-size-select">Por página</label>
          <select
            id="page-size-select"
            className="form-select form-select-sm"
            value={size}
            onChange={(e) => onSizeChange?.(Number(e.target.value))}
            disabled={disabled}
          >
            {sizeOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};

export default Pagination;
