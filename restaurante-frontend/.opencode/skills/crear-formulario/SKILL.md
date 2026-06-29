---
name: crear-formulario
description: >
  Crear un formulario con validación en React + TypeScript para Restaurant
  Manager. Usar cuando el usuario pida "formulario", "form", "crear/editar
  entidad" o "validación de formulario".
---

# Crear Formulario

1. Lee `AGENTS.md` y las guías de UI/UX antes de actuar.
2. Identifica si es formulario de creación, edición o ambos.
3. Crea el formulario en `src/components/ui/<Nombre>Form.tsx` con:
   - **Estados**: idle, submitting, success, error
   - **Validación**: validar en cliente antes de enviar (formato email, campos requeridos, longitud)
   - **Errores inline**: mensaje de error debajo de cada campo, borde rojo
   - **Submit**: botón deshabilitado mientras se envía, texto cambia a "Guardando..."
   - **Campos**: label visible, placeholder opcional, aria-describedby para errores
   - **Props**: `onSubmit`, `initialValues?` (para edición), `isLoading?`
4. Tailwind CSS para estilos, sin comentarios.
