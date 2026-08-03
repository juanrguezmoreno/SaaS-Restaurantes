package com.restaurante.availability.service;

import com.restaurante.availability.dto.AvailableTableResponse;
import com.restaurante.availability.dto.AvailabilityRequest;
import com.restaurante.availability.dto.TimeSlotResponse;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.serviceperiod.entity.ServicePeriod;
import com.restaurante.serviceperiod.repository.ServicePeriodRepository;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Optional;
import java.util.stream.Collectors;

/**
 * Autoridad única de disponibilidad de mesas: capacidad, mantenimiento y
 * solape de horario. Tanto el endpoint público de disponibilidad como
 * {@code ReservationService} (crear, editar, confirmar, reasignar) pasan
 * por aquí — ninguna otra clase reimplementa esta lógica.
 *
 * El solape se calcula por INTERVALO horario, no por igualdad exacta de
 * hora: cada reserva ocupa la mesa desde {@code reservationTime} durante
 * {@code Restaurant.defaultReservationDurationMinutes} minutos. Dos reservas
 * de la misma mesa solapan si sus intervalos [inicio, fin) se cruzan.
 * Una reserva con bloqueo provisional caducado deja de ocupar su mesa de
 * inmediato, sin depender de ningún job de limpieza.
 */
@Service
@Slf4j
public class AvailabilityService {

    private final DiningTableRepository diningTableRepository;
    private final ReservationRepository reservationRepository;
    private final RestaurantRepository restaurantRepository;
    private final ServicePeriodRepository servicePeriodRepository;
    private final int slotIntervalMinutes;
    private final LocalTime defaultOpeningTime;
    private final LocalTime defaultClosingTime;

    public AvailabilityService(
            DiningTableRepository diningTableRepository,
            ReservationRepository reservationRepository,
            RestaurantRepository restaurantRepository,
            ServicePeriodRepository servicePeriodRepository,
            @Value("${app.reservations.slot-interval-minutes:30}") int slotIntervalMinutes,
            @Value("${app.reservations.default-opening-time:12:00}") LocalTime defaultOpeningTime,
            @Value("${app.reservations.default-closing-time:23:00}") LocalTime defaultClosingTime) {
        this.diningTableRepository = diningTableRepository;
        this.reservationRepository = reservationRepository;
        this.restaurantRepository = restaurantRepository;
        this.servicePeriodRepository = servicePeriodRepository;
        this.slotIntervalMinutes = slotIntervalMinutes;
        this.defaultOpeningTime = defaultOpeningTime;
        this.defaultClosingTime = defaultClosingTime;
    }

    /**
     * Verifica disponibilidad real de mesas para una fecha y hora determinadas.
     * Las reservas CANCELLED, COMPLETED y NO_SHOW NO bloquean disponibilidad.
     */
    public List<AvailableTableResponse> checkAvailability(AvailabilityRequest request) {
        List<DiningTable> allTables = diningTableRepository
                .findByRestaurantIdAndDeletedFalse(request.getRestaurantId());

        log.debug("Verificando disponibilidad: restaurante={}, fecha={}, hora={}, comensales={}",
                request.getRestaurantId(), request.getDate(), request.getTime(), request.getPartySize());

        List<AvailableTableResponse> available = allTables.stream()
                .filter(table -> isTableAvailable(table, request.getDate(), request.getTime(),
                        request.getPartySize(), null))
                .map(table -> new AvailableTableResponse(
                        table.getId(), table.getTableNumber(), table.getCapacity(), table.getLocation()))
                .collect(Collectors.toList());

        log.info("Disponibilidad para restaurante {}: {} mesas disponibles de {}",
                request.getRestaurantId(), available.size(), allTables.size());

        return available;
    }

