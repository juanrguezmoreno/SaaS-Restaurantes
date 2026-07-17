package com.restaurante.publicapi.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.publicapi.dto.PublicReservationRequest;
import com.restaurante.publicapi.dto.PublicReservationResponse;
import com.restaurante.publicapi.dto.PublicRestaurantResponse;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
@RequiredArgsConstructor
@Slf4j
public class PublicReservationService {

    private final RestaurantRepository restaurantRepository;
    private final CustomerRepository customerRepository;
    private final ReservationRepository reservationRepository;

    /**
     * Obtiene info básica de un restaurante para la página pública.
     */
    public PublicRestaurantResponse getPublicRestaurant(Long restaurantId) {
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        return PublicRestaurantResponse.builder()
                .id(restaurant.getId())
                .name(restaurant.getName())
                .address(restaurant.getAddress())
                .phone(restaurant.getPhone())
                .email(restaurant.getEmail())
                .description(restaurant.getDescription())
                .openingTime(restaurant.getOpeningTime())
                .closingTime(restaurant.getClosingTime())
                .capacity(restaurant.getCapacity())
                .build();
    }

    /**
     * Crea una solicitud de reserva pública (sin autenticación).
     * - Valida que el restaurante exista.
     * - Busca o crea el cliente por email dentro del restaurante.
     * - Crea una reserva con estado PENDING sin mesa asignada.
     */
    @Transactional
    public PublicReservationResponse createReservationRequest(
            Long restaurantId,
            PublicReservationRequest request) {

        // 1. Validar restaurante
        Restaurant restaurant = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));

        // 1b. Verificar que el restaurante permita reservas públicas
        if (Boolean.FALSE.equals(restaurant.getPublicBookingEnabled())) {
            throw new BadRequestException(
                    "Este restaurante no acepta reservas públicas en este momento");
        }

        // 2. Buscar o crear cliente
        Customer customer = findOrCreateCustomer(restaurant, request);

        // 2b. Rechazar solicitudes duplicadas: mismo cliente, fecha y hora,
        // con una reserva todavía activa (PENDING o CONFIRMED).
        boolean duplicada = reservationRepository
                .existsByCustomerIdAndReservationDateAndReservationTimeAndStatusInAndDeletedFalse(
                        customer.getId(), request.getReservationDate(), request.getReservationTime(),
                        List.of(ReservationStatus.PENDING, ReservationStatus.CONFIRMED));
        if (duplicada) {
            throw new ConflictException(
                    "Ya existe una solicitud de reserva activa para ese email, fecha y hora.");
        }

        // 3. Crear reserva PENDING sin mesa
        Reservation reservation = new Reservation();
        reservation.setCustomer(customer);
        reservation.setRestaurant(restaurant);
        reservation.setDiningTable(null); // explícitamente sin mesa
        reservation.setReservationDate(request.getReservationDate());
        reservation.setReservationTime(request.getReservationTime());
        reservation.setPartySize(request.getPartySize());
        reservation.setNotes(request.getNotes());
        reservation.setStatus(ReservationStatus.PENDING);

        Reservation saved = reservationRepository.save(reservation);

        log.info("Solicitud de reserva pública creada: id={}, restaurante={}, cliente={}",
                saved.getId(), restaurantId, customer.getEmail());

        // Se devuelve el nombre tal como lo escribió el solicitante, nunca el
        // almacenado en BD, para no confirmar identidades a partir de un email
        return PublicReservationResponse.builder()
                .reservationId(saved.getId())
                .customerId(customer.getId())
                .customerName(request.getCustomerName())
                .reservationDate(saved.getReservationDate())
                .reservationTime(saved.getReservationTime())
                .partySize(saved.getPartySize())
                .status(saved.getStatus().name())
                .message("Solicitud de reserva recibida correctamente. El restaurante revisará tu solicitud y confirmará la disponibilidad.")
                .build();
    }

    /**
     * Busca un cliente por email en el restaurante dado.
     * Si no existe, lo crea con los datos de la solicitud.
     * La búsqueda se limita al restaurante para no exponer ni reutilizar
     * clientes de otros restaurantes/tenants.
     */
    private Customer findOrCreateCustomer(Restaurant restaurant, PublicReservationRequest request) {
        return customerRepository
                .findFirstByEmailAndRestaurantIdAndDeletedFalse(request.getEmail(), restaurant.getId())
                .orElseGet(() -> createCustomer(restaurant, request));
    }

    private Customer createCustomer(Restaurant restaurant, PublicReservationRequest request) {
        String fullName = request.getCustomerName().trim();
        String firstName;
        String lastName;

        int spaceIndex = fullName.indexOf(' ');
        if (spaceIndex > 0) {
            firstName = fullName.substring(0, spaceIndex).trim();
            lastName = fullName.substring(spaceIndex + 1).trim();
        } else {
            firstName = fullName;
            lastName = "";
        }

        // Limitar longitud de campos
        if (firstName.length() > 50) firstName = firstName.substring(0, 50);
        if (lastName.length() > 50) lastName = lastName.substring(0, 50);

        Customer customer = new Customer();
        customer.setRestaurant(restaurant);
        customer.setFirstName(firstName);
        customer.setLastName(lastName);
        customer.setEmail(request.getEmail());
        customer.setPhone(request.getPhone());
        customer.setUser(null); // cliente público no tiene usuario del sistema

        Customer saved = customerRepository.save(customer);
        log.info("Cliente creado desde reserva pública: id={}, email={}", saved.getId(), saved.getEmail());
        return saved;
    }
}
