package com.restaurante.diningtable.entity;

import com.restaurante.common.audit.BaseEntity;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.restaurant.entity.Restaurant;
import jakarta.persistence.*;

@Entity
@Table(name = "dining_tables")
public class DiningTable extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @ManyToOne(fetch = FetchType.LAZY)
    @JoinColumn(name = "restaurant_id", nullable = false)
    private Restaurant restaurant;

    @Column(name = "table_number", nullable = false, length = 10)
    private String tableNumber;

    @Column(nullable = false)
    private Integer capacity;

    @Column(length = 30)
    private String location;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 20)
    private TableStatus status = TableStatus.AVAILABLE;

    public DiningTable() {
    }

    public DiningTable(Long id, Restaurant restaurant, String tableNumber, Integer capacity,
                       String location, TableStatus status) {
        this.id = id;
        this.restaurant = restaurant;
        this.tableNumber = tableNumber;
        this.capacity = capacity;
        this.location = location;
        this.status = status;
    }

    public Long getId() {
        return id;
    }

    public void setId(Long id) {
        this.id = id;
    }

    public Restaurant getRestaurant() {
        return restaurant;
    }

    public void setRestaurant(Restaurant restaurant) {
        this.restaurant = restaurant;
    }

    public String getTableNumber() {
        return tableNumber;
    }

    public void setTableNumber(String tableNumber) {
        this.tableNumber = tableNumber;
    }

    public Integer getCapacity() {
        return capacity;
    }

    public void setCapacity(Integer capacity) {
        this.capacity = capacity;
    }

    public String getLocation() {
        return location;
    }

    public void setLocation(String location) {
        this.location = location;
    }

    public TableStatus getStatus() {
        return status;
    }

    public void setStatus(TableStatus status) {
        this.status = status;
    }
}
