import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

// ─── Dobles de los servicios ────────────────────────────────────────────────

vi.mock('../services/customerService', () => ({
  getCustomers: vi.fn(),
  getCustomerStats: vi.fn(),
  getCustomerById: vi.fn(),
  getCustomerReservations: vi.fn().mockResolvedValue([]),
  createCustomer: vi.fn().mockResolvedValue({ id: 99 }),
  updateCustomer: vi.fn().mockResolvedValue({ id: 1 }),
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
  DEFAULT_PAGE_SIZE: 25,
}));

vi.mock('../services/restaurantService', () => ({
  getRestaurants: vi.fn().mockResolvedValue([{ id: 1, name: 'La Buena Mesa' }]),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'super.admin', role: 'SUPER_ADMIN' } }),
}));

import { getCustomers, getCustomerStats, getCustomerById } from '../services/customerService';
import Customers from './Customers';

// ─── Datos de apoyo ─────────────────────────────────────────────────────────

const makeCustomer = (id) => ({
  id,
  firstName: `Nombre${id}`,
  lastName: `Apellido${id}`,
  email: `cliente${id}@ejemplo.com`,
  phone: `61000000${id}`,
  notes: '',
  restaurantId: 1,
  restaurantName: 'La Buena Mesa',
  restaurantNames: ['La Buena Mesa'],
  createdAt: '2026-01-15T10:00:00',
  totalReservations: id <= 2 ? 3 : 0,
  lastReservationDate: id <= 2 ? '2026-07-20' : null,
});

/** Página con los ids dados, de 40 elementos en total (2 páginas de 25). */
const pageOf = (ids, overrides = {}) => ({
  content: ids.map(makeCustomer),
  page: 0,
  size: 25,
  totalElements: 40,
  totalPages: 2,
  first: true,
  last: false,
  empty: false,
  ...overrides,
});

const emptyPage = () => ({
  content: [],
  page: 0,
  size: 25,
  totalElements: 0,
  totalPages: 0,
  first: true,
  last: true,
  empty: true,
});

beforeEach(() => {
  vi.clearAllMocks();
  getCustomers.mockResolvedValue(pageOf([1, 2, 3]));
  getCustomerStats.mockResolvedValue({
    total: 40,
    recurrentes: 12,
    nuevosEsteMes: 5,
    sinVenir: 7,
  });
  getCustomerById.mockResolvedValue(makeCustomer(1));
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// ─── Carga y cifras ─────────────────────────────────────────────────────────

describe('Clientes — carga y cifras', () => {
  it('pide la primera página con el tamaño por defecto', async () => {
    render(<Customers />);

    expect(await screen.findByText('Nombre1 Apellido1')).toBeInTheDocument();
    expect(getCustomers).toHaveBeenCalledWith({
      page: 0,
      size: 25,
      search: '',
      restaurantId: undefined,
      segment: undefined,
      sort: 'name',
      direction: 'asc',
    });
  });

  it('muestra las cifras del backend, no las de la página', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    // 40, 12, 5 y 7 vienen del servidor; la página solo trae 3 filas.
    expect(screen.getByText('40')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(getCustomerStats).toHaveBeenCalledTimes(1);
  });

  it('muestra el contacto como línea secundaria del nombre', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    expect(screen.getByText('cliente1@ejemplo.com · 610000001')).toBeInTheDocument();
  });

  it('no deja la tabla vacía sin explicación mientras carga', async () => {
    let resolve;
    getCustomers.mockImplementation(
      () => new Promise((r) => {
        resolve = r;
      })
    );

    const { container } = render(<Customers />);
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);

    resolve(pageOf([1]));
    expect(await screen.findByText('Nombre1 Apellido1')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay ningún cliente', async () => {
    getCustomers.mockResolvedValue(emptyPage());
    render(<Customers />);

    expect(await screen.findByText('No hay clientes registrados')).toBeInTheDocument();
  });

  it('muestra el error con opción de reintentar', async () => {
    getCustomers.mockRejectedValueOnce(new Error('Fallo del servidor'));
    render(<Customers />);

    expect(await screen.findByText('Fallo del servidor')).toBeInTheDocument();

    getCustomers.mockResolvedValue(pageOf([1]));
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Nombre1 Apellido1')).toBeInTheDocument();
  });
});

// ─── Segmentos ──────────────────────────────────────────────────────────────

describe('Clientes — segmentos', () => {
  it('pulsar una tarjeta manda el segmento al backend', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.click(screen.getByRole('button', { name: /recurrentes/i }));

    await waitFor(() =>
      expect(getCustomers).toHaveBeenLastCalledWith(
        expect.objectContaining({ segment: 'recurrentes', page: 0 })
      )
    );
  });

  it('volver a pulsar la tarjeta activa quita el filtro', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    const tarjeta = screen.getByRole('button', { name: /recurrentes/i });
    await userEvent.click(tarjeta);
    await waitFor(() =>
      expect(getCustomers).toHaveBeenLastCalledWith(
        expect.objectContaining({ segment: 'recurrentes' })
      )
    );

    await userEvent.click(tarjeta);
    await waitFor(() =>
      expect(getCustomers).toHaveBeenLastCalledWith(
        expect.objectContaining({ segment: undefined })
      )
    );
  });

  it('las cifras no cambian al elegir un segmento', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.click(screen.getByRole('button', { name: /sin venir en 3 meses/i }));

    await waitFor(() =>
      expect(getCustomers).toHaveBeenLastCalledWith(
        expect.objectContaining({ segment: 'sinVenir' })
      )
    );
    // Si las cifras dependieran del segmento, las otras tarjetas se moverían.
    expect(getCustomerStats).toHaveBeenCalledTimes(1);
  });
});

