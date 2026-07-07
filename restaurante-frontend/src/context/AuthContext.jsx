import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { login as loginService } from '../services/authService';
import { ROLES, normalizeRole } from '../config/permissions';

const AuthContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
};

/**
 * Extrae y normaliza el rol del usuario desde la respuesta del backend.
 *
 * El backend devuelve:
 *   { "roles": ["ROLE_SUPER_ADMIN"] }   ← formato real
 *   { "role": "ROLE_ADMIN" }             ← alternativo
 *   { "authorities": [{"authority": "ROLE_MANAGER"}] }  ← Spring Boot UserDetails
 *
 * @param {object} userData - Objeto con datos del usuario
 * @returns {string} Rol normalizado sin prefijo (SUPER_ADMIN, ADMIN, MANAGER, EMPLOYEE)
 */
const extractRole = (userData) => {
  // 1. Array roles[] (formato real del backend)
  if (userData.roles && Array.isArray(userData.roles) && userData.roles.length > 0) {
    return normalizeRole(userData.roles[0]);
  }

  // 2. String role (formato alternativo)
  if (userData.role) {
    return normalizeRole(userData.role);
  }

  // 3. Authorities (Spring Boot UserDetails)
  if (userData.authorities && Array.isArray(userData.authorities) && userData.authorities.length > 0) {
    const first = userData.authorities[0];
    const authority = first?.authority || (typeof first === 'string' ? first : null);
    if (authority) {
      return normalizeRole(authority);
    }
  }

  // 4. Fallback seguro
  return ROLES.EMPLOYEE;
};

export const AuthProvider = ({ children }) => {
  const [token, setToken] = useState(null);
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // Recuperar sesión al montar el componente
  useEffect(() => {
    const storedToken = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');

    if (storedToken && storedUser) {
      try {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setToken(storedToken);
        const parsed = JSON.parse(storedUser);
        // Extraer rol normalizado desde el usuario almacenado
        parsed.role = extractRole(parsed);
        setUser(parsed);
      } catch {
        // Si hay error al parsear, limpiar sesión
        localStorage.removeItem('token');
        localStorage.removeItem('user');
      }
    }
    setLoading(false);
  }, []);

  // Escuchar eventos de sesión expirada (disparados por axios interceptor)
  useEffect(() => {
    const handleUnauthorized = () => {
      setToken(null);
      setUser(null);
    };
    window.addEventListener('auth:unauthorized', handleUnauthorized);
    return () => window.removeEventListener('auth:unauthorized', handleUnauthorized);
  }, []);

  const login = useCallback(async (usernameOrEmail, password) => {
    const data = await loginService(usernameOrEmail, password);

    if (data.success && data.data) {
      const { token: jwtToken, ...userData } = data.data;

      // Extraer rol normalizado desde la respuesta del backend
      userData.role = extractRole(userData);

      // Guardar en localStorage
      localStorage.setItem('token', jwtToken);
      localStorage.setItem('user', JSON.stringify(userData));

      // Guardar en estado
      setToken(jwtToken);
      setUser(userData);

      return { success: true };
    }

    return {
      success: false,
      message: data.message || 'Error al iniciar sesión',
    };
  }, []);

  const logout = useCallback(() => {
    // Limpiar localStorage
    localStorage.removeItem('token');
    localStorage.removeItem('user');

    // Limpiar estado
    setToken(null);
    setUser(null);
  }, []);

  // No considerar autenticado mientras se está verificando la sesión inicial
  const isAuthenticated = !!token && !loading;

  const value = {
    token,
    user,
    login,
    logout,
    isAuthenticated,
    loading,
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
};

export default AuthContext;
