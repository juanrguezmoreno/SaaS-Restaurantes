package com.restaurante.security;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.hamcrest.Matchers.containsString;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.options;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Tests de integración de la configuración CORS, cuya única fuente de verdad es
 * {@code SecurityConfig#corsConfigurationSource()} alimentada por la propiedad
 * {@code app.cors.allowed-origins} (variable de entorno {@code CORS_ALLOWED_ORIGINS}).
 *
 * <p>Se fija la propiedad con el MISMO valor coma-separado usado en producción
 * (Railway) para verificar que el parseo produce dos orígenes independientes:
 * el dominio de Vercel y localhost. Se ejerce la cadena real de filtros de
 * Spring Security (CorsFilter incluido) vía MockMvc.</p>
 *
 * <p>Blinda contra la regresión que causó el 403 en producción: el preflight
 * {@code OPTIONS /auth/login} desde el frontend de Vercel debe completarse sin
 * JWT, y un origen no autorizado NO debe recibir cabeceras CORS válidas.</p>
 *
 * Se ejecuta bajo el perfil {@code dev} (H2 en memoria) — seguro para {@code mvn test}.
 */
@SpringBootTest(properties =
        "app.cors.allowed-origins=https://saas-restaurantes-lovat.vercel.app,http://localhost:5173")
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class CorsConfigurationIntegrationTest {

    private static final String LOGIN_PATH = "/api/v1/auth/login";
    private static final String RESERVATIONS_PATH = "/api/v1/reservations";

    private static final String ORIGEN_PROD = "https://saas-restaurantes-lovat.vercel.app";
    private static final String ORIGEN_DEV = "http://localhost:5173";
    private static final String ORIGEN_NO_AUTORIZADO = "https://evil-example.com";

    @Autowired
    private MockMvc mockMvc;

    @Test
    @DisplayName("Preflight OPTIONS /auth/login desde el origen de producción (Vercel) se permite sin JWT")
    void preflightDesdeOrigenProduccion_devuelveCabecerasCors() throws Exception {
        mockMvc.perform(options(LOGIN_PATH)
                        .header(HttpHeaders.ORIGIN, ORIGEN_PROD)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST")
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_HEADERS, "Authorization, Content-Type"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ORIGEN_PROD))
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_METHODS, containsString("POST")))
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_HEADERS, containsString("Authorization")))
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_CREDENTIALS, "true"));
    }

    @Test
    @DisplayName("Preflight OPTIONS /auth/login desde localhost:5173 (desarrollo) se permite")
    void preflightDesdeLocalhost_devuelveCabecerasCors() throws Exception {
        mockMvc.perform(options(LOGIN_PATH)
                        .header(HttpHeaders.ORIGIN, ORIGEN_DEV)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ORIGEN_DEV));
    }

    @Test
    @DisplayName("Preflight desde un origen NO autorizado se rechaza sin cabeceras CORS")
    void preflightDesdeOrigenNoAutorizado_seRechaza() throws Exception {
        mockMvc.perform(options(LOGIN_PATH)
                        .header(HttpHeaders.ORIGIN, ORIGEN_NO_AUTORIZADO)
                        .header(HttpHeaders.ACCESS_CONTROL_REQUEST_METHOD, "POST"))
                .andExpect(status().isForbidden())
                .andExpect(header().doesNotExist(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN));
    }

    @Test
    @DisplayName("POST /auth/login real desde el origen de producción sigue funcionando (no lo bloquea CORS)")
    void loginDesdeOrigenProduccion_funciona() throws Exception {
        // Usuario demo sembrado por el perfil dev (data.sql / DemoDataInitializer).
        String body = "{\"usernameOrEmail\":\"super.admin\",\"password\":\"admin123\"}";

        mockMvc.perform(post(LOGIN_PATH)
                        .header(HttpHeaders.ORIGIN, ORIGEN_PROD)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(body))
                .andExpect(status().isOk())
                .andExpect(header().string(HttpHeaders.ACCESS_CONTROL_ALLOW_ORIGIN, ORIGEN_PROD));
    }

    @Test
    @DisplayName("Los endpoints protegidos siguen exigiendo JWT aunque el origen esté permitido")
    void endpointProtegidoSinJwt_devuelve401() throws Exception {
        mockMvc.perform(get(RESERVATIONS_PATH)
                        .header(HttpHeaders.ORIGIN, ORIGEN_PROD))
                .andExpect(status().isUnauthorized());
    }
}
