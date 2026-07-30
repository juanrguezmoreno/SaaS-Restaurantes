package com.restaurante.reservation.service;

import com.restaurante.availability.service.AvailabilityService;
import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.notification.event.ReservationCancelledEvent;
import com.restaurante.notification.event.ReservationConfirmedEvent;
import com.restaurante.notification.event.ReservationEmailData;
import com.restaurante.reservation.dto.ReservationMapper;
import com.restaurante.reservation.dto.ReservationRequest;
import com.restaurante.reservation.dto.ReservationResponse;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
@Slf4j
public class ReservationService {

    private final ReservationRepository reservationRepository;
    private final CustomerRepository customerRepository;
    private final RestaurantRepository restaurantRepository;
    private final DiningTableRepository diningTableRepository;
    private final ReservationMapper reservationMapper;
    private final CurrentUserService currentUserService;
    private final ApplicationEventPublisher eventPublisher;
    private final AvailabilityService availabilityService;

    /**
     * Matriz explícita de transiciones de estado permitidas. CANCELLED,
     * COMPLETED y NO_SHOW son estados finales: no admiten transiciones salientes.
     * Una transición al mismo estado (idempotente) se permite siempre y no
     * pasa por esta matriz (ver {@code updateStatus}).
     */
    private static final Map<ReservationStatus, Set<ReservationStatus>> ALLOWED_TRANSITIONS = Map.of(
            ReservationStatus.PENDING, Set.of(ReservationStatus.CONFIRMED, ReservationStatus.CANCELLED),
            ReservationStatus.CONFIRMED, Set.of(ReservationStatus.CANCELLED, ReservationStatus.COMPLETED, ReservationStatus.NO_SHOW),
            ReservationStatus.CANCELLED, Set.of(),
            ReservationStatus.COMPLETED, Set.of(),
            ReservationStatus.NO_SHOW, Set.of()
    );

    public Page<ReservationResponse> findAll(Pageable pageable) {
        log.debug("findAll() llamado con pageable: page={}, size={}, sort={}",
                pageable.getPageNumber(), pageable.getPageSize(), pageable.getSort());

        // Obtener IDs de restaurantes visibles según rol y asignaciones
        List<Long> visibleIds = currentUserService.getVisibleRestaurantIds();

        // Si la lista contiene -1L, significa "sin acceso a ninguno"
        if (visibleIds.size() == 1 && visibleIds.get(0) == -1L) {
            log.debug("findAll() usuario sin acceso a ningún restaurante");
            return Page.empty();
        }

        // Si la lista NO está vacía, filtrar solo esos restaurantes
        if (!visibleIds.isEmpty()) {
            Page<ReservationResponse> result = reservationRepository
                    .findByRestaurantIdInAndDeletedFalse(Set.copyOf(visibleIds), pageable)
                    .map(reservationMapper::toResponse);
            log.debug("findAll() filtrado por {} restaurante(s): {} reservas", visibleIds.size(), result.getTotalElements());
            return result;
        }

        // Lista vacía = "sin filtro de ID" → aplicar filtro por rol/tenant

        // SUPER_ADMIN: ve todas las reservas
        if (currentUserService.isSuperAdmin()) {
            Page<ReservationResponse> result = reservationRepository.findAllByDeletedFalse(pageable)
                    .map(reservationMapper::toResponse);
            log.debug("findAll() SUPER_ADMIN: {} reservas encontradas", result.getTotalElements());
            return result;
        }

        // ADMIN/MANAGER (sin asignaciones): filtra por restaurantes del tenant
        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId != null) {
            List<Restaurant> tenantRestaurants = restaurantRepository.findByTenantIdAndDeletedFalse(tenantId);
            if (tenantRestaurants.isEmpty()) {
                log.debug("findAll() tenant {} no tiene restaurantes", tenantId);
                return Page.empty();
            }
            Set<Long> restaurantIds = tenantRestaurants.stream()
                    .map(Restaurant::getId)
                    .collect(Collectors.toSet());

            Page<ReservationResponse> result = reservationRepository
                    .findByRestaurantIdInAndDeletedFalse(restaurantIds, pageable)
                    .map(reservationMapper::toResponse);
            log.debug("findAll() tenant {}: {} reservas encontradas (paginado en DB)", tenantId, result.getTotalElements());
            return result;
        }

