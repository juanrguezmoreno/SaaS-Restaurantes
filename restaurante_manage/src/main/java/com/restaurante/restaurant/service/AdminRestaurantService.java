package com.restaurante.restaurant.service;

import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.dto.AdminRestaurantListItem;
import com.restaurante.restaurant.dto.AdminRestaurantStats;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;
import java.util.Set;

/**
 * Listado y métricas de restaurantes para el panel de administración.
 *
 * <p>La pantalla antigua descargaba todos los restaurantes y sumaba las
 * métricas en el navegador. Aquí la paginación, la búsqueda, la ordenación y
 * los agregados se resuelven en la base de datos, de modo que el coste no crece
 * con el número de restaurantes de la plataforma.</p>
 *
 * <p>El alcance multi-tenant se resuelve <em>siempre</em> aquí, a partir del
 * usuario autenticado, y nunca a partir de parámetros del cliente: SUPER_ADMIN
 * ve todos los tenants y ADMIN queda acotado al suyo.</p>
 */
@Service
@RequiredArgsConstructor
public class AdminRestaurantService {

    /**
     * Los parámetros de colección de JPQL no admiten nulo ni vacío, así que
     * cuando no se filtra por identificador se manda este conjunto inerte que
     * la consulta ignora por la bandera {@code filterByIds}.
     */
    private static final Set<Long> PLACEHOLDER_IDS = Set.of(-1L);

    private final RestaurantRepository restaurantRepository;
    private final CurrentUserService currentUserService;

    /**
     * Página de restaurantes visibles, filtrada por texto libre.
     *
     * @param pageable página y ordenación, ya validadas por el controlador.
     * @param search   texto libre sobre nombre, email, teléfono, dirección y
     *                 nombre de la cuenta; nulo o vacío para no filtrar.
     */
    @Transactional(readOnly = true)
    public Page<AdminRestaurantListItem> search(Pageable pageable, String search) {
        Scope scope = resolveScope();
        if (scope.noAccess()) {
            return Page.empty(pageable);
        }

        return restaurantRepository.searchForAdmin(
                scope.unrestricted(),
                scope.filterByIds(),
                scope.restaurantIds(),
                scope.tenantId(),
                normalizeSearch(search),
                pageable);
    }

    /**
     * Métricas del panel en el alcance del usuario actual, con una sola
     * consulta agregada.
     */
    @Transactional(readOnly = true)
    public AdminRestaurantStats stats() {
        Scope scope = resolveScope();
        if (scope.noAccess()) {
            return AdminRestaurantStats.builder().build();
        }

        List<Object[]> rows = restaurantRepository.statsForAdmin(
                scope.unrestricted(),
                scope.filterByIds(),
                scope.restaurantIds(),
                scope.tenantId());

        if (rows == null || rows.isEmpty() || rows.get(0) == null) {
            return AdminRestaurantStats.builder().build();
        }

        Object[] row = rows.get(0);
        return AdminRestaurantStats.builder()
                .totalRestaurants(toLong(row, 0))
                .totalCapacity(toLong(row, 1))
                .publicBookingEnabledCount(toLong(row, 2))
                .build();
    }

    /**
     * Normaliza el texto de búsqueda igual que el resto del proyecto: en
     * minúsculas y con los comodines escapados, para que un '%' escrito por el
     * usuario se busque literalmente en vez de convertir la consulta en "todo".
     */
    private String normalizeSearch(String search) {
        if (search == null || search.isBlank()) {
            return null;
        }
        String escaped = search.trim().toLowerCase()
                .replace("!", "!!")
                .replace("%", "!%")
                .replace("_", "!_");
        return "%" + escaped + "%";
    }

    /**
     * Traduce las reglas de visibilidad de {@code CurrentUserService} a los
     * parámetros que esperan las consultas del repositorio.
     */
    private Scope resolveScope() {
        List<Long> visibleIds = currentUserService.getVisibleRestaurantIds();

        // [-1] es el marcador de "sin acceso a ningún restaurante".
        if (visibleIds.size() == 1 && visibleIds.get(0) == -1L) {
            return Scope.denied();
        }

        // Lista con contenido: alcance limitado a esos identificadores.
        if (!visibleIds.isEmpty()) {
            return new Scope(false, true, Set.copyOf(visibleIds), null, false);
        }

        // Lista vacía = "sin filtro de identificador"; decide el rol.
        if (currentUserService.isSuperAdmin()) {
            return new Scope(true, false, PLACEHOLDER_IDS, null, false);
        }

        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId != null) {
            return new Scope(false, false, PLACEHOLDER_IDS, tenantId, false);
        }

        // Usuario sin tenant y sin ser SUPER_ADMIN: no ve nada.
        return Scope.denied();
    }

    private long toLong(Object[] row, int index) {
        if (row.length <= index || row[index] == null) {
            return 0L;
        }
        return ((Number) row[index]).longValue();
    }

    /**
     * Alcance resuelto de la consulta.
     *
     * @param unrestricted  sin restricción de tenant (solo SUPER_ADMIN).
     * @param filterByIds   acotar a {@code restaurantIds}.
     * @param restaurantIds identificadores visibles; nunca nulo ni vacío.
     * @param tenantId      tenant al que se acota, o nulo.
     * @param noAccess      el usuario no ve ningún restaurante.
     */
    private record Scope(boolean unrestricted,
                         boolean filterByIds,
                         Set<Long> restaurantIds,
                         Long tenantId,
                         boolean noAccess) {

        static Scope denied() {
            return new Scope(false, false, PLACEHOLDER_IDS, null, true);
        }
    }
}
