package com.restaurante.reservation.repository;

import com.restaurante.common.config.JpaAuditingConfig;
import com.restaurante.customer.entity.Customer;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.restaurant.entity.Restaurant;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.boot.test.autoconfigure.orm.jpa.TestEntityManager;
import org.springframework.context.annotation.Import;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;

/**
 * RES-03: verifica contra una base de datos real (H2) la semántica de
 * {@link ReservationRepository#findActiveByTableAndDateBetween}: solo las
 * reservas ACTIVAS (PENDING/CONFIRMED) y no borradas bloquean una mesa, y
 * el solape real por duración se calcula en {@code AvailabilityService}
 * sobre este resultado (ver AvailabilityServiceTest).
 */
@DataJpaTest(properties = {
        "spring.flyway.enabled=false",
        // application.yml fija ddl-auto=validate y dialecto MySQL (esquema gestionado
        // por Flyway); en el H2 embebido del test el esquema lo crea Hibernate.
        "spring.jpa.hibernate.ddl-auto=create-drop",
        "spring.jpa.properties.hibernate.dialect=org.hibernate.dialect.H2Dialect"
})
@Import(JpaAuditingConfig.class)
class ReservationRepositoryTest {

    private static final LocalDate DATE = LocalDate.of(2026, 12, 31);
    private static final LocalTime TIME = LocalTime.of(21, 0);

    @Autowired
    private TestEntityManager em;

    @Autowired
    private ReservationRepository repository;

    private Restaurant restaurant;
    private Customer customer;
    private DiningTable mesa1;
    private DiningTable mesa2;

    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setName("Restaurante Test");
        em.persist(restaurant);

        customer = new Customer();
        customer.setRestaurant(restaurant);
        customer.setFirstName("Ana");
        customer.setLastName("García");
        customer.setEmail("ana@test.com");
        em.persist(customer);

        mesa1 = crearMesa("1");
        mesa2 = crearMesa("2");
        em.flush();
    }

    private DiningTable crearMesa(String numero) {
        DiningTable mesa = new DiningTable();
        mesa.setRestaurant(restaurant);
        mesa.setTableNumber(numero);
        mesa.setCapacity(4);
        em.persist(mesa);
        return mesa;
    }

    private Reservation crearReserva(DiningTable mesa, LocalDate fecha, LocalTime hora,
                                     ReservationStatus estado) {
        Reservation r = new Reservation();
        r.setCustomer(customer);
        r.setRestaurant(restaurant);
        r.setDiningTable(mesa);
        r.setReservationDate(fecha);
        r.setReservationTime(hora);
        r.setPartySize(2);
        r.setStatus(estado);
        em.persist(r);
        em.flush();
        return r;
    }

    @Test
    void filtraReservasPorRestauranteYFechaExacta() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.CONFIRMED);
        crearReserva(mesa2, DATE, TIME.plusHours(1), ReservationStatus.PENDING);
        crearReserva(mesa1, DATE.plusDays(1), TIME, ReservationStatus.CONFIRMED);

        List<Reservation> resultado = repository
                .findByRestaurantIdAndReservationDateAndDeletedFalse(restaurant.getId(), DATE);

        assertEquals(2, resultado.size());
    }

    @Test
    void noDevuelveReservasBorradasLogicamenteParaLaFecha() {
        Reservation borrada = crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);
        borrada.setDeleted(true);
        borrada.setDeletedAt(LocalDateTime.now());
        em.persistAndFlush(borrada);

        List<Reservation> resultado = repository
                .findByRestaurantIdAndReservationDateAndDeletedFalse(restaurant.getId(), DATE);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void noDevuelveReservasDeOtroRestaurante() {
        Restaurant otro = new Restaurant();
        otro.setName("Otro Restaurante");
        em.persist(otro);
        DiningTable mesaOtro = new DiningTable();
        mesaOtro.setRestaurant(otro);
        mesaOtro.setTableNumber("X1");
        mesaOtro.setCapacity(2);
        em.persist(mesaOtro);
        em.flush();

        Reservation r = new Reservation();
        r.setCustomer(customer);
        r.setRestaurant(otro);
        r.setDiningTable(mesaOtro);
        r.setReservationDate(DATE);
        r.setReservationTime(TIME);
        r.setPartySize(2);
        r.setStatus(ReservationStatus.CONFIRMED);
        em.persistAndFlush(r);

        List<Reservation> resultado = repository
                .findByRestaurantIdAndReservationDateAndDeletedFalse(restaurant.getId(), DATE);

        assertTrue(resultado.isEmpty());
    }

    // ─── findActiveByTableAndDateBetween: solape por intervalo (duración configurable) ───

    @Test
    void findActiveByTableAndDateBetween_incluyeReservaPendienteDentroDelRango() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertEquals(1, resultado.size());
    }

    @Test
    void findActiveByTableAndDateBetween_incluyeReservaConfirmadaDentroDelRango() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.CONFIRMED);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertEquals(1, resultado.size());
    }

    @Test
    void findActiveByTableAndDateBetween_excluyeCanceladasCompletadasYNoShow() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.CANCELLED);
        crearReserva(mesa1, DATE, TIME, ReservationStatus.COMPLETED);
        crearReserva(mesa1, DATE, TIME, ReservationStatus.NO_SHOW);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_excluyeOtraMesa() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa2.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_excluyeFechasFueraDelRango() {
        crearReserva(mesa1, DATE.plusDays(5), TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_excludeIdIgnoraLaPropiaReserva() {
        Reservation propia = crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), propia.getId());

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_excluyeBorradasLogicamente() {
        Reservation borrada = crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);
        borrada.setDeleted(true);
        borrada.setDeletedAt(LocalDateTime.now());
        em.persistAndFlush(borrada);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertTrue(resultado.isEmpty());
    }

    @Test
    void findActiveByTableAndDateBetween_incluyeReservaEnElLimiteInferiorDelRango() {
        crearReserva(mesa1, DATE.minusDays(1), TIME, ReservationStatus.PENDING);

        List<Reservation> resultado = repository
                .findActiveByTableAndDateBetween(mesa1.getId(), DATE.minusDays(1), DATE.plusDays(1), null);

        assertEquals(1, resultado.size());
    }
}
