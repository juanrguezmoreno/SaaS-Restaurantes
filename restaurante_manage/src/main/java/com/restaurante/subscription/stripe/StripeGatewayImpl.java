package com.restaurante.subscription.stripe;

import com.stripe.StripeClient;
import com.stripe.model.Subscription;
import com.stripe.model.checkout.Session;
import com.stripe.param.*;
import com.stripe.param.checkout.SessionCreateParams;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

/**
 * Implementación real contra la API de Stripe.
 *
 * El cliente se construye con la clave secreta de las propiedades; nunca se
 * registra ni se traza esa clave. Los datos de tarjeta jamás pasan por aquí: los
 * captura Stripe en su propia página alojada.
 */
@Slf4j
@Component
public class StripeGatewayImpl implements StripeGateway {

    private final StripeProperties properties;
    private final StripeClient client;

    public StripeGatewayImpl(StripeProperties properties) {
        this.properties = properties;
        // Timeouts explícitos y agresivos (por defecto muy por debajo de los 30 s /
        // 80 s de stripe-java): StripeWebhookService llama a este gateway dentro de
        // una transacción de base de datos, así que una degradación de Stripe no
        // debe poder retener una conexión de la pool durante minutos.
        this.client = properties.isEnabled()
                ? StripeClient.builder()
                        .setApiKey(properties.getSecretKey())
                        .setConnectTimeout(properties.getConnectTimeoutMs())
                        .setReadTimeout(properties.getReadTimeoutMs())
                        .build()
                : null;
    }

    private StripeClient client() {
        if (client == null) {
            throw new IllegalStateException(
                    "La facturación no está configurada: falta STRIPE_SECRET_KEY o los precios");
        }
        return client;
    }

    @Override
    public String createCustomer(Long tenantId, String tenantName, String email) {
        try {
            CustomerCreateParams params = CustomerCreateParams.builder()
                    .setName(tenantName)
                    .setEmail(email)
                    // El tenant viaja en metadata: es como se verifica, al recibir
                    // un webhook, que el cliente de Stripe es de quien creemos.
                    .putMetadata("tenantId", String.valueOf(tenantId))
                    .build();
            return client().customers().create(params).getId();
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo crear el cliente en Stripe", e);
        }
    }

    @Override
    public String createCheckoutSession(String customerId, Long tenantId, String priceId,
                                        Integer trialDays, String successUrl, String cancelUrl) {
        try {
            SessionCreateParams.SubscriptionData.Builder datosSuscripcion =
                    SessionCreateParams.SubscriptionData.builder()
                            .putMetadata("tenantId", String.valueOf(tenantId));
            if (trialDays != null && trialDays > 0) {
                datosSuscripcion.setTrialPeriodDays(trialDays.longValue());
            }

            SessionCreateParams params = SessionCreateParams.builder()
                    .setMode(SessionCreateParams.Mode.SUBSCRIPTION)
                    .setCustomer(customerId)
                    .setClientReferenceId(String.valueOf(tenantId))
                    .addLineItem(SessionCreateParams.LineItem.builder()
                            .setPrice(priceId)
                            .setQuantity(1L)
                            .build())
                    .setSubscriptionData(datosSuscripcion.build())
                    .setSuccessUrl(successUrl)
                    .setCancelUrl(cancelUrl)
                    .build();

            Session sesion = client().checkout().sessions().create(params);
            return sesion.getUrl();
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo crear la sesión de pago", e);
        }
    }

    @Override
    public String createPortalSession(String customerId, String returnUrl) {
        try {
            com.stripe.param.billingportal.SessionCreateParams params =
                    com.stripe.param.billingportal.SessionCreateParams.builder()
                            .setCustomer(customerId)
                            .setReturnUrl(returnUrl)
                            .build();
            return client().billingPortal().sessions().create(params).getUrl();
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo abrir el portal de cliente", e);
        }
    }

    @Override
    public StripeSubscriptionSnapshot updateSubscriptionPrice(String subscriptionId,
                                                              String newPriceId) {
        try {
            Subscription suscripcion = client().subscriptions().retrieve(subscriptionId);
            String itemId = suscripcion.getItems().getData().get(0).getId();

            SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
                    .addItem(SubscriptionUpdateParams.Item.builder()
                            .setId(itemId)
                            .setPrice(newPriceId)
                            .build())
                    // Con prorrateo: el cliente paga o recibe crédito por la parte
                    // proporcional del periodo ya consumido.
                    .setProrationBehavior(
                            SubscriptionUpdateParams.ProrationBehavior.CREATE_PRORATIONS)
                    .build();

            return toSnapshot(client().subscriptions().update(subscriptionId, params));
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo cambiar el plan en Stripe", e);
        }
    }

    @Override
    public StripeSubscriptionSnapshot cancelSubscription(String subscriptionId,
                                                         boolean atPeriodEnd) {
        try {
            if (atPeriodEnd) {
                SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
                        .setCancelAtPeriodEnd(true)
                        .build();
                return toSnapshot(client().subscriptions().update(subscriptionId, params));
            }
            return toSnapshot(client().subscriptions().cancel(subscriptionId));
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo cancelar la suscripción", e);
        }
    }

    @Override
    public StripeSubscriptionSnapshot reactivateSubscription(String subscriptionId) {
        try {
            SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
                    .setCancelAtPeriodEnd(false)
                    .build();
            return toSnapshot(client().subscriptions().update(subscriptionId, params));
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo reactivar la suscripción", e);
        }
    }

    @Override
    public StripeSubscriptionSnapshot fetchSubscription(String subscriptionId) {
        try {
            return toSnapshot(client().subscriptions().retrieve(subscriptionId));
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo leer la suscripción", e);
        }
    }

    /**
     * Nota de versión (verificado con javap contra stripe-java 33.4.1): los
     * campos current_period_start/end NO existen en Subscription en esta
     * versión, sólo en el item de la suscripción (SubscriptionItem). El resto
     * (status, customer, trialEnd, cancelAtPeriodEnd) sí vive en Subscription.
     */
    private StripeSubscriptionSnapshot toSnapshot(Subscription suscripcion) {
        var item = suscripcion.getItems().getData().get(0);
        return new StripeSubscriptionSnapshot(
                suscripcion.getId(),
                suscripcion.getCustomer(),
                item.getPrice() != null ? item.getPrice().getId() : null,
                suscripcion.getStatus(),
                item.getCurrentPeriodStart(),
                item.getCurrentPeriodEnd(),
                suscripcion.getTrialEnd(),
                Boolean.TRUE.equals(suscripcion.getCancelAtPeriodEnd())
        );
    }
}
