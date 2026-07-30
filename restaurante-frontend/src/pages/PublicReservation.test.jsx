import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../services/publicReservationService', () => ({
  fetchPublicRestaurant: vi.fn().mockResolvedValue({ id: 1, name: 'La Buena Mesa' }),
  fetchPublicTimeSlots: vi.fn().mockResolvedValue([
    { time: '13:00:00', available: true },
    { time: '13:30:00', available: false },
  ]),
  createPublicReservation: vi.fn().mockResolvedValue({ reservationId: 9 }),
}));

import {
  createPublicReservation,
  fetchPublicTimeSlots,
} from '../services/publicReservationService';
import PublicReservation from './PublicReservation';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/r/1']}>
      <Routes>
        <Route path="/r/:restaurantId" element={<PublicReservation />} />
      </Routes>
    </MemoryRouter>
  );

describe('PublicReservation', () => {
  it('no envía el formulario sin una hora seleccionada', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    await userEvent.type(screen.getByLabelText(/nombre/i), 'Ana García');
    await userEvent.type(screen.getByLabelText(/teléfono/i), '600123456');
    await userEvent.type(screen.getByLabelText(/email/i), 'ana@test.com');
    await userEvent.click(screen.getByRole('button', { name: /enviar solicitud/i }));

    expect(createPublicReservation).not.toHaveBeenCalled();
    expect(screen.getByText('Selecciona una hora.')).toBeInTheDocument();
  });

  it('pide las franjas al backend usando fecha y comensales', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    await userEvent.type(screen.getByLabelText(/fecha/i), '2026-08-15');

    await waitFor(() =>
      expect(fetchPublicTimeSlots).toHaveBeenCalledWith(1, '2026-08-15', 2)
    );
  });
});
