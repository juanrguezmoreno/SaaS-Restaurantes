# Notificaciones por email para reservas — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enviar un email HTML al cliente cuando su reserva pasa a CONFIRMED o a CANCELLED, sin acoplar `ReservationService` al envío real ni arriesgar la transacción de negocio si el SMTP falla.

**Architecture:** `ReservationService` publica eventos de Spring (`ReservationConfirmedEvent`/`ReservationCancelledEvent`) con un snapshot inmutable de los datos necesarios (`ReservationEmailData`, construido dentro de la transacción). Un listener (`ReservationEmailListener`) los recibe con `@TransactionalEventListener(AFTER_COMMIT)` + `@Async`, y delega en `EmailService`, que renderiza una plantilla HTML con `String.replace` y envía por `JavaMailSender`. Un flag `app.mail.enabled` (default `false`) hace que en dev/test se loguee en vez de enviarse de verdad — no hace falta SMTP para desarrollar. Ningún fallo de `EmailService` se propaga nunca.

**Tech Stack:** Spring Boot 3.3 / Java 21, `spring-boot-starter-mail` (ya añadido al pom.xml), JUnit 5 + Mockito.

## Global Constraints

- Español en código, comentarios, commits (Conventional Commits `feat(...)`/`test(...)`).
- Eventos que disparan email: solo confirmación y cancelación (v1). Ediciones, soft-delete admin, COMPLETED/NO_SHOW y creación PENDING no envían email.
- El snapshot (`ReservationEmailData`) se construye **dentro** de la transacción y, en las rutas de cancelación, **antes** de desasignar la mesa — el listener corre post-commit en otro hilo con la sesión de Hibernate cerrada.
- `EmailService` captura toda excepción de envío (`log.error`) y nunca la propaga; si el cliente no tiene email, se omite con `log.info`.
- `mvn test` debe seguir en verde tras cada tarea. Baseline actual: **37 tests, 0 fallos** (confirmado con `mvn test` antes de empezar).
- No introducir Thymeleaf ni otro motor de plantillas — placeholders `{{...}}` con `String.replace`.

---

## Task 1: `notification/event/` — Snapshot inmutable y eventos de dominio

**Contexto:** Antes de tocar `ReservationService` o `EmailService`, se define el contrato de datos que viaja entre ellos: un snapshot inmutable de la reserva (email/nombre del cliente, restaurante, fecha, hora, comensales, mesa) y los dos eventos que lo envuelven.

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/notification/event/ReservationEmailData.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/notification/event/ReservationConfirmedEvent.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/notification/event/ReservationCancelledEvent.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/notification/event/ReservationEmailDataTest.java`

**Interfaces:**
- Consumes: `Reservation` (`com.restaurante.reservation.entity.Reservation`, ya existe) — usa `getCustomer()`, `getRestaurant()`, `getDiningTable()`, `getReservationDate()`, `getReservationTime()`, `getPartySize()`.
- Produces: `ReservationEmailData.from(Reservation)` → `ReservationEmailData` (record con `customerEmail`, `customerName`, `restaurantName`, `date` en `dd/MM/yyyy`, `time` en `HH:mm`, `partySize`, `tableInfo` = `"Mesa " + tableNumber` o `"mesa por confirmar"` si no hay mesa). `ReservationConfirmedEvent(ReservationEmailData data)` y `ReservationCancelledEvent(ReservationEmailData data)` — records de un solo campo, usados por Tasks 3 y 4.

- [ ] **Step 1: Escribir el test (fallará en compilación: las clases no existen)**

Crear `restaurante_manage/src/test/java/com/restaurante/notification/event/ReservationEmailDataTest.java`:

```java
package com.restaurante.notification.event;

import com.restaurante.customer.entity.Customer;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.restaurant.entity.Restaurant;
import org.junit.jupiter.api.Test;

import java.time.LocalDate;
import java.time.LocalTime;

import static org.junit.jupiter.api.Assertions.assertEquals;

class ReservationEmailDataTest {

    private Reservation reservation(DiningTable table) {
        Customer customer = new Customer();
        customer.setFirstName("Ana");
        customer.setLastName("García");
        customer.setEmail("ana@example.com");

        Restaurant restaurant = new Restaurant();
        restaurant.setName("La Buena Mesa");

        Reservation reservation = new Reservation();
        reservation.setCustomer(customer);
        reservation.setRestaurant(restaurant);
        reservation.setDiningTable(table);
        reservation.setReservationDate(LocalDate.of(2026, 12, 31));
        reservation.setReservationTime(LocalTime.of(21, 30));
        reservation.setPartySize(4);
        return reservation;
    }

    @Test
    void from_mapeaTodosLosCamposYFormateaFechaYHora() {
        DiningTable table = new DiningTable();
        table.setTableNumber("7");

        ReservationEmailData data = ReservationEmailData.from(reservation(table));

        assertEquals("ana@example.com", data.customerEmail());
        assertEquals("Ana García", data.customerName());
        assertEquals("La Buena Mesa", data.restaurantName());
        assertEquals("31/12/2026", data.date());
        assertEquals("21:30", data.time());
        assertEquals(4, data.partySize());
        assertEquals("Mesa 7", data.tableInfo());
    }

