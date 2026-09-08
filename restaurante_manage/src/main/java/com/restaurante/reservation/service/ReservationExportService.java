package com.restaurante.reservation.service;

import com.restaurante.common.security.CurrentUserService;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.service.EntitlementService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;
import java.util.Set;

/**
 * Exportación de reservas a CSV. Es una funcionalidad del plan Pro.
 *
 * El filtrado por inquilino sigue siendo el de siempre
 * (CurrentUserService.getVisibleRestaurantIds): la comprobación de plan se suma a
 * la de aislamiento, no la sustituye.
 */
@Service
@RequiredArgsConstructor
public class ReservationExportService {

    private static final String CABECERA =
            "id,fecha,hora,cliente,telefono,personas,mesa,estado,restaurante";
    private static final DateTimeFormatter FECHA = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter HORA = DateTimeFormatter.ofPattern("HH:mm");

    private final ReservationRepository reservationRepository;
    private final CurrentUserService currentUserService;
    private final EntitlementService entitlementService;

    @Transactional(readOnly = true)
    public String exportToCsv(LocalDate desde, LocalDate hasta) {
        entitlementService.require(Feature.EXPORT_DATA);

        // Convenio de CurrentUserService.getVisibleRestaurantIds(): lista vacía
        // = "sin filtro de ID" (se filtra solo por tenant); [-1] = "no ve nada".
        List<Long> restaurantesVisibles = currentUserService.getVisibleRestaurantIds();
        if (restaurantesVisibles.size() == 1 && restaurantesVisibles.get(0) == -1L) {
            return CABECERA + "\n";
        }
        Long tenantId = currentUserService.getTenantIdForCurrentUser();
        Set<Long> filtroRestaurantes = restaurantesVisibles.isEmpty()
                ? null
                : Set.copyOf(restaurantesVisibles);

        List<Reservation> reservas = reservationRepository
                .findForExport(tenantId, filtroRestaurantes, desde, hasta);

        StringBuilder csv = new StringBuilder(CABECERA).append("\n");
        for (Reservation reserva : reservas) {
            csv.append(fila(reserva)).append("\n");
        }
        return csv.toString();
    }

    private String fila(Reservation reserva) {
        return String.join(",",
                String.valueOf(reserva.getId()),
                reserva.getReservationDate() != null
                        ? reserva.getReservationDate().format(FECHA) : "",
                reserva.getReservationTime() != null
                        ? reserva.getReservationTime().format(HORA) : "",
                escapar(reserva.getCustomer() != null
                        ? reserva.getCustomer().getFirstName() + " "
                          + reserva.getCustomer().getLastName() : ""),
                escapar(reserva.getCustomer() != null ? reserva.getCustomer().getPhone() : ""),
                String.valueOf(reserva.getPartySize()),
                escapar(reserva.getDiningTable() != null
                        ? reserva.getDiningTable().getTableNumber() : ""),
                reserva.getStatus() != null ? reserva.getStatus().name() : "",
                escapar(reserva.getRestaurant() != null ? reserva.getRestaurant().getName() : ""));
    }

    /**
     * Entrecomilla y neutraliza el valor. Además de las comas y comillas, se
     * antepone un apóstrofo a lo que empieza por =, +, - o @: sin eso, abrir el
     * CSV en Excel ejecutaría el contenido como fórmula (inyección CSV), y estos
     * campos los rellenan clientes finales desde la página pública.
     */
    private String escapar(String valor) {
        if (valor == null || valor.isBlank()) {
            return "";
        }
        String limpio = valor.replace("\"", "\"\"").replace("\n", " ").replace("\r", " ");
        if (limpio.startsWith("=") || limpio.startsWith("+")
                || limpio.startsWith("-") || limpio.startsWith("@")) {
            limpio = "'" + limpio;
        }
        return "\"" + limpio + "\"";
    }
}
