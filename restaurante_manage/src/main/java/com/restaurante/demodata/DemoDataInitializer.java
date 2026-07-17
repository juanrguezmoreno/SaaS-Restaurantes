package com.restaurante.demodata;

import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import jakarta.persistence.EntityManager;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.CommandLineRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;

/**
 * Crea (o recrea) los datos demo multi-tenant al arranque.
 *
 * Estructura de tenants:
 *   - "Demo Gourmet" (slug: demo-gourmet)
 *       Restaurantes: La Casa del Chef, Sushi Master, El Rincón de la Abuela
 *   - "Legacy/Test" (slug: legacy-test)
 *       Restaurantes: Restaurante Principal, Restaurante Secundario
 *
 * Usuarios demo (contraseña: admin123):
 *   - super.admin  → SUPER_ADMIN (sin tenant, ve todos los restaurantes)
 *   - juan.admin   → ADMIN   (Demo Gourmet)
 *   - manager.demo → MANAGER (Demo Gourmet)
 *   - employee.demo→ EMPLOYEE(Demo Gourmet)
 *   - ana.manager  → MANAGER (Demo Gourmet, restaurante: La Casa del Chef)
 *   - luis.manager → MANAGER (Demo Gourmet, restaurante: Sushi Master)
 *   - carlos.emp   → EMPLOYEE(Demo Gourmet, restaurante: La Casa del Chef)
 */
@Component
@Profile("dev")
@RequiredArgsConstructor
@Slf4j
public class DemoDataInitializer implements CommandLineRunner {

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final RestaurantRepository restaurantRepository;
    private final TenantRepository tenantRepository;
    private final PasswordEncoder passwordEncoder;
    private final EntityManager entityManager;

    @Override
    @Transactional
    public void run(String... args) {
        log.warn("==================================================================================");
        log.warn(" PERFIL 'dev' ACTIVO — base de datos H2 en memoria (NO es tu MySQL real)");
        log.warn(" Se está recreando y sembrando TODA la base con datos de demostración,");
        log.warn(" incluidas reservas con fecha de HOY (ver data.sql) — no son reservas reales.");
        log.warn(" Todo se pierde al reiniciar. Para trabajar contra tus datos reales (MySQL),");
        log.warn(" arranca SIN perfil: mvn spring-boot:run");
        log.warn("==================================================================================");

        String encodedPassword = passwordEncoder.encode("admin123");
        List<Restaurant> allRestaurants = restaurantRepository.findAll();

        log.info("[DemoData] Iniciando creación de datos demo multi-tenant...");

        // ────────────────────────────────────────────────────────────────
        // 1. CREAR O REUTILIZAR ROLES
        // ────────────────────────────────────────────────────────────────
        Role superAdminRole = getOrCreateRole(RoleName.ROLE_SUPER_ADMIN);
        Role adminRole = getOrCreateRole(RoleName.ROLE_ADMIN);
        Role managerRole = getOrCreateRole(RoleName.ROLE_MANAGER);
        Role employeeRole = getOrCreateRole(RoleName.ROLE_EMPLOYEE);

        // ────────────────────────────────────────────────────────────────
        // 2. CREAR TENANTS
        // ────────────────────────────────────────────────────────────────
        Tenant demoGourmet = createTenantIfNotExists("Demo Gourmet", "demo-gourmet");
        Tenant legacyTest = createTenantIfNotExists("Legacy/Test", "legacy-test");
        log.info("[DemoData] Tenants creados/verificados: '{}' y '{}'", demoGourmet.getName(), legacyTest.getName());

        // ────────────────────────────────────────────────────────────────
        // 3. ASIGNAR RESTAURANTES A TENANTS
        // ────────────────────────────────────────────────────────────────
        assignRestaurantToTenant(allRestaurants, "La Casa del Chef", demoGourmet);
        assignRestaurantToTenant(allRestaurants, "Sushi Master", demoGourmet);
        assignRestaurantToTenant(allRestaurants, "El Rincón de la Abuela", demoGourmet);
        assignRestaurantToTenant(allRestaurants, "Restaurante Principal", legacyTest);
        assignRestaurantToTenant(allRestaurants, "Restaurante Secundario", legacyTest);
        log.info("[DemoData] Restaurantes asignados a tenants correctamente");

        // ────────────────────────────────────────────────────────────────
        // 4. OBTENER REFERENCIAS A RESTAURANTES (para asignación directa)
        // ────────────────────────────────────────────────────────────────
        Restaurant casaDelChef = findByName(allRestaurants, "La Casa del Chef");
        Restaurant sushiMaster = findByName(allRestaurants, "Sushi Master");
        Restaurant rinconAbuela = findByName(allRestaurants, "El Rincón de la Abuela");

        if (casaDelChef == null) log.warn("[DemoData] No se encontró 'La Casa del Chef'");
        if (sushiMaster == null) log.warn("[DemoData] No se encontró 'Sushi Master'");
        if (rinconAbuela == null) log.warn("[DemoData] No se encontró 'El Rincón de la Abuela'");

        // ────────────────────────────────────────────────────────────────
        // 5. ELIMINAR USUARIOS DEMO PREVIOS
        // ────────────────────────────────────────────────────────────────
        for (String username : List.of("super.admin", "juan.admin", "ana.manager",
                "luis.manager", "carlos.emp", "manager.demo", "employee.demo")) {
            deleteExistingDemoUser(username);
        }
        entityManager.flush();

        // ────────────────────────────────────────────────────────────────
        // 6. CREAR USUARIOS DEMO
        // ────────────────────────────────────────────────────────────────

        // SUPER_ADMIN (sin tenant, sin restaurante asignado, sin asignaciones)
        createUser("super.admin", "super.admin@restaurantes.com", encodedPassword,
                "Super", "Admin", "555-000-0000",
                null, null, superAdminRole, Set.of());

        // ADMIN del tenant Demo Gourmet (sin asignaciones → ve todos los restaurantes del tenant)
        createUser("juan.admin", "juan.admin@restaurantes.com", encodedPassword,
                "Juan", "Administrador", "555-000-0001",
                demoGourmet, null, adminRole, Set.of());

        // MANAGER general del tenant Demo Gourmet (sin asignaciones → ve todos los restaurantes del tenant)
        createUser("manager.demo", "manager.demo@restaurantes.com", encodedPassword,
                "Manager", "Demo", "555-000-0005",
                demoGourmet, null, managerRole, Set.of());

        // EMPLOYEE general del tenant Demo Gourmet (sin asignaciones → NO ve ningún restaurante)
        createUser("employee.demo", "employee.demo@restaurantes.com", encodedPassword,
                "Employee", "Demo", "555-000-0006",
                demoGourmet, null, employeeRole, Set.of());

        // MANAGER de La Casa del Chef (con restaurante y asignación explícita)
        createUser("ana.manager", "ana.martinez@lacasadelchef.com", encodedPassword,
                "Ana", "Martínez", "555-000-0002",
                demoGourmet, casaDelChef, managerRole, singletonSet(casaDelChef));

        // MANAGER de Sushi Master (con restaurante y asignación explícita)
        createUser("luis.manager", "luis.torres@sushi-master.com", encodedPassword,
                "Luis", "Torres", "555-000-0003",
                demoGourmet, sushiMaster, managerRole, singletonSet(sushiMaster));

        // EMPLOYEE de La Casa del Chef (con restaurante y asignación explícita)
        createUser("carlos.emp", "carlos.lopez@lacasadelchef.com", encodedPassword,
                "Carlos", "López", "555-000-0004",
                demoGourmet, casaDelChef, employeeRole, singletonSet(casaDelChef));

        log.info("[DemoData] {} usuarios demo creados/actualizados (contraseña: admin123)", 7);
        log.info("[DemoData] Multi-tenant configurado: juan.admin ve solo 3 restaurantes, super.admin ve todos");
    }

