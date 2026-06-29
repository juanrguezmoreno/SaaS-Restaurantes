package com.restaurante.diningtable.service;

import com.restaurante.common.exception.DuplicateResourceException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.diningtable.dto.DiningTableMapper;
import com.restaurante.diningtable.dto.DiningTableRequest;
import com.restaurante.diningtable.dto.DiningTableResponse;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class DiningTableService {

    private final DiningTableRepository diningTableRepository;
    private final RestaurantRepository restaurantRepository;
    private final DiningTableMapper diningTableMapper;
    private final CurrentUserService currentUserService;

    public List<DiningTableResponse> findByRestaurantId(Long restaurantId) {
        currentUserService.validateRestaurantAccess(restaurantId);
        return diningTableRepository.findByRestaurantIdAndDeletedFalse(restaurantId).stream()
                .map(diningTableMapper::toResponse)
                .collect(Collectors.toList());
    }

    public DiningTableResponse findById(Long id) {
        DiningTable table = diningTableRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", id));
        currentUserService.validateRestaurantAccess(table.getRestaurant().getId());
        return diningTableMapper.toResponse(table);
    }

    @Transactional
    public DiningTableResponse create(Long restaurantId, DiningTableRequest request) {
        currentUserService.validateRestaurantAccess(restaurantId);
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
        currentUserService.validateRestaurantAccess(table.getRestaurant().getId());

        diningTableMapper.updateEntity(table, request);
        DiningTable saved = diningTableRepository.save(table);
        return diningTableMapper.toResponse(saved);
    }

    @Transactional
    public DiningTableResponse updateStatus(Long id, String status) {
        DiningTable table = diningTableRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Mesa", "id", id));
        currentUserService.validateRestaurantAccess(table.getRestaurant().getId());

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
        currentUserService.validateRestaurantAccess(table.getRestaurant().getId());
        table.setDeleted(true);
        table.setDeletedAt(LocalDateTime.now());
        diningTableRepository.save(table);
    }
}
