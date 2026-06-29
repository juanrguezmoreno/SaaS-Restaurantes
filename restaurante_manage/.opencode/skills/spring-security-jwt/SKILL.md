# spring-security-jwt — Skill de autenticación con JWT

## Propósito

Implementar autenticación y autorización basada en tokens JWT con Spring Security.

## Cuándo usarlo

- Cuando la API necesite proteger endpoints con autenticación.
- Cuando se requiera un sistema de login basado en tokens.

## Dependencias

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-security</artifactId>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-api</artifactId>
    <version>0.12.3</version>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-impl</artifactId>
    <version>0.12.3</version>
    <scope>runtime</scope>
</dependency>
<dependency>
    <groupId>io.jsonwebtoken</groupId>
    <artifactId>jjwt-jackson</artifactId>
    <version>0.12.3</version>
    <scope>runtime</scope>
</dependency>
```

## Componentes necesarios

| Componente | Propósito |
|---|---|
| `JwtService` | Generar y validar tokens |
| `JwtAuthenticationFilter` | Filtro OncePerRequest para extraer token del header |
| `SecurityConfig` | Configurar SecurityFilterChain, CORS, CSRF |
| `AuthController` | Endpoints `/api/v1/auth/login` y `/api/v1/auth/register` |
| `UserDetailsServiceImpl` | Cargar usuario desde la BD |

## Reglas

- La clave secreta JWT debe ir en `application.yml` **nunca en el código**.
- Usar variables de entorno para secretos en producción.
- El token se envía en el header `Authorization: Bearer <token>`.
- Configurar CORS adecuadamente para el frontend.
- CSRF deshabilitado para API REST stateless.
- Password encoder obligatorio: `BCryptPasswordEncoder`.

## Skills relacionados

- `spring-boot-api`
- `spring-data-jpa-mysql`
- `validation-error-handling`
