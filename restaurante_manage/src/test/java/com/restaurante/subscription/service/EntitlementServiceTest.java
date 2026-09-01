package com.restaurante.subscription.service;

import com.restaurante.common.exception.PlanLimitReachedException;
import com.restaurante.common.exception.PlanUpgradeRequiredException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.Resource;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class EntitlementServiceTest {

    @Mock private SubscriptionRepository subscriptionRepository;
    @Mock private CurrentUserService currentUserService;
    @Mock private RestaurantRepository restaurantRepository;
    @Mock private UserRepository userRepository;

    @InjectMocks private EntitlementService entitlementService;

    private static final Long TENANT_ID = 7L;

    @BeforeEach
    void configurarUsuarioPorDefecto() {
        lenient().when(currentUserService.isSuperAdmin()).thenReturn(false);
        lenient().when(currentUserService.getCurrentTenantId()).thenReturn(TENANT_ID);
    }

    private void conSuscripcion(PlanCode plan, SubscriptionStatus estado) {
        Subscription suscripcion = new Subscription();
        suscripcion.setPlanCode(plan);
        suscripcion.setStatus(estado);
        when(subscriptionRepository.findByTenantIdAndDeletedFalse(TENANT_ID))
                .thenReturn(Optional.of(suscripcion));
    }

    @Test
    @DisplayName("PRO activo tiene las features del plan")
    void proTieneFeatures() {
        conSuscripcion(PlanCode.PRO, SubscriptionStatus.ACTIVE);
        assertTrue(entitlementService.hasFeature(TENANT_ID, Feature.EXPORT_DATA));
        assertDoesNotThrow(() -> entitlementService.require(Feature.EXPORT_DATA));
    }

    @Test
    @DisplayName("NORMAL no tiene features PRO y el error indica a qué plan subir")
    void normalNoTieneFeaturesPro() {
        conSuscripcion(PlanCode.NORMAL, SubscriptionStatus.ACTIVE);

        assertFalse(entitlementService.hasFeature(TENANT_ID, Feature.EXPORT_DATA));

        PlanUpgradeRequiredException error = assertThrows(PlanUpgradeRequiredException.class,
                () -> entitlementService.require(Feature.EXPORT_DATA));
        assertEquals(Feature.EXPORT_DATA, error.getFeature());
        assertEquals(PlanCode.PRO, error.getRequiredPlan());
    }

    @Test
    @DisplayName("Un estado sin acceso anula las features aunque el plan sea PRO")
    void canceladaNoConcedeNada() {
        conSuscripcion(PlanCode.PRO, SubscriptionStatus.CANCELED);
        assertFalse(entitlementService.hasFeature(TENANT_ID, Feature.EXPORT_DATA));
        assertThrows(PlanUpgradeRequiredException.class,
                () -> entitlementService.require(Feature.EXPORT_DATA));
    }

    @Test
    @DisplayName("PAST_DUE conserva el acceso mientras Stripe reintenta el cobro")
    void pagoFallidoConservaAcceso() {
        conSuscripcion(PlanCode.PRO, SubscriptionStatus.PAST_DUE);
        assertTrue(entitlementService.hasFeature(TENANT_ID, Feature.EXPORT_DATA));
    }

    @Test
    @DisplayName("Un tenant sin suscripción se trata como sin acceso, sin lanzar excepción")
    void tenantSinSuscripcion() {
        when(subscriptionRepository.findByTenantIdAndDeletedFalse(TENANT_ID))
                .thenReturn(Optional.empty());

        EffectiveSubscription efectiva = entitlementService.resolve(TENANT_ID);
        assertFalse(efectiva.hasAccess());
        assertTrue(efectiva.features().isEmpty());
        assertFalse(entitlementService.hasFeature(TENANT_ID, Feature.MULTI_RESTAURANT));
    }

    @Test
    @DisplayName("SUPER_ADMIN está exento de features y de límites")
    void superAdminExento() {
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        when(currentUserService.getCurrentTenantId()).thenReturn(null);

        assertDoesNotThrow(() -> entitlementService.require(Feature.EXPORT_DATA));
        assertDoesNotThrow(() -> entitlementService.requireCapacity(Resource.RESTAURANT));
    }

    @Test
    @DisplayName("NORMAL con 1 local no puede crear otro y el error lleva el detalle")
    void limiteDeLocalesAlcanzado() {
        conSuscripcion(PlanCode.NORMAL, SubscriptionStatus.ACTIVE);
        when(restaurantRepository.countByTenantIdAndDeletedFalse(TENANT_ID)).thenReturn(1L);

        PlanLimitReachedException error = assertThrows(PlanLimitReachedException.class,
                () -> entitlementService.requireCapacity(Resource.RESTAURANT));
        assertEquals(Resource.RESTAURANT, error.getResource());
        assertEquals(1, error.getLimit());
        assertEquals(1L, error.getCurrent());
        assertEquals(PlanCode.PRO, error.getRequiredPlan());
    }

    @Test
    @DisplayName("NORMAL con 4 cuentas todavía puede crear una más")
    void limiteDeCuentasConMargen() {
        conSuscripcion(PlanCode.NORMAL, SubscriptionStatus.ACTIVE);
        when(userRepository.countByTenantIdAndDeletedFalse(TENANT_ID)).thenReturn(4L);
        assertDoesNotThrow(() -> entitlementService.requireCapacity(Resource.USER_ACCOUNT));
    }

    @Test
    @DisplayName("PRO no tiene límite de locales")
    void proSinLimiteDeLocales() {
        conSuscripcion(PlanCode.PRO, SubscriptionStatus.ACTIVE);
        when(restaurantRepository.countByTenantIdAndDeletedFalse(TENANT_ID)).thenReturn(42L);
        assertDoesNotThrow(() -> entitlementService.requireCapacity(Resource.RESTAURANT));
    }

    @Test
    @DisplayName("Un usuario sin tenant y sin ser SUPER_ADMIN no tiene ninguna feature")
    void usuarioSinTenant() {
        when(currentUserService.getCurrentTenantId()).thenReturn(null);
        assertThrows(PlanUpgradeRequiredException.class,
                () -> entitlementService.require(Feature.EXPORT_DATA));
    }
}
