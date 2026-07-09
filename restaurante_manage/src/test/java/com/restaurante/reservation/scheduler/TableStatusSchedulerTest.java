package com.restaurante.reservation.scheduler;

import com.restaurante.reservation.service.ReservationService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class TableStatusSchedulerTest {

    @Mock private ReservationService reservationService;

    @InjectMocks private TableStatusScheduler scheduler;

    @Test
    void runScheduledFix_llamaAFixTableStatusesParaTodosLosRestaurantes() {
        when(reservationService.fixTableStatuses(null)).thenReturn(3);

        scheduler.runScheduledFix();

        verify(reservationService).fixTableStatuses(null);
    }
}