    @Test
    void from_usaTextoGenericoDeMesaCuandoNoHayMesaAsignada() {
        ReservationEmailData data = ReservationEmailData.from(reservation(null));

        assertEquals("mesa por confirmar", data.tableInfo());
    }
}
```

- [ ] **Step 2: Ejecutar el test y verificar que falla la compilación**

Run: `cd restaurante_manage && mvn test -Dtest=ReservationEmailDataTest`
Expected: FALLA en compilación — `cannot find symbol: class ReservationEmailData`.

- [ ] **Step 3: Crear `ReservationEmailData.java`**

Crear `restaurante_manage/src/main/java/com/restaurante/notification/event/ReservationEmailData.java`:

```java
package com.restaurante.notification.event;

import com.restaurante.customer.entity.Customer;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.restaurant.entity.Restaurant;

import java.time.format.DateTimeFormatter;

/**
 * Snapshot inmutable de los datos de una reserva necesarios para el email.
 * Se construye dentro de la transacción: el listener que lo consume corre
 * post-commit en otro hilo, con la sesión de Hibernate cerrada — acceder a
 * relaciones lazy en ese punto lanzaría LazyInitializationException.
 */
public record ReservationEmailData(
        String customerEmail,
        String customerName,
        String restaurantName,
        String date,
        String time,
        Integer partySize,
        String tableInfo
) {

    private static final DateTimeFormatter DATE_FORMATTER = DateTimeFormatter.ofPattern("dd/MM/yyyy");
    private static final DateTimeFormatter TIME_FORMATTER = DateTimeFormatter.ofPattern("HH:mm");

    public static ReservationEmailData from(Reservation reservation) {
        Customer customer = reservation.getCustomer();
        Restaurant restaurant = reservation.getRestaurant();
        DiningTable table = reservation.getDiningTable();

        String customerName = (customer.getFirstName() + " " + customer.getLastName()).trim();
        String tableInfo = table != null ? "Mesa " + table.getTableNumber() : "mesa por confirmar";

        return new ReservationEmailData(
                customer.getEmail(),
                customerName,
                restaurant.getName(),
                reservation.getReservationDate().format(DATE_FORMATTER),
                reservation.getReservationTime().format(TIME_FORMATTER),
                reservation.getPartySize(),
                tableInfo
        );
    }
}
```

- [ ] **Step 4: Crear los dos eventos**

Crear `restaurante_manage/src/main/java/com/restaurante/notification/event/ReservationConfirmedEvent.java`:

```java
package com.restaurante.notification.event;

public record ReservationConfirmedEvent(ReservationEmailData data) {
}
```

Crear `restaurante_manage/src/main/java/com/restaurante/notification/event/ReservationCancelledEvent.java`:

```java
package com.restaurante.notification.event;

public record ReservationCancelledEvent(ReservationEmailData data) {
}
```

- [ ] **Step 5: Ejecutar el test y confirmar que pasa**

Run: `cd restaurante_manage && mvn test -Dtest=ReservationEmailDataTest`
Expected: `BUILD SUCCESS`, 2 tests, 0 fallos.

- [ ] **Step 6: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/notification restaurante_manage/src/test/java/com/restaurante/notification
git commit -m "feat(notification): añadir snapshot ReservationEmailData y eventos de reserva confirmada/cancelada"
```

---

## Task 2: `EmailService` — plantillas HTML, configuración SMTP y envío

**Contexto:** Servicio que renderiza las dos plantillas y envía por `JavaMailSender`. No conoce `Reservation` ni Spring events — solo recibe `ReservationEmailData`. Incluye la configuración de `spring.mail.*` y `app.mail.*` en `application.yml`, y la documentación de las variables en `.env.example`.

**Files:**
- Create: `restaurante_manage/src/main/resources/mail/reservation-confirmed.html`
- Create: `restaurante_manage/src/main/resources/mail/reservation-cancelled.html`
- Create: `restaurante_manage/src/main/java/com/restaurante/notification/service/EmailService.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/notification/service/EmailServiceTest.java`
- Modify: `restaurante_manage/src/main/resources/application.yml`
- Modify: `restaurante_manage/.env.example`

**Interfaces:**
- Consumes: `ReservationEmailData` (Task 1); `org.springframework.mail.javamail.JavaMailSender` (bean autoconfigurado por `spring-boot-starter-mail`, ya en el pom).
- Produces: `EmailService.sendReservationConfirmed(ReservationEmailData)` y `EmailService.sendReservationCancelled(ReservationEmailData)` — ambos `void`, nunca lanzan excepción. Usados por `ReservationEmailListener` en la Task 3.

- [ ] **Step 1: Crear las plantillas HTML**

