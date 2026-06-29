# conventional-commits — Skill de Conventional Commits

## Propósito

Estandarizar los mensajes de commit siguiendo la especificación Conventional Commits para mantener un historial legible y permitir generación automática de changelogs.

## Cuándo usarlo

- En todos los commits del proyecto, desde el primero.

## Formato

```
<tipo>(<alcance opcional>): <descripción>

[ cuerpo opcional ]

[ pie opcional (BREAKING CHANGE, issue references) ]
```

## Tipos permitidos

| Tipo | Uso |
|---|---|
| `feat` | Nueva funcionalidad |
| `fix` | Corrección de bug |
| `docs` | Cambios en documentación |
| `style` | Formato, linting (sin cambio lógico) |
| `refactor` | Refactorización sin cambio funcional |
| `perf` | Mejora de rendimiento |
| `test` | Agregar o corregir tests |
| `build` | Cambios en el sistema de build o dependencias |
| `ci` | Cambios en CI/CD |
| `chore` | Tareas de mantenimiento varias |

## Ejemplos

```
feat(auth): implementar login con JWT

Se agrega endpoint POST /api/v1/auth/login que devuelve
un token JWT válido por 24 horas.

Closes #12
```

```
fix(mesa): corregir validación de capacidad mínima

Ahora se rechazan capacidades menores a 1 con un error 400.
```

```
BREAKING CHANGE(api): cambiar prefijo de /api/v1 a /api/v2

Se actualizan todas las rutas y la estructura de respuestas.
Requiere migración de clientes.
```

## Reglas

- La descripción debe ser en español, en imperativo y sin punto final.
- El alcance es opcional pero recomendado (ej: `feat(auth)`, `fix(mesa)`).
- Usar `BREAKING CHANGE` en el pie para cambios incompatibles.
- Separar tipo del cuerpo con una línea en blanco si hay cuerpo.
- No usar mayúscula inicial en la descripción.

## Skills relacionados

- Todos los skills del proyecto — todos los commits deben seguir esta convención.
