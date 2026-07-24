package com.restaurante.common.config;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Configuración MVC transversal.
 *
 * <p>IMPORTANTE: aquí NO se configura CORS. La única fuente de verdad de CORS es
 * {@code SecurityConfig#corsConfigurationSource()}, que lee los orígenes permitidos
 * de la propiedad {@code app.cors.allowed-origins} (variable de entorno
 * {@code CORS_ALLOWED_ORIGINS}, valores separados por comas). Duplicar CORS aquí
 * con {@code addCorsMappings} provocaba una configuración contradictoria con
 * orígenes hardcodeados.</p>
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {
}