Crear `restaurante_manage/src/main/resources/mail/reservation-confirmed.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background-color:#198754;padding:20px 24px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;">Reserva confirmada</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;color:#212529;font-size:15px;line-height:1.5;">
              <p style="margin:0 0 16px;">Hola {{customerName}},</p>
              <p style="margin:0 0 16px;">Tu reserva en <strong>{{restaurantName}}</strong> ha sido confirmada.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">
                <tr>
                  <td style="padding:6px 0;color:#6c757d;">Fecha</td>
                  <td style="padding:6px 0;font-weight:bold;">{{date}}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#6c757d;">Hora</td>
                  <td style="padding:6px 0;font-weight:bold;">{{time}}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#6c757d;">Comensales</td>
                  <td style="padding:6px 0;font-weight:bold;">{{partySize}}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#6c757d;">Mesa</td>
                  <td style="padding:6px 0;font-weight:bold;">{{tableInfo}}</td>
                </tr>
              </table>
              <p style="margin:0;color:#6c757d;font-size:13px;">Si necesitas modificar o cancelar tu reserva, contacta directamente con el restaurante.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

Crear `restaurante_manage/src/main/resources/mail/reservation-cancelled.html`:

```html
<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:Arial, Helvetica, sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" width="480" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;">
          <tr>
            <td style="background-color:#dc3545;padding:20px 24px;">
              <h1 style="margin:0;color:#ffffff;font-size:20px;">Reserva cancelada</h1>
            </td>
          </tr>
          <tr>
            <td style="padding:24px;color:#212529;font-size:15px;line-height:1.5;">
              <p style="margin:0 0 16px;">Hola {{customerName}},</p>
              <p style="margin:0 0 16px;">Tu reserva en <strong>{{restaurantName}}</strong> ha sido cancelada.</p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 16px;border-collapse:collapse;">
                <tr>
                  <td style="padding:6px 0;color:#6c757d;">Fecha</td>
                  <td style="padding:6px 0;font-weight:bold;">{{date}}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#6c757d;">Hora</td>
                  <td style="padding:6px 0;font-weight:bold;">{{time}}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#6c757d;">Comensales</td>
                  <td style="padding:6px 0;font-weight:bold;">{{partySize}}</td>
                </tr>
                <tr>
                  <td style="padding:6px 0;color:#6c757d;">Mesa</td>
                  <td style="padding:6px 0;font-weight:bold;">{{tableInfo}}</td>
                </tr>
              </table>
              <p style="margin:0;color:#6c757d;font-size:13px;">Si ha sido un error o quieres volver a reservar, contacta directamente con el restaurante.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
```

- [ ] **Step 2: Añadir configuración de mail a `application.yml`**

En `restaurante_manage/src/main/resources/application.yml`, reemplazar el bloque `jackson:` (justo antes de `server:`):

```yaml
  jackson:
    serialization:
      write-dates-as-timestamps: false
    # Solo afecta a tipos con zona horaria (Date/Instant); los java.time
    # (LocalDate/LocalDateTime) se serializan en ISO-8601 tal cual.
    time-zone: Europe/Madrid

server:
```

por:

```yaml
  jackson:
    serialization:
      write-dates-as-timestamps: false
    # Solo afecta a tipos con zona horaria (Date/Instant); los java.time
    # (LocalDate/LocalDateTime) se serializan en ISO-8601 tal cual.
    time-zone: Europe/Madrid

  mail:
    host: ${MAIL_HOST:}
    port: ${MAIL_PORT:587}
    username: ${MAIL_USERNAME:}
    password: ${MAIL_PASSWORD:}
    properties:
      mail:
        smtp:
          auth: true
          starttls:
            enable: true

server:
```

Y reemplazar el bloque `maintenance:` (dentro de `app:`, justo antes de `springdoc:`):

```yaml
  maintenance:
    # Frecuencia (ms) del job que corrige mesas RESERVED sin reserva activa.
    # 900000 ms = 15 minutos.
    table-status-fix-delay-ms: ${TABLE_STATUS_FIX_DELAY_MS:900000}

springdoc:
```

por:

```yaml
  maintenance:
    # Frecuencia (ms) del job que corrige mesas RESERVED sin reserva activa.
    # 900000 ms = 15 minutos.
    table-status-fix-delay-ms: ${TABLE_STATUS_FIX_DELAY_MS:900000}
  mail:
    # false (por defecto): el envío se loguea en vez de realizarse de verdad.
    # Útil en desarrollo/tests sin credenciales SMTP reales.
    enabled: ${MAIL_ENABLED:false}
    from: ${MAIL_FROM:no-reply@example.com}

springdoc:
```

- [ ] **Step 3: Documentar las variables en `.env.example`**

En `restaurante_manage/.env.example`, añadir al final del fichero (tras `PORT=8080`):

```
# Email (SMTP) — notificaciones de reserva confirmada/cancelada
# MAIL_ENABLED=false (por defecto) hace que el envío se loguee en vez de
# realizarse de verdad; útil en desarrollo sin credenciales SMTP reales.
MAIL_ENABLED=false
MAIL_HOST=
MAIL_PORT=587
MAIL_USERNAME=
MAIL_PASSWORD=
MAIL_FROM=no-reply@example.com
```

- [ ] **Step 4: Escribir el test de `EmailService` (fallará en compilación: la clase no existe)**

Crear `restaurante_manage/src/test/java/com/restaurante/notification/service/EmailServiceTest.java`:

```java
package com.restaurante.notification.service;

