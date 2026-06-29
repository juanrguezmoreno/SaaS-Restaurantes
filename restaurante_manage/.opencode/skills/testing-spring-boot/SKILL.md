# testing-spring-boot — Skill de pruebas en Spring Boot

## Propósito

Escribir pruebas unitarias y de integración para la API usando JUnit 5, Mockito y MockMvc.

## Cuándo usarlo

- Desde el inicio del proyecto (TDD o pruebas continuas).
- Para cada nueva funcionalidad implementada.

## Dependencias (ya incluidas en spring-boot-starter-test)

```xml
<dependency>
    <groupId>org.springframework.boot</groupId>
    <artifactId>spring-boot-starter-test</artifactId>
    <scope>test</scope>
</dependency>
```

Incluye: JUnit 5, Mockito, MockMvc, AssertJ, Hamcrest.

## Estructura de tests

```
src/test/java/com/restaurant/manager/
├── controller/
│   └── MesaControllerTest.java
├── service/
│   └── MesaServiceTest.java
├── repository/
│   └── MesaRepositoryTest.java
└── security/
    └── JwtServiceTest.java
```

## Prácticas recomendadas

### Capas y anotaciones

| Tipo | Anotación | Alcance |
|---|---|---|
| Unitario (service) | `@ExtendWith(MockitoExtension.class)` | Solo la clase bajo test |
| Integración (controller) | `@WebMvcTest(Controller.class)` | Solo capa web |
| Integración (repository) | `@DataJpaTest` | Solo capa JPA |
| Integración completo | `@SpringBootTest` | Contexto completo |

### Reglas

- Nombrar tests con `@DisplayName` descriptivo en español.
- Usar el patrón **Given / When / Then** en los comentarios o estructura.
- No mockear lo que no se necesita.
- Usar `MockMvc` para tests de controladores (evitar levantar el servidor).
- Usar `Testcontainers` para tests de integración con base de datos real.
- Probar siempre el escenario feliz y los casos de error.
- Cobertura mínima deseable: 80 %.

## Skills relacionados

- `spring-boot-api`
- `spring-data-jpa-mysql`
- `validation-error-handling`
- `spring-security-jwt`
