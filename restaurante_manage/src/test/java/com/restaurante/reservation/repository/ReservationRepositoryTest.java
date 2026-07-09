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
 * {@link ReservationRepository#findActiveConflicts}: solo las reservas ACTIVAS
 * (PENDING/CONFIRMED) y no borradas bloquean el hueco mesa+fecha+hora.
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
    void detectaConflictoConReservaPendienteEnElMismoHueco() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> conflictos = repository.findActiveConflicts(mesa1.getId(), DATE, TIME, null);

        assertEquals(1, conflictos.size());
    }

    @Test
    void detectaConflictoConReservaConfirmadaEnElMismoHueco() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.CONFIRMED);

        List<Reservation> conflictos = repository.findActiveConflicts(mesa1.getId(), DATE, TIME, null);

        assertEquals(1, conflictos.size());
    }

    @Test
    void lasReservasCanceladasCompletadasONoShowNoBloqueanElHueco() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.CANCELLED);
        crearReserva(mesa1, DATE, TIME, ReservationStatus.COMPLETED);
        crearReserva(mesa1, DATE, TIME, ReservationStatus.NO_SHOW);

        List<Reservation> conflictos = repository.findActiveConflicts(mesa1.getId(), DATE, TIME, null);

        assertTrue(conflictos.isEmpty());
    }

    @Test
    void otraMesaALaMismaHoraNoEsConflicto() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> conflictos = repository.findActiveConflicts(mesa2.getId(), DATE, TIME, null);

        assertTrue(conflictos.isEmpty());
    }

    @Test
    void laMismaMesaAOtraHoraNoEsConflicto() {
        crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> conflictos = repository
                .findActiveConflicts(mesa1.getId(), DATE, TIME.plusHours(2), null);

        assertTrue(conflictos.isEmpty());
    }

    @Test
    void excludeIdIgnoraLaPropiaReservaAlEditar() {
        Reservation propia = crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);

        List<Reservation> conflictos = repository
                .findActiveConflicts(mesa1.getId(), DATE, TIME, propia.getId());

        assertTrue(conflictos.isEmpty());
    }

    @Test
    void lasReservasBorradasLogicamenteNoBloqueanElHueco() {
        Reservation borrada = crearReserva(mesa1, DATE, TIME, ReservationStatus.PENDING);
        borrada.setDeleted(true);
        borrada.setDeletedAt(LocalDateTime.now());
        em.persistAndFlush(borrada);

        List<Reservation> conflictos = repository.findActiveConflicts(mesa1.getId(), DATE, TIME, null);

        assertTrue(conflictos.isEmpty());
    }
}