    // ─── MÉTODOS PRIVADOS ───────────────────────────────────────────────

    private Role getOrCreateRole(RoleName roleName) {
        return roleRepository.findByName(roleName)
                .orElseGet(() -> {
                    Role role = new Role();
                    role.setName(roleName);
                    return roleRepository.save(role);
                });
    }

    private Tenant createTenantIfNotExists(String name, String slug) {
        return tenantRepository.findBySlugAndDeletedFalse(slug)
                .orElseGet(() -> {
                    Tenant tenant = new Tenant();
                    tenant.setName(name);
                    tenant.setSlug(slug);
                    return tenantRepository.save(tenant);
                });
    }

    private void assignRestaurantToTenant(List<Restaurant> restaurants, String restaurantName, Tenant tenant) {
        for (Restaurant restaurant : restaurants) {
            if (restaurantName.equals(restaurant.getName())) {
                if (restaurant.getTenant() == null || !restaurant.getTenant().getId().equals(tenant.getId())) {
                    restaurant.setTenant(tenant);
                    restaurantRepository.save(restaurant);
                    log.info("[DemoData] Restaurante '{}' asignado al tenant '{}'", restaurantName, tenant.getName());
                }
                return;
            }
        }
        log.warn("[DemoData] No se encontró restaurante '{}' para asignar al tenant", restaurantName);
    }

    private void deleteExistingDemoUser(String username) {
        Optional<User> existing = userRepository.findByUsernameAndDeletedFalse(username);
        existing.ifPresent(user -> {
            userRepository.delete(user);
            log.info("[DemoData] Usuario anterior '{}' eliminado para recrear", username);
        });
    }

    private Restaurant findByName(List<Restaurant> restaurants, String name) {
        return restaurants.stream()
                .filter(r -> name.equals(r.getName()))
                .findFirst()
                .orElse(null);
    }

    private void createUser(String username, String email, String password,
                            String firstName, String lastName, String phone,
                            Tenant tenant, Restaurant restaurant, Role role,
                            Set<Restaurant> assignedRestaurants) {
        User user = new User();
        user.setUsername(username);
        user.setEmail(email);
        user.setPassword(password);
        user.setFirstName(firstName);
        user.setLastName(lastName);
        user.setPhone(phone);
        user.setEnabled(true);
        user.setTenant(tenant);
        user.setRestaurant(restaurant);
        user.setRoles(Set.of(role));
        user.setAssignedRestaurants(assignedRestaurants != null ? assignedRestaurants : new HashSet<>());

        userRepository.save(user);
        log.info("[DemoData] Usuario creado: {} (rol={}, tenant={}, restaurants={})",
                username, role.getName(), tenant != null ? tenant.getName() : "SIN TENANT",
                assignedRestaurants != null ? assignedRestaurants.size() : 0);
    }

    /**
     * Crea un Set con un solo elemento, manejando nulls de forma segura.
     */
    private Set<Restaurant> singletonSet(Restaurant restaurant) {
        if (restaurant == null) {
            return Set.of();
        }
        return Set.of(restaurant);
    }
}
