# spring-data-jpa-mysql — Skill de persistencia con JPA y MySQL

## Propósito

Configurar la capa de acceso a datos usando Spring Data JPA con MySQL como base de datos.

## Cuándo usarlo

- Cuando el proyecto necesite persistencia relacional.
- Cuando se haya decidido MySQL como base de datos.

## Dependencias

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-data-jpa</artifactId>
</dependency>
<dependency>
    <groupId>com.mysql</groupId>
    <artifactId>mysql-connector-j</artifactId>
    <scope>runtime</scope>
</dependency>
```

## Configuración en application.yml

```yaml
spring:
  datasource:
    url: jdbc:mysql://localhost:3306/restaurant_manager?useSSL=false&serverTimezone=UTC&allowPublicKeyRetrieval=true
    username: ${DB_USERNAME:root}
    password: ${DB_PASSWORD:root}
    driver-class-name: com.mysql.cj.jdbc.Driver
  jpa:
    hibernate:
      ddl-auto: validate
    show-sql: false
    properties:
      hibernate:
        dialect: org.hibernate.dialect.MySQLDialect
        format_sql: true
```

## Estados de ddl-auto

| Valor | Uso |
|---|---|
| `validate` | Producción — solo valida el esquema |
| `update` | Desarrollo — actualiza esquema automáticamente |
| `none` | Cuando se usan migraciones externas (Flyway) |

## Reglas

- Usar `Lombok` con `@Entity` y `@Table` para nombrar tablas explícitamente.
- Preferir `Long` como tipo de ID autogenerado.
- Usar `@Column(name = "...")` para mapear columnas explícitamente.
- Nunca exponer entidades directamente en los controladores; usar DTOs.
- Las relaciones `@OneToMany` deben ser `Lazy` por defecto.
- Usar `Pageable` para endpoints que devuelvan listas paginadas.

## Skills relacionados

- `spring-boot-api`
- `validation-error-handling`
- `testing-spring-boot`