        // Fallback: usuario con restaurante asignado directamente
        Long restaurantId = currentUserService.getCurrentRestaurantId();
        if (restaurantId != null) {
            Page<ReservationResponse> result = reservationRepository.findByRestaurantIdAndDeletedFalse(restaurantId, pageable)
                    .map(reservationMapper::toResponse);
            log.debug("findAll() restaurant {}: {} reservas encontradas", restaurantId, result.getTotalElements());
            return result;
        }

        log.debug("findAll() sin tenant ni restaurant — página vacía");
        return Page.empty();
    }

    public ReservationResponse findById(Long id) {
        Reservation reservation = reservationRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Reserva", "id", id));
        currentUserService.validateRestaurantAccess(reservation.getRestaurant().getId());
        return reservationMapper.toResponse(reservation);
    }

    public List<ReservationResponse> findByCustomerId(Long customerId) {
        List<Reservation> reservations = reservationRepository.findByCustomerIdAndDeletedFalse(customerId);

        // Obtener IDs de restaurantes visibles
        List<Long> visibleIds = currentUserService.getVisibleRestaurantIds();

        // Si contiene -1L, sin acceso a ninguno
        if (visibleIds.size() == 1 && visibleIds.get(0) == -1L) {
            return List.of();
        }

        // Si hay IDs específicos, filtrar por ellos
        if (!visibleIds.isEmpty()) {
            Set<Long> visibleSet = Set.copyOf(visibleIds);
            return reservations.stream()
                    .filter(r -> visibleSet.contains(r.getRestaurant().getId()))
                    .map(reservationMapper::toResponse)
                    .collect(Collectors.toList());
        }

        // SUPER_ADMIN: puede ver todas
        if (currentUserService.isSuperAdmin()) {
            return reservations.stream()
                    .map(reservationMapper::toResponse)
                    .collect(Collectors.toList());
        }

        // ADMIN/MANAGER sin asignaciones: filtrar por restaurantes del tenant
        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId != null) {
            Set<Long> tenantRestaurantIds = restaurantRepository.findByTenantIdAndDeletedFalse(tenantId)
                    .stream().map(Restaurant::getId).collect(Collectors.toSet());
            return reservations.stream()
                    .filter(r -> tenantRestaurantIds.contains(r.getRestaurant().getId()))
                    .map(reservationMapper::toResponse)
                    .collect(Collectors.toList());
        }

        // Fallback: restaurante asignado directamente
        Long restaurantId = currentUserService.getCurrentRestaurantId();
        if (restaurantId != null) {
            return reservations.stream()
                    .filter(r -> r.getRestaurant().getId().equals(restaurantId))
                    .map(reservationMapper::toResponse)
                    .collect(Collectors.toList());
        }

        return List.of();
    }

    public List<ReservationResponse> findByRestaurantId(Long restaurantId) {
        currentUserService.validateRestaurantAccess(restaurantId);
        return reservationRepository.findByRestaurantIdAndDeletedFalse(restaurantId).stream()
                .map(reservationMapper::toResponse)
                .collect(Collectors.toList());
    }

    public List<ReservationResponse> findByRestaurantIdAndDate(Long restaurantId, LocalDate date) {
        currentUserService.validateRestaurantAccess(restaurantId);
        return reservationRepository.findByRestaurantIdAndReservationDateAndDeletedFalse(restaurantId, date).stream()
                .map(reservationMapper::toResponse)
                .collect(Collectors.toList());
    }

    // ════════════════════════════════════════════════════════════════
    //  CREACIÓN
    // ════════════════════════════════════════════════════════════════

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReservationResponse create(ReservationRequest request) {
        // Usar el restaurantId del usuario autenticado si no se especifica
        Long requestRestaurantId = request.getRestaurantId();
        final Long resolvedRestaurantId = requestRestaurantId != null
                ? requestRestaurantId
                : currentUserService.getCurrentRestaurantId();
        if (resolvedRestaurantId == null) {
            throw new BadRequestException("restaurantId es obligatorio");
        }
        currentUserService.validateRestaurantAccess(resolvedRestaurantId);

        Customer customer = customerRepository.findByIdAndDeletedFalse(request.getCustomerId())
                .orElseThrow(() -> new ResourceNotFoundException("Cliente", "id", request.getCustomerId()));

        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(resolvedRestaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", resolvedRestaurantId));

        if (!customer.getRestaurant().getId().equals(resolvedRestaurantId)) {
            throw new BadRequestException("El cliente indicado no pertenece al restaurante de la reserva");
        }

        Reservation reservation = reservationMapper.toEntity(request);
        reservation.setCustomer(customer);
        reservation.setRestaurant(restaurant);

        // Comparar como LocalDateTime (no fecha y hora por separado): comparar
        // solo reservationTime contra LocalTime.now() se rompe cerca de
        // medianoche (p.ej. minusHours(1) a las 00:08 "envuelve" a las 23:08,
        // que parece futura aunque la intención sea "hace una hora").
        if (LocalDateTime.of(reservation.getReservationDate(), reservation.getReservationTime())
                .isBefore(LocalDateTime.now())) {
            throw new BadRequestException("La hora de la reserva ya ha pasado para el día de hoy.");
        }

        // Determinar el estado final de la reserva
        ReservationStatus finalStatus = reservation.getStatus(); // ya se mapeó desde el request o PENDING por defecto

        // Asignar mesa si se proporcionó
        DiningTable table = null;
        if (request.getDiningTableId() != null) {
            table = diningTableRepository.findByIdAndDeletedFalse(request.getDiningTableId())
                    .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", request.getDiningTableId()));

            if (!table.getRestaurant().getId().equals(resolvedRestaurantId)) {
                throw new BadRequestException(
                        "La mesa " + table.getTableNumber() + " no pertenece al restaurante indicado");
            }

            if (table.getCapacity() < reservation.getPartySize()) {
                throw new BadRequestException(
                        "La mesa " + table.getTableNumber() + " tiene capacidad para " + table.getCapacity()
                                + " personas, pero la reserva es para " + reservation.getPartySize() + ".");
            }

            // RES-03: el conflicto de hueco (409) tiene prioridad sobre el chequeo
            // de disponibilidad (400) para que un solape devuelva siempre Conflict.
            availabilityService.assertNoOverlap(table, reservation.getReservationDate(), reservation.getReservationTime(), null);

            // Si la reserva se crea como CONFIRMED, verificar disponibilidad y marcar mesa como RESERVED
            if (finalStatus == ReservationStatus.CONFIRMED) {
                if (!availabilityService.isTableAvailable(table, reservation.getReservationDate(),
                        reservation.getReservationTime(), reservation.getPartySize(), null)) {
                    throw new BadRequestException(
                            "La mesa " + table.getTableNumber() + " no está disponible para la fecha y hora solicitadas");
                }
                table.setStatus(TableStatus.RESERVED);
                diningTableRepository.save(table);
                log.info("Mesa {} marcada como RESERVED al crear reserva CONFIRMED (nueva)", table.getId());
            }
            // Si la reserva es PENDING, NO cambiamos el estado de la mesa bajo ninguna circunstancia
        } else if (finalStatus == ReservationStatus.CONFIRMED) {
            // No se proporcionó mesa pero la reserva es CONFIRMED → auto-asignar
            table = availabilityService.assignFirstAvailableTable(restaurant, reservation.getReservationDate(),
                    reservation.getReservationTime(), reservation.getPartySize(), null).orElse(null);
            if (table == null) {
                throw new BadRequestException(
                        "No hay mesas disponibles para la fecha, hora y número de comensales solicitados. " +
                        "Asigna una mesa manualmente o cambia el estado a PENDING.");
            }
            table.setStatus(TableStatus.RESERVED);
            diningTableRepository.save(table);
            log.info("Mesa {} auto-asignada a reserva CONFIRMED (nueva)", table.getId());
        }

        if (table != null) {
            // RES-03: impedir dos reservas activas (PENDING/CONFIRMED) en la misma mesa/fecha/hora.
            availabilityService.assertNoOverlap(table, reservation.getReservationDate(), reservation.getReservationTime(), null);
            reservation.setDiningTable(table);
        }

        Reservation saved = reservationRepository.save(reservation);
        log.info("Reserva creada: id={}, estado={}, mesa={}", saved.getId(), saved.getStatus(),
                saved.getDiningTable() != null ? saved.getDiningTable().getId() : "sin-mesa");

        if (saved.getStatus() == ReservationStatus.CONFIRMED) {
            eventPublisher.publishEvent(new ReservationConfirmedEvent(ReservationEmailData.from(saved)));
        }

        return reservationMapper.toResponse(saved);
    }

    // ════════════════════════════════════════════════════════════════
    //  ACTUALIZACIÓN
    // ════════════════════════════════════════════════════════════════

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReservationResponse update(Long id, ReservationRequest request) {
        Reservation reservation = reservationRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Reserva", "id", id));
        currentUserService.validateRestaurantAccess(reservation.getRestaurant().getId());

        if (request.getCustomerId() != null && !request.getCustomerId().equals(reservation.getCustomer().getId())) {
            Customer customer = customerRepository.findByIdAndDeletedFalse(request.getCustomerId())
                    .orElseThrow(() -> new ResourceNotFoundException("Cliente", "id", request.getCustomerId()));
            if (!customer.getRestaurant().getId().equals(reservation.getRestaurant().getId())) {
                throw new BadRequestException("El cliente indicado no pertenece al restaurante de la reserva");
            }
            reservation.setCustomer(customer);
        }

        // Manejar cambio de mesa
        if (request.getDiningTableId() != null) {
            DiningTable table = diningTableRepository.findByIdAndDeletedFalse(request.getDiningTableId())
                    .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", request.getDiningTableId()));

            if (!table.getRestaurant().getId().equals(reservation.getRestaurant().getId())) {
                throw new BadRequestException(
                        "La mesa " + table.getTableNumber() + " no pertenece al restaurante de la reserva");
            }

            // El partySize del request es el que prevalecerá tras reservationMapper.updateEntity(),
            // así que la capacidad se valida contra ese valor y no contra el de la entidad aún sin actualizar.
            Integer nuevoPartySize = request.getPartySize() != null ? request.getPartySize() : reservation.getPartySize();
            if (table.getCapacity() < nuevoPartySize) {
                throw new BadRequestException(
                        "La mesa " + table.getTableNumber() + " tiene capacidad para " + table.getCapacity()
                                + " personas, pero la reserva es para " + nuevoPartySize + ".");
            }

            // Si la reserva está CONFIRMED, actualizar estado de mesas
            if (reservation.getStatus() == ReservationStatus.CONFIRMED) {
                // Verificar disponibilidad de la nueva mesa
                if (!availabilityService.isTableAvailable(table, reservation.getReservationDate(),
                        reservation.getReservationTime(), reservation.getPartySize(), reservation.getId())) {
                    throw new BadRequestException(
                            "La mesa " + table.getTableNumber() + " no está disponible para la fecha y hora solicitadas");
                }
                // Liberar mesa anterior si existe
                if (reservation.getDiningTable() != null) {
                    releaseTableIfNoActiveConfirmedReservations(reservation.getDiningTable().getId());
                }
                // Marcar nueva mesa como RESERVED
                table.setStatus(TableStatus.RESERVED);
                diningTableRepository.save(table);
            }
            // Si la reserva es PENDING y se asigna mesa, NO cambiar el estado de la mesa
            reservation.setDiningTable(table);
        } else {
            // Si se elimina la mesa de una reserva CONFIRMED, liberarla
            if (reservation.getStatus() == ReservationStatus.CONFIRMED && reservation.getDiningTable() != null) {
                releaseTableIfNoActiveConfirmedReservations(reservation.getDiningTable().getId());
            }
            reservation.setDiningTable(null);
        }

        reservationMapper.updateEntity(reservation, request);

        // RES-03: validar solape con el estado final (fecha/hora/mesa ya actualizadas),
        // excluyendo la propia reserva.
        if (reservation.getDiningTable() != null) {
            availabilityService.assertNoOverlap(reservation.getDiningTable(), reservation.getReservationDate(),
                    reservation.getReservationTime(), reservation.getId());
        }

        Reservation saved = reservationRepository.save(reservation);
        return reservationMapper.toResponse(saved);
    }

    // ════════════════════════════════════════════════════════════════
    //  CAMBIO DE ESTADO (CORAZÓN DE LA LÓGICA DE NEGOCIO)
    // ════════════════════════════════════════════════════════════════

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ReservationResponse updateStatus(Long id, String status) {
        Reservation reservation = reservationRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Reserva", "id", id));
        currentUserService.validateRestaurantAccess(reservation.getRestaurant().getId());

        ReservationStatus newStatus;
        try {
            newStatus = ReservationStatus.valueOf(status.toUpperCase());
        } catch (IllegalArgumentException e) {
            throw new BadRequestException("Estado inválido: " + status);
        }

        ReservationStatus oldStatus = reservation.getStatus();
        log.debug("Cambiando estado de reserva #{}: {} → {}", id, oldStatus, newStatus);

        // Matriz de transiciones: CANCELLED/COMPLETED/NO_SHOW son estados
        // finales; una transición al mismo estado (idempotente) siempre se permite.
        if (oldStatus != newStatus
                && !ALLOWED_TRANSITIONS.getOrDefault(oldStatus, Set.of()).contains(newStatus)) {
            throw new BadRequestException(
                    "Transición de estado no permitida: " + oldStatus + " → " + newStatus);
        }

        // ─── Transición a CONFIRMED ─────────────────────────────────
        // NOTA: la verificación de disponibilidad excluye esta misma reserva
        // (excludeReservationId) para no detectarla como auto-conflicto.
        if (newStatus == ReservationStatus.CONFIRMED) {
            DiningTable table = reservation.getDiningTable();

            // Si no tiene mesa asignada, intentar auto-asignar una disponible
            if (table == null) {
                table = availabilityService.assignFirstAvailableTable(reservation.getRestaurant(),
                        reservation.getReservationDate(), reservation.getReservationTime(),
                        reservation.getPartySize(), reservation.getId()).orElse(null);
                if (table == null) {
                    throw new BadRequestException(
                            "No hay mesas disponibles para la fecha, hora y número de comensales solicitados. " +
                            "Asigna una mesa manualmente o contacta al administrador.");
                }
                reservation.setDiningTable(table);
                log.info("Mesa {} auto-asignada a la reserva #{}", table.getId(), id);
            } else {
                // Tiene mesa asignada → verificar que sigue disponible
                if (!availabilityService.isTableAvailable(table, reservation.getReservationDate(),
                        reservation.getReservationTime(), reservation.getPartySize(), reservation.getId())) {
                    // Intentar re-asignar otra mesa
                    DiningTable alternativeTable = availabilityService.assignFirstAvailableTable(reservation.getRestaurant(),
                            reservation.getReservationDate(), reservation.getReservationTime(),
                            reservation.getPartySize(), reservation.getId()).orElse(null);
                    if (alternativeTable != null) {
                        reservation.setDiningTable(alternativeTable);
                        table = alternativeTable;
                        log.info("Mesa re-asignada a {} para reserva #{} (anterior ya no disponible)", table.getId(), id);
                    } else {
                        throw new BadRequestException(
                                "La mesa " + table.getTableNumber() + " ya no está disponible y no hay mesas alternativas libres.");
                    }
                }
            }

            // RES-03: guarda final antes de confirmar — ninguna otra reserva activa
            // (PENDING o CONFIRMED) puede ocupar ya esa mesa en esa fecha/hora.
            availabilityService.assertNoOverlap(table, reservation.getReservationDate(),
                    reservation.getReservationTime(), reservation.getId());

            // Marcar la mesa como RESERVED
            table.setStatus(TableStatus.RESERVED);
            diningTableRepository.save(table);
            log.info("Mesa {} marcada como RESERVED al confirmar reserva #{}", table.getId(), id);

            // El bloqueo provisional deja de tener sentido: la mesa pasa a estar
            // ocupada en firme.
            reservation.setHoldExpiresAt(null);

            eventPublisher.publishEvent(new ReservationConfirmedEvent(ReservationEmailData.from(reservation)));
        }

        // ─── Transición a CANCELLED ────────────────────────────────
        if (newStatus == ReservationStatus.CANCELLED) {
            reservation.setHoldExpiresAt(null);

            // Snapshot ANTES de desasignar la mesa: el listener corre
            // post-commit con la sesión de Hibernate cerrada.
            // Solo publicar si no estaba ya CANCELLED, para evitar un
            // segundo email de cancelación (idempotencia de la notificación).
            if (oldStatus != ReservationStatus.CANCELLED) {
                eventPublisher.publishEvent(new ReservationCancelledEvent(ReservationEmailData.from(reservation)));
            }

            // Cambiar estado ANTES de liberar para que la consulta
            // findActiveConfirmedByTableId NO encuentre esta reserva
            if (reservation.getDiningTable() != null) {
                reservation.setStatus(newStatus);
                releaseTableIfNoActiveConfirmedReservations(reservation.getDiningTable().getId());
                reservation.setDiningTable(null);
                log.info("Mesa liberada al cancelar reserva #{}", id);
            }
        }

        // ─── Transición a COMPLETED o NO_SHOW ──────────────────────
        else if (newStatus == ReservationStatus.COMPLETED || newStatus == ReservationStatus.NO_SHOW) {
            reservation.setHoldExpiresAt(null);

            // Cambiar estado ANTES de liberar para que la consulta
            // findActiveConfirmedByTableId NO encuentre esta reserva
            if (reservation.getDiningTable() != null) {
                reservation.setStatus(newStatus);
                releaseTableIfNoActiveConfirmedReservations(reservation.getDiningTable().getId());
                reservation.setDiningTable(null);
                log.info("Mesa liberada al pasar reserva #{} a {}", id, newStatus);
            }
        }

        // Para PENDING o cualquier otro estado, no hay efectos secundarios en mesas

        reservation.setStatus(newStatus);
        Reservation saved = reservationRepository.save(reservation);
        log.info("Estado de reserva #{} actualizado a {}", saved.getId(), saved.getStatus());

        return reservationMapper.toResponse(saved);
    }

    // ════════════════════════════════════════════════════════════════
    //  ELIMINACIÓN (soft delete)
    // ════════════════════════════════════════════════════════════════

    @Transactional
    public void delete(Long id) {
        Reservation reservation = reservationRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Reserva", "id", id));
        currentUserService.validateRestaurantAccess(reservation.getRestaurant().getId());

        // Liberar mesa si estaba asignada y la reserva no estaba ya cancelada/completada
        if (reservation.getDiningTable() != null
                && reservation.getStatus() != ReservationStatus.CANCELLED
                && reservation.getStatus() != ReservationStatus.COMPLETED) {
            releaseTableIfNoActiveConfirmedReservations(reservation.getDiningTable().getId());
            log.info("Mesa liberada al eliminar reserva #{}", id);
        }

        reservation.setDeleted(true);
        reservation.setDeletedAt(java.time.LocalDateTime.now());
        reservationRepository.save(reservation);
    }

    // ════════════════════════════════════════════════════════════════
    //  HELPER: Liberar mesa si no tiene reservas CONFIRMED activas
    // ════════════════════════════════════════════════════════════════

    /**
     * Verifica si una mesa tiene reservas CONFIRMED activas o futuras.
     * Si NO tiene ninguna, cambia su estado a AVAILABLE.
     */
    private void releaseTableIfNoActiveConfirmedReservations(Long tableId) {
        DiningTable table = diningTableRepository.findByIdAndDeletedFalse(tableId)
                .orElse(null);
        if (table == null) {
            log.warn("No se encontró la mesa {} para liberar", tableId);
            return;
        }

        LocalDate today = LocalDate.now();
        LocalTime now = LocalTime.now();

        List<Reservation> activeConfirmed = reservationRepository
                .findActiveConfirmedByTableId(tableId, today, now);

        if (activeConfirmed.isEmpty()) {
            table.setStatus(TableStatus.AVAILABLE);
            diningTableRepository.save(table);
            log.info("Mesa {} liberada a AVAILABLE — no hay reservas CONFIRMED activas/futuras", tableId);
        } else {
            log.debug("Mesa {} NO se libera — tiene {} reserva(s) CONFIRMED activa(s)", tableId, activeConfirmed.size());
        }
    }

    // ════════════════════════════════════════════════════════════════
    //  MANTENIMIENTO: Corregir estados de mesas
    // ════════════════════════════════════════════════════════════════

    /**
     * Recalcula los estados de las mesas.
     * Si una mesa está RESERVED pero no tiene ninguna reserva CONFIRMED activa/futura,
     * la cambia a AVAILABLE.
     *
     * @param restaurantId ID del restaurante (opcional, si es null revisa todos)
     * @return número de mesas corregidas
     */
    @Transactional
    public int fixTableStatuses(Long restaurantId) {
        List<DiningTable> reservedTables;
        if (restaurantId != null) {
            currentUserService.validateRestaurantAccess(restaurantId);
            reservedTables = diningTableRepository
                    .findByRestaurantIdAndStatusAndDeletedFalse(restaurantId, TableStatus.RESERVED);
        } else {
            // P0-4: la ejecución global (sin restaurantId) solo es legítima para el job de
            // mantenimiento (sin usuario autenticado) o un SUPER_ADMIN. Un usuario tenant-scoped
            // NO puede convertir la ausencia de restaurantId en una operación sobre otros tenants.
            if (currentUserService.getCurrentPrincipal() != null && !currentUserService.isSuperAdmin()) {
                throw new AccessDeniedException(
                        "Debe especificar restaurantId; solo un SUPER_ADMIN puede ejecutar el mantenimiento global.");
            }
            reservedTables = diningTableRepository
                    .findByStatusAndDeletedFalse(TableStatus.RESERVED);
        }

        int fixedCount = 0;
        LocalDate today = LocalDate.now();
        LocalTime now = LocalTime.now();

        for (DiningTable table : reservedTables) {
            List<Reservation> activeConfirmed = reservationRepository
                    .findActiveConfirmedByTableId(table.getId(), today, now);

            if (activeConfirmed.isEmpty()) {
                table.setStatus(TableStatus.AVAILABLE);
                diningTableRepository.save(table);
                fixedCount++;
                log.info("[MANTENIMIENTO] Mesa {} corregida a AVAILABLE", table.getId());
            }
        }

        log.info("[MANTENIMIENTO] Revisión completada: {} mesas corregidas de {} revisadas",
                fixedCount, reservedTables.size());
        return fixedCount;
    }

    // ════════════════════════════════════════════════════════════════
    //  MANTENIMIENTO: Liberar bloqueos provisionales caducados
    // ════════════════════════════════════════════════════════════════

    /**
     * Suelta la mesa de las solicitudes públicas cuyo bloqueo provisional ha
     * caducado, conservando {@code holdExpiresAt} como marca de "pendiente sin
     * bloqueo" y la solicitud en PENDING para que el restaurante pueda
     * gestionarla. Solo es higiene de datos: la disponibilidad ya deja de
     * contarlas en cuanto vence la caducidad.
     *
     * @return número de bloqueos liberados
     */
    @Transactional
    public int releaseExpiredHolds() {
        List<Reservation> caducadas = reservationRepository.findExpiredHolds(LocalDateTime.now());
        for (Reservation reserva : caducadas) {
            Long tableId = reserva.getDiningTable().getId();
            reserva.setDiningTable(null);
            reservationRepository.save(reserva);
            releaseTableIfNoActiveConfirmedReservations(tableId);
            log.info("Bloqueo provisional caducado en la reserva #{}: mesa {} liberada",
                    reserva.getId(), tableId);
        }
        return caducadas.size();
    }

    // ════════════════════════════════════════════════════════════════
    //  HELPERS NULL-SAFE para ordenamiento
    // ════════════════════════════════════════════════════════════════

    /**
     * Compara dos LocalDate en orden DESCENDENTE, tratando nulls como "menor que todo".
     * @return negativo si a < b, positivo si a > b, 0 si son iguales
     */
    private int compareDatesDesc(LocalDate a, LocalDate b) {
        if (a == null && b == null) return 0;
        if (a == null) return -1;  // null va al final en DESC
        if (b == null) return 1;
        return a.compareTo(b);
    }

    /**
     * Compara dos LocalTime en orden DESCENDENTE, tratando nulls como "menor que todo".
     * @return negativo si a < b, positivo si a > b, 0 si son iguales
     */
    private int compareTimesDesc(LocalTime a, LocalTime b) {
        if (a == null && b == null) return 0;
        if (a == null) return -1;  // null va al final en DESC
        if (b == null) return 1;
        return a.compareTo(b);
    }
}
