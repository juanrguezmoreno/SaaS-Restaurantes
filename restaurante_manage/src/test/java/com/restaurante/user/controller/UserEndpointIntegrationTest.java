package com.restaurante.user.controller;

import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.test.context.support.WithUserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Listado de empleados: paginación, búsqueda, filtros, ordenación y quién puede
 * llegar al endpoint.
 *
 * <p>El perfil {@code dev} arranca con usuarios demo, así que las pruebas se
 * apoyan en un prefijo propio para poder afirmar totales exactos.</p>
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
// La base H2 vive todo el contexto: sin rollback, los usuarios que crea cada
// prueba se acumularían y los totales dejarían de significar nada.
@Transactional
class UserEndpointIntegrationTest {

    private static final String RUTA = "/api/v1/users";

    /** Prefijo propio, para buscar solo lo que crea esta prueba. */
    private static final String PREFIJO = "zzemp";

    @Autowired private MockMvc mockMvc;
    @Autowired private UserRepository userRepository;
    @Autowired private RoleRepository roleRepository;
    @Autowired private PasswordEncoder passwordEncoder;

    @BeforeEach
    void setUp() {
        Role employeeRole = roleRepository.findByName(RoleName.ROLE_EMPLOYEE).orElseThrow();
        Role managerRole = roleRepository.findByName(RoleName.ROLE_MANAGER).orElseThrow();

        // 7 empleados propios, sin tenant: suficientes para varias páginas de 3.
        for (int i = 1; i <= 7; i++) {
            User user = new User();
            user.setUsername(PREFIJO + ".user" + i);
            user.setEmail(PREFIJO + i + "@ejemplo.com");
            user.setPassword(passwordEncoder.encode("secreto123"));
            user.setFirstName("Nombre" + (char) ('A' + i - 1));
            user.setLastName("Apellido" + i);
            user.setPhone("70000000" + i);
            user.setEnabled(i % 2 == 1);
            // Colección mutable: Hibernate necesita poder modificarla al volcar.
            user.setRoles(new HashSet<>(Set.of(i <= 2 ? managerRole : employeeRole)));
            userRepository.save(user);
        }
    }

    // ─── Seguridad ──────────────────────────────────────────────────────────

    @Test
    void sinAutenticacionRechazaElListado() throws Exception {
        mockMvc.perform(get(RUTA)).andExpect(status().isUnauthorized());
    }

    @Test
    void sinAutenticacionRechazaLasMetricas() throws Exception {
        mockMvc.perform(get(RUTA + "/stats")).andExpect(status().isUnauthorized());
    }

    @Test
    @WithUserDetails("super.admin")
    void elSuperAdminAccedeAlListado() throws Exception {
        mockMvc.perform(get(RUTA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content").isArray());
    }

    @Test
    @WithUserDetails("juan.admin")
    void unAdministradorAccedePeroSoloVeSuCuenta() throws Exception {
        // Los empleados que crea esta prueba no tienen tenant, así que el ADMIN
        // del tenant demo no debe verlos ni buscándolos.
        mockMvc.perform(get(RUTA).param("search", PREFIJO))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    @Test
    @WithUserDetails("manager.demo")
    void unEncargadoAccedeAlListado() throws Exception {
        mockMvc.perform(get(RUTA)).andExpect(status().isOk());
    }

    @Test
    @WithUserDetails("employee.demo")
    void unEmpleadoNoAccede() throws Exception {
        mockMvc.perform(get(RUTA)).andExpect(status().isForbidden());
    }

    @Test
    @WithUserDetails("employee.demo")
    void unEmpleadoNoAccedeALasMetricas() throws Exception {
        mockMvc.perform(get(RUTA + "/stats")).andExpect(status().isForbidden());
    }

    @Test
    @WithUserDetails("super.admin")
    void elListadoNoExponeLaContrasena() throws Exception {
        mockMvc.perform(get(RUTA).param("search", PREFIJO))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].password").doesNotExist());
    }

    // ─── Paginación ─────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void primeraPagina() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("page", "0")
                        .param("size", "3")
                        .param("sort", "username")
                        .param("direction", "asc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.page").value(0))
                .andExpect(jsonPath("$.size").value(3))
                .andExpect(jsonPath("$.totalElements").value(7))
                .andExpect(jsonPath("$.totalPages").value(3))
                .andExpect(jsonPath("$.first").value(true))
                .andExpect(jsonPath("$.last").value(false))
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.content[0].username").value(PREFIJO + ".user1"));
    }

    @Test
    @WithUserDetails("super.admin")
    void paginaIntermedia() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("page", "1")
                        .param("size", "3")
                        .param("sort", "username"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.first").value(false))
                .andExpect(jsonPath("$.last").value(false))
                .andExpect(jsonPath("$.content.length()").value(3))
                .andExpect(jsonPath("$.content[0].username").value(PREFIJO + ".user4"));
    }

    @Test
    @WithUserDetails("super.admin")
    void ultimaPagina() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("page", "2")
                        .param("size", "3")
                        .param("sort", "username"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.last").value(true))
                .andExpect(jsonPath("$.content.length()").value(1))
                .andExpect(jsonPath("$.content[0].username").value(PREFIJO + ".user7"));
    }

