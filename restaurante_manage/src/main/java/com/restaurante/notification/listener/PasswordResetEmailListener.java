package com.restaurante.notification.listener;

import com.restaurante.notification.event.PasswordResetRequestedEvent;
import com.restaurante.notification.service.EmailService;
import lombok.RequiredArgsConstructor;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

/**
 * Igual que ReservationEmailListener: AFTER_COMMIT + @Async, para que el
 * token ya esté persistido (y consultable) antes de enviar el enlace, y
 * para que un SMTP lento no alargue la respuesta HTTP de forgot-password.
 */
@Component
@RequiredArgsConstructor
public class PasswordResetEmailListener {

    private final EmailService emailService;

    @Async
    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPasswordResetRequested(PasswordResetRequestedEvent event) {
        emailService.sendPasswordReset(event.data());
    }
}
