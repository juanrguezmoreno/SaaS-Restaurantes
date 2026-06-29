# swagger-openapi — Skill de documentación con Swagger/OpenAPI

## Propósito

Documentar automáticamente la API REST usando Springdoc OpenAPI y Swagger UI.

## Cuándo usarlo

- En toda API REST que necesite documentación accesible para frontend y otros consumidores.
- Desde el inicio del proyecto.

## Dependencias

```xml
<dependency>
    <groupId>org.springdoc</groupId>
    <artifactId>springdoc-openapi-starter-webmvc-ui</artifactId>
    <version>2.3.0</version>
</dependency>
```

## Configuración en application.yml

```yaml
springdoc:
  api-docs:
    path: /api-docs
  swagger-ui:
    path: /swagger-ui.html
    operations-sorter: method
```

## OpenApiConfig

Clase de configuración con `@Configuration` que define:

- `OpenAPI` bean con `info`, `title`, `description`, `version`, `contact`.
- `SecurityScheme` de tipo `Bearer JWT` para el botón Authorize de Swagger.
- Servidores de desarrollo y producción.

## Reglas

- Anotar todos los endpoints con `@Operation` (resumen) y `@ApiResponse` (respuestas posibles).
- Usar `@Schema` en los DTOs para documentar campos.
- Agrupar endpoints por `@Tag(name = "...", description = "...")`.
- No exponer Swagger UI en producción sin autenticación.
- En producción, deshabilitar Swagger con `springdoc.api-docs.enabled=false`.

## Skills relacionados

- `spring-boot-api`
- `spring-security-jwt`
- `validation-error-handling`
