import { buildPageItems } from './pagination';

describe('buildPageItems', () => {
  it('sin páginas no devuelve nada', () => {
    expect(buildPageItems(0, 0)).toEqual([]);
  });

  it('con pocas páginas las muestra todas', () => {
    expect(buildPageItems(0, 5)).toEqual([0, 1, 2, 3, 4]);
  });

  it('con muchas páginas colapsa el final', () => {
    // 20 páginas en la primera: nunca 20 botones.
    expect(buildPageItems(0, 20)).toEqual([0, 1, 'gap-right', 19]);
  });

  it('con muchas páginas colapsa el principio', () => {
    expect(buildPageItems(19, 20)).toEqual([0, 'gap-left', 18, 19]);
  });

  it('en el medio colapsa por los dos lados y deja las vecinas', () => {
    expect(buildPageItems(10, 20)).toEqual([0, 'gap-left', 9, 10, 11, 'gap-right', 19]);
  });

  it('nunca deja una elipsis que oculte una sola página', () => {
    // Con 8 páginas y la actual en la 2, el hueco izquierdo sería de una sola
    // página: se muestra el número en vez de los puntos.
    expect(buildPageItems(2, 8)).toEqual([0, 1, 2, 3, 'gap-right', 7]);
  });
});
