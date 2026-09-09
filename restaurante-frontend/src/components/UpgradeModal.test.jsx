import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect } from 'vitest';
import UpgradeModal from './UpgradeModal';

const Wrapper = ({ children }) => <MemoryRouter>{children}</MemoryRouter>;

const emitir = (detail) => {
  window.dispatchEvent(new CustomEvent('plan:upgrade-required', { detail }));
};

describe('UpgradeModal', () => {
  it('el diálogo explica la funcionalidad concreta y ofrece un solo CTA', async () => {
    render(<UpgradeModal />, { wrapper: Wrapper });
    emitir({ feature: 'EXPORT_DATA', requiredPlan: 'PRO' });

    expect(await screen.findByText('Exportación de datos')).toBeInTheDocument();
    expect(screen.getByText(/Descarga tus reservas en CSV/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /actualizar a pro/i })).toHaveLength(1);
  });

  it('un límite alcanzado muestra el detalle numérico', async () => {
    render(<UpgradeModal />, { wrapper: Wrapper });
    emitir({
      code: 'PLAN_LIMIT_REACHED', resource: 'RESTAURANT',
      limit: 1, current: 1, requiredPlan: 'PRO',
    });

    expect(await screen.findByText(/1 de 1 locales/i)).toBeInTheDocument();
  });

  it('se cierra con el botón de cerrar', async () => {
    const user = userEvent.setup();
    render(<UpgradeModal />, { wrapper: Wrapper });
    emitir({ feature: 'EXPORT_DATA', requiredPlan: 'PRO' });

    await screen.findByText('Exportación de datos');
    await user.click(screen.getByRole('button', { name: /cerrar/i }));

    expect(screen.queryByText('Exportación de datos')).not.toBeInTheDocument();
  });

  it('no reaparece por el mismo motivo justo después de cerrarlo', async () => {
    const user = userEvent.setup();
    render(<UpgradeModal />, { wrapper: Wrapper });
    emitir({ feature: 'EXPORT_DATA', requiredPlan: 'PRO' });

    await screen.findByText('Exportación de datos');
    await user.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(screen.queryByText('Exportación de datos')).not.toBeInTheDocument();

    // Mismo motivo, sin que pase el minuto de gracia: no debe reabrirse solo.
    emitir({ feature: 'EXPORT_DATA', requiredPlan: 'PRO' });
    expect(screen.queryByText('Exportación de datos')).not.toBeInTheDocument();

    // Un motivo distinto sí debe abrir el diálogo con normalidad.
    emitir({
      code: 'PLAN_LIMIT_REACHED', resource: 'RESTAURANT',
      limit: 1, current: 1, requiredPlan: 'PRO',
    });
    expect(await screen.findByText(/1 de 1 locales/i)).toBeInTheDocument();
  });

  it('se cierra con Escape', async () => {
    const user = userEvent.setup();
    render(<UpgradeModal />, { wrapper: Wrapper });
    emitir({ feature: 'EXPORT_DATA', requiredPlan: 'PRO' });

    await screen.findByText('Exportación de datos');
    await user.keyboard('{Escape}');

    expect(screen.queryByText('Exportación de datos')).not.toBeInTheDocument();
  });
});
