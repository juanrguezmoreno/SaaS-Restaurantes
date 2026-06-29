---
name: crear-servicio-api
description: >
  Crear un nuevo servicio API en src/services/ siguiendo el patrón Axios +
  TypeScript para una entidad del sistema. Usar cuando el usuario pida "crea
  un servicio", "servicio para X", "nuevo service" o "API de X".
---

# Crear Servicio API

1. Lee `AGENTS.md` y el perfil de `api-client` antes de actuar.
2. Lee un servicio existente en `src/services/` para mantener el patrón.
3. Crea `src/services/<entidad>Service.ts` con:
   - Importar `api` desde `../api/axios`
   - Importar tipos desde `../types/<entidad>`
   - Exportar funciones: `getAll`, `getById`, `create`, `update`, `remove`
   - URLs comenzando con `/api/`
   - camelCase para nombres de función
   - Manejo de errores con try/catch (rechazar la promesa)
4. Define los tipos necesarios en `src/types/<entidad>.ts`.
5. NO agregues comentarios en el código.
