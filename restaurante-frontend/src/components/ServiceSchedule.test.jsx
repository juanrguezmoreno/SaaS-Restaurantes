import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import ServiceSchedule from './ServiceSchedule';

const PERIODOS = [
  { _key: 'k1', id: 1, dayOfWeek: 'MONDAY', startTime: '13:00:00', endTime: '16:00:00', name: 'Comidas' },
  { _key: 'k2', id: 2, dayOfWeek: 'MONDAY', startTime: '20:00:00', endTime: '23:00:00', name: 'Cenas' },
];

const setup = (props = {}) => {
  const onChange = vi.fn();
  render(<ServiceSchedule periods={PERIODOS} onChange={onChange} disabled={false} {...props} />);
  return { onChange };
};

describe('ServiceSchedule', () => {
  it('muestra los periodos de cada día y marca como cerrados los días vacíos', () => {
    setup();

    expect(screen.getByDisplayValue('13:00')).toBeInTheDocument();
    expect(screen.getByDisplayValue('20:00')).toBeInTheDocument();
    // Martes a domingo no tienen periodos: seis días cerrados.
    expect(screen.getAllByText('Cerrado')).toHaveLength(6);
  });

  it('añade un periodo al día indicado', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /añadir servicio en martes/i }));

    expect(onChange).toHaveBeenCalled();
    const siguiente = onChange.mock.calls[0][0];
    expect(siguiente).toHaveLength(3);
    expect(siguiente.filter((p) => p.dayOfWeek === 'TUESDAY')).toHaveLength(1);
    // Los periodos nuevos van sin id: el backend los creará.
    expect(siguiente.find((p) => p.dayOfWeek === 'TUESDAY').id).toBeNull();
  });

  it('elimina el periodo indicado', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getAllByRole('button', { name: /eliminar servicio/i })[0]);

    const siguiente = onChange.mock.calls[0][0];
    expect(siguiente).toHaveLength(1);
    expect(siguiente[0]._key).toBe('k2');
  });

  it('marcar un día como cerrado elimina todos sus periodos', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /marcar lunes como cerrado/i }));

    expect(onChange.mock.calls[0][0]).toHaveLength(0);
  });

  it('copia los horarios de un día a los días elegidos', async () => {
    const { onChange } = setup();

    await userEvent.click(screen.getByRole('button', { name: /copiar horarios de lunes/i }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Miércoles' }));
    await userEvent.click(screen.getByRole('button', { name: /^copiar$/i }));

    const siguiente = onChange.mock.calls[0][0];
    const miercoles = siguiente.filter((p) => p.dayOfWeek === 'WEDNESDAY');
    expect(miercoles).toHaveLength(2);
    expect(miercoles.map((p) => p.startTime)).toEqual(['13:00:00', '20:00:00']);
    // Las copias son periodos nuevos, no la misma fila de la base de datos.
    expect(miercoles.every((p) => p.id === null)).toBe(true);
  });

  it('editar la hora de inicio propaga el cambio en el formato del backend', () => {
    // fireEvent y no userEvent.type: el componente es controlado y aquí el padre
    // es un vi.fn() que no re-renderiza, así que escribir carácter a carácter no
    // acumularía valor. Un único change es determinista y prueba lo mismo.
    const { onChange } = setup();

    fireEvent.change(screen.getAllByLabelText(/hora de inicio en lunes/i)[0], {
      target: { value: '12:30' },
    });

    const siguiente = onChange.mock.calls[0][0];
    expect(siguiente.find((p) => p._key === 'k1').startTime).toBe('12:30:00');
  });
});
