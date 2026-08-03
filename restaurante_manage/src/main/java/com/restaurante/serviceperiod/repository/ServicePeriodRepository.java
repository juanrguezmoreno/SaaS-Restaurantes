package com.restaurante.serviceperiod.repository;

import com.restaurante.serviceperiod.entity.ServicePeriod;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.List;

@Repository
public interface ServicePeriodRepository extends JpaRepository<ServicePeriod, Long> {

    /**
     * Periodos vivos de un restaurante, de toda la semana.
     *
     * <p>Una sola consulta resuelve los dos usos que tiene el dominio: filtrar
     * por día concreto y detectar si el restaurante tiene algún periodo (lo que
     * decide si aplica el horario general como fallback).</p>
     */
    List<ServicePeriod> findByRestaurantIdAndDeletedFalse(Long restaurantId);
}
