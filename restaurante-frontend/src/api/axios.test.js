import { describe, it, expect, vi, beforeEach } from 'vitest';

// El cliente real de axios haría una petición HTTP de verdad. Aquí sólo interesa
// probar el interceptor de respuesta, así que se sustituye axios.create() por un
// doble que deja capturar los manejadores que api/axios.js registra.
const interceptors = {
  request: { use: vi.fn() },
  response: { use: vi.fn() },
};

vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      interceptors,
      get: vi.fn(),
      post: vi.fn(),
    })),
  },
}));

/** Carga (o recarga) api/axios.js y devuelve el manejador de error del interceptor. */
const cargarManejadorDeError = async () => {
  vi.resetModules();
  interceptors.request.use.mockClear();
  interceptors.response.use.mockClear();
  await import('./axios');
  return interceptors.response.use.mock.calls[0][1];
};

/** Simula que una petición ha devuelto la respuesta de error dada. */
const simularRespuesta = async ({ status, data }) => {
  const manejarError = await cargarManejadorDeError();
  return manejarError({ response: { status, data } }).catch(() => {});
};

describe('interceptor de respuesta de axios', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('emite plan:upgrade-required ante un 403 con ese código', async () => {
    const escucha = vi.fn();
    window.addEventListener('plan:upgrade-required', escucha);

    await simularRespuesta({
      status: 403,
      data: {
        success: false,
        code: 'PLAN_UPGRADE_REQUIRED',
        message: 'Esta función requiere el plan Pro',
        data: { feature: 'EXPORT_DATA', requiredPlan: 'PRO' },
      },
    });

    expect(escucha).toHaveBeenCalled();
    expect(escucha.mock.calls[0][0].detail.feature).toBe('EXPORT_DATA');

    window.removeEventListener('plan:upgrade-required', escucha);
  });

  it('emite plan:upgrade-required ante un 403 de límite alcanzado', async () => {
    const escucha = vi.fn();
    window.addEventListener('plan:upgrade-required', escucha);

    await simularRespuesta({
      status: 403,
      data: {
        success: false,
        code: 'PLAN_LIMIT_REACHED',
        message: 'Tu plan incluye 1 local',
        data: { resource: 'RESTAURANT', limit: 1, current: 1, requiredPlan: 'PRO' },
      },
    });

    expect(escucha).toHaveBeenCalled();
    expect(escucha.mock.calls[0][0].detail.resource).toBe('RESTAURANT');

    window.removeEventListener('plan:upgrade-required', escucha);
  });

  it('un 403 normal de permisos NO abre el diálogo de mejora', async () => {
    const escucha = vi.fn();
    window.addEventListener('plan:upgrade-required', escucha);

    await simularRespuesta({
      status: 403,
      data: { success: false, message: 'No tiene permisos para realizar esta operación.' },
    });

    // Sin código, es un problema de rol, no de plan: mezclarlos confundiría al
    // usuario ofreciéndole pagar por algo que su rol nunca le va a dejar hacer.
    expect(escucha).not.toHaveBeenCalled();

    window.removeEventListener('plan:upgrade-required', escucha);
  });

  it('un 401 sigue limpiando la sesión y avisando a AuthContext, sin tocar el diálogo de plan', async () => {
    localStorage.setItem('token', 'token-falso');
    localStorage.setItem('user', JSON.stringify({ id: 1 }));

    const escuchaPlan = vi.fn();
    const escuchaAuth = vi.fn();
    window.addEventListener('plan:upgrade-required', escuchaPlan);
    window.addEventListener('auth:unauthorized', escuchaAuth);

    await simularRespuesta({ status: 401, data: { success: false, message: 'Token expirado' } });

    expect(localStorage.getItem('token')).toBeNull();
    expect(localStorage.getItem('user')).toBeNull();
    expect(escuchaAuth).toHaveBeenCalled();
    expect(escuchaPlan).not.toHaveBeenCalled();

    window.removeEventListener('plan:upgrade-required', escuchaPlan);
    window.removeEventListener('auth:unauthorized', escuchaAuth);
  });
});
