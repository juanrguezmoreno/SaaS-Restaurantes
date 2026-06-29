---
name: crear-contexto
description: >
  Crear un nuevo contexto React en src/context/ siguiendo el patrón de
  AuthContext. Usar cuando el usuario pida "contexto", "context", "provider
  para X" o "estado global para X".
---

# Crear Contexto React

1. Lee el `AuthContext` existente en `src/context/` para mantener el patrón.
2. Crea `src/context/<Nombre>Context.tsx` con:
   - Interface para el estado del contexto
   - Context creado con `createContext`
   - Provider component que gestiona el estado con hooks
   - Hook personalizado `use<Nombre>` con validación de que existe el provider
   - `export default` para el Provider, export nombrado para el hook
3. NO agregues comentarios en el código.