import com.restaurante.notification.event.ReservationEmailData;
import jakarta.mail.Session;
import jakarta.mail.internet.MimeMessage;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.mail.MailSendException;
import org.springframework.mail.javamail.JavaMailSender;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class EmailServiceTest {

    @Mock private JavaMailSender mailSender;

    private MimeMessage mimeMessage;

    @BeforeEach
    void setUp() {
        mimeMessage = new MimeMessage((Session) null);
    }

    private ReservationEmailData data(String email) {
        return new ReservationEmailData(email, "Ana García", "La Buena Mesa",
                "31/12/2026", "21:30", 4, "Mesa 7");
    }

    @Test
    void sendReservationConfirmed_renderizaLaPlantillaYEnviaElEmail() throws Exception {
        when(mailSender.createMimeMessage()).thenReturn(mimeMessage);
        EmailService service = new EmailService(mailSender, true, "no-reply@test.com");

        service.sendReservationConfirmed(data("ana@example.com"));

        verify(mailSender).send(mimeMessage);
        String content = (String) mimeMessage.getContent();
        assertTrue(content.contains("Ana García"));
        assertTrue(content.contains("La Buena Mesa"));
        assertTrue(content.contains("31/12/2026"));
        assertTrue(content.contains("21:30"));
        assertTrue(content.contains("Mesa 7"));
        assertFalse(content.contains("{{"));
    }

    @Test
    void send_noEnviaSiMailEnabledEsFalse() {
        EmailService service = new EmailService(mailSender, false, "no-reply@test.com");

        service.sendReservationConfirmed(data("ana@example.com"));

        verify(mailSender, never()).createMimeMessage();
        verify(mailSender, never()).send(any(MimeMessage.class));
    }

    @Test
    void send_noEnviaSiElClienteNoTieneEmail() {
        EmailService service = new EmailService(mailSender, true, "no-reply@test.com");

        service.sendReservationCancelled(data(null));

        verify(mailSender, never()).createMimeMessage();
    }

    @Test
    void send_noPropagaLaExcepcionSiFallaElEnvio() {
        when(mailSender.createMimeMessage()).thenReturn(mimeMessage);
        doThrow(new MailSendException("fallo SMTP")).when(mailSender).send(any(MimeMessage.class));
        EmailService service = new EmailService(mailSender, true, "no-reply@test.com");

        assertDoesNotThrow(() -> service.sendReservationConfirmed(data("ana@example.com")));
    }
}
```

- [ ] **Step 5: Ejecutar el test y verificar que falla la compilación**

Run: `cd restaurante_manage && mvn test -Dtest=EmailServiceTest`
Expected: FALLA en compilación — `cannot find symbol: class EmailService`.

- [ ] **Step 6: Crear `EmailService.java`**

Crear `restaurante_manage/src/main/java/com/restaurante/notification/service/EmailService.java`:

```java
package com.restaurante.notification.service;

import com.restaurante.notification.event.ReservationEmailData;
import jakarta.mail.internet.MimeMessage;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.io.ClassPathResource;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.mail.javamail.MimeMessageHelper;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

/**
 * Envía los emails de confirmación y cancelación de reserva. Nunca propaga
 * excepciones: un fallo de envío no debe afectar a la operación de negocio
 * que lo originó (ver notification.listener.ReservationEmailListener).
 */
@Service
@Slf4j
public class EmailService {

    private final JavaMailSender mailSender;
    private final boolean mailEnabled;
    private final String mailFrom;

    public EmailService(JavaMailSender mailSender,
                         @Value("${app.mail.enabled:false}") boolean mailEnabled,
                         @Value("${app.mail.from}") String mailFrom) {
        this.mailSender = mailSender;
        this.mailEnabled = mailEnabled;
        this.mailFrom = mailFrom;
    }

    public void sendReservationConfirmed(ReservationEmailData data) {
        send(data, "reservation-confirmed.html", "Reserva confirmada — " + data.restaurantName());
    }

    public void sendReservationCancelled(ReservationEmailData data) {
        send(data, "reservation-cancelled.html", "Reserva cancelada — " + data.restaurantName());
    }

    private void send(ReservationEmailData data, String templateName, String subject) {
        if (data.customerEmail() == null || data.customerEmail().isBlank()) {
            log.info("Cliente sin email — se omite el envío de '{}'", subject);
            return;
        }
        if (!mailEnabled) {
            log.info("[app.mail.enabled=false] Se omite el envío real. Asunto: '{}', destinatario: {}",
                    subject, data.customerEmail());
            return;
        }
        try {
            String html = renderTemplate(templateName, data);
            MimeMessage message = mailSender.createMimeMessage();
            MimeMessageHelper helper = new MimeMessageHelper(message, "UTF-8");
            helper.setFrom(mailFrom);
            helper.setTo(data.customerEmail());
            helper.setSubject(subject);
            helper.setText(html, true);
            mailSender.send(message);
            log.info("Email '{}' enviado a {}", subject, data.customerEmail());
        } catch (Exception e) {
            log.error("Error al enviar email '{}' a {}: {}", subject, data.customerEmail(), e.getMessage(), e);
        }
    }

