import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

// ─── Dobles de los servicios ────────────────────────────────────────────────

vi.mock('../services/userService', () => ({
  getUsers: vi.fn(),
  getUserStats: vi.fn(),
  createUser: vi.fn().mockResolvedValue({ id: 99 }),
  updateUser: vi.fn().mockResolvedValue({ id: 1 }),
  deleteUser: vi.fn().mockResolvedValue({ success: true }),
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
  DEFAULT_PAGE_SIZE: 25,
}));

vi.mock('../services/restaurantService', () => ({
  getRestaurants: vi.fn().mockResolvedValue([{ id: 1, name: 'La Buena Mesa' }]),
}));

vi.mock('../services/adminRestaurantService', () => ({
  getAdminRestaurants: vi.fn(),
}));

vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'super.admin', role: 'SUPER_ADMIN' } }),
}));

import { getUsers, getUserStats, createUser, deleteUser } from '../services/userService';
import { getAdminRestaurants } from '../services/adminRestaurantService';
import Employees from './Employees';

// ─── Datos de apoyo ─────────────────────────────────────────────────────────

const makeEmployee = (id, extra = {}) => ({
  id,
  username: `user${id}`,
  email: `user${id}@ejemplo.com`,
  firstName: `Nombre${id}`,
  lastName: `Apellido${id}`,
  phone: `60000000${id}`,
  enabled: id % 2 === 1,
  tenantName: 'Cuenta Demo',
  primaryRestaurantId: 1,
  primaryRestaurantName: 'La Buena Mesa',
  createdAt: '2026-01-15T10:00:00',
  roles: [id <= 2 ? 'ROLE_MANAGER' : 'ROLE_EMPLOYEE'],
  restaurantNames: ['La Buena Mesa'],
  assignedRestaurantIds: [1],
  assignedRestaurants: [{ id: 1, name: 'La Buena Mesa' }],
  ...extra,
});

/** Página con los ids dados, de 40 elementos en total (2 páginas de 25). */
const pageOf = (ids, overrides = {}) => ({
  content: ids.map((id) => makeEmployee(id)),
  page: 0,
  size: 25,
  totalElements: 40,
  totalPages: 2,
  first: true,
  last: false,
  empty: false,
  ...overrides,
});

/** Página con empleados ya construidos (para casos con datos a medida). */
const pageWith = (content, overrides = {}) => ({
  content,
  page: 0,
  size: 25,
  totalElements: content.length,
  totalPages: 1,
  first: true,
  last: true,
  empty: content.length === 0,
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

/** Página de restaurantes que consulta el selector de búsqueda. */
const paginaRestaurantes = (content) => ({
  content,
  page: 0,
  size: 10,
  totalElements: content.length,
  totalPages: 1,
  first: true,
  last: true,
  empty: content.length === 0,
});

beforeEach(() => {
  vi.clearAllMocks();
  getUsers.mockResolvedValue(pageOf([1, 2, 3]));
  getUserStats.mockResolvedValue({ total: 40, active: 31, inactive: 9 });
  getAdminRestaurants.mockResolvedValue(paginaRestaurantes([{ id: 3, name: 'Sushi Master' }]));
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// ─── Carga y métricas ───────────────────────────────────────────────────────

describe('Empleados — carga y métricas', () => {
  it('pide la primera página con el tamaño por defecto', async () => {
    render(<Employees />);

    expect(await screen.findByText('Nombre1 Apellido1')).toBeInTheDocument();
    expect(getUsers).toHaveBeenCalledWith({
      page: 0,
      size: 25,
      search: '',
      role: undefined,
      status: undefined,
      sort: 'name',
      direction: 'asc',
    });
  });

  it('muestra las métricas del backend, no la suma de la página', async () => {
    render(<Employees />);

    // 40 y 31 vienen del servidor; la página solo trae 3 filas.
    expect(await screen.findByText('40')).toBeInTheDocument();
    expect(screen.getByText('31')).toBeInTheDocument();
    expect(getUserStats).toHaveBeenCalledTimes(1);
  });

  it('muestra usuario y email como línea secundaria del nombre', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    expect(screen.getByText('user1 · user1@ejemplo.com')).toBeInTheDocument();
  });

  it('no deja la tabla vacía sin explicación mientras carga', async () => {
    let resolve;
    getUsers.mockImplementation(
      () => new Promise((r) => {
        resolve = r;
      })
    );

    const { container } = render(<Employees />);

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);

    resolve(pageOf([1]));
    expect(await screen.findByText('Nombre1 Apellido1')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay ningún empleado', async () => {
    getUsers.mockResolvedValue(emptyPage());
    render(<Employees />);

    expect(await screen.findByText('No hay empleados registrados')).toBeInTheDocument();
  });

  it('muestra el error con opción de reintentar', async () => {
    getUsers.mockRejectedValueOnce(new Error('Fallo del servidor'));
    render(<Employees />);

    expect(await screen.findByText('Fallo del servidor')).toBeInTheDocument();

    getUsers.mockResolvedValue(pageOf([1]));
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Nombre1 Apellido1')).toBeInTheDocument();
  });
});

// ─── Paginación ─────────────────────────────────────────────────────────────

describe('Empleados — paginación', () => {
  it('muestra el rango sobre el total', async () => {
    render(<Employees />);

    expect(await screen.findByText(/Mostrando 1–25 de 40 empleados/)).toBeInTheDocument();
  });

  it('navega a la página siguiente pidiéndosela al backend', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    getUsers.mockResolvedValue(pageOf([4, 5], { page: 1, first: false, last: true }));
    await userEvent.click(screen.getByRole('button', { name: /página siguiente/i }));

    await waitFor(() =>
      expect(getUsers).toHaveBeenLastCalledWith(expect.objectContaining({ page: 1 }))
    );
    expect(await screen.findByText('Nombre4 Apellido4')).toBeInTheDocument();
  });

  it('desactiva Anterior en la primera página', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    expect(screen.getByRole('button', { name: /página anterior/i })).toBeDisabled();
  });

  it('cambiar el tamaño de página vuelve a la primera', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.selectOptions(screen.getByLabelText(/por página/i), '50');

    await waitFor(() =>
      expect(getUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ size: 50, page: 0 })
      )
    );
  });
});