// ─── Paginación ─────────────────────────────────────────────────────────────

describe('Clientes — paginación', () => {
  it('muestra el rango sobre el total', async () => {
    render(<Customers />);

    expect(await screen.findByText(/Mostrando 1–25 de 40 clientes/)).toBeInTheDocument();
  });

  it('navega a la página siguiente pidiéndosela al backend', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    getCustomers.mockResolvedValue(pageOf([4, 5], { page: 1, first: false, last: true }));
    await userEvent.click(screen.getByRole('button', { name: /página siguiente/i }));

    await waitFor(() =>
      expect(getCustomers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))
    );
    expect(await screen.findByText('Nombre4 Apellido4')).toBeInTheDocument();
  });

  it('desactiva Anterior en la primera página', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    expect(screen.getByRole('button', { name: /página anterior/i })).toBeDisabled();
  });

  it('cambiar el tamaño de página vuelve a la primera', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.selectOptions(screen.getByLabelText(/por página/i), '50');

    await waitFor(() =>
      expect(getCustomers).toHaveBeenLastCalledWith(
        expect.objectContaining({ size: 50, page: 0 })
      )
    );
  });
});

// ─── Búsqueda, filtro y orden ───────────────────────────────────────────────

describe('Clientes — búsqueda, filtro y orden', () => {
  it('agrupa las pulsaciones en una sola consulta y vuelve a la primera página', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');
    const llamadasPrevias = getCustomers.mock.calls.length;

    await userEvent.type(screen.getByLabelText(/buscar clientes/i), 'ana');

    expect(getCustomers.mock.calls.length).toBe(llamadasPrevias);

    await waitFor(() =>
      expect(getCustomers).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'ana', page: 0 })
      )
    );
    expect(getCustomers.mock.calls.length).toBe(llamadasPrevias + 1);
  });

  it('filtra por restaurante en el backend', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.selectOptions(screen.getByLabelText(/filtrar por restaurante/i), '1');

    await waitFor(() =>
      expect(getCustomers).toHaveBeenLastCalledWith(
        expect.objectContaining({ restaurantId: '1', page: 0 })
      )
    );
  });

  it('ordena por nombre alternando la dirección', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.click(screen.getByRole('button', { name: 'Cliente' }));

    await waitFor(() =>
      expect(getCustomers).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'name', direction: 'desc' })
      )
    );
    expect(screen.getByRole('button', { name: 'Cliente' }).closest('th'))
      .toHaveAttribute('aria-sort', 'descending');
  });

  it('muestra el estado sin resultados y permite limpiar los filtros', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    getCustomers.mockResolvedValue(emptyPage());
    await userEvent.type(screen.getByLabelText(/buscar clientes/i), 'zzz');

    const aviso = await screen.findByText(/Ningún cliente coincide con «zzz»/);
    expect(aviso).toBeInTheDocument();

    getCustomers.mockResolvedValue(pageOf([1, 2, 3]));
    await userEvent.click(
      within(aviso.closest('td')).getByRole('button', { name: /limpiar búsqueda y filtros/i })
    );

    expect(await screen.findByText('Nombre1 Apellido1')).toBeInTheDocument();
  });
});

// ─── Acciones y estado retirado ─────────────────────────────────────────────

const abrirMenuDeLaPrimeraFila = async () => {
  const menus = screen.getAllByRole('button', { name: /^Acciones de/ });
  await userEvent.click(menus[0]);
};

describe('Clientes — menú de acciones', () => {
  it('copia el email del cliente', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /copiar email/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('cliente1@ejemplo.com');
    expect(await screen.findByText(/Email copiado/)).toBeInTheDocument();
  });

  it('abre el formulario de edición con los datos del cliente', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /editar cliente/i }));

    expect(await screen.findByText('Editar Cliente')).toBeInTheDocument();
    expect(screen.getByDisplayValue('cliente1@ejemplo.com')).toBeInTheDocument();
  });

  it('no ofrece desactivar: ese estado no existe en el backend', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    await abrirMenuDeLaPrimeraFila();

    expect(screen.queryByRole('menuitem', { name: /desactivar/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: /reactivar/i })).not.toBeInTheDocument();
  });

  it('la tabla ya no tiene columna de estado', async () => {
    render(<Customers />);
    await screen.findByText('Nombre1 Apellido1');

    expect(screen.queryByRole('columnheader', { name: /estado/i })).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/filtrar por estado/i)).not.toBeInTheDocument();
  });
});
