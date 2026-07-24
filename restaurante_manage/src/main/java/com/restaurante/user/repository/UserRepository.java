package com.restaurante.user.repository;

import com.restaurante.role.enums.RoleName;
import com.restaurante.user.entity.User;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.EntityGraph;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;

@Repository
public interface UserRepository extends JpaRepository<User, Long> {

    Optional<User> findByIdAndDeletedFalse(Long id);

    Page<User> findAllByDeletedFalse(Pageable pageable);

    List<User> findAllByDeletedFalse();

    Optional<User> findByUsernameAndDeletedFalse(String username);

    Optional<User> findByEmailAndDeletedFalse(String email);

    boolean existsByUsernameAndDeletedFalse(String username);

    boolean existsByEmailAndDeletedFalse(String email);

    boolean existsByRoles_NameAndDeletedFalse(RoleName roleName);

    @Query("SELECT u FROM User u WHERE u.username = :username AND u.deleted = false")
    @EntityGraph(attributePaths = {"roles", "restaurant", "tenant"})
    Optional<User> findWithRolesAndRestaurantByUsername(@Param("username") String username);

    @Query("SELECT u FROM User u WHERE u.email = :email AND u.deleted = false")
    @EntityGraph(attributePaths = {"roles", "restaurant", "tenant"})
    Optional<User> findWithRolesAndRestaurantByEmail(@Param("email") String email);
}
