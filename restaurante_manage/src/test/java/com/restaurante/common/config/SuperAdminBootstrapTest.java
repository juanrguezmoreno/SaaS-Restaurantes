package com.restaurante.common.config;

import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Tests unitarios del bootstrap del primer SUPER_ADMIN.
 *
 * Cubre la idempotencia y las guardas de seguridad: sin variables no hace nada,
 * nunca duplica un SUPER_ADMIN existente, nunca pisa un username/email ocupado,
 * exige contraseña mínima y cifra la contraseña con el PasswordEncoder real.
 */
@ExtendWith(MockitoExtension.class)
class SuperAdminBootstrapTest {

    @Mock private UserRepository userRepository;
    @Mock private RoleRepository roleRepository;
    @Mock private org.springframework.security.crypto.password.PasswordEncoder passwordEncoder;

    @InjectMocks
    private SuperAdminBootstrap bootstrap;

    private Role superAdminRole;

    @BeforeEach
    void setUp() {
        superAdminRole = new Role();
        superAdminRole.setName(RoleName.ROLE_SUPER_ADMIN);
    }

    private void setProps(String username, String email, String password) {
        setProps(username, email, password, false);
    }

    private void setProps(String username, String email, String password, boolean resetPassword) {
        ReflectionTestUtils.setField(bootstrap, "adminUsername", username);
        ReflectionTestUtils.setField(bootstrap, "adminEmail", email);
        ReflectionTestUtils.setField(bootstrap, "adminPassword", password);
        ReflectionTestUtils.setField(bootstrap, "resetPassword", resetPassword);
    }

    @Test
    @DisplayName("Sin variables BOOTSTRAP_ADMIN_* definidas no crea nada")
    void sinVariables_noHaceNada() {
        setProps("", "", "");

        bootstrap.run();

        verify(userRepository, never()).save(any());
    }

    @Test
    @DisplayName("Si ya existe un SUPER_ADMIN activo no crea otro")
    void yaExisteSuperAdmin_noCreaOtro() {
        setProps("superadmin", "owner@example.com", "ClaveSegura123!");
        when(userRepository.existsByRoles_NameAndDeletedFalse(RoleName.ROLE_SUPER_ADMIN)).thenReturn(true);

        bootstrap.run();

        verify(userRepository, never()).save(any());
    }

    @Test
    @DisplayName("Si el username o el email ya están ocupados no crea ni sobrescribe")
    void usernameOcupado_noCrea() {
        setProps("superadmin", "owner@example.com", "ClaveSegura123!");
        when(userRepository.existsByRoles_NameAndDeletedFalse(RoleName.ROLE_SUPER_ADMIN)).thenReturn(false);
        when(userRepository.existsByUsernameAndDeletedFalse("superadmin")).thenReturn(true);

        bootstrap.run();

        verify(userRepository, never()).save(any());
    }

    @Test
    @DisplayName("Con contraseña demasiado corta no crea el usuario")
    void passwordCorta_noCrea() {
        setProps("superadmin", "owner@example.com", "corta");

        bootstrap.run();

        verify(userRepository, never()).save(any());
    }

    @Test
    @DisplayName("Con RESET_PASSWORD=true restablece la contraseña del SUPER_ADMIN de bootstrap existente")
    void conFlagReset_restableceLaPassword() {
        setProps("superadmin", "owner@example.com", "NuevaClaveSegura123!", true);
        when(userRepository.existsByRoles_NameAndDeletedFalse(RoleName.ROLE_SUPER_ADMIN)).thenReturn(true);

        User existente = new User();
        existente.setUsername("superadmin");
        existente.setPassword("$2a$10$hashViejo");
        existente.setRoles(java.util.Set.of(superAdminRole));
        when(userRepository.findByUsernameAndDeletedFalse("superadmin")).thenReturn(Optional.of(existente));
        when(passwordEncoder.encode("NuevaClaveSegura123!")).thenReturn("$2a$10$hashNuevo");

        bootstrap.run();

        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(captor.capture());
        assertEquals("$2a$10$hashNuevo", captor.getValue().getPassword());
    }

    @Test
    @DisplayName("Con RESET_PASSWORD=true pero la cuenta no es SUPER_ADMIN, no toca nada")
    void conFlagReset_cuentaNoSuperAdmin_noHaceNada() {
        setProps("superadmin", "owner@example.com", "NuevaClaveSegura123!", true);
        when(userRepository.existsByRoles_NameAndDeletedFalse(RoleName.ROLE_SUPER_ADMIN)).thenReturn(true);

        Role adminRole = new Role();
        adminRole.setName(RoleName.ROLE_ADMIN);
        User existente = new User();
        existente.setUsername("superadmin");
        existente.setRoles(java.util.Set.of(adminRole));
        when(userRepository.findByUsernameAndDeletedFalse("superadmin")).thenReturn(Optional.of(existente));

        bootstrap.run();

        verify(userRepository, never()).save(any());
    }

    @Test
    @DisplayName("Crea el SUPER_ADMIN con la contraseña cifrada y el rol correcto")
    void creaSuperAdmin_conPasswordCifrada() {
        setProps("superadmin", "owner@example.com", "ClaveSegura123!");
        when(userRepository.existsByRoles_NameAndDeletedFalse(RoleName.ROLE_SUPER_ADMIN)).thenReturn(false);
        when(userRepository.existsByUsernameAndDeletedFalse("superadmin")).thenReturn(false);
        when(userRepository.existsByEmailAndDeletedFalse("owner@example.com")).thenReturn(false);
        when(roleRepository.findByName(RoleName.ROLE_SUPER_ADMIN)).thenReturn(Optional.of(superAdminRole));
        when(passwordEncoder.encode("ClaveSegura123!")).thenReturn("$2a$10$hashSimulado");

        bootstrap.run();

        ArgumentCaptor<User> captor = ArgumentCaptor.forClass(User.class);
        verify(userRepository).save(captor.capture());
        User creado = captor.getValue();

        assertEquals("superadmin", creado.getUsername());
        assertEquals("owner@example.com", creado.getEmail());
        assertEquals("$2a$10$hashSimulado", creado.getPassword());
        assertTrue(creado.isEnabled());
        assertTrue(creado.getRoles().contains(superAdminRole));
        assertEquals(null, creado.getTenant());
    }
}
