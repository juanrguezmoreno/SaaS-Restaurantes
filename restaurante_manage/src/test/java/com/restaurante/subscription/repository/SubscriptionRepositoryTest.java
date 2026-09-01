package com.restaurante.subscription.repository;

import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("dev")
@Transactional
class SubscriptionRepositoryTest {

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private TenantRepository tenantRepository;

    private Tenant crearTenant(String nombre, String slug) {
        Tenant tenant = new Tenant();
        tenant.setName(nombre);
        tenant.setSlug(slug);
        tenant.setActive(true);
        return tenantRepository.save(tenant);
    }

    @Test
    @DisplayName("Se guarda y se recupera la suscripción por tenant")
    void guardaYRecuperaPorTenant() {
        Tenant tenant = crearTenant("Tenant Test A", "tenant-test-a");

        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(PlanCode.PRO);
        suscripcion.setStatus(SubscriptionStatus.ACTIVE);
        suscripcion.setLegacyGrant(true);
        subscriptionRepository.save(suscripcion);

        Optional<Subscription> encontrada =
                subscriptionRepository.findByTenantIdAndDeletedFalse(tenant.getId());

        assertTrue(encontrada.isPresent());
        assertEquals(PlanCode.PRO, encontrada.get().getPlanCode());
        assertEquals(SubscriptionStatus.ACTIVE, encontrada.get().getStatus());
        assertTrue(encontrada.get().isLegacyGrant());
        assertNull(encontrada.get().getStripeSubscriptionId());
        assertNotNull(encontrada.get().getCreatedAt());
    }

    @Test
    @DisplayName("Se recupera por el identificador de suscripción de Stripe")
    void recuperaPorStripeSubscriptionId() {
        Tenant tenant = crearTenant("Tenant Test B", "tenant-test-b");

        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(PlanCode.NORMAL);
        suscripcion.setStatus(SubscriptionStatus.TRIALING);
        suscripcion.setStripeCustomerId("cus_test_123");
        suscripcion.setStripeSubscriptionId("sub_test_123");
        subscriptionRepository.save(suscripcion);

        assertTrue(subscriptionRepository.findByStripeSubscriptionId("sub_test_123").isPresent());
        assertTrue(subscriptionRepository.findByStripeCustomerId("cus_test_123").isPresent());
        assertTrue(subscriptionRepository.findByStripeSubscriptionId("sub_inexistente").isEmpty());
    }

    @Test
    @DisplayName("Una suscripción borrada lógicamente no se devuelve")
    void ignoraLasBorradas() {
        Tenant tenant = crearTenant("Tenant Test C", "tenant-test-c");

        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(PlanCode.NORMAL);
        suscripcion.setStatus(SubscriptionStatus.ACTIVE);
        suscripcion.setDeleted(true);
        subscriptionRepository.save(suscripcion);

        assertTrue(subscriptionRepository.findByTenantIdAndDeletedFalse(tenant.getId()).isEmpty());
    }
}
