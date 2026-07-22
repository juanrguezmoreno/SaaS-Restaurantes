package com.restaurante.reservation.service;

import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.dto.ReservationRequest;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.security.userdetails.UserPrincipal;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.hibernate.Hibernate;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;

import static org.junit.jupiter.api.Assertions.assertEquals;

/**
 * Caso 8 del blindaje de reservas: dos peticiones concurrentes intentando
 * reservar la misma mesa/franja horaria. Usa transacciones reales sobre H2
 * (no Mockito) para verificar que el bloqueo pesimista de AvailabilityService
 * serializa las dos transacciones y solo una puede tener éxito.
 */
@SpringBootTest
@ActiveProfiles("dev")
class ReservationConcurrencyIntegrationTest {

    @Autowired private ReservationService reservationService;
    @Autowired private ReservationRepository reservationRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private DiningTableRepository diningTableRepository;
    @Autowired private CustomerRepository customerRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private PlatformTransactionManager transactionManager;

    private Restaurant restaurant;
    private DiningTable table;
    private Customer customerA;
    private Customer customerB;
    private User superAdmin;

    @BeforeEach
    void setUp() {
        // Se busca y se inicializa la colección lazy `assignedRestaurants` dentro de una
        // transacción corta y propia: UserPrincipal la recorre en el constructor, y ese
        // constructor se invoca luego desde los hilos de trabajo, fuera de cualquier sesión
        // de Hibernate. Sin esta inicialización explícita aquí, cualquier hilo que construya
        // UserPrincipal(superAdmin) lanzaría LazyInitializationException antes de llegar
        // siquiera a ejercitar el bloqueo pesimista que este test quiere probar.
        superAdmin = new TransactionTemplate(transactionManager).execute(status -> {
            User user = userRepository.findByUsernameAndDeletedFalse("super.admin")
                    .orElseThrow(() -> new IllegalStateException(
                            "Usuario demo 'super.admin' no encontrado — este test requiere el perfil dev con DemoDataInitializer"));
            Hibernate.initialize(user.getAssignedRestaurants());
            Hibernate.initialize(user.getRoles());
            return user;
        });

        restaurant = new Restaurant();
        restaurant.setName("Concurrencia Test");
        restaurant.setDefaultReservationDurationMinutes(90);
        restaurant = restaurantRepository.save(restaurant);

        table = new DiningTable();
        table.setRestaurant(restaurant);
        table.setTableNumber("C1");
        table.setCapacity(4);
        table = diningTableRepository.save(table);

        customerA = new Customer();
        customerA.setRestaurant(restaurant);
        customerA.setFirstName("Cliente");
        customerA.setLastName("A");
        customerA.setEmail("concurrencia.a@test.com");
        customerA = customerRepository.save(customerA);

        customerB = new Customer();
        customerB.setRestaurant(restaurant);
        customerB.setFirstName("Cliente");
        customerB.setLastName("B");
        customerB.setEmail("concurrencia.b@test.com");
        customerB = customerRepository.save(customerB);
    }

    @AfterEach
    void tearDown() {
        SecurityContextHolder.clearContext();
    }

    private void authenticateAsSuperAdmin() {
        UserPrincipal principal = new UserPrincipal(superAdmin);
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(
                new UsernamePasswordAuthenticationToken(principal, null, principal.getAuthorities()));
        SecurityContextHolder.setContext(context);
    }

    private ReservationRequest request(Customer customer) {
        ReservationRequest req = new ReservationRequest();
        req.setCustomerId(customer.getId());
        req.setRestaurantId(restaurant.getId());
        req.setDiningTableId(table.getId());
        req.setReservationDate(LocalDate.now().plusDays(1));
        req.setReservationTime(LocalTime.of(20, 0));
        req.setPartySize(2);
        return req;
    }

    @Test
    void soloUnaDeDosPeticionesConcurrentesReservaLaMismaMesaYFranja() throws Exception {
        ExecutorService executor = Executors.newFixedThreadPool(2);
        CountDownLatch startLatch = new CountDownLatch(1);

        Callable<Boolean> intentoA = () -> {
            authenticateAsSuperAdmin();
            startLatch.await();
            try {
                reservationService.create(request(customerA));
                return true;
            } catch (Exception e) {
                return false;
            } finally {
                SecurityContextHolder.clearContext();
            }
        };
        Callable<Boolean> intentoB = () -> {
            authenticateAsSuperAdmin();
            startLatch.await();
            try {
                reservationService.create(request(customerB));
                return true;
            } catch (Exception e) {
                return false;
            } finally {
                SecurityContextHolder.clearContext();
            }
        };

        Future<Boolean> futureA = executor.submit(intentoA);
        Future<Boolean> futureB = executor.submit(intentoB);
        startLatch.countDown();

        boolean exitoA = futureA.get(10, TimeUnit.SECONDS);
        boolean exitoB = futureB.get(10, TimeUnit.SECONDS);
        executor.shutdown();

        int totalExitos = (exitoA ? 1 : 0) + (exitoB ? 1 : 0);
        assertEquals(1, totalExitos, "Exactamente una de las dos peticiones concurrentes debe tener éxito");

        List<Reservation> reservasCreadas = reservationRepository.findByRestaurantIdAndDeletedFalse(restaurant.getId());
        assertEquals(1, reservasCreadas.size(), "Solo una de las dos peticiones concurrentes debe haber persistido una reserva");
    }
}
