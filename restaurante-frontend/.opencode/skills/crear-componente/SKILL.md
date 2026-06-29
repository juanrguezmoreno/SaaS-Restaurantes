---
name: crear-componente
description: >
  Crear un nuevo componente React reutilizable en src/components/ui/ con
  TypeScript y Tailwind CSS. Usar cuando el usuario pida "crea un componente",
  "nuevo componente", "componente para X" o al agregar UI reutilizable.
---

# Crear Componente React

1. Lee `AGENTS.md` para refrescar convenciones.
2. Identifica el tipo de componente:
   - **UI atom**: `src/components/ui/<Nombre>.tsx` (Button, Input, Badge, Card, Modal, Table)
   - **Layout**: `src/components/layout/<Nombre>.tsx` (Navbar, Sidebar)
   - **Feedback**: `src/components/feedback/<Nombre>.tsx` (LoadingSpinner, ErrorMessage)
3. Lee un componente similar existente para mantener consistencia.
4. Crea el componente con:
   - TypeScript, `export default`
   - Tailwind CSS classes
   - Props tipadas con interface
   - Estados relevantes
5. NO agregues comentarios en el código.
