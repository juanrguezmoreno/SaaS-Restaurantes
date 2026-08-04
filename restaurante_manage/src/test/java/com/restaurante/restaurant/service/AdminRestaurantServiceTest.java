package com.restaurante.restaurant.service;

import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.dto.AdminRestaurantListItem;
import com.restaurante.restaurant.dto.AdminRestaurantStats;
import com.restaurante.restaurant.repository.RestaurantRepository;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Pageable;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyBoolean;
import static org.mockito.ArgumentMatchers.anySet;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * Alcance del panel de administración: quién ve qué, y cómo se traduce a los
 * parámetros de la consulta.
 *
 * <p>Lo que se prueba aquí es la decisión de alcance, que es la garantía de
 * aislamiento entre cuentas: un ADMIN nunca debe consultar sin filtro.</p>
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class AdminRestaurantServiceTest {

    @Mock private RestaurantRepository restaurantRepository;
    @Mock private CurrentUserService currentUserService;

    @InjectMocks private AdminRestaurantService service;

    private final Pageable pageable = PageRequest.of(0, 25);

    private void stubEmptyPage() {
        when(restaurantRepository.searchForAdmin(anyBoolean(), anyBoolean(), anySet(), any(), any(), any()))
                .thenReturn(new PageImpl<>(List.of()));
    }

    // ─── Alcance ────────────────────────────────────────────────────────────

    @Test
    void elSuperAdminConsultaSinRestriccion() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        stubEmptyPage();

        service.search(pageable, null);

        verify(restaurantRepository).searchForAdmin(eq(true), eq(false), anySet(), eq(null), eq(null), eq(pageable));
    }

    @Test
    void unAdministradorQuedaAcotadoASuCuenta() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(false);
        when(currentUserService.getCurrentTenantId()).thenReturn(7L);
        stubEmptyPage();

        service.search(pageable, null);

        // Sin restricción = false y con el tenant puesto: no puede ver otras cuentas.
        verify(restaurantRepository).searchForAdmin(eq(false), eq(false), anySet(), eq(7L), eq(null), eq(pageable));
    }

    @Test
    void conAsignacionesExplicitasSeFiltraPorEsosIdentificadores() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(3L, 5L));
        stubEmptyPage();

        service.search(pageable, null);

        ArgumentCaptor<Set<Long>> ids = ArgumentCaptor.forClass(Set.class);
        verify(restaurantRepository).searchForAdmin(eq(false), eq(true), ids.capture(), eq(null), eq(null), eq(pageable));
        assertThat(ids.getValue()).containsExactlyInAnyOrder(3L, 5L);
    }

    @Test
    void sinAccesoDevuelvePaginaVaciaSinConsultar() {
        // [-1] es el marcador de "no ve ningún restaurante".
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(-1L));

        Page<AdminRestaurantListItem> result = service.search(pageable, null);

        assertThat(result.getTotalElements()).isZero();
        verify(restaurantRepository, never()).searchForAdmin(anyBoolean(), anyBoolean(), anySet(), any(), any(), any());
    }

    @Test
    void unUsuarioSinTenantNiSuperAdminNoVeNada() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(false);
        when(currentUserService.getCurrentTenantId()).thenReturn(null);

        Page<AdminRestaurantListItem> result = service.search(pageable, null);

        assertThat(result.getTotalElements()).isZero();
        verify(restaurantRepository, never()).searchForAdmin(anyBoolean(), anyBoolean(), anySet(), any(), any(), any());
    }

    // ─── Normalización de la búsqueda ───────────────────────────────────────

    @Test
    void laBusquedaSeNormalizaAMinusculasConComodines() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        stubEmptyPage();

        service.search(pageable, "  Casa Pepe  ");

        verify(restaurantRepository).searchForAdmin(anyBoolean(), anyBoolean(), anySet(), any(),
                eq("%casa pepe%"), eq(pageable));
    }

    @Test
    void losComodinesEscritosPorElUsuarioSeEscapan() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        stubEmptyPage();

        service.search(pageable, "50%_off!");

        // Un '%' suelto convertiría la búsqueda en "todo": se busca literal.
        verify(restaurantRepository).searchForAdmin(anyBoolean(), anyBoolean(), anySet(), any(),
                eq("%50!%!_off!!%"), eq(pageable));
    }

    @Test
    void unaBusquedaVaciaNoFiltra() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        stubEmptyPage();

        service.search(pageable, "   ");

        verify(restaurantRepository).searchForAdmin(anyBoolean(), anyBoolean(), anySet(), any(),
                eq(null), eq(pageable));
    }

    // ─── Métricas ───────────────────────────────────────────────────────────

    @Test
    void lasMetricasSeLeenDeLaConsultaAgregada() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        when(restaurantRepository.statsForAdmin(anyBoolean(), anyBoolean(), anySet(), any()))
                .thenReturn(List.<Object[]>of(new Object[]{487L, 12_340L, 401L}));

        AdminRestaurantStats stats = service.stats();

        assertThat(stats.getTotalRestaurants()).isEqualTo(487L);
        assertThat(stats.getTotalCapacity()).isEqualTo(12_340L);
        assertThat(stats.getPublicBookingEnabledCount()).isEqualTo(401L);
    }

    @Test
    void lasMetricasSonCeroSiLaConsultaNoDevuelveFila() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of());
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        when(restaurantRepository.statsForAdmin(anyBoolean(), anyBoolean(), anySet(), any()))
                .thenReturn(List.<Object[]>of());

        AdminRestaurantStats stats = service.stats();

        assertThat(stats.getTotalRestaurants()).isZero();
        assertThat(stats.getTotalCapacity()).isZero();
        assertThat(stats.getPublicBookingEnabledCount()).isZero();
    }

    @Test
    void sinAccesoLasMetricasNoConsultan() {
        when(currentUserService.getVisibleRestaurantIds()).thenReturn(List.of(-1L));

        AdminRestaurantStats stats = service.stats();

        assertThat(stats.getTotalRestaurants()).isZero();
        verify(restaurantRepository, never()).statsForAdmin(anyBoolean(), anyBoolean(), anySet(), any());
    }
}
