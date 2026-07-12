# Notificaciones por email para reservas — Diseño

**Fecha:** 2026-07-12 · **Estado:** aprobado por Juan

## Objetivo

Enviar email al cliente cuando su reserva se confirma o se cancela. Dejar el sistema
preparado (sin activar) para el aviso de reserva pendiente y futuros recordatorios.

## Decisiones tomadas

| Decisión | Elección |
|---|---|
| Eventos que disparan email | Solo confirmación y cancelación (v1) |
| Acoplamiento | Eventos de Spring: `ReservationService` publica, listener envía |
| Momento de envío | `@TransactionalEventListener(AFTER_COMMIT)` + `@Async` |
| Dev sin SMTP | Flag `app.mail.enabled` (`MAIL_ENABLED`, default `false`) → loguea en vez de enviar |
| Plantillas | HTML con CSS inline en `resources/mail/`, placeholders `{{...}}` con `String.replace` (sin Thymeleaf) |

## Arquitectura

```
notification/
├── event/
│   ├── ReservationEmailData.java      record inmutable (snapshot)
│   ├── ReservationConfirmedEvent.java
│   └── ReservationCancelledEvent.java
├── listener/
│   └── ReservationEmailListener.java  @TransactionalEventListener(AFTER_COMMIT) + @Async
└── service/
    └── EmailService.java              JavaMailSender + render de plantillas
```

El evento lleva un **snapshot** (`ReservationEmailData.from(reservation)`) construido
dentro de la transacción: email/nombre del cliente, nombre del restaurante, fecha, hora,
comensales, número de mesa. Motivo: el listener corre post-commit en otro hilo, con la
sesión de Hibernate cerrada — acceder a relaciones lazy lanzaría
`LazyInitializationException`.

## Puntos de publicación (ReservationService)

- `updateStatus()` → a CONFIRMED publica `ReservationConfirmedEvent`; a CANCELLED publica `ReservationCancelledEvent` (snapshot construido **antes** de desasignar la mesa).
- `cancel()` (DELETE) → publica `ReservationCancelledEvent`.
- `create()` con estado CONFIRMED → publica `ReservationConfirmedEvent`.
- Sin email: ediciones, soft-delete admin, COMPLETED/NO_SHOW, creación PENDING.

## Plantillas

`resources/mail/reservation-confirmed.html` y `reservation-cancelled.html`. Español,
CSS inline. Placeholders: `{{customerName}}`, `{{restaurantName}}`, `{{date}}`
(dd/MM/yyyy), `{{time}}` (HH:mm), `{{partySize}}`, `{{tableInfo}}` ("Mesa N" o texto
genérico si no hay mesa).

Asuntos: «Reserva confirmada — {restaurante}» / «Reserva cancelada — {restaurante}».

## Configuración

- pom: `spring-boot-starter-mail`. App principal: `@EnableAsync`.
- `application.yml`:
  - `spring.mail.host/port/username/password` ← `MAIL_HOST`, `MAIL_PORT` (def. 587), `MAIL_USERNAME`, `MAIL_PASSWORD`; `smtp.auth=true`, `starttls.enable=true`.
  - `app.mail.enabled` ← `MAIL_ENABLED` (default `false`), `app.mail.from` ← `MAIL_FROM`.
- `.env.example` documenta las cinco variables + `MAIL_ENABLED`.

## Manejo de errores

- `EmailService` captura toda excepción de envío → `log.error`, nunca propaga.
- Cliente sin email → log info y se omite el envío.
- La reserva nunca se ve afectada (listener post-commit + catch-all).

## Tests

- `EmailServiceTest`: render de plantillas (placeholders sustituidos), skip si
  `enabled=false`, skip si el cliente no tiene email, excepción de envío no propaga.
- `ReservationService`: publica el evento correcto en confirmar/cancelar (mock de
  `ApplicationEventPublisher`).