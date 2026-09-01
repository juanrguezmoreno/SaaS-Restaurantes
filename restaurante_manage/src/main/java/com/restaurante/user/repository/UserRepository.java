package com.restaurante.user.repository;

import com.restaurante.role.enums.RoleName;
import com.restaurante.user.dto.AdminUserListItem;
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
import java.util.Set;

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

    long countByTenantIdAndDeletedFalse(Long tenantId);

    @Query("SELECT u FROM User u WHERE u.username = :username AND u.deleted = false")
    @EntityGraph(attributePaths = {"roles", "restaurant", "tenant"})
    Optional<User> findWithRolesAndRestaurantByUsername(@Param("username") String username);

    @Query("SELECT u FROM User u WHERE u.email = :email AND u.deleted = false")
    @EntityGraph(attributePaths = {"roles", "restaurant", "tenant"})
    Optional<User> findWithRolesAndRestaurantByEmail(@Param("email") String email);

    // ─── Listado de empleados ───────────────────────────────────────────────
    // Antes, para ADMIN y MANAGER, el servicio traía todos los usuarios, los
    // filtraba en memoria y paginaba con subList. Estas consultas hacen ese
    // trabajo en la base de datos, y las dos de lotes evitan el N+1 de las
    // colecciones sin renunciar a mostrar roles y restaurantes.

    /**
     * Búsqueda paginada de usuarios, siempre acotada al alcance que resuelve
     * {@code CurrentUserService}.
     *
     * <p>El alcance llega resuelto desde el servidor, nunca como parámetro del
     * cliente. Las banderas evitan pasar parámetros nulos a la consulta, que es
     * frágil con enumerados y colecciones.</p>
     *
     * @param unrestricted        {@code true} solo para SUPER_ADMIN.
     * @param tenantId            cuenta a la que se acota, o {@code null}.
     * @param filterByRestaurants {@code true} para exigir que el usuario tenga
     *                            como principal o asignado uno de
     *                            {@code restaurantIds}.
     * @param restaurantIds       restaurantes visibles. Nunca nulo ni vacío.
     * @param filterByRole        {@code true} para filtrar por {@code role}.
     * @param role                rol exigido cuando {@code filterByRole}.
     * @param filterByEnabled     {@code true} para filtrar por {@code enabled}.
     * @param enabled             estado exigido cuando {@code filterByEnabled}.
     * @param search              texto ya normalizado a minúsculas y con
     *                            comodines ({@code %texto%}), o nulo.
     */
    @Query(value = """
            SELECT new com.restaurante.user.dto.AdminUserListItem(
                       u.id, u.username, u.email, u.firstName, u.lastName, u.phone,
                       u.enabled, t.name, pr.id, pr.name, u.createdAt)
            FROM User u
            LEFT JOIN u.tenant t
            LEFT JOIN u.restaurant pr
            WHERE u.deleted = false
              AND (:unrestricted = TRUE OR t.id = :tenantId)
              AND (:filterByRestaurants = FALSE
                   OR pr.id IN :restaurantIds
                   OR EXISTS (SELECT 1 FROM User ur JOIN ur.assignedRestaurants ar
                              WHERE ur.id = u.id AND ar.id IN :restaurantIds))
              AND (:filterByRole = FALSE
                   OR EXISTS (SELECT 1 FROM User rl JOIN rl.roles rr
                              WHERE rl.id = u.id AND rr.name = :role))
              AND (:filterByEnabled = FALSE OR u.enabled = :enabled)
              AND (:search IS NULL
                   OR LOWER(u.username) LIKE :search ESCAPE '!'
                   OR LOWER(u.email) LIKE :search ESCAPE '!'
                   OR LOWER(u.phone) LIKE :search ESCAPE '!'
                   OR LOWER(CONCAT(COALESCE(u.firstName, ''), ' ', COALESCE(u.lastName, ''))) LIKE :search ESCAPE '!')
            """,
            countQuery = """
            SELECT COUNT(u)
            FROM User u
            LEFT JOIN u.tenant t
            LEFT JOIN u.restaurant pr
            WHERE u.deleted = false
              AND (:unrestricted = TRUE OR t.id = :tenantId)
              AND (:filterByRestaurants = FALSE
                   OR pr.id IN :restaurantIds
                   OR EXISTS (SELECT 1 FROM User ur JOIN ur.assignedRestaurants ar
                              WHERE ur.id = u.id AND ar.id IN :restaurantIds))
              AND (:filterByRole = FALSE
                   OR EXISTS (SELECT 1 FROM User rl JOIN rl.roles rr
                              WHERE rl.id = u.id AND rr.name = :role))
              AND (:filterByEnabled = FALSE OR u.enabled = :enabled)
              AND (:search IS NULL
                   OR LOWER(u.username) LIKE :search ESCAPE '!'
                   OR LOWER(u.email) LIKE :search ESCAPE '!'
                   OR LOWER(u.phone) LIKE :search ESCAPE '!'
                   OR LOWER(CONCAT(COALESCE(u.firstName, ''), ' ', COALESCE(u.lastName, ''))) LIKE :search ESCAPE '!')
            """)
    Page<AdminUserListItem> searchForAdmin(@Param("unrestricted") boolean unrestricted,
                                          @Param("tenantId") Long tenantId,
                                          @Param("filterByRestaurants") boolean filterByRestaurants,
                                          @Param("restaurantIds") Set<Long> restaurantIds,
                                          @Param("filterByRole") boolean filterByRole,
                                          @Param("role") RoleName role,
                                          @Param("filterByEnabled") boolean filterByEnabled,
                                          @Param("enabled") boolean enabled,
                                          @Param("search") String search,
                                          Pageable pageable);

    /**
     * Métricas del listado en el mismo alcance. Devuelve una fila con
     * {@code [total, activos]}; los inactivos son la diferencia.
     */
    @Query("""
            SELECT COUNT(u),
                   COALESCE(SUM(CASE WHEN u.enabled = TRUE THEN 1 ELSE 0 END), 0)
            FROM User u
            LEFT JOIN u.tenant t
            LEFT JOIN u.restaurant pr
            WHERE u.deleted = false
              AND (:unrestricted = TRUE OR t.id = :tenantId)
              AND (:filterByRestaurants = FALSE
                   OR pr.id IN :restaurantIds
                   OR EXISTS (SELECT 1 FROM User ur JOIN ur.assignedRestaurants ar
                              WHERE ur.id = u.id AND ar.id IN :restaurantIds))
            """)
    List<Object[]> statsForAdmin(@Param("unrestricted") boolean unrestricted,
                                @Param("tenantId") Long tenantId,
                                @Param("filterByRestaurants") boolean filterByRestaurants,
                                @Param("restaurantIds") Set<Long> restaurantIds);

    /** Roles de los usuarios de una página, en una sola consulta. */
    @Query("SELECT u.id, r.name FROM User u JOIN u.roles r WHERE u.id IN :userIds")
    List<Object[]> findRoleNamesByUserIds(@Param("userIds") Set<Long> userIds);

    /**
     * Restaurantes asignados de los usuarios de una página, en una sola consulta.
     * Devuelve {@code [userId, restaurantId, restaurantName]}: el nombre lo pinta
     * la tabla y el identificador lo necesita el formulario de edición para
     * marcar las casillas.
     */
    @Query("SELECT u.id, ar.id, ar.name FROM User u JOIN u.assignedRestaurants ar WHERE u.id IN :userIds")
    List<Object[]> findAssignedRestaurantsByUserIds(@Param("userIds") Set<Long> userIds);
}
