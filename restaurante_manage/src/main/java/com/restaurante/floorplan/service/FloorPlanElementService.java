package com.restaurante.floorplan.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.floorplan.dto.FloorPlanElementMapper;
import com.restaurante.floorplan.dto.FloorPlanElementRequest;
import com.restaurante.floorplan.dto.FloorPlanElementResponse;
import com.restaurante.floorplan.entity.FloorPlanElement;
import com.restaurante.floorplan.repository.FloorPlanElementRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class FloorPlanElementService {

    private static final Logger log = LoggerFactory.getLogger(FloorPlanElementService.class);

    private final FloorPlanElementRepository floorPlanElementRepository;
    private final RestaurantRepository restaurantRepository;
    private final FloorPlanElementMapper floorPlanElementMapper;
    private final CurrentUserService currentUserService;

    public List<FloorPlanElementResponse> findByRestaurantId(Long restaurantId) {
        checkFloorPlanAccess(restaurantId, "LISTAR_ELEMENTOS_PLANO");
        return floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(restaurantId).stream()
                .map(floorPlanElementMapper::toResponse)
                .collect(Collectors.toList());
    }

    /**
     * Reemplaza el conjunto de elementos del plano de un restaurante (idempotente):
     * - Requests con id → actualizan el elemento existente.
     * - Requests sin id → crean un elemento nuevo.
     * - Elementos existentes no incluidos en el payload → soft delete.
     */
    @Transactional
    public List<FloorPlanElementResponse> replaceElements(
            Long restaurantId, List<FloorPlanElementRequest> requests) {

        log.info("[FloorPlan] Saving elements for restaurantId={}, elements received={}",
                restaurantId, requests != null ? requests.size() : 0);

        checkFloorPlanAccess(restaurantId, "GUARDAR_ELEMENTOS_PLANO");

        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        List<FloorPlanElementRequest> safeRequests = requests != null ? requests : List.of();

        // Validar campos obligatorios de cada elemento
        for (int i = 0; i < safeRequests.size(); i++) {
            FloorPlanElementRequest req = safeRequests.get(i);
            if (req.getType() == null || req.getXPosition() == null || req.getYPosition() == null) {
                throw new BadRequestException(
                        "El elemento " + i + " del plano es inválido: type, xPosition e yPosition son obligatorios.");
            }
        }

        List<FloorPlanElement> existing =
                floorPlanElementRepository.findByRestaurantIdAndDeletedFalse(restaurantId);
        Map<Long, FloorPlanElement> existingById = existing.stream()
                .collect(Collectors.toMap(FloorPlanElement::getId, e -> e));

        // Validar que los ids del payload pertenecen a este restaurante
        List<Long> invalidIds = safeRequests.stream()
                .map(FloorPlanElementRequest::getId)
                .filter(Objects::nonNull)
                .filter(id -> !existingById.containsKey(id))
                .collect(Collectors.toList());
        if (!invalidIds.isEmpty()) {
            throw new BadRequestException(
                    "Los siguientes elementos no pertenecen al restaurante " + restaurantId + ": " + invalidIds);
        }

        List<FloorPlanElement> toSave = new ArrayList<>();
        Set<Long> keptIds = new HashSet<>();

        for (FloorPlanElementRequest req : safeRequests) {
            FloorPlanElement element;
            if (req.getId() != null) {
                element = existingById.get(req.getId());
                keptIds.add(req.getId());
            } else {
                element = new FloorPlanElement();
                element.setRestaurant(restaurant);
            }
            element.setType(req.getType());
            element.setXPosition(req.getXPosition());
            element.setYPosition(req.getYPosition());
            element.setWidth(req.getWidth());
            element.setHeight(req.getHeight());
            element.setRotation(req.getRotation());
            toSave.add(element);
        }

        // Soft delete de los elementos existentes que no vienen en el payload
        for (FloorPlanElement element : existing) {
            if (!keptIds.contains(element.getId())) {
                element.setDeleted(true);
                element.setDeletedAt(LocalDateTime.now());
                toSave.add(element);
            }
        }

        floorPlanElementRepository.saveAll(toSave);

        log.info("[FloorPlan] Elements saved for restaurantId={}, alive={}, softDeleted={}",
                restaurantId, safeRequests.size(), toSave.size() - safeRequests.size());

        return toSave.stream()
                .filter(e -> !e.getDeleted())
                .map(floorPlanElementMapper::toResponse)
                .collect(Collectors.toList());
    }

    // Mismo patrón de validación centralizada que DiningTableService.checkTableAccess:
    // delega en CurrentUserService.canAccessRestaurant() y añade trazabilidad.
    private void checkFloorPlanAccess(Long restaurantId, String operation) {
        String username = currentUserService.getCurrentUsername();
        Set<String> roles = currentUserService.getCurrentRoles();
        Long tenantId = currentUserService.getCurrentTenantId();
        Set<Long> assignedIds = currentUserService.getAssignedRestaurantIds();

        Restaurant restaurant = restaurantRepository.findById(restaurantId).orElse(null);
        String restaurantName = restaurant != null ? restaurant.getName() : "DESCONOCIDO";

        boolean allowed = currentUserService.canAccessRestaurant(restaurantId);

        log.info("[FloorPlanAccess] user={} operation={} role={} tenant={} restaurantId={} restaurantName=\"{}\" assignedRestaurants={} result={}",
                username, operation, roles, tenantId, restaurantId, restaurantName, assignedIds,
                allowed ? "ALLOW" : "DENY");

        if (!allowed) {
            throw new AccessDeniedException("No tienes permiso para gestionar el plano de este restaurante.");
        }
    }
}
