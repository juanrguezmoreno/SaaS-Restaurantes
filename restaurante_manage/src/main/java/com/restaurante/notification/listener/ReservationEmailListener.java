package com.restaurante.notification.listener;

import com.restaurante.notification.event.ReservationCancelledEvent;
import com.restaurante.notification.event.ReservationConfirmedEvent;
import com.restaurante.notification.service.EmailService;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Envía el email fuera de la transacción de negocio (AFTER_COMMIT) y en un
 * hilo aparte (@Async), para que un SMTP lento nunca alargue la respuesta
 * HTTP ni bloquee la transacción que confirma/cancela la reserva.
 */
@Component
@RequiredArgsConstructor
public class ReservationEmailListener {

    private final EmailService emailService;

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onReservationConfirmed(ReservationConfirmedEvent event) {
        emailService.sendReservationConfirmed(event.data());
    }

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onReservationCancelled(ReservationCancelledEvent event) {
        emailService.sendReservationCancelled(event.data());
    }
}