    @Test
    @WithUserDetails("super.admin")
    void paginaFueraDeRangoDevuelveVacioPeroConservaElTotal() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("page", "99")
                        .param("size", "3"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content.length()").value(0))
                .andExpect(jsonPath("$.empty").value(true))
                .andExpect(jsonPath("$.totalElements").value(7));
    }

    @Test
    @WithUserDetails("super.admin")
    void cambiarElTamanoCambiaElNumeroDePaginas() throws Exception {
        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("size", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(10))
                .andExpect(jsonPath("$.totalPages").value(1))
                .andExpect(jsonPath("$.content.length()").value(7));
    }

    @Test
    @WithUserDetails("super.admin")
    void elTamanoDePaginaEstaAcotado() throws Exception {
        mockMvc.perform(get(RUTA).param("size", "5000"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.size").value(100));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnaPaginaNegativa() throws Exception {
        mockMvc.perform(get(RUTA).param("page", "-1"))
                .andExpect(status().isBadRequest());
    }

    // ─── Búsqueda ───────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void busquedaPorEmail() throws Exception {
        mockMvc.perform(get(RUTA).param("search", PREFIJO + "3@ejemplo.com"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1))
                .andExpect(jsonPath("$.content[0].username").value(PREFIJO + ".user3"));
    }

    @Test
    @WithUserDetails("super.admin")
    void busquedaPorNombreCompletoYTelefono() throws Exception {
        mockMvc.perform(get(RUTA).param("search", "NombreC Apellido3"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));

        mockMvc.perform(get(RUTA).param("search", "700000005"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(1));
    }

    @Test
    @WithUserDetails("super.admin")
    void busquedaSinResultados() throws Exception {
        mockMvc.perform(get(RUTA).param("search", "no-existe-este-empleado-xyz"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.empty").value(true));
    }

    @Test
    @WithUserDetails("super.admin")
    void elComodinDelUsuarioSeBuscaLiteralmente() throws Exception {
        mockMvc.perform(get(RUTA).param("search", "%"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0));
    }

    // ─── Filtros ────────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void filtraPorRol() throws Exception {
        // De los 7 propios, 2 son MANAGER y 5 EMPLOYEE.
        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("role", "MANAGER"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(2));

        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("role", "ROLE_EMPLOYEE"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(5));
    }

    @Test
    @WithUserDetails("super.admin")
    void filtraPorEstado() throws Exception {
        // Los impares quedan activos: 1, 3, 5 y 7.
        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("status", "active"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(4));

        mockMvc.perform(get(RUTA).param("search", PREFIJO).param("status", "inactive"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(3));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnRolNoValido() throws Exception {
        mockMvc.perform(get(RUTA).param("role", "JEFE_SUPREMO"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnEstadoNoValido() throws Exception {
        mockMvc.perform(get(RUTA).param("status", "quizas"))
                .andExpect(status().isBadRequest());
    }

    // ─── Ordenación ─────────────────────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void ordenAscendentePorNombre() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("sort", "name")
                        .param("direction", "asc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].firstName").value("NombreA"))
                .andExpect(jsonPath("$.content[6].firstName").value("NombreG"));
    }

    @Test
    @WithUserDetails("super.admin")
    void ordenDescendentePorNombre() throws Exception {
        mockMvc.perform(get(RUTA)
                        .param("search", PREFIJO)
                        .param("sort", "name")
                        .param("direction", "desc"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.content[0].firstName").value("NombreG"))
                .andExpect(jsonPath("$.content[6].firstName").value("NombreA"));
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnCampoDeOrdenNoPermitido() throws Exception {
        // El rol no es ordenable: es una colección.
        mockMvc.perform(get(RUTA).param("sort", "role"))
                .andExpect(status().isBadRequest());

        mockMvc.perform(get(RUTA).param("sort", "password"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @WithUserDetails("super.admin")
    void rechazaUnaDireccionNoValida() throws Exception {
        mockMvc.perform(get(RUTA).param("direction", "arriba"))
                .andExpect(status().isBadRequest());
    }

    // ─── Métricas y conjunto vacío ──────────────────────────────────────────

    @Test
    @WithUserDetails("super.admin")
    void lasMetricasSeCalculanEnElServidor() throws Exception {
        mockMvc.perform(get(RUTA + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(org.hamcrest.Matchers.greaterThanOrEqualTo(7)))
                .andExpect(jsonPath("$.data.active").exists())
                .andExpect(jsonPath("$.data.inactive").exists());
    }

    @Test
    @WithUserDetails("super.admin")
    void sinEmpleadosDevuelvePaginaVaciaYMetricasACero() throws Exception {
        List<User> todos = userRepository.findAllByDeletedFalse();
        todos.forEach(user -> {
            user.setDeleted(true);
            user.setDeletedAt(java.time.LocalDateTime.now());
        });
        userRepository.saveAll(todos);

        mockMvc.perform(get(RUTA))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.totalElements").value(0))
                .andExpect(jsonPath("$.totalPages").value(0))
                .andExpect(jsonPath("$.empty").value(true));

        mockMvc.perform(get(RUTA + "/stats"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.total").value(0))
                .andExpect(jsonPath("$.data.active").value(0))
                .andExpect(jsonPath("$.data.inactive").value(0));
    }
}
