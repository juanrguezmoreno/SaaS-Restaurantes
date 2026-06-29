# Restaurant Manager Frontend

## Descripción del Proyecto

Aplicación frontend SPA para la gestión integral de restaurantes. Panel de administración tipo dashboard con autenticación JWT, gestión de clientes, mesas, reservas, empleados y estadísticas. Consume una API REST desarrollada con Spring Boot.

## Stack Tecnológico

| Tecnología | Versión | Propósito |
|---|---|---|
| React | 19 | Librería de UI |
| TypeScript | ~5.7 | Tipado estático |
| Vite | 8 | Bundler y dev server |
| Tailwind CSS | 4 | Estilos utilitarios |
| React Router DOM | 7 | Enrutamiento SPA |
| Axios | 1.17+ | Cliente HTTP |
| JWT | — | Autenticación stateless |
| Vitest | — | Testing unitario |
| React Testing Library | — | Testing de componentes |

## Estructura de Carpetas Recomendada

```
src/
├── api/                    # Instancia Axios, interceptores, configuración
│   └── axios.ts
├── assets/                 # Imágenes, íconos, fuentes
├── components/             # Componentes reutilizables globales
│   ├── ui/                 #   Atoms (Button, Input, Badge, Card, Modal, Table)
│   ├── layout/             #   Navbar, Sidebar, MainLayout
│   └── feedback/           #   LoadingSpinner, ErrorMessage, EmptyState
├── features/               # Módulos por funcionalidad
│   ├── auth/               #   Login, Register, AuthContext, ProtectedRoute
│   ├── dashboard/          #   Dashboard, tarjetas de stats, gráficos
│   ├── restaurants/        #   CRUD de restaurantes
│   ├── tables/             #   CRUD de mesas
│   ├── customers/          #   CRUD de clientes
│   ├── reservations/       #   CRUD de reservas
│   └── employees/          #   CRUD de empleados
├── hooks/                  # Custom hooks globales
│   ├── useAuth.ts
│   └── usePagination.ts
├── lib/                    # Utilidades, helpers, constantes
│   ├── utils.ts
│   └── constants.ts
├── services/               # Capa HTTP (llamadas a la API)
│   ├── authService.ts
│   ├── restaurantService.ts
│   ├── tableService.ts
│   ├── customerService.ts
│   ├── reservationService.ts
│   └── employeeService.ts
├── types/                  # Tipos TypeScript compartidos
│   ├── api.ts              #   Respuestas genéricas, paginación
│   ├── auth.ts
│   ├── restaurant.ts
│   ├── table.ts
│   ├── customer.ts
│   ├── reservation.ts
│   └── employee.ts
├── App.tsx                 # Componente raíz con Router
├── main.tsx                # Entry point
└── index.css               # Directivas Tailwind
```

## Convenciones de Nombres

| Recurso | Convención | Ejemplo |
|---|---|---|
| Componentes React | PascalCase | `DataTable.tsx`, `LoginForm.tsx` |
| Páginas (features) | PascalCase + `Page` | `DashboardPage.tsx`, `CustomersPage.tsx` |
| Servicios API | camelCase + `Service` | `authService.ts`, `restaurantService.ts` |
| Hooks | camelCase + `use` | `useAuth.ts`, `usePagination.ts` |
| Tipos/Interfaces | PascalCase | `User`, `Restaurant`, `ApiResponse<T>` |
| Archivos de tipos | camelCase | `auth.ts`, `api.ts` |
| Contextos | PascalCase + `Context` / `Provider` | `AuthContext.tsx`, `AuthProvider.tsx` |
| Carpetas de features | kebab-case | `reservation-detail/`, `user-profile/` |
| Constantes | UPPER_SNAKE_CASE | `MAX_FILE_SIZE`, `API_BASE_URL` |
| Variables y funciones | camelCase | `getUserById`, `isAuthenticated` |
| Props de componentes | camelCase | `onSubmit`, `isLoading`, `itemsPerPage` |

## Comandos Previstos

```bash
pnpm run dev          # Inicia servidor de desarrollo Vite
pnpm run build        # Build de producción
pnpm run preview      # Previsualiza el build
pnpm run lint         # ESLint
pnpm run typecheck    # Verificación de tipos TypeScript
pnpm run test         # Ejecuta tests con Vitest
pnpm run test:watch   # Tests en modo watch
pnpm run test:coverage# Tests con reporte de cobertura
```

