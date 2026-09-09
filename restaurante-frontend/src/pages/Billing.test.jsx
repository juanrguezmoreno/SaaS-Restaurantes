import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Dobles de los servicios ────────────────────────────────────────────────

vi.mock('../services/billingService');
vi.mock('../services/restaurantService', () => ({
  getRestaurants: vi.fn(),
}));
vi.mock('../context/AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'ADMIN' }, token: 'token-falso' }),
}));

import * as billingService from '../services/billingService';
import { getRestaurants } from '../services/restaurantService';
import { EntitlementsProvider } from '../context/EntitlementsContext';
import Billing from './Billing';

// ─── Envoltorio con los proveedores necesarios ──────────────────────────────

const Wrapper = ({ children }) => (
  <MemoryRouter>
    <EntitlementsProvider>{children}</EntitlementsProvider>
  </MemoryRouter>
);

describe('Billing', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    billingService.getEntitlements.mockResolvedValue({
      plan: 'NORMAL',
      hasAccess: true,
      status: 'ACTIVE',
      features: [],
      limits: { maxRestaurants: 1, maxUserAccounts: 5 },
      usage: { RESTAURANT: 1, USER_ACCOUNT: 2 },
      billingConfigured: true,
    });

    billingService.getSubscription.mockResolvedValue({
      plan: 'NORMAL',
      planName: 'Normal',
      status: 'ACTIVE',
      currentPeriodEnd: null,
      trialEnd: null,
      cancelAtPeriodEnd: false,
      legacyGrant: false,
      stripeLinked: false,
    });

    billingService.getPlans.mockResolvedValue([
      { code: 'NORMAL', name: 'Normal', features: [], maxRestaurants: 1, maxUserAccounts: 5 },
      {
        code: 'PRO', name: 'Pro',
        features: ['EXPORT_DATA', 'MULTI_RESTAURANT'],
        maxRestaurants: null, maxUserAccounts: null,
      },
    ]);

    getRestaurants.mockResolvedValue([
      { id: 1, name: 'Local Centro' },
      { id: 2, name: 'Local Norte' },
      { id: 3, name: 'Local Sur' },
    ]);
  });

  it('muestra el plan actual, su estado y la próxima renovación', async () => {
    billingService.getSubscription.mockResolvedValue({
      plan: 'PRO', planName: 'Pro', status: 'ACTIVE',
      currentPeriodEnd: '2026-10-01T00:00:00', trialEnd: null,
      cancelAtPeriodEnd: false, legacyGrant: false, stripeLinked: true,
    });

    render(<Billing />, { wrapper: Wrapper });

    expect(await screen.findByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText(/1 de octubre/i)).toBeInTheDocument();
  });

  it('avisa de una cancelación programada sin alarmar', async () => {
    billingService.getSubscription.mockResolvedValue({
      plan: 'PRO', planName: 'Pro', status: 'ACTIVE',
      currentPeriodEnd: '2026-10-01T00:00:00',
      cancelAtPeriodEnd: true, stripeLinked: true,
    });

    render(<Billing />, { wrapper: Wrapper });

    expect(await screen.findByText(/se cancelará el/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reactivar/i })).toBeInTheDocument();
  });

  it('redirige a Stripe al contratar un plan', async () => {
    billingService.startCheckout.mockResolvedValue('https://checkout.stripe.test/x');
    const asignar = vi.fn();
    vi.stubGlobal('location', { assign: asignar, href: '', search: '' });

    render(<Billing />, { wrapper: Wrapper });
    await userEvent.click(await screen.findByRole('button', { name: /cambiar a pro/i }));

    await waitFor(() => expect(billingService.startCheckout).toHaveBeenCalledWith('PRO'));
  });

  it('avisa cuando hay locales bloqueados por el plan', async () => {
    billingService.getEntitlements.mockResolvedValue({
      plan: 'PRO', hasAccess: true, status: 'ACTIVE', features: [],
      limits: { maxRestaurants: 1, maxUserAccounts: 5 },
      usage: { RESTAURANT: 3, USER_ACCOUNT: 2 },
      billingConfigured: true,
    });

    render(<Billing />, { wrapper: Wrapper });
    expect(await screen.findByText(/elige cuál quieres mantener activo/i)).toBeInTheDocument();
  });
});