    /**
     * Rejilla de franjas horarias de un restaurante para una fecha y un número
     * de comensales.
     *
     * <p>Las franjas van desde la apertura, en saltos de
     * {@code app.reservations.slot-interval-minutes}, mientras la reserva completa
     * quepa antes del cierre. Si la fecha es hoy, las franjas ya pasadas se omiten
     * aquí: el frontend nunca decide qué horas mostrar.</p>
     *
     * <p>Una franja está disponible cuando existe al menos una mesa que la admita
     * según {@link #isTableAvailable}, es decir: capacidad suficiente, fuera de
     * mantenimiento y sin solape con ninguna reserva viva.</p>
     *
     * <p>Este método NO comprueba autorización. Cada controlador es responsable de
     * validar el acceso al restaurante antes de llamarlo.</p>
     */
    public List<TimeSlotResponse> getTimeSlots(Long restaurantId, LocalDate date, Integer partySize) {
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        List<LocalTime> horas = generarFranjas(restaurant, date);
        if (horas.isEmpty()) {
            log.debug("Sin franjas para restaurante {} el {}", restaurantId, date);
            return List.of();
        }

        List<DiningTable> mesas = diningTableRepository.findByRestaurantIdAndDeletedFalse(restaurantId);

        List<TimeSlotResponse> slots = horas.stream()
                .map(hora -> new TimeSlotResponse(hora, mesas.stream()
                        .anyMatch(mesa -> isTableAvailable(mesa, date, hora, partySize, null))))
                .toList();

        log.info("Rejilla para restaurante {} el {} ({} comensales): {} de {} franjas disponibles",
                restaurantId, date, partySize,
                slots.stream().filter(TimeSlotResponse::isAvailable).count(), slots.size());

        return slots;
    }

    /**
     * Horas candidatas de la rejilla para una fecha.
     *
     * <p>Si el restaurante tiene periodos de servicio configurados, las franjas
     * salen de los periodos de ese día de la semana. Un día sin periodos está
     * cerrado y no ofrece ninguna hora.</p>
     *
     * <p>Si no tiene ninguno en toda la semana, se mantiene el comportamiento
     * anterior: una única ventana apertura–cierre. Es el fallback que permite
     * que los restaurantes que aún no han configurado horarios sigan aceptando
     * reservas exactamente igual que antes.</p>
     */
    private List<LocalTime> generarFranjas(Restaurant restaurant, LocalDate date) {
        List<ServicePeriod> periodos =
                servicePeriodRepository.findByRestaurantIdAndDeletedFalse(restaurant.getId());

        if (periodos.isEmpty()) {
            return generarFranjasHorarioGeneral(restaurant, date);
        }

        List<ServicePeriod> delDia = periodos.stream()
                .filter(periodo -> periodo.getDayOfWeek() == date.getDayOfWeek())
                .sorted(Comparator.comparing(ServicePeriod::getStartTime))
                .toList();

        if (delDia.isEmpty()) {
            log.debug("Restaurante {} cerrado el {}: ese día no tiene periodos de servicio",
                    restaurant.getId(), date);
            return List.of();
        }

        int duracion = restaurant.getDefaultReservationDurationMinutes();
        boolean esHoy = date.equals(LocalDate.now());
        LocalTime ahora = LocalTime.now();

        List<LocalTime> horas = new ArrayList<>();
        for (ServicePeriod periodo : delDia) {
            acumularFranjas(horas, periodo.getStartTime(), periodo.getEndTime(), duracion, esHoy, ahora);
        }
        return horas;
    }

    /**
     * Fallback para restaurantes sin ningún periodo configurado: la ventana
     * única apertura–cierre de toda la vida.
     *
     * <p>Si el cierre no es posterior a la apertura, el restaurante cerraría
     * pasada la medianoche: no se generan franjas, porque una hora de madrugada
     * pertenecería al día siguiente y contradiría la fecha elegida en el
     * formulario. Queda documentado como fuera de alcance en el diseño.</p>
     */
    private List<LocalTime> generarFranjasHorarioGeneral(Restaurant restaurant, LocalDate date) {
        LocalTime apertura = restaurant.getOpeningTime() != null
                ? restaurant.getOpeningTime() : defaultOpeningTime;
        LocalTime cierre = restaurant.getClosingTime() != null
                ? restaurant.getClosingTime() : defaultClosingTime;

        if (!cierre.isAfter(apertura)) {
            log.debug("Restaurante {} cierra a las {} (no posterior a la apertura {}): sin franjas",
                    restaurant.getId(), cierre, apertura);
            return List.of();
        }

        List<LocalTime> horas = new ArrayList<>();
        acumularFranjas(horas, apertura, cierre, restaurant.getDefaultReservationDurationMinutes(),
                date.equals(LocalDate.now()), LocalTime.now());
        return horas;
    }

