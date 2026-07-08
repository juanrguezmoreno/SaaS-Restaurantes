package com.restaurante.user.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.dto.UserMapper;
import com.restaurante.user.dto.UserResponse;
import com.restaurante.user.dto.UserUpdateRequest;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.security.crypto.password.PasswordEncoder;

import java.util.Optional;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.*;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class UserServiceTest {

    @Mock private UserRepository userRepository;
    @Mock private RoleRepository roleRepository;
    @Mock private TenantRepository tenantRepository;
    @Mock private RestaurantRepository restaurantRepository;
    @Mock private PasswordEncoder passwordEncoder;
    @Mock private UserMapper userMapper;
    @Mock private CurrentUserService currentUserService;

    @InjectMocks private UserService service;

    private Tenant tenant(Long id) {
        Tenant t = new Tenant();
        t.setId(id);
        return t;
    }

    private Role role(RoleName name) {
        Role r = new Role();
        r.setName(name);
        return r;
    }

    private User user(Long id, Tenant tenant, RoleName roleName) {
        User u = new User();
        u.setId(id);
        u.setUsername("user" + id);
        u.setEmail("user" + id + "@x.com");
        u.setPassword("HASH_ORIGINAL");
        u.setTenant(tenant);
        u.setRoles(Set.of(role(roleName)));
        return u;
    }

    private UserUpdateRequest updateReq(String username, String email, String password) {
        UserUpdateRequest r = new UserUpdateRequest();
        r.setUsername(username);
        r.setEmail(email);
        r.setPassword(password);
        return r;
    }

    // ─── SEC-01: update ────────────────────────────────────────────────────

    @Test
    void update_denegadoSiElUsuarioEsDeOtroTenant() {
        User target = user(50L, tenant(2L), RoleName.ROLE_MANAGER);
        when(userRepository.findByIdAndDeletedFalse(50L)).thenReturn(Optional.of(target));
        when(currentUserService.isSuperAdmin()).thenReturn(false);
        when(currentUserService.getCurrentTenantId()).thenReturn(1L); // admin del tenant 1

        assertThrows(AccessDeniedException.class,
                () -> service.update(50L, updateReq("user50", "user50@x.com", null)));
        verify(userRepository, never()).save(any());
    }

    @Test
    void update_denegadoSiElObjetivoEsSuperAdmin() {
        User superAdmin = user(1L, null, RoleName.ROLE_SUPER_ADMIN);
        when(userRepository.findByIdAndDeletedFalse(1L)).thenReturn(Optional.of(superAdmin));
        when(currentUserService.isSuperAdmin()).thenReturn(false);
        when(currentUserService.getCurrentTenantId()).thenReturn(1L);

        assertThrows(AccessDeniedException.class,
                () -> service.update(1L, updateReq("super.admin", "super.admin@x.com", null)));
        verify(userRepository, never()).save(any());
    }

    // ─── USR-04: password opcional en update ───────────────────────────────

    @Test
    void update_sinPassword_conservaLaContrasenaActual() {
        User target = user(50L, tenant(1L), RoleName.ROLE_MANAGER);
        when(userRepository.findByIdAndDeletedFalse(50L)).thenReturn(Optional.of(target));
        when(currentUserService.isSuperAdmin()).thenReturn(false);
        when(currentUserService.getCurrentTenantId()).thenReturn(1L);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        when(userMapper.toResponse(any())).thenReturn(new UserResponse());

        service.update(50L, updateReq("user50", "user50@x.com", null));

        assertEquals("HASH_ORIGINAL", target.getPassword(), "La contraseña no debe cambiar");
        verify(passwordEncoder, never()).encode(anyString());
    }

    @Test
    void update_conPassword_lacifraDeNuevo() {
        User target = user(50L, tenant(1L), RoleName.ROLE_MANAGER);
        when(userRepository.findByIdAndDeletedFalse(50L)).thenReturn(Optional.of(target));
        when(currentUserService.isSuperAdmin()).thenReturn(false);
        when(currentUserService.getCurrentTenantId()).thenReturn(1L);
        when(passwordEncoder.encode("nuevaClave")).thenReturn("HASH_NUEVO");
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        when(userMapper.toResponse(any())).thenReturn(new UserResponse());

        service.update(50L, updateReq("user50", "user50@x.com", "nuevaClave"));

        assertEquals("HASH_NUEVO", target.getPassword());
        verify(passwordEncoder).encode("nuevaClave");
    }

    @Test
    void update_superAdminPuedeEditarUsuarioDeCualquierTenant() {
        User target = user(50L, tenant(2L), RoleName.ROLE_MANAGER);
        when(userRepository.findByIdAndDeletedFalse(50L)).thenReturn(Optional.of(target));
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));
        when(userMapper.toResponse(any())).thenReturn(new UserResponse());

        assertDoesNotThrow(() -> service.update(50L, updateReq("user50", "user50@x.com", null)));
        verify(userRepository).save(any(User.class));
    }

    // ─── SEC-01: delete ────────────────────────────────────────────────────

    @Test
    void delete_denegadoSiElUsuarioEsDeOtroTenant() {
        User target = user(50L, tenant(2L), RoleName.ROLE_MANAGER);
        when(userRepository.findByIdAndDeletedFalse(50L)).thenReturn(Optional.of(target));
        when(currentUserService.isSuperAdmin()).thenReturn(false);
        when(currentUserService.getCurrentTenantId()).thenReturn(1L);

        assertThrows(AccessDeniedException.class, () -> service.delete(50L));
        verify(userRepository, never()).save(any());
    }

    @Test
    void delete_permitidoEnElMismoTenant() {
        User target = user(50L, tenant(1L), RoleName.ROLE_EMPLOYEE);
        when(userRepository.findByIdAndDeletedFalse(50L)).thenReturn(Optional.of(target));
        when(currentUserService.isSuperAdmin()).thenReturn(false);
        when(currentUserService.getCurrentTenantId()).thenReturn(1L);
        when(userRepository.save(any(User.class))).thenAnswer(inv -> inv.getArgument(0));

        service.delete(50L);

        assertTrue(target.getDeleted());
        assertFalse(target.isEnabled());
        verify(userRepository).save(target);
    }
}
