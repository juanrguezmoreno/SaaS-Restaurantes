import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

// ─── Dobles de los servicios ────────────────────────────────────────────────

vi.mock('../services/adminRestaurantService', () => ({
  getAdminRestaurants: vi.fn(),
  getAdminRestaurantStats: vi.fn(),
  PAGE_SIZE_OPTIONS: [10, 25, 50, 100],
  DEFAULT_PAGE_SIZE: 25,
}));

vi.mock('../services/restaurantService', () => ({
  createRestaurant: vi.fn().mockResolvedValue({ id: 99 }),
  deleteRestaurant: vi.fn().mockResolvedValue({ success: true }),
}));

// El usuario autenticado es un SUPER_ADMIN: tiene todos los permisos.
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { username: 'super.admin', role: 'SUPER_ADMIN' } }),
}));

// QRModal importa `qrcode` de forma estática; en jsdom no hay canvas real.
vi.mock('qrcode', () => ({
  default: {
    toCanvas: vi.fn().mockResolvedValue(undefined),
    toDataURL: vi.fn().mockResolvedValue('data:image/png;base64,AAAA'),
  },
}));

import {
  getAdminRestaurants,
  getAdminRestaurantStats,
} from '../services/adminRestaurantService';
import { deleteRestaurant } from '../services/restaurantService';
import Restaurants from './Restaurants';

// ─── Datos de apoyo ─────────────────────────────────────────────────────────

const makeRestaurant = (id) => ({
  id,
  name: `Restaurante ${id}`,
  address: `Calle ${id}`,
  phone: `60000000${id}`,
  email: `resto${id}@ejemplo.com`,
  capacity: id * 10,
  openingTime: '13:00:00',
  closingTime: '23:00:00',
  publicBookingEnabled: id % 2 === 0,
  tenantId: 1,
  tenantName: 'Cuenta Demo',
  createdAt: '2026-01-15T10:00:00',
});

/** Página con 3 elementos de 40 en total (2 páginas de 25). */
const pageOf = (ids, overrides = {}) => ({
  content: ids.map(makeRestaurant),
  page: 0,
  size: 25,
  totalElements: 40,
  totalPages: 2,
  first: true,
  last: false,
  empty: false,
  ...overrides,
});

const renderPage = () =>
  render(
    <MemoryRouter>
      <Restaurants />
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  getAdminRestaurants.mockResolvedValue(pageOf([1, 2, 3]));
  getAdminRestaurantStats.mockResolvedValue({
    totalRestaurants: 40,
    totalCapacity: 1200,
    publicBookingEnabledCount: 18,
  });
  // Portapapeles: jsdom lo expone solo como getter, así que se redefine.
  Object.defineProperty(navigator, 'clipboard', {
    configurable: true,
    value: { writeText: vi.fn().mockResolvedValue(undefined) },
  });
});

// ─── Carga y métricas ───────────────────────────────────────────────────────

describe('Restaurantes — carga y métricas', () => {
  it('pide la primera página con el tamaño por defecto y pinta las filas', async () => {
    renderPage();

    expect(await screen.findByText('Restaurante 1')).toBeInTheDocument();
    expect(getAdminRestaurants).toHaveBeenCalledWith({
      page: 0,
      size: 25,
      search: '',
      sort: 'name',
      direction: 'asc',
    });
  });

  it('muestra las métricas que devuelve el backend, no la suma de la página', async () => {
    renderPage();

    // 1200 es la capacidad total del servidor; las 3 filas suman 60.
    expect(await screen.findByText('1200')).toBeInTheDocument();
    expect(screen.getByText('18')).toBeInTheDocument();
    expect(getAdminRestaurantStats).toHaveBeenCalledTimes(1);
  });

  it('no deja la tabla vacía sin explicación mientras carga', async () => {
    let resolve;
    getAdminRestaurants.mockImplementation(
      () => new Promise((r) => {
        resolve = r;
      })
    );

    const { container } = renderPage();

    // Durante la carga inicial hay esqueleto, no una tabla en blanco.
    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(0);

    resolve(pageOf([1]));
    expect(await screen.findByText('Restaurante 1')).toBeInTheDocument();
  });

  it('muestra el estado vacío cuando no hay ningún restaurante', async () => {
    getAdminRestaurants.mockResolvedValue({
      content: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
      first: true,
      last: true,
      empty: true,
    });

    renderPage();

    expect(await screen.findByText('No hay restaurantes registrados')).toBeInTheDocument();
  });

  it('muestra el error con opción de reintentar', async () => {
    getAdminRestaurants.mockRejectedValueOnce(new Error('Fallo del servidor'));
    renderPage();

    expect(await screen.findByText('Fallo del servidor')).toBeInTheDocument();

    getAdminRestaurants.mockResolvedValue(pageOf([1]));
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));

    expect(await screen.findByText('Restaurante 1')).toBeInTheDocument();
  });
});

// ─── Paginación ─────────────────────────────────────────────────────────────

