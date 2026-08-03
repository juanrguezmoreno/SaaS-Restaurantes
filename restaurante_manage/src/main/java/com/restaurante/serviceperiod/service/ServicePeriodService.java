package com.restaurante.serviceperiod.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.serviceperiod.dto.ServicePeriodMapper;
import com.restaurante.serviceperiod.dto.ServicePeriodRequest;
import com.restaurante.serviceperiod.dto.ServicePeriodResponse;
import com.restaurante.serviceperiod.entity.ServicePeriod;
import com.restaurante.serviceperiod.repository.ServicePeriodRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.DayOfWeek;
import java.time.LocalDateTime;
import java.util.*;
import java.util.stream.Collectors;

/**
 * Periodos de servicio de un restaurante.
 *
 * <p>Toda operación valida primero el acceso al restaurante: el aislamiento no
 * depende de que el frontend oculte el botón.</p>
 */
@Service
@RequiredArgsConstructor
@Slf4j
public class ServicePeriodService {

    private static final Map<DayOfWeek, String> NOMBRES_DIA = Map.of(
            DayOfWeek.MONDAY, "lunes",
            DayOfWeek.TUESDAY, "martes",
            DayOfWeek.WEDNESDAY, "miércoles",
            DayOfWeek.THURSDAY, "jueves",
            DayOfWeek.FRIDAY, "viernes",
            DayOfWeek.SATURDAY, "sábado",
            DayOfWeek.SUNDAY, "domingo");

    private static final int MAX_LONGITUD_NOMBRE = 50;

    private final ServicePeriodRepository servicePeriodRepository;
    private final RestaurantRepository restaurantRepository;
    private final ServicePeriodMapper servicePeriodMapper;
    private final CurrentUserService currentUserService;

    /**
     * Periodos del restaurante, ordenados por día y hora de inicio. Una lista
     * vacía significa que el restaurante usa el horario general.
     */
    public List<ServicePeriodResponse> findByRestaurantId(Long restaurantId) {
        currentUserService.validateRestaurantAccess(restaurantId);
        return ordenados(servicePeriodRepository.findByRestaurantIdAndDeletedFalse(restaurantId)).stream()
                .map(servicePeriodMapper::toResponse)
                .collect(Collectors.toList());
    }

    /**
     * Reemplaza los periodos de la semana completa, de forma idempotente:
     * con id se actualizan, sin id se crean, y los existentes que no vengan en
     * el payload se borran lógicamente.
     *
     * <p>Rechazar los ids que no pertenecen al restaurante de la ruta es la
     * defensa concreta contra modificar los horarios de otro restaurante
     * manipulando el cuerpo de la petición.</p>
     */
    @Transactional
    public List<ServicePeriodResponse> replacePeriods(Long restaurantId, List<ServicePeriodRequest> requests) {
        currentUserService.validateRestaurantAccess(restaurantId);

        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        List<ServicePeriodRequest> peticiones = requests != null ? requests : List.of();
        validar(peticiones);

        List<ServicePeriod> existentes =
                servicePeriodRepository.findByRestaurantIdAndDeletedFalse(restaurantId);
        Map<Long, ServicePeriod> existentesPorId = existentes.stream()
                .collect(Collectors.toMap(ServicePeriod::getId, p -> p));

        List<Long> ajenos = peticiones.stream()
                .map(ServicePeriodRequest::getId)
                .filter(Objects::nonNull)
                .filter(id -> !existentesPorId.containsKey(id))
                .collect(Collectors.toList());
        if (!ajenos.isEmpty()) {
            throw new BadRequestException(
                    "Los siguientes periodos no pertenecen al restaurante " + restaurantId + ": " + ajenos);
        }

        List<ServicePeriod> aGuardar = new ArrayList<>();
        Set<Long> conservados = new HashSet<>();

        for (ServicePeriodRequest req : peticiones) {
            ServicePeriod periodo;
            if (req.getId() != null) {
                periodo = existentesPorId.get(req.getId());
                conservados.add(req.getId());
            } else {
                periodo = new ServicePeriod();
                periodo.setRestaurant(restaurant);
            }
            periodo.setDayOfWeek(req.getDayOfWeek());
            periodo.setStartTime(req.getStartTime());
            periodo.setEndTime(req.getEndTime());
            periodo.setName(normalizarNombre(req.getName()));
            aGuardar.add(periodo);
        }

        for (ServicePeriod periodo : existentes) {
            if (!conservados.contains(periodo.getId())) {
                periodo.setDeleted(true);
                periodo.setDeletedAt(LocalDateTime.now());
                aGuardar.add(periodo);
            }
        }

        servicePeriodRepository.saveAll(aGuardar);

        log.info("[ServicePeriod] Horarios guardados para restaurante {}: {} vivos, {} eliminados",
                restaurantId, peticiones.size(), aGuardar.size() - peticiones.size());

        List<ServicePeriod> vivos = aGuardar.stream()
                .filter(p -> !p.getDeleted())
                .collect(Collectors.toList());

        return ordenados(vivos).stream()
                .map(servicePeriodMapper::toResponse)
                .collect(Collectors.toList());
    }

