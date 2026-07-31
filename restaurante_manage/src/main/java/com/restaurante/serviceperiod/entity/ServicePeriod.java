package com.restaurante.serviceperiod.entity;

import com.restaurante.common.audit.BaseEntity;
import com.restaurante.restaurant.entity.Restaurant;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.DayOfWeek;
import java.time.LocalTime;

/**
 * Periodo de servicio de un restaurante en un día de la semana: por ejemplo,
 * comidas de 13:00 a 16:00 y cenas de 20:00 a 23:00 del lunes.
 *
 * <p>Sustituyen a la ventana única apertura/cierre como fuente de las franjas
 * horarias ofrecidas. Un día sin periodos vivos está <strong>cerrado</strong>.
 * Un restaurante sin ningún periodo vivo en toda la semana sigue usando
 * {@code openingTime}/{@code closingTime} como horario general: es el fallback
 * que implementa {@code AvailabilityService.generarFranjas}.</p>
 *
 * <p>Un periodo nunca cruza medianoche: la hora de fin es siempre posterior a
 * la de inicio dentro del mismo día.</p>
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "service_periods")
public class ServicePeriod extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "restaurant_id", nullable = false)
    private Restaurant restaurant;

    @Enumerated(EnumType.STRING)
    @Column(name = "day_of_week", nullable = false, length = 20)
    private DayOfWeek dayOfWeek;

    @Column(name = "start_time", nullable = false)
    private LocalTime startTime;

    @Column(name = "end_time", nullable = false)
    private LocalTime endTime;

    /** Etiqueta opcional ("Comidas", "Cenas"). Ninguna lógica depende de su valor. */
    @Column(name = "name", length = 50)
    private String name;
}