describe('Restaurantes — paginación', () => {
  it('muestra el rango sobre el total', async () => {
    renderPage();

    expect(await screen.findByText(/Mostrando 1–25 de 40 restaurantes/)).toBeInTheDocument();
  });

  it('navega a la página siguiente pidiéndosela al backend', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    getAdminRestaurants.mockResolvedValue(
      pageOf([4, 5], { page: 1, first: false, last: true })
    );
    await userEvent.click(screen.getByRole('button', { name: /página siguiente/i }));

    await waitFor(() =>
      expect(getAdminRestaurants).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 })
      )
    );
    expect(await screen.findByText('Restaurante 4')).toBeInTheDocument();
  });

  it('desactiva Anterior en la primera página', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    expect(screen.getByRole('button', { name: /página anterior/i })).toBeDisabled();
  });

  it('desactiva Siguiente en la última página', async () => {
    getAdminRestaurants.mockResolvedValue(
      pageOf([1], { page: 1, first: false, last: true })
    );
    renderPage();
    await screen.findByText('Restaurante 1');

    expect(screen.getByRole('button', { name: /página siguiente/i })).toBeDisabled();
  });

  it('cambiar el tamaño de página vuelve a la primera página', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    await userEvent.selectOptions(screen.getByLabelText(/por página/i), '50');

    await waitFor(() =>
      expect(getAdminRestaurants).toHaveBeenLastCalledWith(
        expect.objectContaining({ size: 50, page: 0 })
      )
    );
  });
});

// ─── Búsqueda ───────────────────────────────────────────────────────────────

describe('Restaurantes — búsqueda', () => {
  it('agrupa las pulsaciones en una sola consulta y vuelve a la primera página', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');
    const llamadasPrevias = getAdminRestaurants.mock.calls.length;

    await userEvent.type(screen.getByLabelText(/buscar restaurantes/i), 'pepe');

    // Sin cumplirse el debounce no se ha consultado de nuevo.
    expect(getAdminRestaurants.mock.calls.length).toBe(llamadasPrevias);

    await waitFor(() =>
      expect(getAdminRestaurants).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: 'pepe', page: 0 })
      )
    );

    // Una sola consulta para las cuatro pulsaciones.
    expect(getAdminRestaurants.mock.calls.length).toBe(llamadasPrevias + 1);
  });

  it('muestra el estado sin resultados y permite limpiar la búsqueda', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    getAdminRestaurants.mockResolvedValue({
      content: [],
      page: 0,
      size: 25,
      totalElements: 0,
      totalPages: 0,
      first: true,
      last: true,
      empty: true,
    });

    await userEvent.type(screen.getByLabelText(/buscar restaurantes/i), 'zzz');

    const aviso = await screen.findByText(/Ningún restaurante coincide con «zzz»/);
    expect(aviso).toBeInTheDocument();

    // El buscador sigue montado: limpiar desde el propio aviso devuelve la lista.
    getAdminRestaurants.mockResolvedValue(pageOf([1, 2, 3]));
    await userEvent.click(
      within(aviso.closest('td')).getByRole('button', { name: /limpiar búsqueda/i })
    );

    expect(await screen.findByText('Restaurante 1')).toBeInTheDocument();
  });
});

// ─── Ordenación ─────────────────────────────────────────────────────────────

describe('Restaurantes — ordenación', () => {
  it('alterna la dirección al pulsar la misma columna', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    await userEvent.click(screen.getByRole('button', { name: 'Restaurante' }));

    await waitFor(() =>
      expect(getAdminRestaurants).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'name', direction: 'desc' })
      )
    );
  });

  it('ordena por otra columna en ascendente y lo indica', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    await userEvent.click(screen.getByRole('button', { name: 'Capacidad' }));

    await waitFor(() =>
      expect(getAdminRestaurants).toHaveBeenLastCalledWith(
        expect.objectContaining({ sort: 'capacity', direction: 'asc' })
      )
    );

    const cabecera = screen.getByRole('button', { name: 'Capacidad' }).closest('th');
    expect(cabecera).toHaveAttribute('aria-sort', 'ascending');
  });
});

// ─── Acciones de fila ───────────────────────────────────────────────────────

const abrirMenuDeLaPrimeraFila = async () => {
  const menus = screen.getAllByRole('button', { name: /^Acciones de/ });
  await userEvent.click(menus[0]);
};

