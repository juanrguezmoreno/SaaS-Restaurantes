// ═══════════════════════════════════════════════════════════════════════════════
//  Permisos y roles — Restaurant Manager SaaS
//  Define qué puede ver y hacer cada rol en el frontend.
//  ═══════════════════════════════════════════════════════════════════════════════

/**
 * Roles del sistema.
 */
export const ROLES = {
  ADMIN: 'ADMIN',
  MANAGER: 'MANAGER',
  EMPLOYEE: 'EMPLOYEE',
};

/**
 * Etiquetas legibles para cada rol.
 */
export const ROLE_LABELS = {
  [ROLES.ADMIN]: 'Administrador',
  [ROLES.MANAGER]: 'Gerente',
  [ROLES.EMPLOYEE]: 'Empleado',
};

// ─── Permisos individuales ─────────────────────────────────────────────────
// Convención: VERBO_SUSTANTIVO
// VIEW_   → lectura / acceso a página
// MANAGE_ → acciones de escritura (crear, editar, eliminar)

export const PERMISSIONS = {
  // ── Inicio ──
  VIEW_DASHBOARD: 'VIEW_DASHBOARD',

  // ── Operativa ──
  VIEW_RESERVATIONS: 'VIEW_RESERVATIONS',
  MANAGE_RESERVATIONS: 'MANAGE_RESERVATIONS',
  VIEW_FLOOR_PLAN: 'VIEW_FLOOR_PLAN',
  VIEW_CUSTOMERS: 'VIEW_CUSTOMERS',
  MANAGE_CUSTOMERS: 'MANAGE_CUSTOMERS',

  // ── Negocio ──
  VIEW_ANALYTICS: 'VIEW_ANALYTICS',
  VIEW_NOTIFICATIONS: 'VIEW_NOTIFICATIONS',

  // ── Administración ──
  VIEW_RESTAURANTS: 'VIEW_RESTAURANTS',
  MANAGE_RESTAURANTS: 'MANAGE_RESTAURANTS',
  VIEW_TABLES: 'VIEW_TABLES',
  MANAGE_TABLES: 'MANAGE_TABLES',
  VIEW_EMPLOYEES: 'VIEW_EMPLOYEES',
  MANAGE_EMPLOYEES: 'MANAGE_EMPLOYEES',
};

/**
 * Mapa de roles → permisos.
 * ADMIN tiene todos los permisos (se maneja con *).
 * MANAGER y EMPLOYEE tienen listas explícitas.
 */
const ROLE_PERMISSIONS = {
  [ROLES.ADMIN]: '*', // Comodín: todos los permisos

  [ROLES.MANAGER]: [
    PERMISSIONS.VIEW_DASHBOARD,
    // Operativa
    PERMISSIONS.VIEW_RESERVATIONS,
    PERMISSIONS.MANAGE_RESERVATIONS,
    PERMISSIONS.VIEW_FLOOR_PLAN,
    PERMISSIONS.VIEW_CUSTOMERS,
    PERMISSIONS.MANAGE_CUSTOMERS,
    // Negocio
    PERMISSIONS.VIEW_ANALYTICS,
    PERMISSIONS.VIEW_NOTIFICATIONS,
    // Admin — solo lectura de mesas
    PERMISSIONS.VIEW_TABLES,
  ],

  [ROLES.EMPLOYEE]: [
    PERMISSIONS.VIEW_DASHBOARD,
    // Operativa
    PERMISSIONS.VIEW_RESERVATIONS,
    PERMISSIONS.VIEW_FLOOR_PLAN,
    PERMISSIONS.VIEW_CUSTOMERS,
  ],
};

/**
 * Rutas protegidas por permiso.
 * Mapa de ruta → permiso requerido.
 */
export const ROUTE_PERMISSIONS = {
  '/dashboard': PERMISSIONS.VIEW_DASHBOARD,
  '/inicio': PERMISSIONS.VIEW_DASHBOARD,
  '/reservations': PERMISSIONS.VIEW_RESERVATIONS,
  '/floor-plan': PERMISSIONS.VIEW_FLOOR_PLAN,
  '/customers': PERMISSIONS.VIEW_CUSTOMERS,
  '/analytics': PERMISSIONS.VIEW_ANALYTICS,
  '/notifications': PERMISSIONS.VIEW_NOTIFICATIONS,
  '/restaurants': PERMISSIONS.VIEW_RESTAURANTS,
  '/tables': PERMISSIONS.VIEW_TABLES,
  '/employees': PERMISSIONS.VIEW_EMPLOYEES,
};

/**
 * Permisos requeridos para cada elemento del sidebar.
 * sidebarKey coincide con item.path.
 */
