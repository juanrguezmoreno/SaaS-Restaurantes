package com.restaurante.employee.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.employee.dto.EmployeeMapper;
import com.restaurante.employee.dto.EmployeeRequest;
import com.restaurante.employee.dto.EmployeeResponse;
import com.restaurante.employee.entity.Employee;
import com.restaurante.employee.enums.EmployeeStatus;
import com.restaurante.employee.repository.EmployeeRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class EmployeeService {

    private final EmployeeRepository employeeRepository;
    private final RestaurantRepository restaurantRepository;
    private final UserRepository userRepository;
    private final EmployeeMapper employeeMapper;
    private final CurrentUserService currentUserService;

    public List<EmployeeResponse> findByRestaurantId(Long restaurantId) {
        currentUserService.validateRestaurantAccess(restaurantId);
        return employeeRepository.findByRestaurantIdAndDeletedFalse(restaurantId).stream()
                .map(employeeMapper::toResponse)
                .collect(Collectors.toList());
    }

    public EmployeeResponse findById(Long id) {
        Employee employee = employeeRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Empleado", "id", id));
        currentUserService.validateRestaurantAccess(employee.getRestaurant().getId());
        return employeeMapper.toResponse(employee);
    }

    @Transactional
    public EmployeeResponse create(Long restaurantId, EmployeeRequest request) {
        currentUserService.validateRestaurantAccess(restaurantId);
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        User user = userRepository.findByIdAndDeletedFalse(request.getUserId())
                .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", request.getUserId()));

        if (employeeRepository.findByUserIdAndDeletedFalse(request.getUserId()).isPresent()) {
            throw new BadRequestException("El usuario ya está registrado como empleado");
        }

        Employee employee = employeeMapper.toEntity(request);
        employee.setRestaurant(restaurant);
        employee.setUser(user);

        Employee saved = employeeRepository.save(employee);
        return employeeMapper.toResponse(saved);
    }

    @Transactional
    public EmployeeResponse update(Long id, EmployeeRequest request) {
        Employee employee = employeeRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Empleado", "id", id));
        currentUserService.validateRestaurantAccess(employee.getRestaurant().getId());

        if (request.getUserId() != null && !request.getUserId().equals(employee.getUser().getId())) {
            User user = userRepository.findByIdAndDeletedFalse(request.getUserId())
                    .orElseThrow(() -> new ResourceNotFoundException("Usuario", "id", request.getUserId()));
            employee.setUser(user);
        }

        employeeMapper.updateEntity(employee, request);
        Employee saved = employeeRepository.save(employee);
        return employeeMapper.toResponse(saved);
    }

    @Transactional
    public void delete(Long id) {
        Employee employee = employeeRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Empleado", "id", id));
        currentUserService.validateRestaurantAccess(employee.getRestaurant().getId());
        employee.setDeleted(true);
        employee.setDeletedAt(LocalDateTime.now());
        employeeRepository.save(employee);
    }
}
