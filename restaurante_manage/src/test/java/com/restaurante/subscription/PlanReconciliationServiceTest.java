package com.restaurante.subscription;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.subscription.catalog.PlanCatalog;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.subscription.service.EffectiveSubscription;
import com.restaurante.subscription.service.EntitlementService;
import com.restaurante.subscription.service.PlanReconciliationService;
import com.restaurante.tenant.entity.Tenant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.List;
import java.util.Optional;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * PlanReconciliationService: ajusta qué locales quedan operativos al cambiar de
 * plan, SIN borrar ni marcar como eliminado ningún dato.
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class PlanReconciliationServiceTest {

    @Mock private RestaurantRepository restaurantRepository;
    @Mock private EntitlementService entitlementService;

    @InjectMocks private PlanReconciliationService planReconciliationService;

    private static final Long TENANT_ID = 1L;

    private Tenant tenant;
    private Restaurant local10;
    private Restaurant local11;
    private Restaurant local12;

    @BeforeEach
    void sembrarLocales() {
        tenant = new Tenant();
        tenant.setId(TENANT_ID);

        local10 = crearLocal(10L, true);
        local11 = crearLocal(11L, true);
        local12 = crearLocal(12L, true);

        lenient().when(restaurantRepository.findByTenantIdAndDeletedFalseOrderByIdAsc(TENANT_ID))
                .thenReturn(List.of(local10, local11, local12));
        // saveAll no hace nada especial en este mock: los cambios ya están en las
        // mismas instancias que se comparan en los asserts.
        lenient().when(restaurantRepository.saveAll(any()))
                .thenAnswer(invocacion -> invocacion.getArgument(0));

        conPlan(PlanCode.NORMAL);
    }

    private Restaurant crearLocal(Long id, boolean activo) {
        Restaurant local = new Restaurant();
        local.setId(id);
        local.setTenant(tenant);
        local.setActiveUnderPlan(activo);
        local.setDeleted(false);
        return local;
    }

    private void conPlan(PlanCode plan) {
        conPlanYEstado(plan, SubscriptionStatus.ACTIVE);
    }

    private void conPlanYEstado(PlanCode plan, SubscriptionStatus estado) {
        boolean acceso = estado.grantsAccess();
        EffectiveSubscription efectiva = new EffectiveSubscription(
                plan, estado, acceso,
                acceso ? PlanCatalog.limits(plan) : new com.restaurante.subscription.catalog.PlanLimits(0, 0),
                false, null, null, false);
        when(entitlementService.resolve(TENANT_ID)).thenReturn(efectiva);
    }

    @Test
    @DisplayName("Al bajar a un plan de 1 local, queda activo el más antiguo y el resto se bloquea")
    void downgradeDejaActivoElMasAntiguo() {
        planReconciliationService.reconcile(TENANT_ID);

        assertTrue(local10.getActiveUnderPlan());
        assertFalse(local11.getActiveUnderPlan());
        assertFalse(local12.getActiveUnderPlan());
    }

    @Test
    @DisplayName("La reconciliación NUNCA borra ni marca como eliminado un local")
    void reconciliacionNoBorraNada() {
        planReconciliationService.reconcile(TENANT_ID);

        for (Restaurant local : List.of(local10, local11, local12)) {
            assertFalse(local.getDeleted(), "La reconciliación no debe borrar locales");
            assertNull(local.getDeletedAt());
        }
        verify(restaurantRepository, never()).delete(any());
        verify(restaurantRepository, never()).deleteById(any());
    }

    @Test
    @DisplayName("Al volver a un plan ilimitado se reactivan todos los locales")
    void upgradeReactivaTodo() {
        local11.setActiveUnderPlan(false);
        local12.setActiveUnderPlan(false);
        conPlan(PlanCode.PRO);

        planReconciliationService.reconcile(TENANT_ID);

        assertTrue(local10.getActiveUnderPlan());
        assertTrue(local11.getActiveUnderPlan());
        assertTrue(local12.getActiveUnderPlan());
    }

    @Test
    @DisplayName("Si ya hay un local elegido dentro de la cuota, se respeta")
    void respetaLaEleccionPrevia() {
        local10.setActiveUnderPlan(false);
        local12.setActiveUnderPlan(true);   // el usuario eligió el 12
        local11.setActiveUnderPlan(false);
        conPlan(PlanCode.NORMAL);

        planReconciliationService.reconcile(TENANT_ID);

        assertFalse(local10.getActiveUnderPlan());
        assertTrue(local12.getActiveUnderPlan(), "No debe pisar la elección del usuario");
    }

    @Test
    @DisplayName("Un estado sin acceso bloquea todos los locales, sin borrar nada")
    void suscripcionMuertaBloqueaTodo() {
        conPlanYEstado(PlanCode.PRO, SubscriptionStatus.CANCELED);

        planReconciliationService.reconcile(TENANT_ID);

        assertFalse(local10.getActiveUnderPlan());
        assertFalse(local11.getActiveUnderPlan());
        assertFalse(local12.getActiveUnderPlan());
        assertFalse(local10.getDeleted());
    }

    @Test
    @DisplayName("No se puede elegir como activo un local de otro inquilino")
    void eleccionCrossTenantRechazada() {
        Tenant otroTenant = new Tenant();
        otroTenant.setId(999L);
        Restaurant localDeOtroTenant = new Restaurant();
        localDeOtroTenant.setId(50L);
        localDeOtroTenant.setTenant(otroTenant);
        localDeOtroTenant.setActiveUnderPlan(true);
        localDeOtroTenant.setDeleted(false);

        when(restaurantRepository.findByIdAndDeletedFalse(50L))
                .thenReturn(Optional.of(localDeOtroTenant));

        assertThrows(AccessDeniedException.class, () ->
                planReconciliationService.chooseActiveRestaurant(TENANT_ID, 50L));
    }

    @Test
    @DisplayName("Elegir un local inexistente se rechaza con un error de petición inválida")
    void eleccionDeLocalInexistente() {
        when(restaurantRepository.findByIdAndDeletedFalse(404L)).thenReturn(Optional.empty());

        assertThrows(BadRequestException.class, () ->
                planReconciliationService.chooseActiveRestaurant(TENANT_ID, 404L));
    }

    @Test
    @DisplayName("chooseActiveRestaurant activa el elegido y respeta el cupo del plan")
    void chooseActiveRestaurantActivaElElegidoDentroDelCupo() {
        when(restaurantRepository.findByIdAndDeletedFalse(12L)).thenReturn(Optional.of(local12));

        planReconciliationService.chooseActiveRestaurant(TENANT_ID, 12L);

        assertTrue(local12.getActiveUnderPlan());
        assertFalse(local10.getActiveUnderPlan());
        assertFalse(local11.getActiveUnderPlan());
    }
}