    /**
     * Reglas del conjunto de periodos. Se comprueban todas antes de tocar la
     * base de datos: un payload inválido no debe dejar la semana a medias.
     */
    private void validar(List<ServicePeriodRequest> peticiones) {
        List<Long> idsRepetidos = peticiones.stream()
                .map(ServicePeriodRequest::getId)
                .filter(Objects::nonNull)
                .collect(Collectors.groupingBy(id -> id, Collectors.counting()))
                .entrySet().stream()
                .filter(entrada -> entrada.getValue() > 1)
                .map(Map.Entry::getKey)
                .collect(Collectors.toList());
        if (!idsRepetidos.isEmpty()) {
            throw new BadRequestException(
                    "El payload repite el id de periodo " + idsRepetidos + " más de una vez.");
        }

        for (int i = 0; i < peticiones.size(); i++) {
            ServicePeriodRequest req = peticiones.get(i);

            if (req.getDayOfWeek() == null || req.getStartTime() == null || req.getEndTime() == null) {
                throw new BadRequestException("El periodo " + (i + 1)
                        + " es inválido: el día, la hora de inicio y la hora de fin son obligatorios.");
            }
            // Cubre a la vez inicio igual a fin, fin anterior al inicio y los
            // periodos que cruzarían medianoche.
            if (!req.getEndTime().isAfter(req.getStartTime())) {
                throw new BadRequestException("En " + nombreDia(req.getDayOfWeek())
                        + ", la hora de fin (" + req.getEndTime() + ") debe ser posterior a la de inicio ("
                        + req.getStartTime() + ").");
            }
            if (req.getName() != null && req.getName().trim().length() > MAX_LONGITUD_NOMBRE) {
                throw new BadRequestException(
                        "El nombre de un periodo no debe exceder " + MAX_LONGITUD_NOMBRE + " caracteres.");
            }
        }

        // Solapes dentro de cada día. Ordenando por hora de inicio basta con
        // comparar cada periodo con el anterior: si dos cualesquiera se solapan,
        // algún par consecutivo también lo hace. Un duplicado exacto es un
        // solape total, así que esta misma regla lo cubre.
        Map<DayOfWeek, List<ServicePeriodRequest>> porDia = peticiones.stream()
                .collect(Collectors.groupingBy(ServicePeriodRequest::getDayOfWeek));

        for (Map.Entry<DayOfWeek, List<ServicePeriodRequest>> entrada : porDia.entrySet()) {
            List<ServicePeriodRequest> delDia = entrada.getValue().stream()
                    .sorted(Comparator.comparing(ServicePeriodRequest::getStartTime))
                    .collect(Collectors.toList());

            for (int i = 1; i < delDia.size(); i++) {
                ServicePeriodRequest anterior = delDia.get(i - 1);
                ServicePeriodRequest actual = delDia.get(i);
                if (actual.getStartTime().isBefore(anterior.getEndTime())) {
                    throw new BadRequestException("En " + nombreDia(entrada.getKey()) + ", los periodos "
                            + anterior.getStartTime() + "–" + anterior.getEndTime() + " y "
                            + actual.getStartTime() + "–" + actual.getEndTime() + " se solapan.");
                }
            }
        }
    }

    private List<ServicePeriod> ordenados(List<ServicePeriod> periodos) {
        return periodos.stream()
                .sorted(Comparator.comparing(ServicePeriod::getDayOfWeek)
                        .thenComparing(ServicePeriod::getStartTime))
                .collect(Collectors.toList());
    }

    private String normalizarNombre(String nombre) {
        if (nombre == null) {
            return null;
        }
        String limpio = nombre.trim();
        return limpio.isEmpty() ? null : limpio;
    }

    private String nombreDia(DayOfWeek dia) {
        return NOMBRES_DIA.getOrDefault(dia, dia.name());
    }
}
