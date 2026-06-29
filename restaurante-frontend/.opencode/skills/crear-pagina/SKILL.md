---
name: crear-pagina
description: >
  Crear una nueva página en src/features/ y registrar su ruta en App.tsx con
  React Router. Usar cuando el usuario pida "nueva página", "página para X",
  "crea una vista" o "nueva ruta".
---

# Crear Página

1. Lee `AGENTS.md` para refrescar convenciones.
2. Identifica la feature y verifica que exista `src/features/<feature>/`.
3. Lee una página existente similar para mantener consistencia.
4. Pasos:
   a. Define/actualiza types en `src/types/<entidad>.ts`.
   b. Crea/actualiza servicio API en `src/services/<entidad>Service.ts`.
   c. Crea componentes UI necesarios en `src/components/ui/`.
   d. Crea la página `src/features/<feature>/<Nombre>Page.tsx`.
   e. Registra la ruta en `src/App.tsx`.
5. La página debe manejar: **loading**, **error**, **empty**, **success**.
6. NO agregues comentarios en el código.
