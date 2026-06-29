package com.restaurante.security.userdetails;

import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CustomUserDetailsService implements UserDetailsService {

    private final UserRepository userRepository;

    @Override
    @Transactional(readOnly = true)
    public UserDetails loadUserByUsername(String usernameOrEmail) throws UsernameNotFoundException {
        User user = userRepository.findWithRolesAndRestaurantByUsername(usernameOrEmail)
                .orElseGet(() -> userRepository.findWithRolesAndRestaurantByEmail(usernameOrEmail)
                        .orElseThrow(() -> new UsernameNotFoundException(
                                "Usuario no encontrado con username o email: " + usernameOrEmail)));

        return new UserPrincipal(user);
    }
}
