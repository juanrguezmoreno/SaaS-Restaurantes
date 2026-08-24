import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi, beforeEach, describe, it, expect } from 'vitest';

vi.mock('../services/adminRestaurantService', () => ({
  getAdminRestaurants: vi.fn(),
}));

import { getAdminRestaurants } from '../services/adminRestaurantService';
import RestaurantMultiSelect from './RestaurantMultiSelect';

const pagina = (content, totalElements = content.length) => ({
  content, page: 0, size: 10, totalElements,
  totalPages: Math.ceil(totalElements / 10),
  first: true, last: true, empty: content.length === 0,
});

const TRES = [
  { id: 1, name: 'La Casa del Chef' },
  { id: 2, name: 'La Parrilla del Norte' },
  { id: 3, name: 'Sushi Master' },
];

beforeEach(() => {
  vi.clearAllMocks();
  getAdminRestaurants.mockResolvedValue(pagina(TRES));
});

/** Renderiza el selector controlando su valor, como hace el formulario real. */
const montar = (valorInicial = []) => {
  const onChange = vi.fn();
  const utils = render(
    <RestaurantMultiSelect value={valorInicial} onChange={onChange} />
  );
  return { onChange, ...utils };
};

describe('RestaurantMultiSelect', () => {
  it('no consulta nada hasta que se abre', async () => {
    montar();
    expect(getAdminRestaurants).not.toHaveBeenCalled();
  });

  it('al abrir muestra los primeros restaurantes sin escribir nada', async () => {
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    expect(await screen.findByRole('option', { name: /la casa del chef/i })).toBeInTheDocument();
    expect(getAdminRestaurants).toHaveBeenCalledWith(
      expect.objectContaining({ size: 10, sort: 'name', direction: 'asc' })
    );
  });

  it('busca con retardo y dispara una sola petición', async () => {
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));
    await waitFor(() => expect(getAdminRestaurants).toHaveBeenCalledTimes(1));

    getAdminRestaurants.mockClear();
    await userEvent.type(screen.getByLabelText(/buscar restaurante/i), 'sus');

    await waitFor(
      () => expect(getAdminRestaurants).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'sus' })
      ),
      { timeout: 2000 }
    );
    expect(getAdminRestaurants).toHaveBeenCalledTimes(1);
  });

  it('elegir uno lo comunica al formulario con su nombre', async () => {
    const { onChange } = montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));
    await userEvent.click(await screen.findByRole('option', { name: /sushi master/i }));

    expect(onChange).toHaveBeenCalledWith([{ id: 3, name: 'Sushi Master' }]);
  });

  it('los ya elegidos salen marcados y pulsarlos los quita', async () => {
    const { onChange } = montar([{ id: 3, name: 'Sushi Master' }]);
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    const opcion = await screen.findByRole('option', { name: /sushi master/i });
    expect(opcion).toHaveAttribute('aria-selected', 'true');

    await userEvent.click(opcion);
    expect(onChange).toHaveBeenCalledWith([]);
  });

  it('conserva la etiqueta de lo elegido aunque no esté en los resultados', async () => {
    // El caso de edición: el restaurante asignado no aparece al buscar otra cosa.
    montar([{ id: 99, name: 'El Rincón' }]);
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));
    await screen.findByRole('option', { name: /la casa del chef/i });

    expect(screen.getByText('El Rincón')).toBeInTheDocument();
  });

  it('la etiqueta se quita con su botón', async () => {
    const { onChange } = montar([
      { id: 1, name: 'La Casa del Chef' },
      { id: 3, name: 'Sushi Master' },
    ]);

    await userEvent.click(screen.getByRole('button', { name: /quitar sushi master/i }));

    expect(onChange).toHaveBeenCalledWith([{ id: 1, name: 'La Casa del Chef' }]);
  });

  it('avisa de cuántos resultados quedan fuera', async () => {
    getAdminRestaurants.mockResolvedValue(pagina(TRES, 27));
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    expect(await screen.findByText(/y 24 más, afina la búsqueda/i)).toBeInTheDocument();
  });

  it('dice cuando no hay resultados', async () => {
    getAdminRestaurants.mockResolvedValue(pagina([]));
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    expect(await screen.findByText(/ningún restaurante coincide/i)).toBeInTheDocument();
  });

  it('ofrece reintentar cuando la consulta falla', async () => {
    getAdminRestaurants.mockRejectedValueOnce(new Error('Error de conexión'));
    montar();
    await userEvent.click(screen.getByLabelText(/buscar restaurante/i));

    const aviso = await screen.findByRole('alert');
    expect(aviso).toHaveTextContent(/no se pudieron cargar/i);

    getAdminRestaurants.mockResolvedValue(pagina(TRES));
    await userEvent.click(within(aviso).getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByRole('option', { name: /la casa del chef/i })).toBeInTheDocument();
  });

  it('se recorre y se elige con el teclado', async () => {
    const { onChange } = montar();
    const campo = screen.getByLabelText(/buscar restaurante/i);
    await userEvent.click(campo);
    await screen.findByRole('option', { name: /la casa del chef/i });

    await userEvent.keyboard('{ArrowDown}{Enter}');

    expect(onChange).toHaveBeenCalledWith([{ id: 2, name: 'La Parrilla del Norte' }]);
  });

  it('Escape cierra la lista y devuelve el foco al campo', async () => {
    montar();
    const campo = screen.getByLabelText(/buscar restaurante/i);
    await userEvent.click(campo);
    await screen.findByRole('option', { name: /la casa del chef/i });

    await userEvent.keyboard('{Escape}');

    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(campo);
  });
});