// ─── Búsqueda y filtros ─────────────────────────────────────────────────────

describe('Empleados — búsqueda y filtros', () => {
  it('agrupa las pulsaciones en una sola consulta y vuelve a la primera página', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');
    const llamadasPrevias = getUsers.mock.calls.length;

    await userEvent.type(screen.getByLabelText(/buscar empleados/i), 'ana');

    // Sin cumplirse el debounce no se ha consultado de nuevo.
    expect(getUsers.mock.calls.length).toBe(llamadasPrevias);

    await waitFor(() =>
      expect(getUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'ana', page: 0 })
      )
    );
    expect(getUsers.mock.calls.length).toBe(llamadasPrevias + 1);
  });

  it('filtra por rol en el backend', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.selectOptions(screen.getByLabelText(/filtrar por rol/i), 'MANAGER');

    await waitFor(() =>
      expect(getUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ role: 'MANAGER', page: 0 })
      )
    );
  });

  it('filtra por estado en el backend', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.selectOptions(screen.getByLabelText(/filtrar por estado/i), 'inactive');

    await waitFor(() =>
      expect(getUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ status: 'inactive', page: 0 })
      )
    );
  });

  it('muestra el estado sin resultados y permite limpiar los filtros', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    getUsers.mockResolvedValue(emptyPage());
    await userEvent.type(screen.getByLabelText(/buscar empleados/i), 'zzz');

    const aviso = await screen.findByText(/Ningún empleado coincide con los filtros/);
    expect(aviso).toBeInTheDocument();

    getUsers.mockResolvedValue(pageOf([1, 2, 3]));
    await userEvent.click(
      within(aviso.closest('td')).getByRole('button', { name: /limpiar filtros/i })
    );

    expect(await screen.findByText('Nombre1 Apellido1')).toBeInTheDocument();
  });
});

// ─── Ordenación ─────────────────────────────────────────────────────────────

describe('Empleados — ordenación', () => {
  it('alterna la dirección al pulsar la misma columna', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.click(screen.getByRole('button', { name: 'Empleado' }));

    await waitFor(() =>
      expect(getUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'name', direction: 'desc' })
      )
    );
  });

  it('ordena por otra columna en ascendente y lo indica', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.click(screen.getByRole('button', { name: 'Alta' }));

    await waitFor(() =>
      expect(getUsers).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'createdAt', direction: 'asc' })
      )
    );

    expect(screen.getByRole('button', { name: 'Alta' }).closest('th'))
      .toHaveAttribute('aria-sort', 'ascending');
  });

  it('no ofrece ordenar por rol: es un filtro, no una columna ordenable', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    expect(screen.queryByRole('button', { name: 'Rol' })).not.toBeInTheDocument();
  });
});

// ─── Acciones de fila ───────────────────────────────────────────────────────

const abrirMenuDeLaPrimeraFila = async () => {
  const menus = screen.getAllByRole('button', { name: /^Acciones de/ });
  await userEvent.click(menus[0]);
};

describe('Empleados — menú de acciones', () => {
  it('copia el email del empleado', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /copiar email/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('user1@ejemplo.com');
    expect(await screen.findByText(/Email copiado/)).toBeInTheDocument();
  });

  it('abre el formulario de edición con los datos del empleado', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /editar empleado/i }));

    expect(await screen.findByText('Editar Empleado')).toBeInTheDocument();
    expect(screen.getByDisplayValue('user1')).toBeInTheDocument();
  });
});

