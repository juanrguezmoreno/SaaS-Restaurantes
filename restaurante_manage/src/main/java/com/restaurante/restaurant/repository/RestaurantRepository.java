package com.restaurante.restaurant.repository;

import java.util.List;
import java.util.Optional;
import java.util.Set;

import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;

import com.restaurante.restaurant.dto.AdminRestaurantListItem;
import com.restaurante.restaurant.entity.Restaurant;
@Repository
public interface RestaurantRepository extends JpaRepository<Restaurant, Long> {

    Optional<Restaurant> findByIdAndDeletedFalse(Long id);

    Page<Restaurant> findAllByDeletedFalse(Pageable pageable);

    List<Restaurant> findByTenantIdAndDeletedFalse(Long tenantId);

    Page<Restaurant> findByTenantIdAndDeletedFalse(Long tenantId, Pageable pageable);

    long countByTenantIdAndDeletedFalse(Long tenantId);

    // Consultas para filtrar por IDs de restaurantes visibles

    @Query("SELECT r FROM Restaurant r WHERE r.id IN :ids AND r.deleted = false")
    List<Restaurant> findByIdInAndDeletedFalse(Set<Long> ids);

    @Query("SELECT r FROM Restaurant r WHERE r.id IN :ids AND r.deleted = false")
    Page<Restaurant> findByIdInAndDeletedFalse(Set<Long> ids, Pageable pageable);

    @Query("SELECT r FROM Restaurant r WHERE r.tenant.id = :tenantId AND r.id IN :ids AND r.deleted = false")
    List<Restaurant> findByTenantIdAndIdInAndDeletedFalse(Long tenantId, Set<Long> ids);

    @Query("SELECT r FROM Restaurant r WHERE r.tenant.id = :tenantId AND r.id IN :ids AND r.deleted = false")
    Page<Restaurant> findByTenantIdAndIdInAndDeletedFalse(Long tenantId, Set<Long> ids, Pageable pageable);

    // ─── Panel de administración ────────────────────────────────────────────
    // El listado del panel no puede pasar por RestaurantMapper: sus contadores
    // de mesas y empleados recorren colecciones LAZY y añaden dos consultas por
    // fila. Estas dos consultas devuelven exactamente lo que la pantalla pinta,
    // en una sola ida a la base de datos.

    /**
     * Búsqueda paginada de restaurantes para el panel de administración,
     * siempre acotada al alcance multi-tenant que resuelve
     * {@code CurrentUserService}.
     *
     * <p>El alcance no es negociable desde fuera: llega resuelto en el
     * servidor, nunca como parámetro del cliente. {@code unrestricted} solo es
     * {@code true} para SUPER_ADMIN.</p>
     *
     * @param unrestricted  {@code true} solo para SUPER_ADMIN, que ve todos los
     *                      tenants. Con {@code false} mandan {@code filterByIds}
     *                      y {@code tenantId}.
     * @param filterByIds   {@code true} para acotar a {@code restaurantIds}.
     * @param restaurantIds restaurantes visibles. Nunca nulo ni vacío; se
     *                      ignora su contenido si {@code filterByIds} es false.
     * @param tenantId      tenant al que se acota la consulta, o {@code null}.
     * @param search        texto ya normalizado a minúsculas y con comodines
     *                      ({@code %texto%}), o nulo para no filtrar.
     */
    @Query(value = """
            SELECT new com.restaurante.restaurant.dto.AdminRestaurantListItem(
                       r.id, r.name, r.address, r.phone, r.email, r.capacity,
                       r.openingTime, r.closingTime, r.publicBookingEnabled,
                       t.id, t.name, r.createdAt)
            FROM Restaurant r
            LEFT JOIN r.tenant t
            WHERE r.deleted = false
              AND (:unrestricted = TRUE OR :filterByIds = FALSE OR r.id IN :restaurantIds)
              AND (:unrestricted = TRUE OR :tenantId IS NULL OR t.id = :tenantId)
              AND (:search IS NULL
                   OR LOWER(r.name) LIKE :search ESCAPE '!'
                   OR LOWER(r.email) LIKE :search ESCAPE '!'
                   OR LOWER(r.phone) LIKE :search ESCAPE '!'
                   OR LOWER(r.address) LIKE :search ESCAPE '!'
                   OR LOWER(t.name) LIKE :search ESCAPE '!')
            """,
            countQuery = """
            SELECT COUNT(r)
            FROM Restaurant r
            LEFT JOIN r.tenant t
            WHERE r.deleted = false
              AND (:unrestricted = TRUE OR :filterByIds = FALSE OR r.id IN :restaurantIds)
              AND (:unrestricted = TRUE OR :tenantId IS NULL OR t.id = :tenantId)
              AND (:search IS NULL
                   OR LOWER(r.name) LIKE :search ESCAPE '!'
                   OR LOWER(r.email) LIKE :search ESCAPE '!'
                   OR LOWER(r.phone) LIKE :search ESCAPE '!'
                   OR LOWER(r.address) LIKE :search ESCAPE '!'
                   OR LOWER(t.name) LIKE :search ESCAPE '!')
            """)
    Page<AdminRestaurantListItem> searchForAdmin(@Param("unrestricted") boolean unrestricted,
                                                @Param("filterByIds") boolean filterByIds,
                                                @Param("restaurantIds") Set<Long> restaurantIds,
                                                @Param("tenantId") Long tenantId,
                                                @Param("search") String search,
                                                Pageable pageable);

    /**
     * Métricas agregadas del panel, en el mismo alcance que
     * {@link #searchForAdmin}. Devuelve una única fila con
     * {@code [total, capacidadTotal, conReservasOnline]}.
     *
     * <p>Se calcula en la base de datos precisamente para no depender de
     * descargar la lista completa en el cliente.</p>
     */
    @Query("""
            SELECT COUNT(r),
                   COALESCE(SUM(COALESCE(r.capacity, 0)), 0),
                   COALESCE(SUM(CASE WHEN r.publicBookingEnabled = TRUE THEN 1 ELSE 0 END), 0)
            FROM Restaurant r
            LEFT JOIN r.tenant t
            WHERE r.deleted = false
              AND (:unrestricted = TRUE OR :filterByIds = FALSE OR r.id IN :restaurantIds)
              AND (:unrestricted = TRUE OR :tenantId IS NULL OR t.id = :tenantId)
            """)
    List<Object[]> statsForAdmin(@Param("unrestricted") boolean unrestricted,
                                @Param("filterByIds") boolean filterByIds,
                                @Param("restaurantIds") Set<Long> restaurantIds,
                                @Param("tenantId") Long tenantId);
}