    /**
     * Añade a {@code destino} las franjas que caben enteras dentro de la ventana
     * [inicio, fin]: la última es aquella cuya hora más la duración de la
     * reserva no pasa del fin (límite inclusivo, una reserva puede terminar
     * justo al cerrar el servicio). Una reserva nunca se reparte entre dos
     * periodos.
     *
     * <p>Si la fecha es hoy, las franjas ya pasadas se omiten aquí: el frontend
     * nunca decide qué horas mostrar.</p>
     *
     * <p>El bucle trabaja en minutos desde medianoche (enteros), no sumando
     * directamente sobre {@link LocalTime}: {@code LocalTime.plusMinutes} da la
     * vuelta a medianoche sin avisar, y con una ventana que ocupe casi todo el
     * día esa vuelta hace que "hora + duración" nunca quede después del fin, así
     * que la condición de parada no se alcanzaría jamás. Comparando en minutos,
     * sin ese ciclo de 24 h, siempre se alcanza.</p>
     */
    private void acumularFranjas(List<LocalTime> destino, LocalTime inicio, LocalTime fin,
                                 int duracion, boolean esHoy, LocalTime ahora) {
        int minutoInicio = inicio.toSecondOfDay() / 60;
        int minutoFin = fin.toSecondOfDay() / 60;

        for (int minuto = minutoInicio; minuto + duracion <= minutoFin; minuto += slotIntervalMinutes) {
            LocalTime hora = LocalTime.MIDNIGHT.plusMinutes(minuto);
            if (esHoy && !hora.isAfter(ahora)) {
                continue;
            }
            destino.add(hora);
        }
    }

    /**
     * Verifica si una mesa está disponible para una reserva en una fecha/hora
     * concretas: capacidad suficiente, no está en MAINTENANCE, y no solapa con
     * ninguna otra reserva ACTIVA (PENDING/CONFIRMED) de esa mesa.
     * {@code excludeReservationId} ignora la propia reserva al editar/reconfirmar.
     */
    public boolean isTableAvailable(DiningTable table, LocalDate date, LocalTime time,
                                     Integer partySize, Long excludeReservationId) {
        if (partySize != null && table.getCapacity() < partySize) {
            log.debug("Mesa {} NO disponible: capacidad {} < comensales {}", table.getId(), table.getCapacity(), partySize);
            return false;
        }
        if (table.getStatus() == TableStatus.MAINTENANCE) {
            log.debug("Mesa {} NO disponible: está en MANTENIMIENTO", table.getId());
            return false;
        }
        return !hasOverlap(table, date, time, excludeReservationId);
    }

    /**
     * Lanza {@link ConflictException} (HTTP 409) si la mesa tiene una reserva
     * activa cuyo intervalo horario solapa con el solicitado. Adquiere un
     * bloqueo pesimista sobre la fila de la mesa ANTES de comprobar el solape,
     * para serializar dos transacciones que compitan por la misma mesa
     * (ver Task 4: se combina con aislamiento READ_COMMITTED en el llamador).
     */
    public void assertNoOverlap(DiningTable table, LocalDate date, LocalTime time, Long excludeReservationId) {
        DiningTable lockedTable = diningTableRepository.findByIdAndDeletedFalseForUpdate(table.getId())
                .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", table.getId()));

        if (hasOverlap(lockedTable, date, time, excludeReservationId)) {
            int duration = lockedTable.getRestaurant().getDefaultReservationDurationMinutes();
            throw new ConflictException("La mesa " + lockedTable.getTableNumber()
                    + " ya tiene una reserva que solapa con la franja de " + time + " a "
                    + time.plusMinutes(duration) + " el " + date + ".");
        }
    }

