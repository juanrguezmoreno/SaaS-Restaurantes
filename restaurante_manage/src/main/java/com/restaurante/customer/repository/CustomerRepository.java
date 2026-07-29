package com.restaurante.customer.repository;

import com.restaurante.customer.entity.Customer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

@Repository
public interface CustomerRepository extends JpaRepository<Customer, Long> {

    Optional<Customer> findByIdAndDeletedFalse(Long id);

    Page<Customer> findAllByDeletedFalse(Pageable pageable);

    Page<Customer> findByRestaurantIdAndDeletedFalse(Long restaurantId, Pageable pageable);

    List<Customer> findAllByRestaurantIdAndDeletedFalse(Long restaurantId);

    Page<Customer> findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds, Pageable pageable);

    List<Customer> findByRestaurantIdInAndDeletedFalse(Set<Long> restaurantIds);

    Optional<Customer> findByEmailAndDeletedFalse(String email);

    Optional<Customer> findFirstByEmailAndRestaurantIdAndDeletedFalse(String email, Long restaurantId);

    Optional<Customer> findByUserIdAndDeletedFalse(Long userId);

    boolean existsByEmailAndDeletedFalse(String email);

    /**
     * Búsqueda paginada de clientes con filtros opcionales, siempre acotada al
     * alcance multi-tenant que resuelve {@code CurrentUserService}.
     *
     * <p>El alcance no es negociable desde fuera: aunque se pida un
     * {@code restaurantId} concreto, la condición de alcance se sigue aplicando,
     * de modo que pedir un restaurante ajeno devuelve vacío en vez de filtrarse.</p>
     *
     * @param unrestricted  {@code true} solo para SUPER_ADMIN, que ve todos los tenants.
     *                      Con {@code false} manda {@code restaurantIds}.
     * @param restaurantIds restaurantes visibles. Nunca nulo ni vacío; cuando
     *                      {@code unrestricted} es true se ignora su contenido.
     * @param restaurantId  filtro opcional por un restaurante concreto.
     * @param search        texto ya normalizado a minúsculas y con comodines
     *                      ({@code %texto%}), o nulo para no filtrar.
     */
    @Query("""
            SELECT c FROM Customer c
            WHERE c.deleted = false
              AND (:unrestricted = TRUE OR c.restaurant.id IN :restaurantIds)
              AND (:restaurantId IS NULL OR c.restaurant.id = :restaurantId)
              AND (:search IS NULL
                   OR LOWER(CONCAT(c.firstName, ' ', c.lastName)) LIKE :search ESCAPE '!'
                   OR LOWER(c.email) LIKE :search ESCAPE '!'
                   OR LOWER(c.phone) LIKE :search ESCAPE '!')
            """)
    Page<Customer> search(@Param("unrestricted") boolean unrestricted,
                          @Param("restaurantIds") Set<Long> restaurantIds,
                          @Param("restaurantId") Long restaurantId,
                          @Param("search") String search,
                          Pageable pageable);
}