// ─── Eliminación ────────────────────────────────────────────────────────────

describe('Empleados — eliminación', () => {
  it('pide confirmación antes de eliminar', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /eliminar empleado/i }));

    expect(await screen.findByText(/Eliminar Empleado|Confirmar/i)).toBeInTheDocument();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('confirma y refresca la página actual', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');
    const llamadasPrevias = getUsers.mock.calls.length;

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /eliminar empleado/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^eliminar$/i }));

    await waitFor(() => expect(deleteUser).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/eliminado correctamente/)).toBeInTheDocument();
    expect(getUsers.mock.calls.length).toBeGreaterThan(llamadasPrevias);
  });

  it('un doble clic no lanza dos eliminaciones', async () => {
    let resolveDelete;
    deleteUser.mockImplementation(
      () => new Promise((r) => {
        resolveDelete = r;
      })
    );

    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /eliminar empleado/i }));

    const boton = await screen.findByRole('button', { name: /^eliminar$/i });
    await userEvent.click(boton);
    await userEvent.click(boton);

    expect(deleteUser).toHaveBeenCalledTimes(1);
    resolveDelete({ success: true });
  });

  it('muestra el error del backend si la eliminación falla', async () => {
    deleteUser.mockRejectedValueOnce(new Error('No se puede eliminar'));

    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /eliminar empleado/i }));
    await userEvent.click(await screen.findByRole('button', { name: /^eliminar$/i }));

    expect(await screen.findByText('No se puede eliminar')).toBeInTheDocument();
  });
});

// ─── Restaurantes asignados: selector con búsqueda ─────────────────────────
// Sustituye a la antigua rejilla de casillas: ahora las parejas id+nombre las
// trae emparejadas el backend en `assignedRestaurants`.

describe('Empleados — restaurantes asignados', () => {
  it('el formulario de edición precarga los restaurantes asignados', async () => {
    // La fila trae parejas id+nombre, no dos listas sueltas.
    getUsers.mockResolvedValue(pageWith([
      makeEmployee(5, { assignedRestaurants: [{ id: 3, name: 'Sushi Master' }] }),
    ]));
    render(<Employees />);
    await screen.findByText('Nombre5 Apellido5');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /editar empleado/i }));

    const dialogo = within(await screen.findByRole('dialog'));
    expect(dialogo.getByText('Sushi Master')).toBeInTheDocument();
    expect(dialogo.getByRole('button', { name: /quitar sushi master/i })).toBeInTheDocument();
  });

  it('al guardar sigue enviando restaurantIds', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.click(screen.getByRole('button', { name: /nuevo empleado/i }));
    const dialogo = within(await screen.findByRole('dialog'));

    await userEvent.type(dialogo.getByLabelText(/nombre/i), 'Ana');
    await userEvent.type(dialogo.getByLabelText(/usuario/i), 'ana.garcia');
    await userEvent.type(dialogo.getByLabelText(/email/i), 'ana@ejemplo.com');
    await userEvent.type(dialogo.getByLabelText(/contraseña/i), 'secreto1');
    await userEvent.click(dialogo.getByLabelText(/buscar restaurante/i));
    await userEvent.click(await screen.findByRole('option', { name: /sushi master/i }));
    await userEvent.click(dialogo.getByRole('button', { name: /crear empleado/i }));

    await waitFor(() => expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantIds: [3] })
    ));
  });

  it('el aviso del vacío cambia con el rol', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.click(screen.getByRole('button', { name: /nuevo empleado/i }));
    const dialogo = within(await screen.findByRole('dialog'));

    await userEvent.selectOptions(dialogo.getByLabelText(/rol/i), 'EMPLOYEE');
    expect(dialogo.getByText(/no podrá ver ningún restaurante/i)).toBeInTheDocument();

    await userEvent.selectOptions(dialogo.getByLabelText(/rol/i), 'MANAGER');
    expect(dialogo.getByText(/verá todos los del tenant/i)).toBeInTheDocument();
  });

  it('el aviso desaparece al elegir un restaurante', async () => {
    render(<Employees />);
    await screen.findByText('Nombre1 Apellido1');

    await userEvent.click(screen.getByRole('button', { name: /nuevo empleado/i }));
    const dialogo = within(await screen.findByRole('dialog'));

    await userEvent.selectOptions(dialogo.getByLabelText(/rol/i), 'EMPLOYEE');
    await userEvent.click(dialogo.getByLabelText(/buscar restaurante/i));
    await userEvent.click(await screen.findByRole('option', { name: /sushi master/i }));

    expect(dialogo.queryByText(/no podrá ver ningún restaurante/i)).not.toBeInTheDocument();
  });
});
