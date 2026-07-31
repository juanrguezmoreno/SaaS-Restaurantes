import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../services/reservationService', () => ({
  getReservations: vi.fn().mockResolvedValue([]),
  createReservation: vi.fn().mockResolvedValue({ id: 1 }),
  updateReservation: vi.fn(),
  deleteReservation: vi.fn(),
  updateReservationStatus: vi.fn(),
  getReservationsByRestaurantAndDate: vi.fn().mockResolvedValue([]),
  getTimeSlots: vi.fn().mockResolvedValue([
    { time: '13:00:00', available: true },
    { time: '13:30:00', available: false },
  ]),
}));
vi.mock('../services/restaurantService', () => ({
  getRestaurants: vi.fn().mockResolvedValue([{ id: 1, name: 'La Buena Mesa' }]),
}));
vi.mock('../services/tableService', () => ({ getTablesByRestaurant: vi.fn().mockResolvedValue([]) }));
vi.mock('../services/customerService', () => ({ getCustomers: vi.fn().mockResolvedValue([]) }));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { roles: ['ROLE_SUPER_ADMIN'] } }),
}));

import { getTimeSlots } from '../services/reservationService';
import Reservations from './Reservations';

describe('Wizard de nueva reserva', () => {
  it('consulta las franjas con la fecha y los comensales del mismo paso', async () => {
    render(<MemoryRouter><Reservations /></MemoryRouter>);

    await userEvent.click(await screen.findByTitle('Nueva reserva'));
    await userEvent.click(await screen.findByText('La Buena Mesa'));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));

    await userEvent.type(screen.getByLabelText(/fecha/i), '2026-08-15');

    await waitFor(() => expect(getTimeSlots).toHaveBeenCalledWith(1, '2026-08-15', 2));
  });

  it('no deja avanzar a la selección de mesa sin hora elegida', async () => {
    render(<MemoryRouter><Reservations /></MemoryRouter>);

    await userEvent.click(await screen.findByTitle('Nueva reserva'));
    await userEvent.click(await screen.findByText('La Buena Mesa'));
    await userEvent.click(screen.getByRole('button', { name: /continuar/i }));
    await userEvent.type(screen.getByLabelText(/fecha/i), '2026-08-15');
    await screen.findByRole('button', { name: /13:00/ });

    expect(screen.getByRole('button', { name: /buscar mesas/i })).toBeDisabled();
  });
});
