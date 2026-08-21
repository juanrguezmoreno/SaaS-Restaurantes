import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

// vi.mock se eleva por encima de las declaraciones del módulo, así que el sobre
// paginado se escribe en línea en cada mock en vez de en una constante compartida.
vi.mock('../services/reservationService', () => ({
  getReservations: vi.fn().mockResolvedValue({
    content: [], page: 0, size: 25, totalElements: 0, totalPages: 0,
    first: true, last: true, empty: true,
  }),
  getReservationStats: vi.fn().mockResolvedValue({
    total: 0, pendientes: 0, hoyConfirmadas: 0,
    proximasConfirmadas: 0, canceladasFuturas: 0, historial: 0,
  }),
  getReservationsByDate: vi.fn().mockResolvedValue([]),
  createReservation: vi.fn().mockResolvedValue({ id: 1 }),
  updateReservation: vi.fn(),
  deleteReservation: vi.fn(),
  updateReservationStatus: vi.fn(),
  getReservationsByRestaurantAndDate: vi.fn().mockResolvedValue([]),
  getTimeSlots: vi.fn().mockResolvedValue([
    { time: '13:00:00', available: true },
    { time: '13:30:00', available: false },
  ]),
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
  DEFAULT_PAGE_SIZE: 25,
}));
vi.mock('../services/restaurantService', () => ({
  getRestaurants: vi.fn().mockResolvedValue([{ id: 1, name: 'La Buena Mesa' }]),
}));
vi.mock('../services/tableService', () => ({ getTablesByRestaurant: vi.fn().mockResolvedValue([]) }));
// getCustomers devuelve un sobre paginado desde que el listado de clientes pagina.
vi.mock('../services/customerService', () => ({
  getCustomers: vi.fn().mockResolvedValue({
    content: [], page: 0, size: 100, totalElements: 0, totalPages: 0,
    first: true, last: true, empty: true,
  }),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { roles: ['ROLE_SUPER_ADMIN'] } }),
}));

import { getTimeSlots } from '../services/reservationService';
import Reservations from './Reservations';

describe('Wizard de nueva reserva', () => {
  it('consulta las franjas con la fecha y los comensales del mismo paso', async () => {
    render(<MemoryRouter><Reservations /></MemoryRouter>);

    await userEvent.click(await screen.findByTitle('Nueva reserva'));
    // El restaurante también sale en el desplegable de filtros de la barra de
    // herramientas, así que la búsqueda se acota al asistente.
    const asistente = within(await screen.findByRole('dialog'));
    await userEvent.click(await asistente.findByText('La Buena Mesa'));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));

    await userEvent.type(screen.getByLabelText(/fecha/i), '2026-08-15');

    await waitFor(() => expect(getTimeSlots).toHaveBeenCalledWith(1, '2026-08-15', 2));
  });

  it('no deja avanzar a la selección de mesa sin hora elegida', async () => {
    render(<MemoryRouter><Reservations /></MemoryRouter>);

    await userEvent.click(await screen.findByTitle('Nueva reserva'));
    // El restaurante también sale en el desplegable de filtros de la barra de
    // herramientas, así que la búsqueda se acota al asistente.
    const asistente = within(await screen.findByRole('dialog'));
    await userEvent.click(await asistente.findByText('La Buena Mesa'));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await userEvent.type(screen.getByLabelText(/fecha/i), '2026-08-15');
    await screen.findByRole('button', { name: /13:00/ });

    expect(screen.getByRole('button', { name: /buscar mesas/i })).toBeDisabled();
  });
});