describe('Restaurantes — menú de acciones', () => {
  it('copia el enlace público del restaurante', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /copiar enlace público/i }));

    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      expect.stringContaining('/public/reservar/1')
    );
    expect(await screen.findByText(/Enlace público copiado/)).toBeInTheDocument();
  });

  it('abre la página pública en otra pestaña', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    renderPage();
    await screen.findByText('Restaurante 1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /abrir página pública/i }));

    expect(open).toHaveBeenCalledWith(
      expect.stringContaining('/public/reservar/1'),
      '_blank',
      'noopener,noreferrer'
    );
    open.mockRestore();
  });

  it('abre el detalle con el enlace público y desde ahí el QR', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /ver detalles/i }));

    const dialogo = await screen.findByRole('dialog');
    expect(within(dialogo).getByText(/\/public\/reservar\/1$/)).toBeInTheDocument();
    expect(within(dialogo).getByText('Cuenta Demo')).toBeInTheDocument();

    await userEvent.click(within(dialogo).getByRole('button', { name: /ver qr/i }));
    expect(await screen.findByText('Código QR')).toBeInTheDocument();
  });

  it('cierra el detalle', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /ver detalles/i }));
    const dialogo = await screen.findByRole('dialog');

    const pie = dialogo.querySelector('.modal-footer');
    await userEvent.click(within(pie).getByRole('button', { name: /^cerrar$/i }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('descarga el código QR generándolo en ese momento', async () => {
    const QRCode = (await import('qrcode')).default;
    renderPage();
    await screen.findByText('Restaurante 1');

    // Al cargar la pantalla no se ha generado ningún QR.
    expect(QRCode.toDataURL).not.toHaveBeenCalled();

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /descargar código qr/i }));

    await waitFor(() => expect(QRCode.toDataURL).toHaveBeenCalledTimes(1));
    expect(QRCode.toDataURL).toHaveBeenCalledWith(
      expect.stringContaining('/public/reservar/1'),
      expect.any(Object)
    );
  });
});

// ─── Eliminación ────────────────────────────────────────────────────────────

describe('Restaurantes — eliminación', () => {
  it('pide confirmación nombrando el restaurante afectado', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /eliminar restaurante/i }));

    expect(await screen.findByText('Confirmar Eliminación')).toBeInTheDocument();
    expect(screen.getByText(/¿Estás seguro de eliminar este restaurante\?/)).toBeInTheDocument();
    expect(deleteRestaurant).not.toHaveBeenCalled();
  });

  it('cancelar no elimina', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /eliminar restaurante/i }));
    await screen.findByText('Confirmar Eliminación');

    await userEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    expect(deleteRestaurant).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.queryByText('Confirmar Eliminación')).not.toBeInTheDocument()
    );
  });

  it('confirma, refresca la página actual y avisa del resultado', async () => {
    renderPage();
    await screen.findByText('Restaurante 1');
    const llamadasPrevias = getAdminRestaurants.mock.calls.length;

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /eliminar restaurante/i }));
    await screen.findByText('Confirmar Eliminación');
    await userEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));

    await waitFor(() => expect(deleteRestaurant).toHaveBeenCalledWith(1));
    expect(await screen.findByText(/eliminado correctamente/)).toBeInTheDocument();
    // Se recarga la página actual, no toda la aplicación.
    expect(getAdminRestaurants.mock.calls.length).toBeGreaterThan(llamadasPrevias);
  });

  it('un doble clic no lanza dos eliminaciones', async () => {
    let resolveDelete;
    deleteRestaurant.mockImplementation(
      () => new Promise((r) => {
        resolveDelete = r;
      })
    );

    renderPage();
    await screen.findByText('Restaurante 1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /eliminar restaurante/i }));
    await screen.findByText('Confirmar Eliminación');

    const boton = screen.getByRole('button', { name: /^eliminar$/i });
    await userEvent.click(boton);
    await userEvent.click(boton);

    expect(deleteRestaurant).toHaveBeenCalledTimes(1);
    resolveDelete({ success: true });
  });

  it('muestra el error del backend si la eliminación falla', async () => {
    deleteRestaurant.mockRejectedValueOnce(new Error('No se puede eliminar'));

    renderPage();
    await screen.findByText('Restaurante 1');

    await abrirMenuDeLaPrimeraFila();
    await userEvent.click(screen.getByRole('menuitem', { name: /eliminar restaurante/i }));
    await screen.findByText('Confirmar Eliminación');
    await userEvent.click(screen.getByRole('button', { name: /^eliminar$/i }));

    expect(await screen.findByText('No se puede eliminar')).toBeInTheDocument();
  });

  it('si la página se queda vacía tras eliminar, retrocede a la anterior', async () => {
    // Arranca en la página 2 y, al recargar, el backend la devuelve vacía.
    getAdminRestaurants.mockResolvedValue(
      pageOf([4], { page: 1, first: false, last: true })
    );
    renderPage();
    await screen.findByText('Restaurante 4');

    await userEvent.click(screen.getByRole('button', { name: /página anterior/i }));
    await waitFor(() =>
      expect(getAdminRestaurants).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 0 })
      )
    );

    // Ahora en la página 1: se pide la 2 y vuelve vacía con total > 0.
    getAdminRestaurants.mockResolvedValue({
      content: [],
      page: 1,
      size: 25,
      totalElements: 40,
      totalPages: 2,
      first: false,
      last: true,
      empty: true,
    });
    await userEvent.click(screen.getByRole('button', { name: /página siguiente/i }));

    getAdminRestaurants.mockResolvedValue(pageOf([1, 2, 3]));
    await waitFor(() =>
      expect(getAdminRestaurants).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 0 })
      )
    );
  });
});
