package com.restaurante.subscription;

import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.subscription.repository.ProcessedStripeEventRepository;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.subscription.stripe.FakeStripeGateway;
import com.restaurante.subscription.stripe.StripeSubscriptionSnapshot;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.web.servlet.MockMvc;

import java.time.Instant;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Webhook de Stripe: la única vía por la que el estado de pago de un inquilino
 * puede cambiar de forma autoritativa.
 *
 * Los eventos se firman aquí mismo con HMAC-SHA256, exactamente como lo hace
 * Stripe, así que no hace falta ni red ni cuenta. Lo que se comprueba es que sin
 * firma válida NADA cambia, que una entrega duplicada no se aplica dos veces y
 * que un evento fuera de orden no revierte el estado.
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
@TestPropertySource(properties = {
        "app.stripe.secret-key=sk_test_falsa",
        "app.stripe.webhook-secret=whsec_test_falsa",
        "app.stripe.price-normal-monthly=price_normal_test",
        "app.stripe.price-pro-monthly=price_pro_test",
        "app.stripe.trial-days=14"
})
class StripeWebhookEndpointIntegrationTest {

    private static final String SECRETO = "whsec_test_falsa";
    private static final String RUTA = "/api/v1/webhooks/stripe";

    /**
     * Versión de API con la que stripe-java 33.4.1 sabe deserializar el objeto del
     * evento. Si no coincide, getDataObjectDeserializer().getObject() viene vacío.
     */
    private static final String VERSION_API = "2026-08-26.dahlia";

    @Autowired private MockMvc mockMvc;
    @Autowired private TenantRepository tenantRepository;
    @Autowired private SubscriptionRepository subscriptionRepository;
    @Autowired private ProcessedStripeEventRepository processedStripeEventRepository;
    @Autowired private FakeStripeGateway fakeStripeGateway;

    private Tenant tenantNormal;

    @BeforeEach
    void sembrarDatos() {
        fakeStripeGateway.reset();
        // La bitácora de eventos procesados es compartida por toda la clase: se
        // limpia para poder contar cuántos ha dejado el test en curso.
        processedStripeEventRepository.deleteAll();

        // El nombre del tenant también es único en BD: cada @Test reejecuta este
        // @BeforeEach sobre el mismo contexto/H2, así que necesita su propio sufijo
        // igual que el slug, o el segundo test de la clase choca con el primero.
        long sufijo = System.nanoTime();
        tenantNormal = crearTenant("Facturacion Webhook SA " + sufijo,
                "facturacion-webhook-sa-" + sufijo);
        crearSuscripcion(tenantNormal, PlanCode.NORMAL, SubscriptionStatus.ACTIVE);
    }

    private Tenant crearTenant(String nombre, String slug) {
        Tenant tenant = new Tenant();
        tenant.setName(nombre);
        tenant.setSlug(slug);
        tenant.setActive(true);
        return tenantRepository.save(tenant);
    }

    private void crearSuscripcion(Tenant tenant, PlanCode plan, SubscriptionStatus estado) {
        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(plan);
        suscripcion.setStatus(estado);
        subscriptionRepository.save(suscripcion);
    }

