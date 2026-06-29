# spring-boot-api — Skill de configuración Spring Boot

## Propósito

Configurar un proyecto Spring Boot desde cero como API REST.

## Cuándo usarlo

- Al iniciar un nuevo microservicio o API.
- Cuando se necesite agregar Spring Boot a un proyecto existente.

## Dependencias base (Maven)

```xml
<parent>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-parent</artifactId>
    <version>3.2.0</version>
    <relativePath/>
</parent>

<properties>
    <java.version>17</java.version>
</properties>

<dependencies>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-web</artifactId>
    </dependency>
    <dependency>
        <groupId>org.springframework.boot</groupId>
        <artifactId>spring-boot-starter-test</artifactId>
        <scope>test</scope>
    </dependency>
</dependencies>
```

## Estructura de paquetes recomendada

```
com.restaurant.manager
├── config/
├── controller/
├── dto/
├── exception/
├── model/
├── repository/
├── security/
└── service/
```

## Reglas

- Usar `application.yml` en lugar de `application.properties`.
- No exponer información sensible en las respuestas de error.
- Puerto por defecto: `8080` (configurable en `application.yml`).
- Prefijo global de API: `/api/v1`.

## Skills relacionados

- `spring-data-jpa-mysql`
- `spring-security-jwt`
- `validation-error-handling`
- `swagger-openapi`
- `testing-spring-boot`
