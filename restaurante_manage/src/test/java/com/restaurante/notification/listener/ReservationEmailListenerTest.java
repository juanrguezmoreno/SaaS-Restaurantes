package com.restaurante.notification.listener;

import com.restaurante.notification.event.ReservationCancelledEvent;
import com.restaurante.notification.event.ReservationConfirmedEvent;
import com.restaurante.notification.event.ReservationEmailData;
import com.restaurante.notification.service.EmailService;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.mockito.Mockito.verify;

@ExtendWith(MockitoExtension.class)
class ReservationEmailListenerTest {

    @Mock private EmailService emailService;

    @InjectMocks private ReservationEmailListener listener;

    private ReservationEmailData data() {
        return new ReservationEmailData("ana@example.com", "Ana García", "La Buena Mesa",
                "31/12/2026", "21:30", 4, "Mesa 7");
    }

    @Test
    void onReservationConfirmed_delegaEnEmailService() {
        ReservationEmailData data = data();

        listener.onReservationConfirmed(new ReservationConfirmedEvent(data));

        verify(emailService).sendReservationConfirmed(data);
    }

    @Test
    void onReservationCancelled_delegaEnEmailService() {
        ReservationEmailData data = data();

        listener.onReservationCancelled(new ReservationCancelledEvent(data));

        verify(emailService).sendReservationCancelled(data);
    }
}
