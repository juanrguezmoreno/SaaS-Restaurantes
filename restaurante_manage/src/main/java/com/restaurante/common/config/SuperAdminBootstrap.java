package com.restaurante.common.config;

import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.util.StringUtils;

import java.util.Set;

/**
 * Crea el primer SUPER_ADMIN en un entorno recién desplegado (bootstrap en frío).
 *
 * <p>Resuelve el problema de arranque: {@code POST /auth/register} exige un
 * ADMIN/SUPER_ADMIN autenticado, pero una base de datos nueva no contiene ninguno.
 * Las credenciales se toman de variables de entorno (nunca del repositorio):
 * {@code BOOTSTRAP_ADMIN_USERNAME}, {@code BOOTSTRAP_ADMIN_EMAIL} y
 * {@code BOOTSTRAP_ADMIN_PASSWORD}.</p>
 *
 * <p>Es idempotente y seguro dejarlo activo de forma permanente:</p>
 * <ul>
 *   <li>Sin las tres variables definidas no hace nada.</li>
 *   <li>Si ya existe un SUPER_ADMIN activo no crea otro (las variables pueden
 *       retirarse del entorno tras el primer arranque).</li>
 *   <li>Nunca sobrescribe un username/email existente.</li>
 *   <li>Exige una contraseña de al menos 12 caracteres y la guarda cifrada (BCrypt).</li>
 * </ul>
 */
@Component
@RequiredArgsConstructor
@Slf4j
public class SuperAdminBootstrap implements CommandLineRunner {

    private static final int MIN_PASSWORD_LENGTH = 12;

    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final PasswordEncoder passwordEncoder;

    @Value("${app.bootstrap.admin-username:}")
    private String adminUsername;

    @Value("${app.bootstrap.admin-email:}")
    private String adminEmail;

    @Value("${app.bootstrap.admin-password:}")
    private String adminPassword;

    // BOOTSTRAP_ADMIN_RESET_PASSWORD=true restablece la contraseña de la cuenta
    // de bootstrap existente (recuperación si el valor original se guardó mal).
    @Value("${app.bootstrap.admin-reset-password:false}")
    private boolean resetPassword;

    @Override
    @Transactional
    public void run(String... args) {
        if (!StringUtils.hasText(adminUsername)
                || !StringUtils.hasText(adminEmail)
                || !StringUtils.hasText(adminPassword)) {
            log.debug("[Bootstrap] Variables BOOTSTRAP_ADMIN_* no definidas — no se crea SUPER_ADMIN inicial.");
            return;
        }

        if (adminPassword.length() < MIN_PASSWORD_LENGTH) {
            log.warn("[Bootstrap] BOOTSTRAP_ADMIN_PASSWORD tiene menos de {} caracteres — no se crea el SUPER_ADMIN.",
                    MIN_PASSWORD_LENGTH);
            return;
        }

        if (userRepository.existsByRoles_NameAndDeletedFalse(RoleName.ROLE_SUPER_ADMIN)) {
            if (resetPassword) {
                resetBootstrapAccountPassword();
            } else {
                log.info("[Bootstrap] Ya existe un SUPER_ADMIN activo — no se crea otro. "
                        + "Puedes retirar las variables BOOTSTRAP_ADMIN_* del entorno.");
            }
            return;
        }

        if (userRepository.existsByUsernameAndDeletedFalse(adminUsername)
                || userRepository.existsByEmailAndDeletedFalse(adminEmail)) {
            log.warn("[Bootstrap] El username '{}' o el email indicado ya existen con otro rol — no se crea el "
                    + "SUPER_ADMIN. Revisa BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_EMAIL.", adminUsername);
            return;
        }

        Role superAdminRole = roleRepository.findByName(RoleName.ROLE_SUPER_ADMIN)
                .orElseGet(() -> {
                    Role role = new Role();
                    role.setName(RoleName.ROLE_SUPER_ADMIN);
                    return roleRepository.save(role);
                });

        User user = new User();
        user.setUsername(adminUsername);
        user.setEmail(adminEmail);
        user.setPassword(passwordEncoder.encode(adminPassword));
        user.setFirstName("Super");
        user.setLastName("Admin");
        user.setEnabled(true);
        // SUPER_ADMIN: sin tenant ni restaurante — ve toda la plataforma (ver CurrentUserService)
        user.setTenant(null);
        user.setRestaurant(null);
        user.setRoles(Set.of(superAdminRole));

        userRepository.save(user);

        log.warn("[Bootstrap] SUPER_ADMIN inicial '{}' creado. Cambia la contraseña tras el primer login "
                + "y retira las variables BOOTSTRAP_ADMIN_* del entorno.", adminUsername);
    }

    /**
     * Restablece la contraseña de la cuenta de bootstrap (misma username y rol
     * SUPER_ADMIN) con el valor actual de BOOTSTRAP_ADMIN_PASSWORD. Solo actúa
     * sobre esa cuenta concreta y solo con el flag explícito activado.
     */
    private void resetBootstrapAccountPassword() {
        userRepository.findByUsernameAndDeletedFalse(adminUsername).ifPresentOrElse(user -> {
            boolean esSuperAdmin = user.getRoles().stream()
                    .anyMatch(role -> role.getName() == RoleName.ROLE_SUPER_ADMIN);
            if (!esSuperAdmin) {
                log.warn("[Bootstrap] La cuenta '{}' existe pero NO es SUPER_ADMIN — no se restablece su contraseña.",
                        adminUsername);
                return;
            }
            user.setPassword(passwordEncoder.encode(adminPassword));
            userRepository.save(user);
            log.warn("[Bootstrap] Contraseña del SUPER_ADMIN '{}' restablecida desde BOOTSTRAP_ADMIN_PASSWORD. "
                    + "Retira BOOTSTRAP_ADMIN_RESET_PASSWORD del entorno para que no se repita en cada arranque.",
                    adminUsername);
        }, () -> log.warn("[Bootstrap] RESET_PASSWORD activo pero no existe la cuenta '{}' — nada que restablecer.",
                adminUsername));
    }
}