    /**
     * Busca la primera mesa del restaurante disponible para la fecha/hora/comensales
     * indicados. No adquiere bloqueo (solo escaneo de candidatas); el bloqueo se
     * adquiere después, cuando se llama a {@link #assertNoOverlap} sobre la mesa elegida.
     */
    public Optional<DiningTable> assignFirstAvailableTable(Restaurant restaurant, LocalDate date, LocalTime time,
                                                            Integer partySize, Long excludeReservationId) {
        return diningTableRepository.findByRestaurantIdAndDeletedFalse(restaurant.getId()).stream()
                .filter(t -> isTableAvailable(t, date, time, partySize, excludeReservationId))
                .findFirst();
    }

    /**
     * Retiene una mesa compatible para la franja solicitada, con bloqueo.
     *
     * <p>A diferencia de {@link #assignFirstAvailableTable}, que solo escanea, este
     * método deja la mesa efectivamente reservada dentro de la transacción del
     * llamante: recorre las candidatas <strong>ordenadas por id</strong> y sobre cada
     * una llama a {@link #assertNoOverlap}, que adquiere el bloqueo pesimista sobre
     * la fila antes de comprobar el solape. El orden determinista es lo que evita
     * interbloqueos: todas las transacciones piden los cerrojos en la misma
     * secuencia. Si otra transacción se lleva una candidata, se prueba la siguiente
     * en lugar de fallar.</p>
     *
     * <p>{@code assertNoOverlap} no abre transacción propia, así que capturar su
     * excepción aquí no marca la transacción como rollback-only.</p>
     *
     * @return la mesa retenida, o vacío si ninguna admite la franja
     */
    public Optional<DiningTable> holdFirstAvailableTable(Restaurant restaurant, LocalDate date,
                                                          LocalTime time, Integer partySize) {
        List<DiningTable> candidatas = diningTableRepository
                .findByRestaurantIdAndDeletedFalse(restaurant.getId()).stream()
                .filter(mesa -> isTableAvailable(mesa, date, time, partySize, null))
                .sorted(Comparator.comparing(DiningTable::getId))
                .toList();

        for (DiningTable candidata : candidatas) {
            try {
                assertNoOverlap(candidata, date, time, null);
                return Optional.of(candidata);
            } catch (ConflictException e) {
                log.debug("Mesa {} tomada por otra transacción, probando la siguiente", candidata.getId());
            }
        }
        return Optional.empty();
    }

    /**
     * Calcula si el intervalo [time, time+duración) de la mesa solicitada
     * solapa con el de alguna reserva activa existente. Se consultan las
     * reservas de esa mesa en el rango [fecha-1, fecha+1] (no solo el mismo
     * día) para detectar solapes que cruzan medianoche.
     */
    private boolean hasOverlap(DiningTable table, LocalDate date, LocalTime time, Long excludeReservationId) {
        int durationMinutes = table.getRestaurant().getDefaultReservationDurationMinutes();
        LocalDateTime start = LocalDateTime.of(date, time);
        LocalDateTime end = start.plusMinutes(durationMinutes);

        List<Reservation> candidatas = reservationRepository.findActiveByTableAndDateBetween(
                table.getId(), date.minusDays(1), date.plusDays(1), excludeReservationId);

        LocalDateTime ahora = LocalDateTime.now();
        for (Reservation candidata : candidatas) {
            // Un bloqueo provisional caducado ya no ocupa la mesa. Se filtra aquí
            // y no en el JPQL para no cambiar la firma del repositorio: hasOverlap
            // es el paso obligatorio de todo cálculo de ocupación (disponibilidad,
            // creación, edición y confirmación), así que basta con este punto.
            if (candidata.getHoldExpiresAt() != null
                    && !candidata.getHoldExpiresAt().isAfter(ahora)) {
                continue;
            }
            LocalDateTime otroInicio = LocalDateTime.of(candidata.getReservationDate(), candidata.getReservationTime());
            LocalDateTime otroFin = otroInicio.plusMinutes(durationMinutes);
            if (start.isBefore(otroFin) && otroInicio.isBefore(end)) {
                return true;
            }
        }
        return false;
    }
}
