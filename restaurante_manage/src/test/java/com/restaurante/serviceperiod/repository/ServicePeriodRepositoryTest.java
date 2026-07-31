package com.restaurante.serviceperiod.repository;

import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.serviceperiod.entity.ServicePeriod;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;

/**
 * Persistencia de los periodos de servicio: se guardan asociados a su
 * restaurante y las consultas respetan el borrado lógico.
 */
@SpringBootTest
@ActiveProfiles("dev")
class ServicePeriodRepositoryTest {

    @Autowired private ServicePeriodRepository servicePeriodRepository;
    @Autowired private RestaurantRepository restaurantRepository;

    private Restaurant restaurante;

    @BeforeEach
    void setUp() {
        Restaurant nuevo = new Restaurant();
        nuevo.setName("Horarios Test");
        nuevo.setDefaultReservationDurationMinutes(90);
        nuevo.setPublicBookingEnabled(true);
        restaurante = restaurantRepository.save(nuevo);
    }

    private ServicePeriod periodo(DayOfWeek dia, LocalTime inicio, LocalTime fin, String nombre) {
        ServicePeriod p = new ServicePeriod();
        p.setRestaurant(restaurante);
        p.setDayOfWeek(dia);
        p.setStartTime(inicio);
        p.setEndTime(fin);
        p.setName(nombre);
        return p;
    }

    @Test
    void guardaYRecuperaLosPeriodosDeUnRestaurante() {
        servicePeriodRepository.save(periodo(DayOfWeek.MONDAY, LocalTime.of(13, 0), LocalTime.of(16, 0), "Comidas"));
        servicePeriodRepository.save(periodo(DayOfWeek.MONDAY, LocalTime.of(20, 0), LocalTime.of(23, 0), "Cenas"));

        List<ServicePeriod> vivos = servicePeriodRepository
                .findByRestaurantIdAndDeletedFalse(restaurante.getId());

        assertEquals(2, vivos.size());
    }

    @Test
    void elNombreEsOpcional() {
        ServicePeriod guardado = servicePeriodRepository
                .save(periodo(DayOfWeek.TUESDAY, LocalTime.of(13, 0), LocalTime.of(16, 0), null));

        assertNull(servicePeriodRepository.findById(guardado.getId()).orElseThrow().getName());
    }

    @Test
    void losPeriodosBorradosLogicamenteNoSeDevuelven() {
        ServicePeriod guardado = servicePeriodRepository
                .save(periodo(DayOfWeek.WEDNESDAY, LocalTime.of(13, 0), LocalTime.of(16, 0), null));
        guardado.setDeleted(true);
        guardado.setDeletedAt(LocalDateTime.now());
        servicePeriodRepository.save(guardado);

        assertEquals(0, servicePeriodRepository
                .findByRestaurantIdAndDeletedFalse(restaurante.getId()).size());
    }
}
