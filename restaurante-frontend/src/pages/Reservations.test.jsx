import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi, beforeEach, describe, it, expect } from 'vitest';

vi.mock('../services/reservationService', () => ({
  getReservations: vi.fn(),
  getReservationStats: vi.fn(),
  getReservationsByDate: vi.fn().mockResolvedValue([]),
  createReservation: vi.fn(),
  updateReservation: vi.fn(),
  deleteReservation: vi.fn(),
  updateReservationStatus: vi.fn(),
  getReservationsByRestaurantAndDate: vi.fn().mockResolvedValue([]),
  getTimeSlots: vi.fn().mockResolvedValue([]),
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
  DEFAULT_PAGE_SIZE: 25,
}));
vi.mock('../services/restaurantService', () => ({
  getRestaurants: vi.fn().mockResolvedValue([{ id: 7, name: 'La Buena Mesa' }]),
}));
vi.mock('../services/tableService', () => ({ getTablesByRestaurant: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/customerService', () => ({
  getCustomers: vi.fn().mockResolvedValue({
    content: [], page: 0, size: 100, totalElements: 0, totalPages: 0,
    first: true, last: true, empty: true,
  }),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { roles: ['ROLE_SUPER_ADMIN'] } }),
}));

import {
  getReservations,
  getReservationStats,
} from '../services/reservationService';
import Reservations from './Reservations';

/** Construye una reserva de listado con la forma que devuelve el backend. */
const reserva = (id, extra = {}) => ({
  id,
  customerId: 100 + id,
  customerName: `Cliente ${id}`,
  customerEmail: `cliente${id}@ejemplo.com`,
  diningTableId: null,
  tableNumber: null,
  restaurantId: 7,
  restaurantName: 'La Buena Mesa',
  reservationDate: '2026-09-01',
  reservationTime: '20:00:00',
  partySize: 2,
  status: 'PENDING',
  notes: '',
  holdExpiresAt: null,
  holdStatus: 'NONE',
  ...extra,
});

/** Sobre paginado con los valores derivados ya calculados. */
const pagina = (content, { page = 0, size = 25, totalElements = content.length } = {}) => {
  const totalPages = Math.ceil(totalElements / size);
  return {
    content,
    page,
    size,
    totalElements,
    totalPages,
    first: page === 0,
    last: totalPages === 0 || page >= totalPages - 1,
    empty: content.length === 0,
  };
};

const cifras = (extra = {}) => ({
  total: 40,
  pendientes: 3,
  hoyConfirmadas: 5,
  proximasConfirmadas: 12,
  canceladasFuturas: 1,
  historial: 20,
  ...extra,
});

const renderizar = () => render(<MemoryRouter><Reservations /></MemoryRouter>);

beforeEach(() => {
  vi.clearAllMocks();
  getReservations.mockResolvedValue(pagina([reserva(1), reserva(2)]));
  getReservationStats.mockResolvedValue(cifras());
});

