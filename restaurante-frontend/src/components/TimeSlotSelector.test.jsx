import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import TimeSlotSelector from './TimeSlotSelector';

const SLOTS = [
  { time: '13:00:00', available: true },
  { time: '13:30:00', available: false },
  { time: '14:00:00', available: true },
];

const setup = (props = {}) => {
  const onChange = vi.fn();
  render(
    <TimeSlotSelector
      slots={SLOTS}
      value=""
      onChange={onChange}
      loading={false}
      error={null}
      onRetry={vi.fn()}
      {...props}
    />
  );
  return { onChange };
};

describe('TimeSlotSelector', () => {
  it('permite seleccionar una hora disponible', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /13:00/ }));

    expect(onChange).toHaveBeenCalledWith('13:00:00');
  });

  it('deshabilita las horas completas con el atributo disabled real', () => {
    setup();

    expect(screen.getByRole('button', { name: /13:30/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /13:00/ })).toBeEnabled();
  });

  it('no dispara onChange al pulsar una hora completa', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /13:30/ }));

    expect(onChange).not.toHaveBeenCalled();
  });

  it('marca como seleccionada solo la hora activa', () => {
    setup({ value: '14:00:00' });

    expect(screen.getByRole('button', { name: /14:00/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /13:00/ })).toHaveAttribute('aria-pressed', 'false');
  });

  it('no pinta ninguna franja que no venga del backend', () => {
    setup();

    expect(screen.getAllByRole('button')).toHaveLength(3);
  });

  it('muestra el estado de carga sin pintar franjas', () => {
    setup({ loading: true });

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /13:00/ })).not.toBeInTheDocument();
  });

  it('avisa cuando no queda ninguna hora disponible', () => {
    setup({ slots: [] });

    expect(
      screen.getByText('No hay horarios disponibles para la fecha y el número de personas seleccionados.')
    ).toBeInTheDocument();
  });

  it('permite reintentar cuando la consulta ha fallado', async () => {
    const onRetry = vi.fn();
    setup({ error: 'Error de conexión.', onRetry });

    expect(screen.getByText('Error de conexión.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));

    expect(onRetry).toHaveBeenCalled();
  });
});