export const SIDEBAR_PERMISSIONS = {
  '/dashboard': PERMISSIONS.VIEW_DASHBOARD,
  '/reservations': PERMISSIONS.VIEW_RESERVATIONS,
  '/floor-plan': PERMISSIONS.VIEW_FLOOR_PLAN,
  '/customers': PERMISSIONS.VIEW_CUSTOMERS,
  '/analytics': PERMISSIONS.VIEW_ANALYTICS,
  '/notifications': PERMISSIONS.VIEW_NOTIFICATIONS,
  '/restaurants': PERMISSIONS.VIEW_RESTAURANTS,
  '/tables': PERMISSIONS.VIEW_TABLES,
  '/employees': PERMISSIONS.VIEW_EMPLOYEES,
};

/**
 * Verifica si un rol tiene un permiso específico.
 * @param {string} role - Rol del usuario (ADMIN, MANAGER, EMPLOYEE)
 * @param {string} permission - Permiso a verificar
 * @returns {boolean}
 */
export const hasPermission = (role, permission) => {
  if (!role || !permission) return false;
  const permissions = ROLE_PERMISSIONS[role];
  if (!permissions) return false;
  // ADMIN tiene todos los permisos (comodín)
  if (permissions === '*') return true;
  return permissions.includes(permission);
};

/**
 * Verifica si un rol pertenece a uno de los roles dados.
 * @param {string} role - Rol del usuario
 * @param {string|string[]} roles - Rol o lista de roles permitidos
 * @returns {boolean}
 */
export const hasRole = (role, roles) => {
  if (!role || !roles) return false;
  const allowed = Array.isArray(roles) ? roles : [roles];
  return allowed.includes(role);
};

/**
 * Versión simplificada: dado un usuario y un permiso, ¿puede acceder?
 * @param {object|null} user - Objeto usuario (de AuthContext)
 * @param {string} permission - Permiso a verificar
 * @returns {boolean}
 */
export const canAccess = (user, permission) => {
  if (!user) return false;
  return hasPermission(user.role, permission);
};

/**
 * Mapa contextual de mensajes según la ruta bloqueada.
 * La clave es el permiso (o ruta) y el valor es un mensaje amigable.
 */
const DENIED_MESSAGES = {
  [PERMISSIONS.VIEW_RESTAURANTS]: 'Esta zona está reservada para administradores.',
  [PERMISSIONS.MANAGE_RESTAURANTS]: 'Esta zona está reservada para administradores.',
  [PERMISSIONS.VIEW_TABLES]: 'La gestión de mesas requiere permisos de administrador.',
  [PERMISSIONS.MANAGE_TABLES]: 'La gestión de mesas requiere permisos de administrador.',
  [PERMISSIONS.VIEW_EMPLOYEES]: 'La gestión de empleados requiere permisos de administrador.',
  [PERMISSIONS.MANAGE_EMPLOYEES]: 'La gestión de empleados requiere permisos de administrador.',
  [PERMISSIONS.VIEW_ANALYTICS]: 'Esta sección está disponible para perfiles con permisos de negocio.',
  [PERMISSIONS.VIEW_NOTIFICATIONS]: 'Esta sección está disponible para perfiles con permisos de negocio.',
  [PERMISSIONS.VIEW_FLOOR_PLAN]: 'El plano de sala está disponible para perfiles operativos.',
};

/**
 * Mensaje por defecto cuando no hay un mensaje contextual específico.
 */
const DEFAULT_DENIED_MESSAGE = 'No tienes permisos para acceder a esta sección.';

/**
 * Devuelve un mensaje contextual según la ruta a la que se intentó acceder.
 * Útil para mostrar en la página de "Acceso restringido".
 *
 * @param {string} pathname - Ruta a la que se intentó acceder (ej. '/analytics')
 * @returns {{ title: string, message: string, secondary: string }}
 */
export const getPermissionDeniedContext = (pathname) => {
  // Determinar el permiso basado en la ruta
  const permission = ROUTE_PERMISSIONS[pathname];
  const contextualMessage = permission ? DENIED_MESSAGES[permission] : null;

  return {
    contextualMessage: contextualMessage || DEFAULT_DENIED_MESSAGE,
  };
};

/**
 * Alias legible para obtener el mensaje de denegación según la ruta.
 * @param {string} path - Ruta a la que se intentó acceder
 * @returns {string} Mensaje contextual de denegación
 */
export const getPermissionDeniedMessage = (path) => {
  const { contextualMessage } = getPermissionDeniedContext(path);
  return contextualMessage;
};

export default ROLE_PERMISSIONS;
