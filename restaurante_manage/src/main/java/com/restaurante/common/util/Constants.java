package com.restaurante.common.util;

public final class Constants {

    private Constants() {
        throw new UnsupportedOperationException("Esta es una clase de constantes y no puede ser instanciada");
    }

    // API
    public static final String API_BASE_PATH = "/api/v1";

    // Auth
    public static final String AUTH_PATH = API_BASE_PATH + "/auth";
    public static final String LOGIN_PATH = "/login";
    public static final String REGISTER_PATH = "/register";
    public static final String FORGOT_PASSWORD_PATH = "/forgot-password";
    public static final String RESET_PASSWORD_PATH = "/reset-password";

    // Users
    public static final String USERS_PATH = API_BASE_PATH + "/users";

    // Restaurants
    public static final String RESTAURANTS_PATH = API_BASE_PATH + "/restaurants";

    /**
     * Listado de restaurantes del panel de administración de la plataforma.
     * Separado de {@link #RESTAURANTS_PATH}, que es público y lo consumen los
     * desplegables de varias pantallas: este exige autenticación y rol
     * SUPER_ADMIN o ADMIN.
     */
    public static final String ADMIN_RESTAURANTS_PATH = API_BASE_PATH + "/admin/restaurants";

    // Tables
    public static final String TABLES_PATH = API_BASE_PATH + "/tables";

    // Floor plan (elementos decorativos del plano de sala)
    public static final String FLOOR_PLAN_ELEMENTS_SUBPATH = "/floor-plan/elements";

    /** Subruta de los periodos de servicio de un restaurante. */
    public static final String SERVICE_PERIODS_SUBPATH = "/service-periods";

    // Reservas de un restaurante (plano de sala)
    public static final String RESTAURANT_RESERVATIONS_SUBPATH = "/reservations";

    // Customers
    public static final String CUSTOMERS_PATH = API_BASE_PATH + "/customers";

    // Employees
    public static final String EMPLOYEES_PATH = API_BASE_PATH + "/employees";

    // Reservations
    public static final String RESERVATIONS_PATH = API_BASE_PATH + "/reservations";

    // Public
    public static final String PUBLIC_PATH = API_BASE_PATH + "/public";

    // Availability
    public static final String AVAILABILITY_PATH = API_BASE_PATH + "/availability";
    public static final String AVAILABILITY_TIME_SLOTS_SUBPATH = "/time-slots";

    // Roles
    public static final String ROLE_SUPER_ADMIN = "ROLE_SUPER_ADMIN";
    public static final String ROLE_ADMIN = "ROLE_ADMIN";
    public static final String ROLE_MANAGER = "ROLE_MANAGER";
    public static final String ROLE_EMPLOYEE = "ROLE_EMPLOYEE";
    public static final String ROLE_CLIENT = "ROLE_CLIENT";

    // Facturación y suscripciones
    public static final String BILLING_PATH = API_BASE_PATH + "/billing";
    public static final String BILLING_PLANS_SUBPATH = "/plans";
    public static final String BILLING_ENTITLEMENTS_SUBPATH = "/entitlements";
    public static final String BILLING_SUBSCRIPTION_SUBPATH = "/subscription";
    public static final String BILLING_CHECKOUT_SUBPATH = "/checkout";
    public static final String BILLING_PORTAL_SUBPATH = "/portal";
    public static final String BILLING_CHANGE_PLAN_SUBPATH = "/change-plan";
    public static final String BILLING_CANCEL_SUBPATH = "/cancel";
    public static final String BILLING_REACTIVATE_SUBPATH = "/reactivate";
    public static final String BILLING_ACTIVE_RESTAURANT_SUBPATH = "/active-restaurant";

    /** Webhook de Stripe. Público y con verificación de firma obligatoria. */
    public static final String STRIPE_WEBHOOK_PATH = API_BASE_PATH + "/webhooks/stripe";

    // Pagination defaults
    public static final String DEFAULT_PAGE = "0";
    public static final String DEFAULT_SIZE = "10";
    public static final String DEFAULT_SORT = "id";
}