## Reglas de Seguridad

1. **JWT**: No almacenar en `localStorage`. Preferir cookies `HttpOnly` si el backend lo permite. En su defecto, almacenar en memoria (variable) con refresh token en cookie.
2. **Interceptors**: El interceptor de Axios debe adjuntar el token automáticamente y redirigir al login en 401.
3. **Rutas protegidas**: Usar `ProtectedRoute` que valide autenticación y redirija a `/login`.
4. **XSS**: Validar y sanitizar cualquier entrada del usuario. React lo maneja por defecto en JSX, pero tener cuidado con `dangerouslySetInnerHTML`.
5. **CSRF**: Si se usan cookies, implementar protección CSRF.
6. **Variables de entorno**: Usar `VITE_API_URL` para la URL base de la API. Nunca exponer secrets.
7. **Formularios**: Validar tanto en cliente (antes de enviar) como en servidor.
8. **Errores**: No mostrar detalles técnicos al usuario. Mostrar mensajes genéricos amigables y loguear el error real.

## Definition of Done (DoD)

- [ ] El código compila sin errores de TypeScript
- [ ] El lint pasa sin warnings (`pnpm run lint`)
- [ ] Los tests unitarios pasan (`pnpm run test`)
- [ ] Todos los estados están cubiertos: **loading**, **error**, **empty**, **success**
- [ ] Diseño responsive validado en mobile y desktop
- [ ] Accesibilidad básica: roles ARIA, etiquetas, contraste de color
- [ ] No hay código duplicado
- [ ] No hay secretos hardcodeados
- [ ] Las llamadas API manejan errores (try/catch con mensajes al usuario)
- [ ] El componente/página sigue la estructura de carpetas por features
- [ ] PR revisado por al menos un agente (auditor)

## Flujo de Trabajo Recomendado

1. **Planificación**: auditor analiza el requerimiento y define el alcance.
2. **Creación de types**: Se definen/actualizan las interfaces TypeScript en `src/types/`.
3. **Servicio API**: Se crea/actualiza el servicio en `src/services/` con las llamadas HTTP.
4. **Componentes UI**: Se crean componentes atómicos en `src/components/ui/` si es necesario.
5. **Feature**: Se implementa la página/feature completa en `src/features/`.
6. **Tests**: Se escriben tests unitarios para la nueva funcionalidad.
7. **Revisión**: auditor valida que cumple la DoD.
8. **Merge**: Se integra a la rama principal.

## Reglas para Integración con la API

- **Base URL**: `VITE_API_URL` desde variables de entorno.
- **Instancia Axios**: Centralizada en `src/api/axios.ts` con interceptores.
- **Interceptor de request**: Adjunta `Authorization: Bearer <token>` automáticamente.
- **Interceptor de response**: Maneja 401 (redirigir a login), 403 (sin permisos), 500 (error genérico).
- **Refresh token**: Si el backend lo soporta, implementar refresh silencioso en el interceptor de response.
- **Métodos**: `get` para lecturas, `post` para creación, `put` para actualización completa, `patch` para parcial, `delete` para borrado.
- **Paginación**: La API devuelve `{ content: T[], totalPages, totalElements, number, size }`. El frontend debe manejar este formato.
- **Errores**: La API devuelve `{ message: string, status: number, errors?: Record<string, string> }`. Mostrar `message` al usuario y `errors` en validación de formularios.
- **Headers**: `Content-Type: application/json` por defecto. `multipart/form-data` para subida de archivos.

## Estilo Visual

- **Look & feel**: Limpio, moderno, profesional, tipo dashboard SaaS.
- **Paleta**: Colores neutrales (grises, slate) con un color de acento (indigo/blue) para acciones primarias.
- **Tipografía**: Inter o sistema sans-serif.
- **Layout**: Sidebar colapsable a la izquierda, header superior con usuario y notificaciones, contenido principal con padding.
- **Tablas**: Con búsqueda, paginación, columnas sortables, acciones por fila.
- **Formularios**: Con validación inline, mensajes de error claros, loading states en botones de submit.
- **Dashboard**: Tarjetas con estadísticas (KPI cards), gráficos simples, tabla de actividad reciente.
- **Responsive**: Mobile-first. Sidebar se convierte en menú hamburguesa en pantallas pequeñas.
- **Estados vacíos**: Ilustración o icono + mensaje + CTA cuando no hay datos.
- **Carga**: Spinners/Skeletons mientras se cargan datos.
