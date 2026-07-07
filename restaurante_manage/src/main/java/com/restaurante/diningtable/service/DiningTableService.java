package com.restaurante.diningtable.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.DuplicateResourceException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.diningtable.dto.DiningTableMapper;
import com.restaurante.diningtable.dto.DiningTableRequest;
import com.restaurante.diningtable.dto.DiningTableResponse;
import com.restaurante.diningtable.dto.TableLayoutRequest;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class DiningTableService {

    private static final Logger log = LoggerFactory.getLogger(DiningTableService.class);

    private final DiningTableRepository diningTableRepository;
    private final RestaurantRepository restaurantRepository;
    private final DiningTableMapper diningTableMapper;
    private final CurrentUserService currentUserService;

    public List<DiningTableResponse> findByRestaurantId(Long restaurantId) {
        checkTableAccess(restaurantId, "LISTAR_MESAS");
        return diningTableRepository.findByRestaurantIdAndDeletedFalse(restaurantId).stream()
                .map(diningTableMapper::toResponse)
                .collect(Collectors.toList());
    }

    public DiningTableResponse findById(Long id) {
        DiningTable table = diningTableRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", id));
        checkTableAccess(table.getRestaurant().getId(), "VER_MESA");
        return diningTableMapper.toResponse(table);
    }

    @Transactional
    public DiningTableResponse create(Long restaurantId, DiningTableRequest request) {
        checkTableAccess(restaurantId, "CREAR_MESA");
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        if (diningTableRepository.existsByRestaurantIdAndTableNumberAndDeletedFalse(restaurantId, request.getTableNumber())) {
            throw new DuplicateResourceException(
                    "Ya existe una mesa con el número '" + request.getTableNumber() + "' en este restaurante");
        }

        DiningTable table = diningTableMapper.toEntity(request);
        table.setRestaurant(restaurant);

        DiningTable saved = diningTableRepository.save(table);
        return diningTableMapper.toResponse(saved);
    }

    @Transactional
    public DiningTableResponse update(Long id, DiningTableRequest request) {
        DiningTable table = diningTableRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", id));
        checkTableAccess(table.getRestaurant().getId(), "ACTUALIZAR_MESA");

        diningTableMapper.updateEntity(table, request);
        DiningTable saved = diningTableRepository.save(table);
        return diningTableMapper.toResponse(saved);
    }

    @Transactional
    public DiningTableResponse updateStatus(Long id, String status) {
        DiningTable table = diningTableRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", id));
        checkTableAccess(table.getRestaurant().getId(), "CAMBIAR_ESTADO_MESA");

        try {
            table.setStatus(TableStatus.valueOf(status.toUpperCase()));
        } catch (IllegalArgumentException e) {
            throw new IllegalArgumentException("Estado inválido: " + status);
        }

        DiningTable saved = diningTableRepository.save(table);
        return diningTableMapper.toResponse(saved);
    }

    @Transactional
    public void delete(Long id) {
        DiningTable table = diningTableRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", id));
        checkTableAccess(table.getRestaurant().getId(), "ELIMINAR_MESA");
        table.setDeleted(true);
        table.setDeletedAt(LocalDateTime.now());
        diningTableRepository.save(table);
    }

    // ─── Gestión de layout (plano de sala) ──────────────────────────────

    /**
     * Actualiza las posiciones/visualización de todas las mesas del layout
     * de un restaurante a partir del payload enviado por el frontend.
     *
     * @param restaurantId ID del restaurante
     * @param requests     lista de posiciones de mesas
     * @return lista de mesas actualizadas
     */
    @Transactional
    public List<DiningTableResponse> updateRestaurantTablesLayout(
            Long restaurantId, List<TableLayoutRequest> requests) {

        log.info("[TableLayout] Saving layout for restaurantId={}, tables received={}",
                restaurantId, requests != null ? requests.size() : 0);

        // 1. Validar permiso de acceso
        checkTableAccess(restaurantId, "GUARDAR_LAYOUT");

        // 2. Validar que el restaurante existe
        restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        // 3. Si no hay mesas en el payload, devolver lista vacía (no es un error)
        if (requests == null || requests.isEmpty()) {
            log.warn("[TableLayout] Empty layout received for restaurantId={}", restaurantId);
            return List.of();
        }

        // 4. Validar que cada elemento tenga tableId no nulo
        for (int i = 0; i < requests.size(); i++) {
            if (requests.get(i).getTableId() == null) {
                throw new BadRequestException(
                        "El elemento " + i + " del layout no tiene tableId. Todos los elementos deben tener un tableId.");
            }
        }

        // 5. Extraer IDs de mesas del payload
        List<Long> requestedTableIds = requests.stream()
                .map(TableLayoutRequest::getTableId)
                .collect(Collectors.toList());

        // 4. Cargar las mesas del restaurante que coinciden con los IDs solicitados
        List<DiningTable> existingTables = diningTableRepository
                .findByRestaurantIdAndIdInAndDeletedFalse(restaurantId, requestedTableIds);

        // 6. Validar que todos los IDs pertenecen al restaurante
        Set<Long> existingIds = existingTables.stream()
                .map(DiningTable::getId)
                .collect(Collectors.toSet());

        List<Long> invalidIds = requestedTableIds.stream()
                .filter(id -> !existingIds.contains(id))
                .collect(Collectors.toList());

        if (!invalidIds.isEmpty()) {
            throw new BadRequestException(
                    "Las siguientes mesas no pertenecen al restaurante " + restaurantId + ": " + invalidIds);
        }

        // 7. Mapa para búsqueda rápida de mesas por ID
        Map<Long, DiningTable> tableMap = existingTables.stream()
                .collect(Collectors.toMap(DiningTable::getId, t -> t));

        // 8. Actualizar campos de layout
        for (TableLayoutRequest req : requests) {
            DiningTable table = tableMap.get(req.getTableId());
            if (table == null) {
                // No debería ocurrir porque ya validamos, pero por seguridad
                log.warn("[TableLayout] Table {} not found in map, skipping", req.getTableId());
                continue;
            }
            table.setXPosition(req.getXPosition());
            table.setYPosition(req.getYPosition());
            table.setWidth(req.getWidth());
            table.setHeight(req.getHeight());
            table.setShape(req.getShape());
            table.setRotation(req.getRotation());
        }

        // 9. Guardar todo en lote
        diningTableRepository.saveAll(existingTables);

        log.info("[TableLayout] Layout saved successfully for restaurantId={}, tables updated={}",
                restaurantId, existingTables.size());

        // 10. Devolver mesas actualizadas
        return existingTables.stream()
                .map(diningTableMapper::toResponse)
                .collect(Collectors.toList());
    }

    // ─── Validación centralizada con logs [TableAccess] ─────────────────────
    // Centraliza TODAS las comprobaciones de acceso a mesas en un solo punto.
    // No duplica lógica: delega en CurrentUserService.canAccessRestaurant()
    // pero añade trazabilidad específica para operaciones de mesas.
    //
    // Si en el futuro se añade un nuevo endpoint de mesas, SOLO hay que
    // llamar a este método. La regla de negocio se mantiene en un solo lugar.
    private void checkTableAccess(Long restaurantId, String operation) {
        String username = currentUserService.getCurrentUsername();
        Set<String> roles = currentUserService.getCurrentRoles();
        Long tenantId = currentUserService.getCurrentTenantId();
        Set<Long> assignedIds = currentUserService.getAssignedRestaurantIds();

        Restaurant restaurant = restaurantRepository.findById(restaurantId).orElse(null);
        String restaurantName = restaurant != null ? restaurant.getName() : "DESCONOCIDO";
        Long restaurantTenantId = restaurant != null && restaurant.getTenant() != null
                ? restaurant.getTenant().getId()
                : null;

        boolean allowed = currentUserService.canAccessRestaurant(restaurantId);

        log.info("[TableAccess] user={} operation={} role={} tenant={} restaurantId={} restaurantName=\"{}\" restaurantTenant={} assignedRestaurants={} result={}",
                username, operation, roles, tenantId, restaurantId, restaurantName, restaurantTenantId, assignedIds,
                allowed ? "ALLOW" : "DENY");

        if (!allowed) {
            throw new AccessDeniedException("No tienes permiso para gestionar las mesas de este restaurante.");
        }
    }
}
