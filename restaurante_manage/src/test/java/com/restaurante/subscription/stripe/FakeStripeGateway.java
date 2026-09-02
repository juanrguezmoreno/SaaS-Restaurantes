package com.restaurante.subscription.stripe;

import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Implementación falsa de Stripe para los tests. No hace red ni cobra nada:
 * registra lo que se le pide y devuelve lo que se le haya preparado.
 */
@Primary
@Component
public class FakeStripeGateway implements StripeGateway {

    public record CheckoutRequest(String customerId, Long tenantId, String priceId,
                                  Integer trialDays, String successUrl, String cancelUrl) {}

    private final List<CheckoutRequest> checkoutRequests = new ArrayList<>();
    private StripeSubscriptionSnapshot nextSnapshot;
    private String nextCustomerId = "cus_fake_1";

    public void setNextSnapshot(StripeSubscriptionSnapshot snapshot) {
        this.nextSnapshot = snapshot;
    }

    public void setNextCustomerId(String customerId) {
        this.nextCustomerId = customerId;
    }

    public CheckoutRequest getLastCheckoutRequest() {
        return checkoutRequests.isEmpty() ? null : checkoutRequests.get(checkoutRequests.size() - 1);
    }

    public void reset() {
        checkoutRequests.clear();
        nextSnapshot = null;
        nextCustomerId = "cus_fake_1";
    }

    @Override
    public String createCustomer(Long tenantId, String tenantName, String email) {
        return nextCustomerId;
    }

    @Override
    public String createCheckoutSession(String customerId, Long tenantId, String priceId,
                                        Integer trialDays, String successUrl, String cancelUrl) {
        checkoutRequests.add(new CheckoutRequest(
                customerId, tenantId, priceId, trialDays, successUrl, cancelUrl));
        return "https://checkout.stripe.test/sesion-falsa";
    }

    @Override
    public String createPortalSession(String customerId, String returnUrl) {
        return "https://billing.stripe.test/portal-falso";
    }

    @Override
    public StripeSubscriptionSnapshot updateSubscriptionPrice(String subscriptionId, String newPriceId) {
        return snapshotOSimulado(subscriptionId, newPriceId, "active", false);
    }

    @Override
    public StripeSubscriptionSnapshot cancelSubscription(String subscriptionId, boolean atPeriodEnd) {
        return snapshotOSimulado(subscriptionId, null,
                atPeriodEnd ? "active" : "canceled", atPeriodEnd);
    }

    @Override
    public StripeSubscriptionSnapshot reactivateSubscription(String subscriptionId) {
        return snapshotOSimulado(subscriptionId, null, "active", false);
    }

    @Override
    public StripeSubscriptionSnapshot fetchSubscription(String subscriptionId) {
        return snapshotOSimulado(subscriptionId, null, "active", false);
    }

    private StripeSubscriptionSnapshot snapshotOSimulado(String subscriptionId, String priceId,
                                                         String status, boolean cancelAtPeriodEnd) {
        if (nextSnapshot != null) {
            return nextSnapshot;
        }
        long ahora = System.currentTimeMillis() / 1000L;
        return new StripeSubscriptionSnapshot(
                subscriptionId, "cus_fake_1", priceId, status,
                ahora, ahora + 2_592_000L, null, cancelAtPeriodEnd);
    }
}
