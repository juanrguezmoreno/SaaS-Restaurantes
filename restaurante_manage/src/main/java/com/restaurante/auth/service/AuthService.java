package com.restaurante.auth.service;

import com.restaurante.auth.dto.JwtResponse;
import com.restaurante.auth.dto.LoginRequest;
import com.restaurante.auth.dto.RegisterRequest;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.DuplicateResourceException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.security.jwt.JwtTokenProvider;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.HashSet;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class AuthService {

    private final AuthenticationManager authenticationManager;
    private final UserRepository userRepository;
    private final RoleRepository roleRepository;
    private final RestaurantRepository restaurantRepository;
    private final TenantRepository tenantRepository;
    private final PasswordEncoder passwordEncoder;
    private final JwtTokenProvider jwtTokenProvider;

    public JwtResponse login(LoginRequest request) {
        Authentication authentication = authenticationManager.authenticate(
                new UsernamePasswordAuthenticationToken(
                        request.getUsernameOrEmail(),
                        request.getPassword()
                )
        );

        SecurityContextHolder.getContext().setAuthentication(authentication);

        String username = authentication.getName();
        User user = userRepository.findWithRolesAndRestaurantByUsername(username)
                .orElseThrow(() -> new BadRequestException("Usuario no encontrado"));

        String token = jwtTokenProvider.generateToken(user);

        Set<String> roles = authentication.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority)
                .collect(Collectors.toSet());

        return JwtResponse.builder()
                .token(token)
                .id(user.getId())
                .username(user.getUsername())
                .email(user.getEmail())
                .roles(roles)
                .restaurantId(user.getRestaurant() != null ? user.getRestaurant().getId() : null)
                .restaurantName(user.getRestaurant() != null ? user.getRestaurant().getName() : null)
                .tenantId(user.getTenant() != null ? user.getTenant().getId() : null)
                .tenantName(user.getTenant() != null ? user.getTenant().getName() : null)
                .build();
    }

    @Transactional
    public JwtResponse register(RegisterRequest request) {
        // Usar 'name' como username
        String username = request.getName();

        if (userRepository.existsByUsernameAndDeletedFalse(username)) {
            throw new DuplicateResourceException(
                    "El nombre de usuario '" + username + "' ya está en uso");
        }
        if (userRepository.existsByEmailAndDeletedFalse(request.getEmail())) {
            throw new DuplicateResourceException(
                    "El email '" + request.getEmail() + "' ya está en uso");
        }

        // Resolver rol
        RoleName roleName;
        try {
            roleName = RoleName.valueOf("ROLE_" + request.getRole().toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Rol inválido: " + request.getRole() +
                    ". Roles válidos: ADMIN, MANAGER, EMPLOYEE, CLIENT");
        }

        // Si no es ADMIN, restaurantId es obligatorio
        if (roleName != RoleName.ROLE_ADMIN && request.getRestaurantId() == null) {
            throw new BadRequestException("restaurantId es obligatorio para el rol " + request.getRole());
        }

        // Buscar restaurante si se proporcionó
        Restaurant restaurant = null;
        if (request.getRestaurantId() != null) {
            restaurant = restaurantRepository.findByIdAndDeletedFalse(request.getRestaurantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", request.getRestaurantId()));
        }

        // Buscar tenant si se proporcionó
        Tenant tenant = null;
        if (request.getTenantId() != null) {
            tenant = tenantRepository.findByIdAndDeletedFalse(request.getTenantId())
                    .orElseThrow(() -> new ResourceNotFoundException("Tenant", "id", request.getTenantId()));
        } else if (restaurant != null && restaurant.getTenant() != null) {
            // Si no se especificó tenant pero sí restaurante, usar el tenant del restaurante
            tenant = restaurant.getTenant();
        }

        User user = new User();
        user.setUsername(username);
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        user.setFirstName(request.getFirstName());
        user.setLastName(request.getLastName());
        user.setPhone(request.getPhone());
        user.setEnabled(true);
        user.setRestaurant(restaurant);
        user.setTenant(tenant);

        // Asignar rol
        Set<Role> roles = new HashSet<>();
        Role role = roleRepository.findByName(roleName)
                .orElseThrow(() -> new RuntimeException("Rol " + roleName + " no encontrado"));
        roles.add(role);
        user.setRoles(roles);

        User savedUser = userRepository.save(user);

        String token = jwtTokenProvider.generateToken(savedUser);

        Set<String> roleNames = savedUser.getRoles().stream()
                .map(roleEntity -> roleEntity.getName().name())
                .collect(Collectors.toSet());

        return JwtResponse.builder()
                .token(token)
                .id(savedUser.getId())
                .username(savedUser.getUsername())
                .email(savedUser.getEmail())
                .roles(roleNames)
                .restaurantId(savedUser.getRestaurant() != null ? savedUser.getRestaurant().getId() : null)
                .restaurantName(savedUser.getRestaurant() != null ? savedUser.getRestaurant().getName() : null)
                .tenantId(savedUser.getTenant() != null ? savedUser.getTenant().getId() : null)
                .tenantName(savedUser.getTenant() != null ? savedUser.getTenant().getName() : null)
                .build();
    }
}
