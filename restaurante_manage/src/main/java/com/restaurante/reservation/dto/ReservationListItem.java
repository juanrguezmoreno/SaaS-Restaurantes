package com.restaurante.reservation.dto;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.restaurante.reservation.enums.ReservationStatus;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDate;
import java.time.LocalDateTime;
import java.time.LocalTime;

/**
 * Proyección de reserva para el listado.
 *
 * <p>Se construye con una <em>constructor expression</em> de JPQL que trae
 * cliente, restaurante y mesa por {@code JOIN}. Antes el listado pasaba por
 * {@link ReservationMapper#toResponse}, que lee tres asociaciones {@code LAZY}
 * por fila —{@code customer}, {@code diningTable} y {@code restaurant}—: con
 * {@code size=9999}, decenas de miles de consultas por carga de pantalla.</p>
 *
 * <p>Los nombres de los campos JSON son los mismos que los de
 * {@link ReservationResponse} a propósito: el modal de detalle y el formulario
 * de edición se abren con los datos de la fila, así que la fila tiene que
 * seguir trayendo {@code customerId}, {@code restaurantId},
 * {@code diningTableId} y {@code notes} aunque no se pinten en la tabla.</p>
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class ReservationListItem {

    private Long id;

    private Long customerId;

    /** Se expone como {@code customerName}, no por separado. */
    @JsonIgnore
    private String customerFirstName;

    @JsonIgnore
    private String customerLastName;

    private String customerEmail;

    private Long diningTableId;
    private String tableNumber;

    private Long restaurantId;
    private String restaurantName;

    private LocalDate reservationDate;
    private LocalTime reservationTime;
    private Integer partySize;
    private String status;

    /** Lo necesita el formulario de edición, que se abre con los datos de la fila. */
    private String notes;

    /** Caducidad del bloqueo provisional; nulo si la reserva no tiene bloqueo. */
    private LocalDateTime holdExpiresAt;

    private LocalDateTime createdAt;
    private LocalDateTime updatedAt;

    /**
     * Constructor que usa la consulta de listado. El orden de los argumentos es
     * el de la {@code SELECT new ...}: si se cambia uno, hay que cambiar el otro.
     */
    public ReservationListItem(Long id,
                               Long customerId,
                               String customerFirstName,
                               String customerLastName,
                               String customerEmail,
                               Long diningTableId,
                               String tableNumber,
                               Long restaurantId,
                               String restaurantName,
                               LocalDate reservationDate,
                               LocalTime reservationTime,
                               Integer partySize,
                               ReservationStatus status,
                               String notes,
                               LocalDateTime holdExpiresAt,
                               LocalDateTime createdAt,
                               LocalDateTime updatedAt) {
        this.id = id;
        this.customerId = customerId;
        this.customerFirstName = customerFirstName;
        this.customerLastName = customerLastName;
        this.customerEmail = customerEmail;
        this.diningTableId = diningTableId;
        this.tableNumber = tableNumber;
        this.restaurantId = restaurantId;
        this.restaurantName = restaurantName;
        this.reservationDate = reservationDate;
        this.reservationTime = reservationTime;
        this.partySize = partySize;
        this.status = status != null ? status.name() : null;
        this.notes = notes;
        this.holdExpiresAt = holdExpiresAt;
        this.createdAt = createdAt;
        this.updatedAt = updatedAt;
    }

    /** Nombre completo del cliente, como lo pinta la tabla. */
    public String getCustomerName() {
        String first = customerFirstName != null ? customerFirstName.trim() : "";
        String last = customerLastName != null ? customerLastName.trim() : "";
        return (first + " " + last).trim();
    }

    /**
     * Estado del bloqueo provisional, con la misma regla que
     * {@link ReservationMapper}: {@code NONE} si no hay bloqueo, {@code ACTIVE}
     * si sigue vivo y {@code EXPIRED} si ya venció.
     */
    public String getHoldStatus() {
        if (holdExpiresAt == null) {
            return "NONE";
        }
        return holdExpiresAt.isAfter(LocalDateTime.now()) ? "ACTIVE" : "EXPIRED";
    }
}
