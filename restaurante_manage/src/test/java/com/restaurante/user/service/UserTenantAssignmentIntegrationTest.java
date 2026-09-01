package com.restaurante.user.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.dto.UserRequest;
import com.restaurante.user.dto.UserResponse;
import com.restaurante.user.dto.UserUpdateRequest;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.test.context.support.WithUserDetails;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * El inquilino de un usuario creado por un SUPER_ADMIN.
 *
 * <p>El formulario de empleados solo envía {@code restaurantIds}: no tiene
 * selector de inquilino ni de restaurante principal. Sin heredar el inquilino
 * de los restaurantes asignados, el usuario se guardaba con
 * {@code tenant = null} y al entrar no veía ningún restaurante, porque
 * {@code CurrentUserService.getVisibleRestaurantIds()} corta en cuanto el
 * inquilino es nulo, sin llegar a mirar las asignaciones.</p>
 */
@SpringBootTest
@ActiveProfiles("dev")
// La base H2 vive todo el contexto: sin rollback, los usuarios de cada prueba
// se acumularían y los nombres únicos chocarían entre ejecuciones.
@Transactional
class UserTenantAssignmentIntegrationTest {

    private static final String PREFIJO = "zzten";

    @Autowired private UserService userService;
    @Autowired private UserRepository userRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private TenantRepository tenantRepository;

    private Tenant inquilino;
    private Restaurant casaPepe;

    @BeforeEach
    void setUp() {
        inquilino = new Tenant();
        inquilino.setName(PREFIJO + " Inquilino");
        inquilino.setSlug(PREFIJO + "-inquilino");
        inquilino = tenantRepository.save(inquilino);

        casaPepe = new Restaurant();
        casaPepe.setName(PREFIJO + " Casa Pepe");
        casaPepe.setTenant(inquilino);
        casaPepe.setPublicBookingEnabled(true);
        casaPepe.setDefaultReservationDurationMinutes(90);
        casaPepe = restaurantRepository.save(casaPepe);
    }

    /** Petición como la que manda el formulario de empleados: solo restaurantIds. */
    private UserRequest peticionDelFormulario(String sufijo, String rol, Set<Long> restaurantIds) {
        UserRequest request = new UserRequest();
        request.setUsername(PREFIJO + "." + sufijo);
        request.setEmail(PREFIJO + "." + sufijo + "@ejemplo.com");
        request.setPassword("contrasena123");
        request.setFirstName("Nombre");
        request.setLastName("Apellido");
        request.setRoles(Set.of(rol));
        request.setRestaurantIds(restaurantIds);
        // Ni tenantId ni restaurantId: el formulario no los tiene.
        return request;
    }

    @Test
    @WithUserDetails("super.admin")
    void elAdminCreadoConRestaurantesHeredaSuInquilino() {
        UserResponse creado = userService.create(
                peticionDelFormulario("admin", "ADMIN", Set.of(casaPepe.getId())));

        User guardado = userRepository.findByIdAndDeletedFalse(creado.getId()).orElseThrow();

        // Sin inquilino, este usuario no vería ningún restaurante al entrar.
        assertThat(guardado.getTenant())
                .as("el ADMIN debe heredar el inquilino del restaurante que se le asigna")
                .isNotNull();
        assertThat(guardado.getTenant().getId()).isEqualTo(inquilino.getId());
        assertThat(guardado.getAssignedRestaurants())
                .extracting(Restaurant::getId)
                .containsExactly(casaPepe.getId());
    }

    @Test
    @WithUserDetails("super.admin")
    void unEmpleadoCreadoConRestaurantesTambienHeredaElInquilino() {
        UserResponse creado = userService.create(
                peticionDelFormulario("emp", "EMPLOYEE", Set.of(casaPepe.getId())));

        User guardado = userRepository.findByIdAndDeletedFalse(creado.getId()).orElseThrow();
        assertThat(guardado.getTenant()).isNotNull();
        assertThat(guardado.getTenant().getId()).isEqualTo(inquilino.getId());
    }

    @Test
    @WithUserDetails("super.admin")
    void elInquilinoExplicitoManda() {
        Tenant otro = new Tenant();
        otro.setName(PREFIJO + " Otro");
        otro.setSlug(PREFIJO + "-otro");
        otro = tenantRepository.save(otro);

        UserRequest request = peticionDelFormulario("explicito", "ADMIN", Set.of(casaPepe.getId()));
        request.setTenantId(otro.getId());

        UserResponse creado = userService.create(request);

        // Lo que se pide de forma explícita nunca lo pisa la herencia.
        User guardado = userRepository.findByIdAndDeletedFalse(creado.getId()).orElseThrow();
        assertThat(guardado.getTenant().getId()).isEqualTo(otro.getId());
    }

    @Test
    @WithUserDetails("super.admin")
    void restaurantesDeInquilinosDistintosSeRechazan() {
        Tenant otro = new Tenant();
        otro.setName(PREFIJO + " Ajeno");
        otro.setSlug(PREFIJO + "-ajeno");
        otro = tenantRepository.save(otro);

        Restaurant ajeno = new Restaurant();
        ajeno.setName(PREFIJO + " Ajeno");
        ajeno.setTenant(otro);
        ajeno.setDefaultReservationDurationMinutes(90);
        ajeno = restaurantRepository.save(ajeno);

        UserRequest request = peticionDelFormulario(
                "mezcla", "MANAGER", Set.of(casaPepe.getId(), ajeno.getId()));

        // Un usuario pertenece a un solo inquilino: mezclarlos no puede resolverse solo.
        assertThatThrownBy(() -> userService.create(request))
                .isInstanceOf(BadRequestException.class)
                .hasMessageContaining("inquilino");
    }

    @Test
    @WithUserDetails("super.admin")
    void sinRestaurantesElUsuarioSeQuedaSinInquilino() {
        // No hay de dónde deducirlo; se conserva el comportamiento de siempre.
        UserResponse creado = userService.create(
                peticionDelFormulario("suelto", "EMPLOYEE", Set.of()));

        User guardado = userRepository.findByIdAndDeletedFalse(creado.getId()).orElseThrow();
        assertThat(guardado.getTenant()).isNull();
    }

    @Test
    @WithUserDetails("super.admin")
    void editarUnUsuarioSinInquilinoLoRepara() {
        // Las cuentas ya creadas se arreglan reeditándolas desde la pantalla,
        // sin tocar la base de datos a mano.
        User roto = new User();
        roto.setUsername(PREFIJO + ".roto");
        roto.setEmail(PREFIJO + ".roto@ejemplo.com");
        roto.setPassword("cifrada");
        roto.setFirstName("Nombre");
        roto.setLastName("Apellido");
        roto.setEnabled(true);
        roto = userRepository.save(roto);
        assertThat(roto.getTenant()).isNull();

        UserUpdateRequest request = new UserUpdateRequest();
        request.setUsername(roto.getUsername());
        request.setEmail(roto.getEmail());
        request.setFirstName("Nombre");
        request.setLastName("Apellido");
        request.setRoles(Set.of("ADMIN"));
        request.setRestaurantIds(Set.of(casaPepe.getId()));

        userService.update(roto.getId(), request);

        User reparado = userRepository.findByIdAndDeletedFalse(roto.getId()).orElseThrow();
        assertThat(reparado.getTenant()).isNotNull();
        assertThat(reparado.getTenant().getId()).isEqualTo(inquilino.getId());
    }
}
