// ═══════════════════════════════════════════════════════════════════════════════
//  Funcionalidades por plan — espejo del enum Feature del backend.
//
//  IMPORTANTE: esto NO autoriza nada. Sirve para pintar candados y textos. Quien
//  decide es el backend: aunque alguien manipule este archivo en el navegador, la
//  API responde 403 igual.
// ═══════════════════════════════════════════════════════════════════════════════

export const FEATURES = {
  MULTI_RESTAURANT: 'MULTI_RESTAURANT',
  ADVANCED_ANALYTICS: 'ADVANCED_ANALYTICS',
  EXPORT_DATA: 'EXPORT_DATA',
  ADVANCED_PERMISSIONS: 'ADVANCED_PERMISSIONS',
  AUTOMATIONS: 'AUTOMATIONS',
  CUSTOMER_REMINDERS: 'CUSTOMER_REMINDERS',
};

/** Nombre y explicación breve de cada funcionalidad, para el diálogo de mejora. */
export const FEATURE_LABELS = {
  [FEATURES.MULTI_RESTAURANT]: {
    name: 'Varios locales',
    description: 'Gestiona todos tus restaurantes desde una sola cuenta, con sus '
      + 'reservas, mesas y personal separados.',
  },
  [FEATURES.ADVANCED_ANALYTICS]: {
    name: 'Analítica avanzada',
    description: 'Histórico completo, comparativas entre periodos y tendencias, '
      + 'más allá de los últimos 7 días.',
  },
  [FEATURES.EXPORT_DATA]: {
    name: 'Exportación de datos',
    description: 'Descarga tus reservas en CSV para abrirlas en Excel o llevarlas '
      + 'a tu contabilidad.',
  },
  [FEATURES.ADVANCED_PERMISSIONS]: {
    name: 'Permisos avanzados',
    description: 'Control fino de qué ve y qué hace cada persona de tu equipo.',
  },
  [FEATURES.AUTOMATIONS]: {
    name: 'Automatizaciones',
    description: 'Tareas que se ejecutan solas según lo que pase en tu servicio.',
  },
  [FEATURES.CUSTOMER_REMINDERS]: {
    name: 'Recordatorios a clientes',
    description: 'Avisos automáticos antes de la reserva para reducir las ausencias.',
  },
};

export const PLAN_LABELS = { NORMAL: 'Normal', PRO: 'Pro' };

/** Estados de suscripción en lenguaje humano. */
export const STATUS_LABELS = {
  TRIALING: { text: 'Periodo de prueba', tone: 'info' },
  ACTIVE: { text: 'Activo', tone: 'success' },
  PAST_DUE: { text: 'Pago pendiente', tone: 'warning' },
  CANCELED: { text: 'Cancelado', tone: 'danger' },
  UNPAID: { text: 'Impagado', tone: 'danger' },
  INCOMPLETE: { text: 'Sin completar', tone: 'warning' },
  INCOMPLETE_EXPIRED: { text: 'Caducado', tone: 'danger' },
};