    private String renderTemplate(String templateName, ReservationEmailData data) throws IOException {
        ClassPathResource resource = new ClassPathResource("mail/" + templateName);
        String template;
        try (InputStream is = resource.getInputStream()) {
            template = new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
        return template
                .replace("{{customerName}}", data.customerName())
                .replace("{{restaurantName}}", data.restaurantName())
                .replace("{{date}}", data.date())
                .replace("{{time}}", data.time())
                .replace("{{partySize}}", String.valueOf(data.partySize()))
                .replace("{{tableInfo}}", data.tableInfo());
    }
}
```

- [ ] **Step 7: Ejecutar el test y confirmar que pasa**

Run: `cd restaurante_manage && mvn test -Dtest=EmailServiceTest`
Expected: `BUILD SUCCESS`, 4 tests, 0 fallos.

- [ ] **Step 8: Ejecutar la suite completa**

Run: `cd restaurante_manage && mvn test`
Expected: `BUILD SUCCESS`, 43 tests (37 base + 2 de la Task 1 + 4 nuevos), 0 fallos. `RestaurantManageApplicationTests` (arranque de contexto) sigue pasando con `spring-boot-starter-mail` autoconfigurado y `MAIL_ENABLED` en `false` por defecto.

- [ ] **Step 9: Commit**

```bash
git add restaurante_manage/src/main/resources/mail restaurante_manage/src/main/resources/application.yml restaurante_manage/.env.example restaurante_manage/src/main/java/com/restaurante/notification/service restaurante_manage/src/test/java/com/restaurante/notification/service
git commit -m "feat(notification): añadir EmailService con plantillas HTML y configuración SMTP"
```

---

## Task 3: `ReservationEmailListener` — envío asíncrono post-commit

**Contexto:** El listener desacopla el envío del hilo/transacción HTTP: se dispara solo si la transacción que publicó el evento hace commit (`AFTER_COMMIT`), y corre en un hilo aparte (`@Async`) para que un SMTP lento no alargue la respuesta. Requiere habilitar `@EnableAsync` en la aplicación (junto al `@EnableScheduling` ya existente).

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/RestaurantManageApplication.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/notification/listener/ReservationEmailListener.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/notification/listener/ReservationEmailListenerTest.java`

**Interfaces:**
- Consumes: `ReservationConfirmedEvent`, `ReservationCancelledEvent` (Task 1); `EmailService.sendReservationConfirmed/Cancelled` (Task 2).
- Produces: nada nuevo para otras tareas — es el punto de entrada que Spring invoca automáticamente al publicarse un evento transaccional. La Task 4 solo necesita saber que publicar `ReservationConfirmedEvent`/`ReservationCancelledEvent` con `ApplicationEventPublisher` es suficiente para que el email se envíe.

- [ ] **Step 1: Escribir el test del listener (fallará en compilación: la clase no existe)**

Crear `restaurante_manage/src/test/java/com/restaurante/notification/listener/ReservationEmailListenerTest.java`:

```java
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
```

- [ ] **Step 2: Ejecutar el test y verificar que falla la compilación**

Run: `cd restaurante_manage && mvn test -Dtest=ReservationEmailListenerTest`
Expected: FALLA en compilación — `cannot find symbol: class ReservationEmailListener`.

- [ ] **Step 3: Crear `ReservationEmailListener.java`**

Crear `restaurante_manage/src/main/java/com/restaurante/notification/listener/ReservationEmailListener.java`:

```java
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
```

- [ ] **Step 4: Habilitar `@EnableAsync` en la aplicación**

En `restaurante_manage/src/main/java/com/restaurante/RestaurantManageApplication.java`, reemplazar:

```java
package com.restaurante;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.TimeZone;

@SpringBootApplication
@EnableScheduling
public class RestaurantManageApplication {
```

por:

```java
package com.restaurante;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

import java.util.TimeZone;

@SpringBootApplication
@EnableScheduling
@EnableAsync
public class RestaurantManageApplication {
```

(el resto del fichero, desde `public static void main`, no cambia).

- [ ] **Step 5: Ejecutar el test del listener y confirmar que pasa**

Run: `cd restaurante_manage && mvn test -Dtest=ReservationEmailListenerTest`
Expected: `BUILD SUCCESS`, 2 tests, 0 fallos.

- [ ] **Step 6: Ejecutar la suite completa (incluye arranque de contexto con `@EnableAsync`)**

Run: `cd restaurante_manage && mvn test`
Expected: `BUILD SUCCESS`, 45 tests (43 + 2 nuevos), 0 fallos. `RestaurantManageApplicationTests` sigue pasando con el scheduling y el async habilitados a la vez.

- [ ] **Step 7: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/RestaurantManageApplication.java restaurante_manage/src/main/java/com/restaurante/notification/listener restaurante_manage/src/test/java/com/restaurante/notification/listener
git commit -m "feat(notification): añadir ReservationEmailListener asíncrono post-commit"
```

---

## Task 4: Conectar `ReservationService` — publicar los eventos

**Contexto:** Último cable: `ReservationService` publica `ReservationConfirmedEvent`/`ReservationCancelledEvent` en los tres puntos que el diseño define — `create()` cuando se crea ya CONFIRMED, `updateStatus()` en la transición a CONFIRMED o a CANCELLED, y `cancel()` (DELETE). En la transición a CANCELLED de `updateStatus()` y en `cancel()`, el snapshot se construye **antes** de desasignar la mesa. Ediciones (`update()`), soft-delete admin (`delete()`), transiciones a COMPLETED/NO_SHOW y creación en PENDING no publican nada — no se tocan.

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java`
- Modify: `restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationServiceTest.java`

**Interfaces:**
- Consumes: `ReservationEmailData.from(Reservation)` (Task 1), `ReservationConfirmedEvent`, `ReservationCancelledEvent` (Task 1), `org.springframework.context.ApplicationEventPublisher` (bean de Spring, no requiere configuración).
- Produces: sin cambios de firma pública en `ReservationService` — el comportamiento observable añadido es que `create()`, `updateStatus()` y `cancel()` ahora publican eventos de Spring como efecto colateral.

- [ ] **Step 1: Escribir los tests que verifican la publicación de eventos (fallarán: el mock `eventPublisher` aún no existe en el fixture y el service aún no publica nada)**

En `restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationServiceTest.java`, añadir imports (tras la línea 24, `import org.mockito.quality.Strictness;`):

```java
import com.restaurante.notification.event.ReservationCancelledEvent;
import com.restaurante.notification.event.ReservationConfirmedEvent;
import org.mockito.ArgumentCaptor;
import org.springframework.context.ApplicationEventPublisher;
```

Añadir el mock del publisher (tras la línea 51, `@Mock private CurrentUserService currentUserService;`):

```java
    @Mock private ApplicationEventPublisher eventPublisher;
```

En `setUp()`, dar nombre/email reales al cliente y al restaurante para que el snapshot de email no viaje con campos nulos — reemplazar (líneas 59-75):

```java
    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);

        table = new DiningTable();
        table.setId(TABLE_ID);
        table.setTableNumber("1");
        table.setCapacity(4);

        customer = new Customer();
        customer.setId(CUSTOMER_ID);

        when(customerRepository.findByIdAndDeletedFalse(CUSTOMER_ID)).thenReturn(Optional.of(customer));
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        when(diningTableRepository.findByIdAndDeletedFalse(TABLE_ID)).thenReturn(Optional.of(table));
    }
```

por:

```java
    @BeforeEach
    void setUp() {
        restaurant = new Restaurant();
        restaurant.setId(RESTAURANT_ID);
        restaurant.setName("La Buena Mesa");

        table = new DiningTable();
        table.setId(TABLE_ID);
        table.setTableNumber("1");
        table.setCapacity(4);

        customer = new Customer();
        customer.setId(CUSTOMER_ID);
        customer.setFirstName("Ana");
        customer.setLastName("García");
        customer.setEmail("ana@example.com");

        when(customerRepository.findByIdAndDeletedFalse(CUSTOMER_ID)).thenReturn(Optional.of(customer));
        when(restaurantRepository.findByIdAndDeletedFalse(RESTAURANT_ID)).thenReturn(Optional.of(restaurant));
        when(diningTableRepository.findByIdAndDeletedFalse(TABLE_ID)).thenReturn(Optional.of(table));
    }
```

Añadir los cuatro tests nuevos al final de la clase, antes del cierre `}` final (tras el test `findByRestaurantIdAndDate_propagaAccessDeniedSiNoTieneAcceso`, línea 231):

```java

    // ─── Notificaciones por email: publicación de eventos ─────────────────

    @Test
    void create_publicaReservationConfirmedEventSiSeCreaConfirmada() {
        when(reservationMapper.toEntity(any(ReservationRequest.class))).thenAnswer(inv -> {
            Reservation r = new Reservation();
            r.setReservationDate(DATE);
            r.setReservationTime(TIME);
            r.setPartySize(2);
            r.setStatus(ReservationStatus.CONFIRMED);
            return r;
        });
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, null)).thenReturn(List.of());

        service.create(request());

        ArgumentCaptor<ReservationConfirmedEvent> captor = ArgumentCaptor.forClass(ReservationConfirmedEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
        assertEquals("ana@example.com", captor.getValue().data().customerEmail());
    }

    @Test
    void updateStatus_publicaReservationConfirmedEventAlConfirmar() {
        Reservation reserva = reservaPendienteSinMesa(5L);
        when(reservationRepository.findByIdAndDeletedFalse(5L)).thenReturn(Optional.of(reserva));
        when(diningTableRepository.findByRestaurantIdAndDeletedFalse(RESTAURANT_ID))
                .thenReturn(List.of(table));
        when(reservationRepository.findActiveConflicts(TABLE_ID, DATE, TIME, 5L)).thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(5L, "CONFIRMED");

        ArgumentCaptor<ReservationConfirmedEvent> captor = ArgumentCaptor.forClass(ReservationConfirmedEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
    }

    @Test
    void updateStatus_publicaReservationCancelledEventAlCancelar() {
        Reservation reserva = reservaPendienteSinMesa(6L);
        reserva.setStatus(ReservationStatus.CONFIRMED);
        reserva.setDiningTable(table);
        when(reservationRepository.findByIdAndDeletedFalse(6L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.findActiveConfirmedByTableId(eq(TABLE_ID), any(LocalDate.class), any(LocalTime.class)))
                .thenReturn(List.of());
        when(reservationRepository.save(any(Reservation.class))).thenAnswer(inv -> inv.getArgument(0));
        when(reservationMapper.toResponse(any())).thenReturn(new ReservationResponse());

        service.updateStatus(6L, "CANCELLED");

        ArgumentCaptor<ReservationCancelledEvent> captor = ArgumentCaptor.forClass(ReservationCancelledEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
    }

    @Test
    void cancel_publicaReservationCancelledEvent() {
        Reservation reserva = reservaPendienteSinMesa(7L);
        reserva.setStatus(ReservationStatus.CONFIRMED);
        reserva.setDiningTable(table);
        when(reservationRepository.findByIdAndDeletedFalse(7L)).thenReturn(Optional.of(reserva));
        when(reservationRepository.findActiveConfirmedByTableId(eq(TABLE_ID), any(LocalDate.class), any(LocalTime.class)))
                .thenReturn(List.of());

        service.cancel(7L);

        ArgumentCaptor<ReservationCancelledEvent> captor = ArgumentCaptor.forClass(ReservationCancelledEvent.class);
        verify(eventPublisher).publishEvent(captor.capture());
        assertEquals("Mesa 1", captor.getValue().data().tableInfo());
    }
```

- [ ] **Step 2: Ejecutar los tests nuevos y verificar que fallan**

Run: `cd restaurante_manage && mvn test -Dtest=ReservationServiceTest`
Expected: FALLA — los 4 tests nuevos fallan con `WantedButNotInvoked` en `verify(eventPublisher).publishEvent(...)` porque `ReservationService` todavía no publica ningún evento.

- [ ] **Step 3: Añadir el campo `eventPublisher` y los imports a `ReservationService.java`**

En `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java`, reemplazar el bloque de imports (líneas 3-26):

```java
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.reservation.dto.ReservationMapper;
import com.restaurante.reservation.dto.ReservationRequest;
import com.restaurante.reservation.dto.ReservationResponse;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
```

por:

```java
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.exception.ConflictException;
import com.restaurante.common.exception.ResourceNotFoundException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.customer.entity.Customer;
import com.restaurante.customer.repository.CustomerRepository;
import com.restaurante.diningtable.entity.DiningTable;
import com.restaurante.diningtable.enums.TableStatus;
import com.restaurante.diningtable.repository.DiningTableRepository;
import com.restaurante.notification.event.ReservationCancelledEvent;
import com.restaurante.notification.event.ReservationConfirmedEvent;
import com.restaurante.notification.event.ReservationEmailData;
import com.restaurante.reservation.dto.ReservationMapper;
import com.restaurante.reservation.dto.ReservationRequest;
import com.restaurante.reservation.dto.ReservationResponse;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.enums.ReservationStatus;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageImpl;
import org.springframework.data.domain.Pageable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
```

Y el campo (línea 44, `private final CurrentUserService currentUserService;`):

```java
    private final CurrentUserService currentUserService;
```

por:

```java
    private final CurrentUserService currentUserService;
    private final ApplicationEventPublisher eventPublisher;
```

- [ ] **Step 4: Publicar `ReservationConfirmedEvent` en `create()`**

En el mismo fichero, reemplazar el final de `create()` (líneas 251-256):

```java
        Reservation saved = reservationRepository.save(reservation);
        log.info("Reserva creada: id={}, estado={}, mesa={}", saved.getId(), saved.getStatus(),
                saved.getDiningTable() != null ? saved.getDiningTable().getId() : "sin-mesa");

        return reservationMapper.toResponse(saved);
    }
```

por:

```java
        Reservation saved = reservationRepository.save(reservation);
        log.info("Reserva creada: id={}, estado={}, mesa={}", saved.getId(), saved.getStatus(),
                saved.getDiningTable() != null ? saved.getDiningTable().getId() : "sin-mesa");

        if (saved.getStatus() == ReservationStatus.CONFIRMED) {
            eventPublisher.publishEvent(new ReservationConfirmedEvent(ReservationEmailData.from(saved)));
        }

        return reservationMapper.toResponse(saved);
    }
```

- [ ] **Step 5: Publicar `ReservationConfirmedEvent` al confirmar en `updateStatus()`**

Reemplazar el final de la rama CONFIRMED de `updateStatus()` (líneas 395-399):

```java
            // Marcar la mesa como RESERVED
            table.setStatus(TableStatus.RESERVED);
            diningTableRepository.save(table);
            log.info("Mesa {} marcada como RESERVED al confirmar reserva #{}", table.getId(), id);
        }
```

por:

```java
            // Marcar la mesa como RESERVED
            table.setStatus(TableStatus.RESERVED);
            diningTableRepository.save(table);
            log.info("Mesa {} marcada como RESERVED al confirmar reserva #{}", table.getId(), id);

            eventPublisher.publishEvent(new ReservationConfirmedEvent(ReservationEmailData.from(reservation)));
        }
```

- [ ] **Step 6: Publicar `ReservationCancelledEvent` al cancelar en `updateStatus()`**

Reemplazar la rama CANCELLED de `updateStatus()` (líneas 401-411):

```java
        // ─── Transición a CANCELLED ────────────────────────────────
        if (newStatus == ReservationStatus.CANCELLED) {
            // Cambiar estado ANTES de liberar para que la consulta
            // findActiveConfirmedByTableId NO encuentre esta reserva
            if (reservation.getDiningTable() != null) {
                reservation.setStatus(newStatus);
                releaseTableIfNoActiveConfirmedReservations(reservation.getDiningTable().getId());
                reservation.setDiningTable(null);
                log.info("Mesa liberada al cancelar reserva #{}", id);
            }
        }
```

por:

```java
        // ─── Transición a CANCELLED ────────────────────────────────
        if (newStatus == ReservationStatus.CANCELLED) {
            // Snapshot ANTES de desasignar la mesa: el listener corre
            // post-commit con la sesión de Hibernate cerrada.
            eventPublisher.publishEvent(new ReservationCancelledEvent(ReservationEmailData.from(reservation)));

            // Cambiar estado ANTES de liberar para que la consulta
            // findActiveConfirmedByTableId NO encuentre esta reserva
            if (reservation.getDiningTable() != null) {
                reservation.setStatus(newStatus);
                releaseTableIfNoActiveConfirmedReservations(reservation.getDiningTable().getId());
                reservation.setDiningTable(null);
                log.info("Mesa liberada al cancelar reserva #{}", id);
            }
        }
```

- [ ] **Step 7: Publicar `ReservationCancelledEvent` en `cancel()`**

Reemplazar `cancel()` (líneas 438-454):

```java
    @Transactional
    public void cancel(Long id) {
        Reservation reservation = reservationRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Reserva", "id", id));
        currentUserService.validateRestaurantAccess(reservation.getRestaurant().getId());

        // Liberar mesa si estaba asignada
        if (reservation.getDiningTable() != null) {
            releaseTableIfNoActiveConfirmedReservations(reservation.getDiningTable().getId());
            reservation.setDiningTable(null);
            log.info("Mesa liberada al cancelar reserva #{}", id);
        }

        reservation.setStatus(ReservationStatus.CANCELLED);
        reservationRepository.save(reservation);
        log.info("Reserva #{} cancelada", id);
    }
```

por:

```java
    @Transactional
    public void cancel(Long id) {
        Reservation reservation = reservationRepository.findByIdAndDeletedFalse(id)
                .orElseThrow(() -> new ResourceNotFoundException("Reserva", "id", id));
        currentUserService.validateRestaurantAccess(reservation.getRestaurant().getId());

        // Snapshot ANTES de desasignar la mesa: el listener corre
        // post-commit con la sesión de Hibernate cerrada.
        eventPublisher.publishEvent(new ReservationCancelledEvent(ReservationEmailData.from(reservation)));

        // Liberar mesa si estaba asignada
        if (reservation.getDiningTable() != null) {
            releaseTableIfNoActiveConfirmedReservations(reservation.getDiningTable().getId());
            reservation.setDiningTable(null);
            log.info("Mesa liberada al cancelar reserva #{}", id);
        }

        reservation.setStatus(ReservationStatus.CANCELLED);
        reservationRepository.save(reservation);
        log.info("Reserva #{} cancelada", id);
    }
```

- [ ] **Step 8: Ejecutar `ReservationServiceTest` y confirmar que todo pasa**

Run: `cd restaurante_manage && mvn test -Dtest=ReservationServiceTest`
Expected: `BUILD SUCCESS`, 11 tests (7 existentes + 4 nuevos), 0 fallos.

- [ ] **Step 9: Ejecutar la suite completa**

Run: `cd restaurante_manage && mvn test`
Expected: `BUILD SUCCESS`, 49 tests (45 + 4 nuevos), 0 fallos.

- [ ] **Step 10: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java restaurante_manage/src/test/java/com/restaurante/reservation/service/ReservationServiceTest.java
git commit -m "feat(reservation): publicar eventos de email al confirmar/cancelar una reserva"
```

---

## Task 5: Verificación manual end-to-end (smoke test)

**Contexto:** Los tests unitarios verifican cada pieza aislada; falta una comprobación manual de que el cableado completo funciona en caliente (contexto Spring real, `@Async` + `@TransactionalEventListener` disparándose de verdad) antes de dar la feature por cerrada. Con `app.mail.enabled=false` (default), el email no se envía de verdad — se verifica por log.

**Files:** ninguno (solo verificación manual).

- [ ] **Step 1: Arrancar la API en modo dev**

Run: `cd restaurante_manage && mvn spring-boot:run -Dspring-boot.run.profiles=dev`
Expected: arranca sin errores en el puerto 8080; el log no muestra ninguna excepción relacionada con `mail` o `notification` durante el arranque.

- [ ] **Step 2: Confirmar una reserva PENDING existente (datos demo) vía Swagger o curl**

Con el usuario demo `juan.admin` / `admin123` (login en `POST /api/v1/auth/login`), localizar una reserva PENDING con `GET /api/v1/reservations` y confirmarla:

Run: `curl -X PATCH http://localhost:8080/api/v1/reservations/{id}/status -H "Authorization: Bearer {token}" -H "Content-Type: application/json" -d "{\"status\":\"CONFIRMED\"}"`
Expected: `200 OK`. En la consola del backend aparece, tras la respuesta HTTP (es asíncrono), una línea `[app.mail.enabled=false] Se omite el envío real. Asunto: 'Reserva confirmada — ...'`.

- [ ] **Step 3: Cancelar esa misma reserva**

Run: `curl -X PATCH http://localhost:8080/api/v1/reservations/{id}/status -H "Authorization: Bearer {token}" -H "Content-Type: application/json" -d "{\"status\":\"CANCELLED\"}"`
Expected: `200 OK`. Log con `[app.mail.enabled=false] Se omite el envío real. Asunto: 'Reserva cancelada — ...'`.

- [ ] **Step 4: Confirmar que una reserva sin cliente con email, o una transición a COMPLETED/NO_SHOW, no generan log de email**

Cambiar el estado de otra reserva CONFIRMED a `COMPLETED` o `NO_SHOW`.
Expected: `200 OK`, sin ninguna línea de log de `EmailService` ni `ReservationEmailListener` asociada a esa reserva.

No hay commit en esta tarea — es solo verificación.
