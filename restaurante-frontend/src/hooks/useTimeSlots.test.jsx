import { renderHook, waitFor } from '@testing-library/react';
import { vi } from 'vitest';
import useTimeSlots from './useTimeSlots';

const SLOTS = [{ time: '13:00:00', available: true }];

describe('useTimeSlots', () => {
  it('consulta las franjas cuando hay restaurante, fecha y comensales', async () => {
    const fetcher = vi.fn().mockResolvedValue(SLOTS);

    const { result } = renderHook(() =>
      useTimeSlots({ fetcher, restaurantId: 1, date: '2026-08-15', partySize: 2 })
    );

    await waitFor(() => expect(result.current.slots).toEqual(SLOTS));
    expect(fetcher).toHaveBeenCalledWith(1, '2026-08-15', 2);
  });

  it('no consulta nada si falta la fecha', () => {
    const fetcher = vi.fn();

    renderHook(() => useTimeSlots({ fetcher, restaurantId: 1, date: '', partySize: 2 }));

    expect(fetcher).not.toHaveBeenCalled();
  });

  it('limpia la hora seleccionada al cambiar la fecha', async () => {
    const fetcher = vi.fn().mockResolvedValue(SLOTS);
    const onReset = vi.fn();

    const { rerender } = renderHook(
      ({ date }) => useTimeSlots({ fetcher, restaurantId: 1, date, partySize: 2, onReset }),
      { initialProps: { date: '2026-08-15' } }
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    rerender({ date: '2026-08-16' });

    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    expect(onReset).toHaveBeenCalled();
  });

  it('recalcula la disponibilidad al cambiar el número de comensales', async () => {
    const fetcher = vi.fn().mockResolvedValue(SLOTS);

    const { rerender } = renderHook(
      ({ partySize }) => useTimeSlots({ fetcher, restaurantId: 1, date: '2026-08-15', partySize }),
      { initialProps: { partySize: 2 } }
    );
    await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));

    rerender({ partySize: 6 });

    await waitFor(() => expect(fetcher).toHaveBeenLastCalledWith(1, '2026-08-15', 6));
  });

  it('expone el error y permite reintentar', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('Servidor caído'));

    const { result } = renderHook(() =>
      useTimeSlots({ fetcher, restaurantId: 1, date: '2026-08-15', partySize: 2 })
    );

    await waitFor(() => expect(result.current.error).toBe('Servidor caído'));

    fetcher.mockResolvedValue(SLOTS);
    result.current.retry();

    await waitFor(() => expect(result.current.slots).toEqual(SLOTS));
  });
});
