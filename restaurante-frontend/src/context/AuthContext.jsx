import { createContext, useState, useContext, useEffect, useCallback } from 'react';
import { login as loginService } from '../services/authService';
import { ROLES } from '../config/permissions';

const AuthContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth debe usarse dentro de un AuthProvider');
  }
  return context;
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
        // Asegurar que el usuario tenga un rol (por defecto ADMIN)
        if (!parsed.role) {
          parsed.role = ROLES.ADMIN;
        }
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

      // Si el backend no envía role, asignar ADMIN por defecto
      if (!userData.role) {
        userData.role = ROLES.ADMIN;
      }

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