describe('Panel de reservas', () => {
  it('pide la primera página de solicitudes al montar', async () => {
    renderizar();

    await waitFor(() => expect(getReservations).toHaveBeenCalled());
    expect(getReservations).toHaveBeenCalledWith(
      expect.objectContaining({ page: 0, size: 25, view: 'solicitudes' })
    );
    expect(await screen.findByText('Cliente 1')).toBeInTheDocument();
  });

  it('las cifras salen del servidor, no de la página cargada', async () => {
    renderizar();

    // 2 filas en la página, pero la tarjeta dice 40: las cuenta el backend.
    await waitFor(() => expect(getReservationStats).toHaveBeenCalled());
    const tarjetaTotal = (await screen.findByText('Total Reservas')).closest('.stat-card');
    expect(within(tarjetaTotal).getByText('40')).toBeInTheDocument();

    // Confirmadas = hoy + próximas.
    const tarjetaConfirmadas = screen.getByText('Confirmadas').closest('.stat-card');
    expect(within(tarjetaConfirmadas).getByText('17')).toBeInTheDocument();
  });

  it('cambiar de pestaña consulta esa vista y vuelve a la página cero', async () => {
    renderizar();
    await screen.findByText('Cliente 1');

    getReservations.mockClear();
    await userEvent.click(screen.getByRole('tab', { name: /historial/i }));

    await waitFor(() =>
      expect(getReservations).toHaveBeenCalledWith(
        expect.objectContaining({ view: 'historial', page: 0 })
      )
    );
  });

  it('las cifras no cambian al cambiar de pestaña', async () => {
    renderizar();
    await screen.findByText('Cliente 1');
    await waitFor(() => expect(getReservationStats).toHaveBeenCalledTimes(1));

    await userEvent.click(screen.getByRole('tab', { name: /^todas/i }));
    await waitFor(() =>
      expect(getReservations).toHaveBeenCalledWith(expect.objectContaining({ view: 'todas' }))
    );

    // La vista cambia; las cifras no se vuelven a pedir.
    expect(getReservationStats).toHaveBeenCalledTimes(1);
  });

  it('el buscador espera y dispara una sola petición', async () => {
    renderizar();
    await screen.findByText('Cliente 1');

    getReservations.mockClear();
    await userEvent.type(screen.getByLabelText(/buscar reservas/i), 'ana');

    // Tres pulsaciones, una sola consulta gracias al retardo.
    await waitFor(
      () => expect(getReservations).toHaveBeenCalledWith(expect.objectContaining({ search: 'ana' })),
      { timeout: 2000 }
    );
    expect(getReservations).toHaveBeenCalledTimes(1);
  });

  it('el buscador no pierde el foco mientras se recarga', async () => {
    renderizar();
    await screen.findByText('Cliente 1');

    const buscador = screen.getByLabelText(/buscar reservas/i);
    await userEvent.type(buscador, 'ana');

    await waitFor(() =>
      expect(getReservations).toHaveBeenCalledWith(expect.objectContaining({ search: 'ana' })),
      { timeout: 2000 }
    );
    expect(document.activeElement).toBe(buscador);
  });

  it('cambiar de página pide la siguiente', async () => {
    getReservations.mockResolvedValue(pagina([reserva(1)], { size: 25, totalElements: 60 }));
    renderizar();
    await screen.findByText('Cliente 1');

    getReservations.mockClear();
    await userEvent.click(screen.getByRole('button', { name: /página siguiente/i }));

    await waitFor(() =>
      expect(getReservations).toHaveBeenCalledWith(expect.objectContaining({ page: 1 }))
    );
  });

  it('cambiar el tamaño de página vuelve a la primera', async () => {
    getReservations.mockResolvedValue(pagina([reserva(1)], { size: 25, totalElements: 60 }));
    renderizar();
    await screen.findByText('Cliente 1');

    getReservations.mockClear();
    await userEvent.selectOptions(screen.getByLabelText(/por página/i), '50');

    await waitFor(() =>
      expect(getReservations).toHaveBeenCalledWith(expect.objectContaining({ size: 50, page: 0 }))
    );
  });

  it('estado y fecha solo aparecen en Todas e Historial', async () => {
    renderizar();
    await screen.findByText('Cliente 1');

    // Vista «solicitudes»: el estado ya lo fija la vista.
    expect(screen.queryByLabelText(/filtrar por estado/i)).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/filtrar por fecha/i)).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: /^todas/i }));

    expect(await screen.findByLabelText(/filtrar por estado/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/filtrar por fecha/i)).toBeInTheDocument();
  });

  it('distingue una vista vacía de una búsqueda sin resultados', async () => {
    getReservations.mockResolvedValue(pagina([]));
    renderizar();

    expect(await screen.findByText(/no hay solicitudes pendientes/i)).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText(/buscar reservas/i), 'zzz');

    expect(
      await screen.findByText(/no se encontraron reservas con los filtros actuales/i, {}, { timeout: 2000 })
    ).toBeInTheDocument();
  });

  it('el menú de acciones abre el detalle de la reserva', async () => {
    renderizar();
    await screen.findByText('Cliente 1');

    await userEvent.click(screen.getByRole('button', { name: /acciones de la reserva 1/i }));
    await userEvent.click(await screen.findByRole('menuitem', { name: /ver detalles/i }));

    expect(await screen.findByText(/detalle de reserva/i)).toBeInTheDocument();
  });

  it('una reserva en estado final no ofrece cambios de estado', async () => {
    getReservations.mockResolvedValue(pagina([reserva(1, { status: 'COMPLETED' })]));
    renderizar();
    await screen.findByText('Cliente 1');

    await userEvent.click(screen.getByRole('button', { name: /acciones de la reserva 1/i }));

    // COMPLETED es final: la matriz del backend no admite salida.
    expect(screen.queryByRole('menuitem', { name: /marcar como/i })).not.toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: /ver detalles/i })).toBeInTheDocument();
  });

  it('filtrar por restaurante recalcula también las cifras', async () => {
    renderizar();
    await screen.findByText('Cliente 1');
    await waitFor(() => expect(getReservationStats).toHaveBeenCalledTimes(1));

    await userEvent.selectOptions(screen.getByLabelText(/filtrar por restaurante/i), '7');

    await waitFor(() =>
      expect(getReservationStats).toHaveBeenCalledWith({ restaurantId: '7' })
    );
    expect(getReservations).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: '7', page: 0 })
    );
  });
});
