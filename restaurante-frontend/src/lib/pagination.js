/**
 * Construye la lista compacta de páginas a mostrar en los controles.
 *
 * Con 20 páginas no se pintan 20 botones: se muestran la primera, la última, la
 * actual y sus vecinas, y el resto se colapsa en elipsis. Devuelve números de
 * página (base 0) y las cadenas 'gap-left' / 'gap-right' para los saltos.
 *
 * @param {number} currentPage Página actual, base 0.
 * @param {number} totalPages  Total de páginas.
 * @param {number} [siblings]  Cuántas páginas mostrar a cada lado de la actual.
 * @returns {Array<number|'gap-left'|'gap-right'>}
 */
export const buildPageItems = (currentPage, totalPages, siblings = 1) => {
  if (totalPages <= 0) return [];

  // Primera + última + actual + vecinas + dos elipsis.
  const maxSlots = siblings * 2 + 5;
  if (totalPages <= maxSlots) {
    return Array.from({ length: totalPages }, (_, i) => i);
  }

  const first = 0;
  const last = totalPages - 1;
  const start = Math.max(first + 1, currentPage - siblings);
  const end = Math.min(last - 1, currentPage + siblings);

  const items = [first];

  if (start > first + 1) {
    items.push('gap-left');
  }

  for (let page = start; page <= end; page += 1) {
    items.push(page);
  }

  if (end < last - 1) {
    items.push('gap-right');
  }

  items.push(last);
  return items;
};
