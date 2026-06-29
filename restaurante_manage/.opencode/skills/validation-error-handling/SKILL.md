# validation-error-handling — Skill de validaciones y manejo global de errores

## Propósito

Centralizar la validación de datos de entrada y el manejo de excepciones en toda la API.

## Cuándo usarlo

- En toda API REST que reciba datos del cliente.
- Desde el inicio del proyecto, para mantener consistencia.

## Dependencias

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-validation</artifactId>
</dependency>
```

## Componentes necesarios

### GlobalExceptionHandler

Clase anotada con `@RestControllerAdvice` que maneja:

| Excepción | Código HTTP |
|---|---|
| `MethodArgumentNotValidException` | 400 Bad Request |
| `ConstraintViolationException` | 400 Bad Request |
| `HttpMessageNotReadableException` | 400 Bad Request |
| `ResourceNotFoundException` | 404 Not Found |
| `AccessDeniedException` | 403 Forbidden |
| `AuthenticationException` | 401 Unauthorized |
| `DataIntegrityViolationException` | 409 Conflict |
| `Exception` (catch-all) | 500 Internal Server Error |

### DTO de respuesta de error

```json
{
    "status": 400,
    "code": "BAD_REQUEST",
    "message": "Mensaje descriptivo",
    "timestamp": "2026-06-04T10:00:00Z",
    "errors": [
        {
            "field": "nombre",
            "message": "El nombre no puede estar vacío"
        }
    ]
}
```

## Reglas

- Validar siempre los DTOs con anotaciones de Jakarta Validation (`@NotBlank`, `@Email`, `@Size`, `@Positive`, etc.).
- Usar `@Valid` o `@Validated` en los controladores.
- Los mensajes de error deben ser en español y descriptivos.
- Nunca devolver stack traces al cliente.
- Loguear el error completo con el logger del servicio.

## Skills relacionados

- `spring-boot-api`
- `spring-data-jpa-mysql`
- `spring-security-jwt`
