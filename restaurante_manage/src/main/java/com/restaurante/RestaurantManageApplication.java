package com.restaurante;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.TimeZone;

@SpringBootApplication
@EnableScheduling
@EnableAsync
public class RestaurantManageApplication {

    public static void main(String[] args) {
        // La lógica de negocio usa LocalDate.now()/LocalDateTime.now() (auditoría,
        // franjas de reserva, liberación de mesas) asumiendo hora de Madrid. Sin esto,
        // un host con TZ distinta (p. ej. Railway en UTC) desplazaría esas horas.
        TimeZone.setDefault(TimeZone.getTimeZone("Europe/Madrid"));
        SpringApplication.run(RestaurantManageApplication.class, args);
    }
}
