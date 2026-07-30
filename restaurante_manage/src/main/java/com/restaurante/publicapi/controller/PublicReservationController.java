package com.restaurante.publicapi.controller;

import com.restaurante.availability.dto.TimeSlotResponse;
import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.util.Constants;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.RateLimitExceededException;
import com.restaurante.publicapi.dto.PublicReservationRequest;
import com.restaurante.publicapi.dto.PublicReservationResponse;
import com.restaurante.publicapi.dto.PublicRestaurantResponse;
import com.restaurante.publicapi.ratelimit.PublicReservationRateLimiter;
import com.restaurante.publicapi.service.PublicReservationService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import lombok.RequiredArgsConstructor;
import org.springframework.format.annotation.DateTimeFormat;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.time.LocalDate;
import java.util.List;

@RestController
@RequestMapping(Constants.PUBLIC_PATH + "/restaurants/{restaurantId}")
@RequiredArgsConstructor
@Validated
@Tag(name = "Público - Reservas", description = "Endpoints públicos para solicitar reservas sin autenticación")
public class PublicReservationController {

    private final PublicReservationService publicReservationService;
    private final PublicReservationRateLimiter rateLimiter;

    @GetMapping
    @Operation(summary = "Obtener restaurante público",
            description = "Devuelve la información básica del restaurante para mostrarla en la página pública de reservas.")
    public ResponseEntity<ApiResponse<PublicRestaurantResponse>> getPublicRestaurant(
            @PathVariable Long restaurantId) {

        PublicRestaurantResponse response = publicReservationService.getPublicRestaurant(restaurantId);
        return ResponseEntity.ok(ApiResponse.success(response));
    }

    @GetMapping(Constants.AVAILABILITY_TIME_SLOTS_SUBPATH)
    @Operation(summary = "Franjas horarias disponibles",
            description = "Devuelve las franjas horarias del restaurante para una fecha y número de "
                    + "comensales, indicando cuáles admiten reserva. Solo expone hora y disponibilidad: "
                    + "ningún dato de mesas ni de otras reservas.")
    public ResponseEntity<ApiResponse<List<TimeSlotResponse>>> getPublicTimeSlots(
            @PathVariable Long restaurantId,
            @RequestParam @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate date,
            @RequestParam(defaultValue = "1") @Min(1) @Max(50) Integer partySize) {

        return ResponseEntity.ok(ApiResponse.success(
                publicReservationService.getPublicTimeSlots(restaurantId, date, partySize)));
    }

    @PostMapping(value = "/reservation-requests", consumes = MediaType.APPLICATION_JSON_VALUE)
    @Operation(summary = "Solicitar reserva",
            description = "Permite a un cliente sin autenticación enviar una solicitud de reserva. " +
                    "La reserva se crea en estado PENDING sin mesa asignada. " +
                    "El restaurante revisará la solicitud y confirmará disponibilidad.")
    public ResponseEntity<ApiResponse<PublicReservationResponse>> createReservationRequest(
            @PathVariable Long restaurantId,
            @Valid @RequestBody PublicReservationRequest request,
            HttpServletRequest httpRequest) {

        if (!rateLimiter.tryAcquire(httpRequest.getRemoteAddr())) {
            throw new RateLimitExceededException(
                    "Demasiadas solicitudes de reserva. Inténtalo de nuevo en unos minutos.");
        }

        PublicReservationResponse response = publicReservationService.createReservationRequest(restaurantId, request);

        return ResponseEntity.status(HttpStatus.CREATED)
                .body(ApiResponse.success("Solicitud de reserva recibida correctamente", response));
    }
}
