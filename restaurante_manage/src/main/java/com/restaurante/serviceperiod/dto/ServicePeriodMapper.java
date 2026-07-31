package com.restaurante.serviceperiod.dto;

import com.restaurante.serviceperiod.entity.ServicePeriod;
import org.springframework.stereotype.Component;

@Component
public class ServicePeriodMapper {

    public ServicePeriodResponse toResponse(ServicePeriod periodo) {
        return new ServicePeriodResponse(
                periodo.getId(),
                periodo.getDayOfWeek(),
                periodo.getStartTime(),
                periodo.getEndTime(),
                periodo.getName());
    }
}
