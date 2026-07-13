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

    // Tables
    public static final String TABLES_PATH = API_BASE_PATH + "/tables";

    // Floor plan (elementos decorativos del plano de sala)
    public static final String FLOOR_PLAN_ELEMENTS_SUBPATH = "/floor-plan/elements";

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

    // Roles
    public static final String ROLE_SUPER_ADMIN = "ROLE_SUPER_ADMIN";
    public static final String ROLE_ADMIN = "ROLE_ADMIN";
    public static final String ROLE_MANAGER = "ROLE_MANAGER";
    public static final String ROLE_EMPLOYEE = "ROLE_EMPLOYEE";
    public static final String ROLE_CLIENT = "ROLE_CLIENT";

    // Pagination defaults
    public static final String DEFAULT_PAGE = "0";
    public static final String DEFAULT_SIZE = "10";
    public static final String DEFAULT_SORT = "id";
}