    private void enlazarConStripe(Tenant tenant, String customerId,
                                  String subscriptionId, String priceId) {
        Subscription suscripcion = subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenant.getId()).orElseThrow();
        suscripcion.setStripeCustomerId(customerId);
        suscripcion.setStripeSubscriptionId(subscriptionId);
        suscripcion.setStripePriceId(priceId);
        subscriptionRepository.save(suscripcion);
    }

    /**
     * El servicio NO se fía del cuerpo del evento: relee la suscripción en Stripe.
     * Por eso el falso gateway tiene que devolver la misma foto que cuenta el
     * evento, o el test estaría comprobando otra cosa.
     */
    private void prepararInstantanea(String subscriptionId, String customerId, String priceId,
                                     String estado) {
        long ahora = Instant.now().getEpochSecond();
        fakeStripeGateway.setNextSnapshot(new StripeSubscriptionSnapshot(
                subscriptionId, customerId, priceId, estado,
                ahora, ahora + 2_592_000L, null, false));
    }

    private String cuerpoSuscripcion(String eventId, String subscriptionId, String priceId,
                                     String estado, long creadoEn) {
        return """
            {
              "id": "%s",
              "object": "event",
              "api_version": "%s",
              "type": "customer.subscription.updated",
              "created": %d,
              "data": { "object": {
                "id": "%s",
                "object": "subscription",
                "customer": "cus_test_1",
                "status": "%s",
                "cancel_at_period_end": false,
                "items": { "object": "list", "data": [
                  { "id": "si_1", "object": "subscription_item",
                    "current_period_start": 1750000000,
                    "current_period_end": 1752592000,
                    "price": { "id": "%s", "object": "price" } }
                ]}
              }}
            }
            """.formatted(eventId, VERSION_API, creadoEn, subscriptionId, estado, priceId);
    }

    private String cuerpoCheckout(String eventId, String sessionId, String subscriptionId,
                                  String customerId, String referenciaCliente) {
        return """
            {
              "id": "%s",
              "object": "event",
              "api_version": "%s",
              "type": "checkout.session.completed",
              "created": %d,
              "data": { "object": {
                "id": "%s",
                "object": "checkout.session",
                "mode": "subscription",
                "customer": "%s",
                "client_reference_id": "%s",
                "subscription": "%s"
              }}
            }
            """.formatted(eventId, VERSION_API, Instant.now().getEpochSecond(),
                sessionId, customerId, referenciaCliente, subscriptionId);
    }

    private void enviarFirmado(String cuerpo) throws Exception {
        mockMvc.perform(post(RUTA)
                        .header("Stripe-Signature", StripeSignatureHelper.firmar(
                                cuerpo, SECRETO, Instant.now().getEpochSecond()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("Un webhook firmado correctamente actualiza el plan y el estado")
    void webhookValidoActualizaEstado() throws Exception {
        enlazarConStripe(tenantNormal, "cus_test_1", "sub_test_1", "price_normal_test");
        prepararInstantanea("sub_test_1", "cus_test_1", "price_pro_test", "active");
        String cuerpo = cuerpoSuscripcion("evt_1", "sub_test_1", "price_pro_test",
                "active", Instant.now().getEpochSecond());

        mockMvc.perform(post(RUTA)
                        .header("Stripe-Signature", StripeSignatureHelper.firmar(
                                cuerpo, SECRETO, Instant.now().getEpochSecond()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isOk());

        Subscription actualizada = subscriptionRepository
                .findByStripeSubscriptionId("sub_test_1").orElseThrow();
        assertEquals(PlanCode.PRO, actualizada.getPlanCode());
        assertEquals(SubscriptionStatus.ACTIVE, actualizada.getStatus());
    }

    @Test
    @DisplayName("Una firma inválida devuelve 400 y NO cambia nada")
    void firmaInvalidaNoCambiaNada() throws Exception {
        enlazarConStripe(tenantNormal, "cus_test_1", "sub_test_2", "price_normal_test");
        prepararInstantanea("sub_test_2", "cus_test_1", "price_pro_test", "active");
        String cuerpo = cuerpoSuscripcion("evt_2", "sub_test_2", "price_pro_test",
                "active", Instant.now().getEpochSecond());

        mockMvc.perform(post(RUTA)
                        .header("Stripe-Signature", "t=1,v1=firmafalsa")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isBadRequest());

        // El plan sigue siendo el de antes: nadie sube de plan sin firma válida.
        assertEquals(PlanCode.NORMAL, subscriptionRepository
                .findByStripeSubscriptionId("sub_test_2").orElseThrow().getPlanCode());
        assertEquals(0, processedStripeEventRepository.count());
    }

    @Test
    @DisplayName("Sin cabecera de firma se rechaza")
    void sinCabeceraDeFirma() throws Exception {
        mockMvc.perform(post(RUTA)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("El mismo evento entregado dos veces se procesa una sola vez")
    void eventoDuplicado() throws Exception {
        enlazarConStripe(tenantNormal, "cus_test_1", "sub_test_3", "price_normal_test");
        prepararInstantanea("sub_test_3", "cus_test_1", "price_pro_test", "active");
        String cuerpo = cuerpoSuscripcion("evt_dup", "sub_test_3", "price_pro_test",
                "active", Instant.now().getEpochSecond());
        String firma = StripeSignatureHelper.firmar(
                cuerpo, SECRETO, Instant.now().getEpochSecond());

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post(RUTA)
                            .header("Stripe-Signature", firma)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(cuerpo))
                    .andExpect(status().isOk());
        }

        assertEquals(1, processedStripeEventRepository.count());
    }

    @Test
    @DisplayName("Un evento más antiguo que el último aplicado se descarta")
    void eventoFueraDeOrden() throws Exception {
        enlazarConStripe(tenantNormal, "cus_test_1", "sub_test_4", "price_normal_test");
        long ahora = Instant.now().getEpochSecond();

        // Primero llega el nuevo: sube a PRO.
        prepararInstantanea("sub_test_4", "cus_test_1", "price_pro_test", "active");
        enviarFirmado(cuerpoSuscripcion("evt_nuevo", "sub_test_4", "price_pro_test",
                "active", ahora));
        // Luego llega uno viejo que decía NORMAL: debe ignorarse.
        prepararInstantanea("sub_test_4", "cus_test_1", "price_normal_test", "active");
        enviarFirmado(cuerpoSuscripcion("evt_viejo", "sub_test_4", "price_normal_test",
                "active", ahora - 600));

        assertEquals(PlanCode.PRO, subscriptionRepository
                .findByStripeSubscriptionId("sub_test_4").orElseThrow().getPlanCode());
    }

    @Test
    @DisplayName("Un tipo de evento que no nos interesa se acepta sin hacer nada")
    void eventoIrrelevante() throws Exception {
        String cuerpo = """
            {"id":"evt_otro","object":"event","api_version":"%s","type":"payment_intent.created",
             "created":%d,"data":{"object":{"id":"pi_1","object":"payment_intent"}}}
            """.formatted(VERSION_API, Instant.now().getEpochSecond());
        enviarFirmado(cuerpo);
        // 200 para que Stripe no lo reintente eternamente.
    }

    @Test
    @DisplayName("El primer checkout enlaza la suscripción por el inquilino del evento")
    void checkoutEnlazaPorInquilino() throws Exception {
        // Todavía no hay stripeSubscriptionId guardado: es el primer pago.
        enlazarConStripe(tenantNormal, "cus_checkout_1", null, null);
        prepararInstantanea("sub_checkout_1", "cus_checkout_1", "price_pro_test", "active");

        enviarFirmado(cuerpoCheckout("evt_checkout", "cs_1", "sub_checkout_1",
                "cus_checkout_1", String.valueOf(tenantNormal.getId())));

        Subscription actualizada = subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenantNormal.getId()).orElseThrow();
        assertEquals("sub_checkout_1", actualizada.getStripeSubscriptionId());
        assertEquals(PlanCode.PRO, actualizada.getPlanCode());
    }

    @Test
    @DisplayName("Un evento de otro cliente de Stripe no engancha la suscripción del inquilino")
    void checkoutDeOtroClienteNoEngancha() throws Exception {
        enlazarConStripe(tenantNormal, "cus_checkout_2", null, null);
        prepararInstantanea("sub_intruso", "cus_intruso", "price_pro_test", "active");

        // Mismo inquilino en client_reference_id, pero otro cliente de Stripe:
        // sería alguien pagando en su cuenta para subir de plan la de otro.
        enviarFirmado(cuerpoCheckout("evt_intruso", "cs_2", "sub_intruso",
                "cus_intruso", String.valueOf(tenantNormal.getId())));

        Subscription intacta = subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenantNormal.getId()).orElseThrow();
        assertNull(intacta.getStripeSubscriptionId());
        assertEquals(PlanCode.NORMAL, intacta.getPlanCode());
    }
}
