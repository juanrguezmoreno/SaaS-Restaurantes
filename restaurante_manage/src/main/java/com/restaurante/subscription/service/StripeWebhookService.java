package com.restaurante.subscription.service;

import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import com.restaurante.common.exception.InvalidWebhookSignatureException;
import com.restaurante.common.exception.WebhookSecretNotConfiguredException;
import com.restaurante.subscription.entity.ProcessedStripeEvent;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.repository.ProcessedStripeEventRepository;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.subscription.stripe.StripeGateway;
import com.restaurante.subscription.stripe.StripeProperties;
import com.restaurante.subscription.stripe.StripeSubscriptionSnapshot;
import com.stripe.Stripe;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import com.stripe.model.EventDataObjectDeserializer;
import com.stripe.model.Invoice;
import com.stripe.model.StripeObject;
import com.stripe.model.checkout.Session;
import com.stripe.net.Webhook;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Optional;

/**
 * Procesa los eventos de Stripe. Es la ÚNICA vía por la que el estado de pago de
 * un tenant puede cambiar de forma autoritativa.
 *
 * Tres garantías:
 *  - Firma verificada siempre. Sin secreto configurado, no se procesa nada.
 *  - Idempotencia por la UNIQUE de stripe_processed_events, no por una consulta
 *    previa (que tendría condición de carrera con dos entregas simultáneas).
 *  - Se descartan los eventos anteriores al último aplicado a esa suscripción:
 *    Stripe no garantiza el orden de entrega.
 *
 * El registro del evento y el cambio de la suscripción van en la MISMA
 * transacción, abierta a mano con TransactionTemplate. Es a propósito: la
 * violación de la UNIQUE deja la transacción marcada para deshacer, así que hay
 * que capturarla FUERA de ella. Así una entrega duplicada no aplica nada y se
 * responde 200, y un fallo transitorio deshace también el registro del evento,
 * de modo que el reintento de Stripe sigue siendo efectivo.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StripeWebhookService {

    public static final String SIGNATURE_HEADER = "Stripe-Signature";

    /** Clave con la que el tenant viaja en la metadata de Stripe. */
    private static final String CLAVE_TENANT = "tenantId";

    private final StripeProperties stripeProperties;
    private final SubscriptionRepository subscriptionRepository;
    private final ProcessedStripeEventRepository processedEventRepository;
    private final SubscriptionService subscriptionService;
    private final StripeGateway stripeGateway;
    private final TransactionTemplate transactionTemplate;
    private final PlanReconciliationService planReconciliationService;

    public void handle(String payload, String signatureHeader) {
        if (stripeProperties.getWebhookSecret() == null
                || stripeProperties.getWebhookSecret().isBlank()) {
            // Fail closed: sin secreto no se acepta NADA. Aceptar sin verificar
            // sería dejar que cualquiera regale planes con una petición HTTP.
            // No es InvalidWebhookSignatureException: la petición de Stripe es
            // legítima, el fallo es nuestro (despliegue sin el secreto
            // configurado), así que el handler debe responder 503 y no 400 para
            // que Stripe reintente el evento hasta que se configure el secreto.
            throw new WebhookSecretNotConfiguredException(
                    "STRIPE_WEBHOOK_SECRET no está configurado: no se procesa ningún webhook");
        }

        Event evento;
        try {
            evento = Webhook.constructEvent(
                    payload, signatureHeader, stripeProperties.getWebhookSecret());
        } catch (SignatureVerificationException e) {
            throw new InvalidWebhookSignatureException("Firma de webhook inválida", e);
        } catch (RuntimeException e) {
            // Cuerpo que no es ni siquiera un evento de Stripe: se trata igual que
            // una firma inválida (400), porque reintentarlo tampoco lo arreglaría.
            throw new InvalidWebhookSignatureException("Webhook de Stripe ilegible", e);
        }

        try {
            transactionTemplate.executeWithoutResult(estado -> procesar(evento));
        } catch (DataIntegrityViolationException e) {
            // La UNIQUE que salta puede ser la de stripe_processed_events (evento
            // duplicado, caso normal) o la de subscriptions.stripe_subscription_id
            // (dos inquilinos distintos intentando quedarse con el mismo id de
            // suscripción de Stripe: una colisión real que NO debe silenciarse).
            // Sólo se trata como duplicado si el evento ya está en la bitácora;
            // si no lo está, se relanza para que responda 500 y Stripe reintente,
            // en vez de perder el evento devolviendo 200 con el mensaje engañoso
            // de "ya procesado".
            if (!processedEventRepository.existsByStripeEventId(evento.getId())) {
                throw e;
            }
            log.info("[Stripe] Evento {} ({}) ya procesado; se ignora",
                    evento.getId(), evento.getType());
        }
    }

    /** Cuerpo transaccional: registra el evento y aplica su efecto. */
    private void procesar(Event evento) {
        processedEventRepository.saveAndFlush(
                new ProcessedStripeEvent(evento.getId(), evento.getType()));

        log.info("[Stripe] Procesando evento {} de tipo {}", evento.getId(), evento.getType());

        LocalDateTime eventoEn = LocalDateTime.ofInstant(
                Instant.ofEpochSecond(evento.getCreated()), ZoneId.systemDefault());

        switch (evento.getType()) {
            case "checkout.session.completed",
                 "customer.subscription.created",
                 "customer.subscription.updated",
                 "customer.subscription.deleted",
                 "invoice.paid",
                 "invoice.payment_failed" -> aplicarDesdeEvento(evento, eventoEn);
            case "customer.subscription.trial_will_end" ->
                    log.info("[Stripe] La prueba del evento {} termina pronto", evento.getId());
            default -> log.debug("[Stripe] Evento {} sin manejador; se acepta y se ignora",
                    evento.getType());
        }
    }

    /**
     * Relee la suscripción desde Stripe en lugar de fiarse del cuerpo del evento.
     * Es una llamada más, pero elimina toda una clase de errores: el cuerpo puede
     * estar incompleto o desfasado, la API siempre dice la verdad actual.
     */
    private void aplicarDesdeEvento(Event evento, LocalDateTime eventoEn) {
        Optional<String> subscriptionId = extraerSubscriptionId(evento);
        if (subscriptionId.isEmpty()) {
            log.warn("[Stripe] Evento {} sin identificador de suscripción; se ignora",
                    evento.getId());
            return;
        }

        Optional<Subscription> suscripcion =
                subscriptionRepository.findByStripeSubscriptionId(subscriptionId.get());
        if (suscripcion.isEmpty()) {
            suscripcion = resolverPorTenantDeMetadata(evento, subscriptionId.get());
        }
        if (suscripcion.isEmpty()) {
            log.warn("[Stripe] No hay inquilino asociado a la suscripción {}; se ignora",
                    subscriptionId.get());
            return;
        }

        Subscription entidad = suscripcion.get();
        if (entidad.getLastStripeEventAt() != null
                && eventoEn.isBefore(entidad.getLastStripeEventAt())) {
            log.info("[Stripe] Evento {} anterior al último aplicado; se descarta",
                    evento.getId());
            return;
        }

        StripeSubscriptionSnapshot instantanea = stripeGatewayFetch(subscriptionId.get());
        subscriptionService.applySnapshot(entidad, instantanea, eventoEn);
        subscriptionRepository.save(entidad);

        // El plan acaba de cambiar: ajustar qué locales quedan operativos.
        // Nunca borra datos, sólo alterna activeUnderPlan.
        planReconciliationService.reconcile(entidad.getTenant().getId());
    }

    /**
     * Saca el id de la suscripción del evento, según su tipo.
     *
     * Se intenta primero con el objeto tipado y, si no está disponible, con el
     * JSON crudo. El objeto tipado sólo existe cuando la versión de API del
     * evento coincide con la de stripe-java; cuando no coincide (una cuenta
     * anclada a una versión antigua, por ejemplo) el deserializador devuelve
     * vacío o falla, y quedarse ahí sería perder eventos de pago reales.
     */
    private Optional<String> extraerSubscriptionId(Event evento) {
        String tipo = evento.getType() == null ? "" : evento.getType();
        Optional<StripeObject> objeto = objetoDelEvento(evento);

        if (tipo.startsWith("customer.subscription.")) {
            return objeto
                    .filter(com.stripe.model.Subscription.class::isInstance)
                    .map(o -> ((com.stripe.model.Subscription) o).getId())
                    .flatMap(this::conValor)
                    .or(() -> textoDelJson(evento, "id"));
        }
        if (tipo.equals("checkout.session.completed")) {
            return objeto
                    .filter(Session.class::isInstance)
                    .map(o -> ((Session) o).getSubscription())
                    .flatMap(this::conValor)
                    .or(() -> textoDelJson(evento, "subscription"));
        }
        if (tipo.startsWith("invoice.")) {
            // En stripe-java 33.4.1 la factura YA NO tiene getSubscription(): el id
            // vive en parent.subscription_details.subscription. Se deja además la
            // lectura del campo antiguo del JSON por si el evento viene de una
            // cuenta anclada a una versión de API anterior.
            return objeto
                    .filter(Invoice.class::isInstance)
                    .map(Invoice.class::cast)
                    .map(Invoice::getParent)
                    .map(Invoice.Parent::getSubscriptionDetails)
                    .map(Invoice.Parent.SubscriptionDetails::getSubscription)
                    .flatMap(this::conValor)
                    .or(() -> textoDelJson(evento,
                            "parent", "subscription_details", "subscription"))
                    .or(() -> textoDelJson(evento, "subscription"));
        }
        return Optional.empty();
    }

    /**
     * Busca la suscripción por el tenant que viaja en el evento, para el caso en
     * el que todavía no hay ninguna guardada con ese id de Stripe: es justo lo que
     * pasa con el primer checkout.session.completed de un inquilino.
     *
     * Antes de devolverla se comprueba que el cliente de Stripe del evento es el
     * que ya teníamos guardado. Si no coincide, alguien está intentando enganchar
     * la suscripción de otro: se descarta y se registra como incidencia.
     */
    private Optional<Subscription> resolverPorTenantDeMetadata(Event evento, String subscriptionId) {
        Optional<Long> tenantId = tenantIdDelEvento(evento);
        if (tenantId.isEmpty()) {
            log.warn("[Stripe] El evento {} de la suscripción {} no trae inquilino",
                    evento.getId(), subscriptionId);
            return Optional.empty();
        }

        Optional<Subscription> suscripcion =
                subscriptionRepository.findByTenantIdAndDeletedFalse(tenantId.get());
        if (suscripcion.isEmpty()) {
            log.warn("[Stripe] El inquilino {} del evento {} no tiene suscripción guardada",
                    tenantId.get(), evento.getId());
            return Optional.empty();
        }

        String clienteGuardado = suscripcion.get().getStripeCustomerId();
        Optional<String> clienteDelEvento = textoDelJson(evento, "customer");
        if (clienteGuardado != null) {
            // Falla cerrado: si ya había un cliente de Stripe guardado, el del
            // evento tiene que poder leerse y coincidir. Que no se pueda leer
            // (por ejemplo porque "customer" llegó expandido como objeto en vez
            // de como id) no es motivo para omitir la comprobación: sería una
            // forma trivial de saltársela en silencio.
            if (clienteDelEvento.isEmpty()) {
                log.warn("[Seguridad] El evento {} pretende asociar la suscripción {} al"
                                + " inquilino {}, pero no se puede leer el cliente de Stripe"
                                + " del evento para verificarlo; se descarta",
                        evento.getId(), subscriptionId, tenantId.get());
                return Optional.empty();
            }
            if (!clienteGuardado.equals(clienteDelEvento.get())) {
                log.warn("[Seguridad] El evento {} pretende asociar la suscripción {} del cliente"
                                + " {} al inquilino {}, cuyo cliente en Stripe es otro; se descarta",
                        evento.getId(), subscriptionId, clienteDelEvento.get(), tenantId.get());
                return Optional.empty();
            }
        }
        return suscripcion;
    }

    /** Relee la suscripción en Stripe a través de la única puerta de salida. */
    private StripeSubscriptionSnapshot stripeGatewayFetch(String subscriptionId) {
        return stripeGateway.fetchSubscription(subscriptionId);
    }

    /** El inquilino viaja en client_reference_id (checkout) o en metadata.tenantId. */
    private Optional<Long> tenantIdDelEvento(Event evento) {
        return textoDelJson(evento, "client_reference_id")
                .or(() -> textoDelJson(evento, "metadata", CLAVE_TENANT))
                .flatMap(this::aIdentificador);
    }

    private Optional<Long> aIdentificador(String valor) {
        try {
            return Optional.of(Long.valueOf(valor.trim()));
        } catch (NumberFormatException e) {
            log.warn("[Stripe] Identificador de inquilino no numérico en un evento; se ignora");
            return Optional.empty();
        }
    }

    /**
     * Objeto tipado del evento, o vacío si stripe-java no puede construirlo.
     * getObject() devuelve vacío cuando la versión de API no encaja, y puede
     * llegar a fallar si el evento ni siquiera trae api_version: ese caso se
     * trata aquí en lugar de dejar que estalle a mitad del proceso.
     */
    private Optional<StripeObject> objetoDelEvento(Event evento) {
        EventDataObjectDeserializer deserializador = evento.getDataObjectDeserializer();
        if (deserializador == null) {
            return Optional.empty();
        }
        try {
            return deserializador.getObject();
        } catch (RuntimeException e) {
            log.warn("[Stripe] El evento {} ({}) no se puede deserializar con stripe-java {};"
                            + " se leerá su JSON crudo",
                    evento.getId(), evento.getApiVersion(), Stripe.VERSION);
            return Optional.empty();
        }
    }

    /** Lee una ruta de campos del JSON crudo del objeto del evento. */
    private Optional<String> textoDelJson(Event evento, String... ruta) {
        EventDataObjectDeserializer deserializador = evento.getDataObjectDeserializer();
        if (deserializador == null) {
            return Optional.empty();
        }
        try {
            JsonElement actual = JsonParser.parseString(deserializador.getRawJson());
            for (String campo : ruta) {
                if (actual == null || !actual.isJsonObject()) {
                    return Optional.empty();
                }
                JsonObject objeto = actual.getAsJsonObject();
                actual = objeto.get(campo);
            }
            if (actual == null || !actual.isJsonPrimitive()) {
                return Optional.empty();
            }
            return conValor(actual.getAsString());
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    private Optional<String> conValor(String valor) {
        return valor == null || valor.isBlank() ? Optional.empty() : Optional.of(valor);
    }
}
