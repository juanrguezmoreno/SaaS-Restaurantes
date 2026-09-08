import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntitlementsProvider, useEntitlements } from './EntitlementsContext';
import * as billingService from '../services/billingService';

vi.mock('../services/billingService');
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'ADMIN' }, token: 'token-falso' }),
}));

const Sonda = () => {
  const { plan, loading, hasFeature, isAtLimit } = useEntitlements();
  if (loading) return <span>cargando</span>;
  return (
    <div>
      <span data-testid="plan">{plan}</span>
      <span data-testid="export">{String(hasFeature('EXPORT_DATA'))}</span>
      <span data-testid="tope-locales">{String(isAtLimit('RESTAURANT'))}</span>
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

  it('ante un fallo de red no concede ninguna feature', async () => {
    billingService.getEntitlements.mockRejectedValue(new Error('sin red'));

    render(<EntitlementsProvider><Sonda /></EntitlementsProvider>);

    // Cerrado por defecto: un error de red nunca debe regalar funciones de pago.
    await waitFor(() => expect(screen.getByTestId('export')).toHaveTextContent('false'));
  });
});
