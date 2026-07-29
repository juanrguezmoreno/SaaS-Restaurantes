package com.restaurante.customer.repository;

import com.restaurante.common.config.JpaAuditingConfig;
import com.restaurante.customer.entity.Customer;
import com.restaurante.restaurant.entity.Restaurant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * Verifica contra una base de datos real (H2) la consulta de búsqueda de
 * clientes. Es un test de repositorio a propósito: lo que se quiere blindar es
 * el JPQL —el filtro de alcance multi-tenant y los LIKE— y eso un mock no lo
 * comprueba.
 *
 * <p>El invariante crítico: el alcance por restaurante se aplica SIEMPRE, de
 * modo que pedir explícitamente un restaurante de otro tenant devuelve vacío
 * en lugar de filtrar sus clientes.</p>
 */
@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        // application.yml fija ddl-auto=validate y dialecto MySQL (esquema gestionado
        // por Flyway); en el H2 embebido del test el esquema lo crea Hibernate.
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
@Import(JpaAuditingConfig.class)
class CustomerSearchRepositoryTest {

    private static final Pageable PAGE = PageRequest.of(0, 50);
    /** Marcador de "sin restricción": el contenido se ignora cuando unrestricted = true. */
    private static final Set<Long> IGNORED = Set.of(-1L);

    @Autowired
    private TestEntityManager em;

    @Autowired
    private CustomerRepository repository;

    private Restaurant propio;
    private Restaurant ajeno;

    @BeforeEach
    void setUp() {
        propio = crearRestaurante("La Casa del Chef");
        ajeno = crearRestaurante("Restaurante de otro tenant");

        crearCliente(propio, "Andrea", "Pirlo", "pirlo@email.com", "666777888");
        crearCliente(propio, "María", "García", "maria.garcia@email.com", "555100001");
        crearCliente(propio, "Pedro", "Hernández", "pedro.hernandez@email.com", "555100002");
        crearCliente(ajeno, "Andrea", "Ajena", "andrea.ajena@otrotenant.com", "999000111");
        em.flush();
    }

    private Restaurant crearRestaurante(String nombre) {
        Restaurant r = new Restaurant();
        r.setName(nombre);
        em.persist(r);
        return r;
    }

    private Customer crearCliente(Restaurant restaurante, String nombre, String apellido,
                                  String email, String telefono) {
        Customer c = new Customer();
        c.setRestaurant(restaurante);
        c.setFirstName(nombre);
        c.setLastName(apellido);
        c.setEmail(email);
        c.setPhone(telefono);
        em.persist(c);
        return c;
    }

    private List<String> nombresDe(Page<Customer> page) {
        return page.getContent().stream()
                .map(c -> c.getFirstName() + " " + c.getLastName())
                .toList();
    }

    // ─── Búsqueda por texto ──────────────────────────────────────────────────

    @Test
    @DisplayName("Busca por nombre de pila dentro del alcance")
    void buscaPorNombre() {
        Page<Customer> result = repository.search(false, Set.of(propio.getId()), null, "%andrea%", PAGE);

        assertEquals(List.of("Andrea Pirlo"), nombresDe(result));
    }

    @Test
    @DisplayName("Busca por apellido y por nombre completo")
    void buscaPorApellidoYNombreCompleto() {
        assertEquals(List.of("María García"),
                nombresDe(repository.search(false, Set.of(propio.getId()), null, "%garcía%", PAGE)));

        assertEquals(List.of("Andrea Pirlo"),
                nombresDe(repository.search(false, Set.of(propio.getId()), null, "%andrea pirlo%", PAGE)));
    }

    @Test
    @DisplayName("Busca por email y por teléfono")
    void buscaPorEmailYTelefono() {
        assertEquals(List.of("Pedro Hernández"),
                nombresDe(repository.search(false, Set.of(propio.getId()), null, "%pedro.hernandez@%", PAGE)));

        assertEquals(List.of("Andrea Pirlo"),
                nombresDe(repository.search(false, Set.of(propio.getId()), null, "%666777%", PAGE)));
    }

    @Test
    @DisplayName("Sin texto de búsqueda devuelve todo el alcance")
    void sinBusquedaDevuelveTodoElAlcance() {
        Page<Customer> result = repository.search(false, Set.of(propio.getId()), null, null, PAGE);

        assertEquals(3, result.getTotalElements());
    }

    @Test
    @DisplayName("Una búsqueda sin coincidencias devuelve vacío, no la lista entera")
    void busquedaSinCoincidencias() {
        Page<Customer> result = repository.search(false, Set.of(propio.getId()), null, "%nadie%", PAGE);

        assertTrue(result.isEmpty());
    }

    // ─── Aislamiento multi-tenant ────────────────────────────────────────────

    @Test
    @DisplayName("La búsqueda NUNCA alcanza clientes de un restaurante fuera del alcance")
    void noVeClientesDeOtroTenant() {
        // "andrea" coincide con un cliente propio y con uno del tenant ajeno.
        Page<Customer> result = repository.search(false, Set.of(propio.getId()), null, "%andrea%", PAGE);

        assertEquals(1, result.getTotalElements());
        assertEquals(List.of("Andrea Pirlo"), nombresDe(result));
    }

    @Test
    @DisplayName("Pedir explícitamente un restaurante ajeno devuelve vacío, no sus clientes")
    void restaurantIdFueraDelAlcanceNoFiltraDatosAjenos() {
        Page<Customer> result = repository.search(false, Set.of(propio.getId()), ajeno.getId(), null, PAGE);

        assertTrue(result.isEmpty(), "El alcance debe imponerse sobre el restaurantId solicitado");
    }

    @Test
    @DisplayName("El filtro por restaurante funciona dentro del alcance")
    void filtraPorRestauranteDentroDelAlcance() {
        Set<Long> ambos = Set.of(propio.getId(), ajeno.getId());

        Page<Customer> result = repository.search(false, ambos, ajeno.getId(), null, PAGE);

        assertEquals(List.of("Andrea Ajena"), nombresDe(result));
    }

    @Test
    @DisplayName("Sin restricción (SUPER_ADMIN) se ven los clientes de todos los tenants")
    void sinRestriccionVeTodo() {
        Page<Customer> result = repository.search(true, IGNORED, null, "%andrea%", PAGE);

        assertEquals(2, result.getTotalElements());
    }

    // ─── Borrado lógico y comodines ──────────────────────────────────────────

    @Test
    @DisplayName("Los clientes borrados lógicamente quedan fuera de la búsqueda")
    void ignoraBorradosLogicos() {
        Customer borrado = crearCliente(propio, "Andrea", "Borrada", "borrada@email.com", "111222333");
        borrado.setDeleted(true);
        em.flush();

        Page<Customer> result = repository.search(false, Set.of(propio.getId()), null, "%andrea%", PAGE);

        assertEquals(List.of("Andrea Pirlo"), nombresDe(result));
    }

    @Test
    @DisplayName("Un comodín escapado se busca de forma literal y no devuelve toda la tabla")
    void comodinEscapadoNoAmpliaLaBusqueda() {
        // '%' escapado como '!%' con ESCAPE '!': ningún cliente contiene ese carácter.
        Page<Customer> result = repository.search(false, Set.of(propio.getId()), null, "%!%%", PAGE);

        assertTrue(result.isEmpty(), "Un '%' escrito por el usuario no debe comportarse como comodín");
    }
}
