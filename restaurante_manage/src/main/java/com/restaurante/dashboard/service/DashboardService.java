package com.restaurante.dashboard.service;

import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.dashboard.dto.DashboardSummary;
import com.restaurante.dashboard.dto.ReservationStats;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.employee.repository.EmployeeRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import static java.util.stream.Collectors.toSet;

@Service
@RequiredArgsConstructor
public class DashboardService {

    private final RestaurantRepository restaurantRepository;
    private final DiningTableRepository diningTableRepository;
    private final CustomerRepository customerRepository;
    private final EmployeeRepository employeeRepository;
    private final ReservationRepository reservationRepository;
    private final CurrentUserService currentUserService;

    public DashboardSummary getSummary() {
        // Obtener IDs de restaurantes visibles según rol y asignaciones
        List<Long> visibleIds = currentUserService.getVisibleRestaurantIds();

        // Si contiene -1L, sin acceso a ninguno
        if (visibleIds.size() == 1 && visibleIds.get(0) == -1L) {
            return DashboardSummary.builder()
                    .totalRestaurants(0).totalTables(0).totalCustomers(0).totalEmployees(0)
                    .totalReservations(0).pendingReservations(0).confirmedReservations(0)
                    .completedReservations(0).cancelledReservations(0).todayReservations(0)
                    .build();
        }

        Set<Long> restaurantIds;

        // Si hay IDs específicos, usar esos
        if (!visibleIds.isEmpty()) {
            restaurantIds = Set.copyOf(visibleIds);
        } else if (currentUserService.isSuperAdmin()) {
            // SUPER_ADMIN: no hay restricción, obtener todos
            long totalRestaurants = restaurantRepository.count();
            long totalTables = diningTableRepository.count();
            long totalCustomers = customerRepository.count();
            long totalEmployees = employeeRepository.count();
            long totalReservations = reservationRepository.count();
            long pendingReservations = reservationRepository.countByStatusAndDeletedFalse(ReservationStatus.PENDING);
            long confirmedReservations = reservationRepository.countByStatusAndDeletedFalse(ReservationStatus.CONFIRMED);
            long completedReservations = reservationRepository.countByStatusAndDeletedFalse(ReservationStatus.COMPLETED);
            long cancelledReservations = reservationRepository.countByStatusAndDeletedFalse(ReservationStatus.CANCELLED);

            return DashboardSummary.builder()
                    .totalRestaurants(totalRestaurants)
                    .totalTables(totalTables)
                    .totalCustomers(totalCustomers)
                    .totalEmployees(totalEmployees)
                    .totalReservations(totalReservations)
                    .pendingReservations(pendingReservations)
                    .confirmedReservations(confirmedReservations)
                    .completedReservations(completedReservations)
                    .cancelledReservations(cancelledReservations)
                    .todayReservations(0)
                    .build();
        } else {
            // ADMIN/MANAGER sin asignaciones: restaurantes del tenant
            Long tenantId = currentUserService.getCurrentTenantId();
            if (tenantId == null) {
                throw new IllegalStateException("El usuario autenticado no tiene tenant asociado");
            }
            restaurantIds = restaurantRepository.findByTenantIdAndDeletedFalse(tenantId)
                    .stream().map(Restaurant::getId).collect(toSet());
        }

        if (restaurantIds.isEmpty()) {
            return DashboardSummary.builder()
                    .totalRestaurants(0).totalTables(0).totalCustomers(0).totalEmployees(0)
                    .totalReservations(0).pendingReservations(0).confirmedReservations(0)
                    .completedReservations(0).cancelledReservations(0).todayReservations(0)
                    .build();
        }

        // Calcular estadísticas para los restaurantes visibles
        long totalRestaurants = restaurantIds.size();
        long totalTables = diningTableRepository.countByRestaurantIdInAndDeletedFalse(restaurantIds);
        long totalCustomers = customerRepository.findByRestaurantIdInAndDeletedFalse(restaurantIds).size();
        long totalEmployees = employeeRepository.findByRestaurantIdInAndDeletedFalse(restaurantIds).size();
        List<Reservation> allReservations = reservationRepository.findByRestaurantIdInAndDeletedFalse(restaurantIds);

        long totalReservations = allReservations.size();
        long pendingReservations = allReservations.stream()
                .filter(r -> r.getStatus() == ReservationStatus.PENDING).count();
        long confirmedReservations = allReservations.stream()
                .filter(r -> r.getStatus() == ReservationStatus.CONFIRMED).count();
        long completedReservations = allReservations.stream()
                .filter(r -> r.getStatus() == ReservationStatus.COMPLETED).count();
        long cancelledReservations = allReservations.stream()
                .filter(r -> r.getStatus() == ReservationStatus.CANCELLED).count();

        return DashboardSummary.builder()
                .totalRestaurants(totalRestaurants)
                .totalTables(totalTables)
                .totalCustomers(totalCustomers)
                .totalEmployees(totalEmployees)
                .totalReservations(totalReservations)
                .pendingReservations(pendingReservations)
                .confirmedReservations(confirmedReservations)
                .completedReservations(completedReservations)
                .cancelledReservations(cancelledReservations)
                .todayReservations(0)
                .build();
    }

    public List<ReservationStats> getReservationsByDay(LocalDate startDate, LocalDate endDate) {
        // Lógica pendiente de implementar
        return List.of();
    }

    public List<Object[]> getPopularTables(Long restaurantId) {
        currentUserService.validateRestaurantAccess(restaurantId);
        return reservationRepository.findPopularTables(restaurantId);
    }
}
