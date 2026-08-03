import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { vi } from 'vitest';

vi.mock('../services/restaurantService', () => ({
  getRestaurantById: vi.fn().mockResolvedValue({
    id: 1,
    name: 'La Buena Mesa',
    address: 'Calle Mayor 1',
    phone: '600123456',
    email: 'hola@labuenamesa.com',
    openingTime: '13:00:00',
    closingTime: '23:00:00',
    capacity: 80,
    defaultReservationDurationMinutes: 90,
    description: '',
  }),
  updateRestaurant: vi.fn().mockResolvedValue({ id: 1 }),
}));

vi.mock('../services/servicePeriodService', () => ({
  getServicePeriods: vi.fn().mockResolvedValue([]),
  saveServicePeriods: vi.fn().mockResolvedValue([]),
}));

import { updateRestaurant } from '../services/restaurantService';
import { getServicePeriods, saveServicePeriods } from '../services/servicePeriodService';
import RestaurantSettings from './RestaurantSettings';

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={['/restaurants/1/configuracion']}>
      <Routes>
        <Route path="/restaurants/:restaurantId/configuracion" element={<RestaurantSettings />} />
      </Routes>
    </MemoryRouter>
  );

describe('RestaurantSettings', () => {
  it('muestra el nombre del restaurante que se está configurando', async () => {
    renderPage();

    expect(await screen.findByText('La Buena Mesa')).toBeInTheDocument();
  });

  it('deshabilita Guardar mientras no haya cambios', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    expect(screen.getByRole('button', { name: /guardar información/i })).toBeDisabled();
  });

  it('habilita Guardar al modificar un campo y envía los datos', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    await userEvent.type(screen.getByLabelText(/^tel/i), '789');

    const guardar = screen.getByRole('button', { name: /guardar información/i });
    expect(guardar).toBeEnabled();

    await userEvent.click(guardar);

    await waitFor(() => expect(updateRestaurant).toHaveBeenCalled());
    expect(updateRestaurant.mock.calls[0][0]).toBe('1');
    expect(updateRestaurant.mock.calls[0][1].phone).toBe('600123456789');
  });

  it('avisa de que usa el horario general cuando no hay periodos', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    expect(
      await screen.findByText(/utiliza el horario general/i)
    ).toBeInTheDocument();
  });

  it('guarda los periodos configurados', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');
    await waitFor(() => expect(getServicePeriods).toHaveBeenCalledWith('1'));

    await userEvent.click(screen.getByRole('button', { name: /añadir servicio en lunes/i }));
    await userEvent.click(screen.getByRole('button', { name: /guardar horarios/i }));

    await waitFor(() => expect(saveServicePeriods).toHaveBeenCalled());
    const [id, periodos] = saveServicePeriods.mock.calls[0];
    expect(id).toBe('1');
    expect(periodos).toHaveLength(1);
    expect(periodos[0].dayOfWeek).toBe('MONDAY');
    // El campo interno de React no debe viajar al backend.
    expect(periodos[0]._key).toBeUndefined();
  });

  it('deshabilita Guardar horarios mientras no haya cambios', async () => {
    renderPage();
    await screen.findByText('La Buena Mesa');

    expect(await screen.findByRole('button', { name: /guardar horarios/i })).toBeDisabled();
  });
});
