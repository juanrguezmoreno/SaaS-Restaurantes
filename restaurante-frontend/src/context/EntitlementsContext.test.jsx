import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntitlementsProvider, useEntitlements } from './EntitlementsContext';
import * as billingService from '../services/billingService';

vi.mock('../services/billingService');
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'ADMIN' }, token: 'token-falso' }),
}));

const Sonda = () => {
  const { plan, loading, hasFeature, isAtLimit, refresh } = useEntitlements();
  if (loading) return <span>cargando</span>;
  return (
    <div>
      <span data-testid="plan">{plan}</span>
      <span data-testid="export">{String(hasFeature('EXPORT_DATA'))}</span>
      <span data-testid="tope-locales">{String(isAtLimit('RESTAURANT'))}</span>
      <button onClick={refresh}>refrescar</button>
    </div>
  );
};

describe('EntitlementsContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('expone las features del plan contratado', async () => {
    billingService.getEntitlements.mockResolvedValue({
      plan: 'PRO', hasAccess: true, status: 'ACTIVE',
      features: ['EXPORT_DATA', 'MULTI_RESTAURANT'],
      limits: { maxRestaurants: null, maxUserAccounts: null },
      usage: { RESTAURANT: 3, USER_ACCOUNT: 8 },
    });

    render(<EntitlementsProvider><Sonda /></EntitlementsProvider>);

    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('PRO'));
    expect(screen.getByTestId('export')).toHaveTextContent('true');
    expect(screen.getByTestId('tope-locales')).toHaveTextContent('false');
  });

  it('un plan NORMAL no tiene features y detecta el tope alcanzado', async () => {
    billingService.getEntitlements.mockResolvedValue({
      plan: 'NORMAL', hasAccess: true, status: 'ACTIVE', features: [],
      limits: { maxRestaurants: 1, maxUserAccounts: 5 },
      usage: { RESTAURANT: 1, USER_ACCOUNT: 3 },
    });

    render(<EntitlementsProvider><Sonda /></EntitlementsProvider>);

    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('NORMAL'));
    expect(screen.getByTestId('export')).toHaveTextContent('false');
    expect(screen.getByTestId('tope-locales')).toHaveTextContent('true');
  });

  it('ante un fallo de red en un refresh, las features ya concedidas desaparecen', async () => {
    // Primero resuelve con un plan PRO ya con features concedidas: si el catch
    // se quitase, o conservase el estado anterior en vez de cerrarlo, este test
    // seguiría en verde con solo el estado inicial (que también parte vacío).
    // Por eso se espera primero a tener features y SÓLO ENTONCES se provoca el
    // fallo de red, para que la propiedad "cerrado por defecto" se compruebe de
    // verdad tras haber tenido algo que perder.
    billingService.getEntitlements.mockResolvedValueOnce({
      plan: 'PRO', hasAccess: true, status: 'ACTIVE',
      features: ['EXPORT_DATA', 'MULTI_RESTAURANT'],
      limits: { maxRestaurants: null, maxUserAccounts: null },
      usage: { RESTAURANT: 3, USER_ACCOUNT: 8 },
    });

    render(<EntitlementsProvider><Sonda /></EntitlementsProvider>);

    await waitFor(() => expect(screen.getByTestId('export')).toHaveTextContent('true'));

    billingService.getEntitlements.mockRejectedValueOnce(new Error('sin red'));
    screen.getByRole('button', { name: 'refrescar' }).click();

    // Cerrado por defecto: un error de red nunca debe conservar funciones de pago
    // ya concedidas, deben desaparecer.
    await waitFor(() => expect(screen.getByTestId('export')).toHaveTextContent('false'));
    expect(screen.getByTestId('plan')).toHaveTextContent('');
  });
});
