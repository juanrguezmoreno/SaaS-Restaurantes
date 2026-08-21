package com.restaurante.customer.repository;

import com.restaurante.customer.dto.CustomerListItem;
import com.restaurante.customer.entity.Customer;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import java.time.LocalDate;
import java.time.LocalDateTime;
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

    // ─── Listado con segmentos ──────────────────────────────────────────────
    // El listado anterior pasaba por CustomerMapper, que lee user.username y
    // restaurant.name sobre asociaciones LAZY (dos consultas por fila), y los
    // segmentos se calculaban en el navegador sobre la lista completa. Estas dos
    // consultas hacen ambas cosas en la base de datos.

    /**
     * Búsqueda paginada de clientes con filtros de texto, restaurante y
     * segmento, siempre acotada al alcance multi-tenant.
     *
     * <p>Los tres segmentos llegan como parámetros independientes y se aplica el
     * que venga informado; el servicio garantiza que solo sea uno. Los umbrales
     * de fecha se calculan en el servicio y viajan como parámetros para que H2 y
     * MySQL se comporten igual.</p>
     *
     * @param unrestricted      {@code true} solo para SUPER_ADMIN.
     * @param restaurantIds     restaurantes visibles. Nunca nulo ni vacío; se
     *                          ignora cuando {@code unrestricted}.
     * @param restaurantId      filtro opcional por un restaurante concreto.
     * @param search            texto ya normalizado con comodines, o nulo.
     * @param filterRecurrentes exigir más de una reserva no cancelada.
     * @param newSince          exigir alta desde esta fecha, o nulo.
     * @param inactiveBefore    exigir última reserva anterior a esta fecha, o
     *                          nulo. Quien nunca reservó queda fuera porque el
     *                          {@code MAX} nulo no cumple la comparación.
     */
    @Query(value = """
            SELECT new com.restaurante.customer.dto.CustomerListItem(
                       c.id, u.id, u.username, r.id, r.name,
                       c.firstName, c.lastName, c.email, c.phone, c.notes, c.createdAt)
            FROM Customer c
            LEFT JOIN c.user u
            LEFT JOIN c.restaurant r
            WHERE c.deleted = false
              AND (:unrestricted = TRUE OR r.id IN :restaurantIds)
              AND (:restaurantId IS NULL OR r.id = :restaurantId)
              AND (:search IS NULL
                   OR LOWER(CONCAT(c.firstName, ' ', c.lastName)) LIKE :search ESCAPE '!'
                   OR LOWER(c.email) LIKE :search ESCAPE '!'
                   OR LOWER(c.phone) LIKE :search ESCAPE '!')
              AND (:filterRecurrentes = FALSE
                   OR (SELECT COUNT(res) FROM Reservation res
                       WHERE res.customer.id = c.id
                         AND res.deleted = false
                         AND res.status <> com.restaurante.reservation.enums.ReservationStatus.CANCELLED) > 1)
              AND (:newSince IS NULL OR c.createdAt >= :newSince)
              AND (:inactiveBefore IS NULL
                   OR (SELECT MAX(res2.reservationDate) FROM Reservation res2
                       WHERE res2.customer.id = c.id
                         AND res2.deleted = false
                         AND res2.status <> com.restaurante.reservation.enums.ReservationStatus.CANCELLED) < :inactiveBefore)
            """,
            countQuery = """
            SELECT COUNT(c)
            FROM Customer c
            LEFT JOIN c.user u
            LEFT JOIN c.restaurant r
            WHERE c.deleted = false
              AND (:unrestricted = TRUE OR r.id IN :restaurantIds)
              AND (:restaurantId IS NULL OR r.id = :restaurantId)
              AND (:search IS NULL
                   OR LOWER(CONCAT(c.firstName, ' ', c.lastName)) LIKE :search ESCAPE '!'
                   OR LOWER(c.email) LIKE :search ESCAPE '!'
                   OR LOWER(c.phone) LIKE :search ESCAPE '!')
              AND (:filterRecurrentes = FALSE
                   OR (SELECT COUNT(res) FROM Reservation res
                       WHERE res.customer.id = c.id
                         AND res.deleted = false
                         AND res.status <> com.restaurante.reservation.enums.ReservationStatus.CANCELLED) > 1)
              AND (:newSince IS NULL OR c.createdAt >= :newSince)
              AND (:inactiveBefore IS NULL
                   OR (SELECT MAX(res2.reservationDate) FROM Reservation res2
                       WHERE res2.customer.id = c.id
                         AND res2.deleted = false
                         AND res2.status <> com.restaurante.reservation.enums.ReservationStatus.CANCELLED) < :inactiveBefore)
            """)
    Page<CustomerListItem> searchForList(@Param("unrestricted") boolean unrestricted,
                                        @Param("restaurantIds") Set<Long> restaurantIds,
                                        @Param("restaurantId") Long restaurantId,
                                        @Param("search") String search,
                                        @Param("filterRecurrentes") boolean filterRecurrentes,
                                        @Param("newSince") LocalDateTime newSince,
                                        @Param("inactiveBefore") LocalDate inactiveBefore,
                                        Pageable pageable);

    /**
     * Cifras de las tarjetas en el mismo alcance, con una sola consulta.
     * Devuelve una fila con
     * {@code [total, recurrentes, nuevosEsteMes, sinVenir]}.
     */
    @Query("""
            SELECT COUNT(c),
                   COALESCE(SUM(CASE WHEN (SELECT COUNT(res) FROM Reservation res
                                          WHERE res.customer.id = c.id
                                            AND res.deleted = false
                                            AND res.status <> com.restaurante.reservation.enums.ReservationStatus.CANCELLED) > 1
                                     THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN c.createdAt >= :newSince THEN 1 ELSE 0 END), 0),
                   COALESCE(SUM(CASE WHEN (SELECT MAX(res2.reservationDate) FROM Reservation res2
                                           WHERE res2.customer.id = c.id
                                             AND res2.deleted = false
                                             AND res2.status <> com.restaurante.reservation.enums.ReservationStatus.CANCELLED) < :inactiveBefore
                                     THEN 1 ELSE 0 END), 0)
            FROM Customer c
            LEFT JOIN c.restaurant r
            WHERE c.deleted = false
              AND (:unrestricted = TRUE OR r.id IN :restaurantIds)
              AND (:restaurantId IS NULL OR r.id = :restaurantId)
            """)
    List<Object[]> statsForList(@Param("unrestricted") boolean unrestricted,
                               @Param("restaurantIds") Set<Long> restaurantIds,
                               @Param("restaurantId") Long restaurantId,
                               @Param("newSince") LocalDateTime newSince,
                               @Param("inactiveBefore") LocalDate inactiveBefore);
}
