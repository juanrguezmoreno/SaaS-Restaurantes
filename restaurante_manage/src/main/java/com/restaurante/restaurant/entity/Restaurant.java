package com.restaurante.restaurant.entity;

import com.restaurante.common.audit.BaseEntity;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.employee.entity.Employee;
import com.restaurante.tenant.entity.Tenant;
import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;

@Getter
@Setter
@NoArgsConstructor
@AllArgsConstructor
@Entity
@Table(name = "restaurants")
public class Restaurant extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(length = 200)
    private String address;

    @Column(length = 20)
    private String phone;

    @Column(length = 100)
    private String email;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "opening_time")
    private LocalTime openingTime;

    @Column(name = "closing_time")
    private LocalTime closingTime;

    private Integer capacity;

    @Column(name = "public_booking_enabled", nullable = false)
    private Boolean publicBookingEnabled = true;

    @Column(name = "default_reservation_duration_minutes", nullable = false)
    private Integer defaultReservationDurationMinutes = 90;

    /**
     * Si el local está operativo bajo el plan contratado. Un tenant que baja de
     * PRO a NORMAL con varios locales conserva TODOS sus datos: los sobrantes
     * pasan a solo lectura con este flag en false, y se reactivan solos al
     * volver a PRO. Nunca se borra ni se marca como eliminado un local por
     * motivos de plan.
     */
    @Column(name = "active_under_plan", nullable = false)
    private Boolean activeUnderPlan = true;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "tenant_id")
    private Tenant tenant;

    @OneToMany(mappedBy = "restaurant", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<DiningTable> tables = new ArrayList<>();

    @OneToMany(mappedBy = "restaurant", cascade = CascadeType.ALL, orphanRemoval = true)
    private List<Employee> employees = new ArrayList<>();
}
