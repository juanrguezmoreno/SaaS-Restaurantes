# Suscripciones NORMAL/PRO con Stripe Billing — Plan de implementación

> **Para agentes:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development`
> (recomendado) o `superpowers:executing-plans` para ejecutar este plan tarea a tarea.
> Los pasos usan casillas (`- [ ]`) para seguimiento.

**Especificación:** `docs/superpowers/specs/2026-09-01-suscripciones-stripe-design.md`

**Goal:** Añadir suscripciones de pago por tenant (planes NORMAL y PRO) cobradas con Stripe
Billing, donde el backend impone los límites y las funcionalidades contratadas, y Stripe es
la única fuente de verdad del estado de pago.

**Architecture:** Un catálogo inmutable en código (`PlanCode` → features + límites) y un
`EntitlementService` que es la autoridad única de consulta, al mismo nivel que
`CurrentUserService` lo es para el aislamiento multi-tenant. La comprobación de plan vive en
la capa de servicio, junto a las validaciones de tenant ya existentes. El estado de la
suscripción sólo se modifica desde webhooks de Stripe con firma verificada, nunca desde el
frontend.

**Tech Stack:** Spring Boot 3.3.5 / Java 21 / Maven · JPA + Flyway (MySQL) · H2 en perfil
`dev` · JUnit 5 + Mockito + MockMvc · `com.stripe:stripe-java` 33.x · React 19 + Vite +
Bootstrap 5 · Vitest + Testing Library.

## Global Constraints

- Rama de trabajo: `JRM-suscripciones`. **No hacer push ni abrir PR** sin pedirlo al usuario.
- El código, los comentarios, los mensajes de commit y los textos de interfaz van en
  **español**. Commits en Conventional Commits (`feat(billing): ...`).
- `spring.jpa.hibernate.ddl-auto` es **`validate`** en el perfil por defecto: cada entidad
  nueva o columna nueva **debe** tener su equivalente exacto en la migración Flyway, o el
  backend no arranca.
- La migración nueva es **`V9__subscriptions.sql`** (la última aplicada es V8). Debe ser
  **100 % aditiva**: prohibido `DROP`, `DELETE` y cualquier `UPDATE` sobre columnas
  existentes.
- El perfil `dev` usa H2 `create-drop` con Flyway **desactivado**; los datos demo los crea
  `demodata/DemoDataInitializer.java` (Java), no `data.sql`. Los tests de integración corren
  con `@ActiveProfiles("dev")`.
- En MySQL, las columnas booleanas heredadas de `BaseEntity` se declaran `bit(1)` (ver
  `V8__add_service_periods.sql`). Charset `utf8mb4` / collation `utf8mb4_unicode_ci`,
  `ENGINE=InnoDB`.
- **Ningún secreto en el repositorio ni en `application.yml`**: sólo `${VARIABLE}` sin valor
  por defecto para claves de Stripe. `restaurante_manage/.env` ya está en `.gitignore`.
- Todas las rutas nuevas se declaran como constantes en `common/util/Constants.java`. Nunca
  literales en los controladores.
- Ningún test puede llamar a la red ni generar cobros: se usa el `StripeGateway` falso.
- `SUPER_ADMIN` está **exento** de todo límite y de toda comprobación de feature.
- No se borra ni se marca `deleted` ningún dato del cliente por motivos de plan. Nunca.
- Comandos: backend `cd restaurante_manage && mvn test` (o `mvn test -Dtest=Clase`);
  frontend `cd restaurante-frontend && pnpm test`.

---

## Estructura de archivos

**Paquete nuevo `com.restaurante.subscription`** (layout por feature, como el resto):

| Archivo | Responsabilidad |
|---|---|
| `enums/PlanCode.java` | Los planes: `NORMAL`, `PRO`. |
| `enums/Feature.java` | Las capacidades contratables. |
| `enums/SubscriptionStatus.java` | Estados de Stripe + `grantsAccess()`. |
| `enums/Resource.java` | Ejes de cuota: `RESTAURANT`, `USER_ACCOUNT`. |
| `catalog/PlanLimits.java` | Record de límites (`null` = ilimitado). |
| `catalog/PlanDefinition.java` | Record: código, nombre comercial, features, límites. |
| `catalog/PlanCatalog.java` | Mapa inmutable `PlanCode → PlanDefinition`. Única fuente. |
| `entity/Subscription.java` | La suscripción del tenant. |
| `entity/ProcessedStripeEvent.java` | Idempotencia de webhooks. |
| `repository/SubscriptionRepository.java` | Acceso a `subscriptions`. |
| `repository/ProcessedStripeEventRepository.java` | Acceso a `stripe_processed_events`. |
| `service/EffectiveSubscription.java` | Vista resuelta: plan efectivo + acceso + límites. |
| `service/EntitlementService.java` | **Autoridad única**: `hasFeature`, `require`, `requireCapacity`. |
| `service/SubscriptionService.java` | Altas, cambios de plan, cancelación, reconciliación. |
| `service/StripeWebhookService.java` | Procesa eventos: firma ya validada, idempotencia, orden. |
| `stripe/StripeGateway.java` | Interfaz de todo lo que se le pide a Stripe. |
| `stripe/StripeGatewayImpl.java` | Implementación real con `stripe-java`. |
| `stripe/StripeProperties.java` | `@ConfigurationProperties` de `app.stripe`. |
| `controller/BillingController.java` | `/api/v1/billing/**`. |
| `controller/StripeWebhookController.java` | `/api/v1/webhooks/stripe`, cuerpo crudo. |
| `dto/*.java` | DTOs de petición y respuesta + mapper estático. |

**Excepciones nuevas** en `common/exception/`: `PlanUpgradeRequiredException`,
`PlanLimitReachedException`.

**Migración**: `src/main/resources/db/migration/V9__subscriptions.sql`.

**Frontend nuevo**: `src/services/billingService.js`, `src/context/EntitlementsContext.jsx`,
`src/config/features.js`, `src/pages/Billing.jsx`, `src/components/PlanComparisonModal.jsx`,
`src/components/UpgradeModal.jsx`, `src/components/PlanBadge.jsx`.

---

## Orden de ejecución

```
Fase A — cimientos      Tareas 1-5    (sin Stripe; el sistema ya impone planes)
Fase B — Stripe         Tareas 6-10   (pagos reales, webhooks, ciclo de vida)
Fase C — features PRO   Tarea 11      (exportación CSV + recorte de histórico)
Fase D — frontend       Tareas 12-14
Fase E — cierre         Tarea 15      (auditoría y documentación)
```

Al final de la Fase A el backend ya niega funciones PRO a tenants NORMAL, aunque nadie pueda
pagar todavía. Es un punto de parada válido y verificable.

---

# FASE A — Cimientos

## Task 1: Catálogo de planes

Sin base de datos, sin Spring: enums puros y un mapa inmutable. Es el corazón de la
extensibilidad, así que se fija con un test que rompe la build si alguien lo cambia por
accidente.

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/enums/PlanCode.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/enums/Feature.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/enums/Resource.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/enums/SubscriptionStatus.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/catalog/PlanLimits.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/catalog/PlanDefinition.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/catalog/PlanCatalog.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/catalog/PlanCatalogTest.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/enums/SubscriptionStatusTest.java`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `PlanCode.NORMAL`, `PlanCode.PRO`
  - `Feature.MULTI_RESTAURANT | ADVANCED_ANALYTICS | EXPORT_DATA | ADVANCED_PERMISSIONS | AUTOMATIONS | CUSTOMER_REMINDERS`
  - `Resource.RESTAURANT | USER_ACCOUNT`
  - `SubscriptionStatus` con `boolean grantsAccess()` y `boolean allowsPublicBooking()`
  - `PlanLimits(Integer maxRestaurants, Integer maxUserAccounts)` con `boolean isUnlimited(Resource)` y `Integer limitFor(Resource)`
  - `PlanDefinition(PlanCode code, String displayName, Set<Feature> features, PlanLimits limits)`
  - `PlanCatalog.get(PlanCode)`, `PlanCatalog.all()`, `PlanCatalog.hasFeature(PlanCode, Feature)`, `PlanCatalog.limits(PlanCode)`, `PlanCatalog.minimumPlanFor(Feature)`

- [ ] **Step 1: Escribir los tests que fijan el catálogo**

`PlanCatalogTest.java`:

```java
package com.restaurante.subscription.catalog;

import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.Resource;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Fija la matriz plan x feature. Si alguien cambia el catálogo sin querer, este
 * test rompe la build: es la protección contra que los planes se desvíen de lo
 * que se vende.
 */
class PlanCatalogTest {

    @Test
    @DisplayName("NORMAL no incluye ninguna feature de pago")
    void normalNoTieneFeaturesPro() {
        assertTrue(PlanCatalog.get(PlanCode.NORMAL).features().isEmpty());
        for (Feature feature : Feature.values()) {
            assertFalse(PlanCatalog.hasFeature(PlanCode.NORMAL, feature),
                    "NORMAL no debería incluir " + feature);
        }
    }

    @Test
    @DisplayName("PRO incluye todas las features declaradas")
    void proIncluyeTodasLasFeatures() {
        for (Feature feature : Feature.values()) {
            assertTrue(PlanCatalog.hasFeature(PlanCode.PRO, feature),
                    "PRO debería incluir " + feature);
        }
    }

    @Test
    @DisplayName("NORMAL limita a 1 local y 5 cuentas")
    void limitesDeNormal() {
        PlanLimits limites = PlanCatalog.limits(PlanCode.NORMAL);
        assertEquals(1, limites.maxRestaurants());
        assertEquals(5, limites.maxUserAccounts());
        assertFalse(limites.isUnlimited(Resource.RESTAURANT));
        assertFalse(limites.isUnlimited(Resource.USER_ACCOUNT));
        assertEquals(1, limites.limitFor(Resource.RESTAURANT));
        assertEquals(5, limites.limitFor(Resource.USER_ACCOUNT));
    }

    @Test
    @DisplayName("PRO es ilimitado en locales y cuentas")
    void limitesDePro() {
        PlanLimits limites = PlanCatalog.limits(PlanCode.PRO);
        assertNull(limites.maxRestaurants());
        assertNull(limites.maxUserAccounts());
        assertTrue(limites.isUnlimited(Resource.RESTAURANT));
        assertTrue(limites.isUnlimited(Resource.USER_ACCOUNT));
    }

    @Test
    @DisplayName("Todo plan del enum tiene definición en el catálogo")
    void todoPlanEstaDefinido() {
        for (PlanCode code : PlanCode.values()) {
            assertNotNull(PlanCatalog.get(code), "Falta la definición de " + code);
            assertNotNull(PlanCatalog.get(code).displayName());
            assertFalse(PlanCatalog.get(code).displayName().isBlank());
        }
        assertEquals(PlanCode.values().length, PlanCatalog.all().size());
    }

    @Test
    @DisplayName("El plan mínimo para cualquier feature es PRO")
    void planMinimoParaFeature() {
        for (Feature feature : Feature.values()) {
            assertEquals(PlanCode.PRO, PlanCatalog.minimumPlanFor(feature));
        }
    }

    @Test
    @DisplayName("El catálogo es inmutable: no se puede alterar desde fuera")
    void catalogoInmutable() {
        assertThrows(UnsupportedOperationException.class,
                () -> PlanCatalog.get(PlanCode.NORMAL).features().add(Feature.EXPORT_DATA));
        assertThrows(UnsupportedOperationException.class,
                () -> PlanCatalog.all().remove(PlanCode.PRO));
    }
}
```

`SubscriptionStatusTest.java`:

```java
package com.restaurante.subscription.enums;

import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

class SubscriptionStatusTest {

    @Test
    @DisplayName("TRIALING, ACTIVE y PAST_DUE conceden acceso")
    void estadosQueDanAcceso() {
        assertTrue(SubscriptionStatus.TRIALING.grantsAccess());
        assertTrue(SubscriptionStatus.ACTIVE.grantsAccess());
        // Un pago fallido suele ser una tarjeta caducada, no un abandono:
        // se conserva el acceso mientras Stripe reintenta.
        assertTrue(SubscriptionStatus.PAST_DUE.grantsAccess());
    }

    @Test
    @DisplayName("CANCELED, UNPAID e INCOMPLETE no conceden acceso")
    void estadosSinAcceso() {
        assertFalse(SubscriptionStatus.CANCELED.grantsAccess());
        assertFalse(SubscriptionStatus.UNPAID.grantsAccess());
        assertFalse(SubscriptionStatus.INCOMPLETE.grantsAccess());
        assertFalse(SubscriptionStatus.INCOMPLETE_EXPIRED.grantsAccess());
    }

    @Test
    @DisplayName("La reserva pública sigue abierta exactamente en los estados con acceso")
    void reservaPublicaSigueLaMismaRegla() {
        for (SubscriptionStatus estado : SubscriptionStatus.values()) {
            assertTrue(estado.grantsAccess() == estado.allowsPublicBooking(),
                    "Divergencia inesperada en " + estado);
        }
    }

    @Test
    @DisplayName("fromStripe mapea los valores de la API de Stripe")
    void mapeoDesdeStripe() {
        assertTrue(SubscriptionStatus.fromStripe("trialing") == SubscriptionStatus.TRIALING);
        assertTrue(SubscriptionStatus.fromStripe("active") == SubscriptionStatus.ACTIVE);
        assertTrue(SubscriptionStatus.fromStripe("past_due") == SubscriptionStatus.PAST_DUE);
        assertTrue(SubscriptionStatus.fromStripe("canceled") == SubscriptionStatus.CANCELED);
        assertTrue(SubscriptionStatus.fromStripe("unpaid") == SubscriptionStatus.UNPAID);
        assertTrue(SubscriptionStatus.fromStripe("incomplete") == SubscriptionStatus.INCOMPLETE);
        assertTrue(SubscriptionStatus.fromStripe("incomplete_expired")
                == SubscriptionStatus.INCOMPLETE_EXPIRED);
        // Un estado desconocido nunca debe conceder acceso por accidente.
        assertTrue(SubscriptionStatus.fromStripe("paused") == SubscriptionStatus.INCOMPLETE);
        assertTrue(SubscriptionStatus.fromStripe(null) == SubscriptionStatus.INCOMPLETE);
    }
}
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `cd restaurante_manage && mvn test -Dtest='PlanCatalogTest,SubscriptionStatusTest'`
Expected: FAIL de compilación — `package com.restaurante.subscription.catalog does not exist`.

- [ ] **Step 3: Escribir los enums**

`PlanCode.java`:

```java
package com.restaurante.subscription.enums;

/**
 * Planes contratables. Añadir uno nuevo es añadirlo aquí y darle definición en
 * {@link com.restaurante.subscription.catalog.PlanCatalog}; no hay que tocar
 * ningún servicio.
 */
public enum PlanCode {
    NORMAL,
    PRO
}
```

`Feature.java`:

```java
package com.restaurante.subscription.enums;

/**
 * Capacidades que un plan puede incluir. Son cosas que el TENANT contrata, no
 * permisos del usuario: eso último son los roles, y se comprueban aparte.
 */
public enum Feature {
    /** Más de un restaurante por tenant. */
    MULTI_RESTAURANT,
    /** Estadísticas con histórico completo, más allá de los últimos 7 días. */
    ADVANCED_ANALYTICS,
    /** Exportación de datos a CSV. */
    EXPORT_DATA,
    /** Reservada para el futuro editor de roles. Declarada, aún sin consumidor. */
    ADVANCED_PERMISSIONS,
    /** Reservada. Declarada, aún sin consumidor. */
    AUTOMATIONS,
    /** Reservada. Declarada, aún sin consumidor. */
    CUSTOMER_REMINDERS
}
```

`Resource.java`:

```java
package com.restaurante.subscription.enums;

/**
 * Ejes de cuota que un plan puede limitar. Cada uno se cuenta de una forma
 * distinta (ver EntitlementService), por eso son un enum y no un String.
 */
public enum Resource {
    /** Restaurantes vivos y activos bajo el plan. */
    RESTAURANT,
    /** Cuentas de usuario vivas del tenant (no fichas de empleado). */
    USER_ACCOUNT
}
```

`SubscriptionStatus.java`:

```java
package com.restaurante.subscription.enums;

/**
 * Estados de una suscripción, con la misma nomenclatura que la API de Stripe.
 *
 * INCOMPLETE_EXPIRED no estaba en la especificación original, pero Stripe lo
 * emite: sin él, un webhook real no mapearía y romperíamos la idempotencia.
 */
public enum SubscriptionStatus {

    TRIALING(true),
    ACTIVE(true),
    /**
     * Pago fallido. Conserva el acceso a propósito: casi siempre es una tarjeta
     * caducada, y cortar el servicio dejaría tirados a los clientes finales del
     * restaurante mientras Stripe reintenta el cobro.
     */
    PAST_DUE(true),
    CANCELED(false),
    UNPAID(false),
    INCOMPLETE(false),
    INCOMPLETE_EXPIRED(false);

    private final boolean grantsAccess;

    SubscriptionStatus(boolean grantsAccess) {
        this.grantsAccess = grantsAccess;
    }

    /** ¿Este estado da derecho a las features y los límites del plan? */
    public boolean grantsAccess() {
        return grantsAccess;
    }

    /** ¿La página pública de reservas (QR) sigue aceptando solicitudes? */
    public boolean allowsPublicBooking() {
        return grantsAccess;
    }

    /**
     * Mapea el status textual de Stripe. Un valor desconocido cae en INCOMPLETE:
     * ante la duda, nunca se concede acceso.
     */
    public static SubscriptionStatus fromStripe(String stripeStatus) {
        if (stripeStatus == null) {
            return INCOMPLETE;
        }
        try {
            return valueOf(stripeStatus.trim().toUpperCase());
        } catch (IllegalArgumentException e) {
            return INCOMPLETE;
        }
    }
}
```

- [ ] **Step 4: Escribir el catálogo**

`PlanLimits.java`:

```java
package com.restaurante.subscription.catalog;

import com.restaurante.subscription.enums.Resource;

/**
 * Límites de un plan. {@code null} significa ilimitado (no cero, no -1: null es
 * el único valor que no se puede confundir con un límite real).
 */
public record PlanLimits(Integer maxRestaurants, Integer maxUserAccounts) {

    public static PlanLimits unlimited() {
        return new PlanLimits(null, null);
    }

    public Integer limitFor(Resource resource) {
        return switch (resource) {
            case RESTAURANT -> maxRestaurants;
            case USER_ACCOUNT -> maxUserAccounts;
        };
    }

    public boolean isUnlimited(Resource resource) {
        return limitFor(resource) == null;
    }
}
```

`PlanDefinition.java`:

```java
package com.restaurante.subscription.catalog;

import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;

import java.util.Set;

/**
 * Definición completa de un plan: qué incluye y cuánto deja hacer.
 * El nombre comercial vive aquí para que la interfaz no lo reinvente.
 */
public record PlanDefinition(
        PlanCode code,
        String displayName,
        Set<Feature> features,
        PlanLimits limits
) {
    public PlanDefinition {
        features = Set.copyOf(features); // inmutable
    }
}
```

`PlanCatalog.java`:

```java
package com.restaurante.subscription.catalog;

import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

/**
 * Fuente única de verdad de qué incluye cada plan.
 *
 * Vive en código y no en base de datos a propósito: con ddl-auto=validate, una
 * tabla plan_features mal sembrada dejaría a TODOS los tenants sin ninguna
 * feature, convirtiendo un fallo de datos en una caída del producto. Además, un
 * catálogo en código se fija con un test (PlanCatalogTest); una fila, no.
 *
 * Añadir un plan o una feature no requiere tocar ningún servicio: basta con el
 * enum y una entrada aquí.
 */
public final class PlanCatalog {

    private PlanCatalog() {
        throw new UnsupportedOperationException("Clase de utilidad, no instanciable");
    }

    private static final Map<PlanCode, PlanDefinition> CATALOGO = Map.of(
            PlanCode.NORMAL, new PlanDefinition(
                    PlanCode.NORMAL,
                    "Normal",
                    EnumSet.noneOf(Feature.class),
                    new PlanLimits(1, 5)
            ),
            PlanCode.PRO, new PlanDefinition(
                    PlanCode.PRO,
                    "Pro",
                    EnumSet.allOf(Feature.class),
                    PlanLimits.unlimited()
            )
    );

    public static PlanDefinition get(PlanCode code) {
        return CATALOGO.get(code);
    }

    public static Map<PlanCode, PlanDefinition> all() {
        return CATALOGO;
    }

    public static boolean hasFeature(PlanCode code, Feature feature) {
        PlanDefinition definicion = CATALOGO.get(code);
        return definicion != null && definicion.features().contains(feature);
    }

    public static PlanLimits limits(PlanCode code) {
        PlanDefinition definicion = CATALOGO.get(code);
        return definicion != null ? definicion.limits() : new PlanLimits(0, 0);
    }

    /**
     * Plan más barato que incluye la feature. Se usa para decirle al usuario a
     * qué tiene que subir, en vez de dejarlo adivinando.
     */
    public static PlanCode minimumPlanFor(Feature feature) {
        for (PlanCode code : PlanCode.values()) {
            if (hasFeature(code, feature)) {
                return code;
            }
        }
        return PlanCode.PRO;
    }
}
```

- [ ] **Step 5: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante_manage && mvn test -Dtest='PlanCatalogTest,SubscriptionStatusTest'`
Expected: PASS — `Tests run: 11, Failures: 0, Errors: 0`.

- [ ] **Step 6: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/subscription \
        restaurante_manage/src/test/java/com/restaurante/subscription
git commit -m "feat(billing): añadir el catálogo de planes y sus features

El catálogo vive en código y no en tablas: con ddl-auto=validate, una tabla
mal sembrada dejaría a todos los tenants sin features. Un test fija la matriz
plan x feature para que no se desvíe de lo que se vende."
```

---

## Task 2: Entidades, migración V9 y arranque verificado

Aquí es donde se puede romper producción, así que el paso de verificación contra el MySQL
real es obligatorio y no se salta.

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/entity/Subscription.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/entity/ProcessedStripeEvent.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/repository/SubscriptionRepository.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/repository/ProcessedStripeEventRepository.java`
- Create: `restaurante_manage/src/main/resources/db/migration/V9__subscriptions.sql`
- Modify: `restaurante_manage/src/main/java/com/restaurante/restaurant/entity/Restaurant.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/repository/SubscriptionRepositoryTest.java`

**Interfaces:**
- Consumes: `PlanCode`, `SubscriptionStatus` (Task 1); `Tenant`, `BaseEntity` (existentes).
- Produces:
  - `Subscription` con getters/setters Lombok y el campo `legacyGrant`
  - `SubscriptionRepository.findByTenantIdAndDeletedFalse(Long): Optional<Subscription>`
  - `SubscriptionRepository.findByStripeSubscriptionId(String): Optional<Subscription>`
  - `SubscriptionRepository.findByStripeCustomerId(String): Optional<Subscription>`
  - `ProcessedStripeEventRepository.existsByStripeEventId(String): boolean`
  - `Restaurant.getActiveUnderPlan(): Boolean` / `setActiveUnderPlan(Boolean)`

- [ ] **Step 1: Escribir el test del repositorio**

`SubscriptionRepositoryTest.java`:

```java
package com.restaurante.subscription.repository;

import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

@SpringBootTest
@ActiveProfiles("dev")
@Transactional
class SubscriptionRepositoryTest {

    @Autowired
    private SubscriptionRepository subscriptionRepository;

    @Autowired
    private TenantRepository tenantRepository;

    private Tenant crearTenant(String nombre, String slug) {
        Tenant tenant = new Tenant();
        tenant.setName(nombre);
        tenant.setSlug(slug);
        tenant.setActive(true);
        return tenantRepository.save(tenant);
    }

    @Test
    @DisplayName("Se guarda y se recupera la suscripción por tenant")
    void guardaYRecuperaPorTenant() {
        Tenant tenant = crearTenant("Tenant Test A", "tenant-test-a");

        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(PlanCode.PRO);
        suscripcion.setStatus(SubscriptionStatus.ACTIVE);
        suscripcion.setLegacyGrant(true);
        subscriptionRepository.save(suscripcion);

        Optional<Subscription> encontrada =
                subscriptionRepository.findByTenantIdAndDeletedFalse(tenant.getId());

        assertTrue(encontrada.isPresent());
        assertEquals(PlanCode.PRO, encontrada.get().getPlanCode());
        assertEquals(SubscriptionStatus.ACTIVE, encontrada.get().getStatus());
        assertTrue(encontrada.get().isLegacyGrant());
        assertNull(encontrada.get().getStripeSubscriptionId());
        assertNotNull(encontrada.get().getCreatedAt());
    }

    @Test
    @DisplayName("Se recupera por el identificador de suscripción de Stripe")
    void recuperaPorStripeSubscriptionId() {
        Tenant tenant = crearTenant("Tenant Test B", "tenant-test-b");

        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(PlanCode.NORMAL);
        suscripcion.setStatus(SubscriptionStatus.TRIALING);
        suscripcion.setStripeCustomerId("cus_test_123");
        suscripcion.setStripeSubscriptionId("sub_test_123");
        subscriptionRepository.save(suscripcion);

        assertTrue(subscriptionRepository.findByStripeSubscriptionId("sub_test_123").isPresent());
        assertTrue(subscriptionRepository.findByStripeCustomerId("cus_test_123").isPresent());
        assertTrue(subscriptionRepository.findByStripeSubscriptionId("sub_inexistente").isEmpty());
    }

    @Test
    @DisplayName("Una suscripción borrada lógicamente no se devuelve")
    void ignoraLasBorradas() {
        Tenant tenant = crearTenant("Tenant Test C", "tenant-test-c");

        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(PlanCode.NORMAL);
        suscripcion.setStatus(SubscriptionStatus.ACTIVE);
        suscripcion.setDeleted(true);
        subscriptionRepository.save(suscripcion);

        assertTrue(subscriptionRepository.findByTenantIdAndDeletedFalse(tenant.getId()).isEmpty());
    }
}
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=SubscriptionRepositoryTest`
Expected: FAIL de compilación — no existen `Subscription` ni `SubscriptionRepository`.

- [ ] **Step 3: Escribir las entidades**

`Subscription.java`:

```java
package com.restaurante.subscription.entity;

import com.restaurante.common.audit.BaseEntity;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.tenant.entity.Tenant;
import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Suscripción de un tenant. Una por tenant (tenant_id es UNIQUE).
 *
 * El estado NUNCA se cambia desde una petición del frontend: sólo desde webhooks
 * de Stripe con firma verificada, o desde la concesión de cortesía (legacyGrant).
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "subscriptions")
public class Subscription extends BaseEntity {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @OneToOne(fetch = FetchType.LAZY, optional = false)
    @JoinColumn(name = "tenant_id", nullable = false, unique = true)
    private Tenant tenant;

    @Enumerated(EnumType.STRING)
    @Column(name = "plan_code", nullable = false, length = 30)
    private PlanCode planCode;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 30)
    private SubscriptionStatus status;

    @Column(name = "stripe_customer_id", length = 255)
    private String stripeCustomerId;

    @Column(name = "stripe_subscription_id", length = 255, unique = true)
    private String stripeSubscriptionId;

    @Column(name = "stripe_price_id", length = 255)
    private String stripePriceId;

    @Column(name = "current_period_start")
    private LocalDateTime currentPeriodStart;

    @Column(name = "current_period_end")
    private LocalDateTime currentPeriodEnd;

    @Column(name = "trial_end")
    private LocalDateTime trialEnd;

    @Column(name = "cancel_at_period_end", nullable = false)
    private boolean cancelAtPeriodEnd = false;

    /**
     * Concesión de cortesía: el plan es válido aunque no haya suscripción en
     * Stripe. Lo usan los tenants que ya existían antes de implantar el cobro,
     * para que la migración no rompa ninguna cuenta.
     */
    @Column(name = "legacy_grant", nullable = false)
    private boolean legacyGrant = false;

    /**
     * Momento del último evento de Stripe aplicado. Stripe no garantiza el orden
     * de entrega: un evento más antiguo que este se descarta.
     */
    @Column(name = "last_stripe_event_at")
    private LocalDateTime lastStripeEventAt;
}
```

`ProcessedStripeEvent.java`:

```java
package com.restaurante.subscription.entity;

import jakarta.persistence.*;
import lombok.Getter;
import lombok.NoArgsConstructor;
import lombok.Setter;

import java.time.LocalDateTime;

/**
 * Registro de eventos de Stripe ya procesados.
 *
 * La idempotencia se consigue con la restricción UNIQUE de stripe_event_id, no
 * con una consulta previa: una comprobación previa tiene condición de carrera
 * (dos entregas simultáneas del mismo evento la pasarían las dos), una UNIQUE no.
 *
 * No extiende BaseEntity: es una bitácora técnica, no un dato de negocio, y no
 * tiene sentido el borrado lógico ni la auditoría de actualización.
 */
@Getter
@Setter
@NoArgsConstructor
@Entity
@Table(name = "stripe_processed_events")
public class ProcessedStripeEvent {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "stripe_event_id", nullable = false, unique = true, length = 255)
    private String stripeEventId;

    @Column(nullable = false, length = 100)
    private String type;

    @Column(name = "processed_at", nullable = false)
    private LocalDateTime processedAt;

    public ProcessedStripeEvent(String stripeEventId, String type) {
        this.stripeEventId = stripeEventId;
        this.type = type;
        this.processedAt = LocalDateTime.now();
    }
}
```

- [ ] **Step 4: Escribir los repositorios**

`SubscriptionRepository.java`:

```java
package com.restaurante.subscription.repository;

import com.restaurante.subscription.entity.Subscription;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

import java.util.Optional;

@Repository
public interface SubscriptionRepository extends JpaRepository<Subscription, Long> {

    Optional<Subscription> findByTenantIdAndDeletedFalse(Long tenantId);

    Optional<Subscription> findByStripeSubscriptionId(String stripeSubscriptionId);

    Optional<Subscription> findByStripeCustomerId(String stripeCustomerId);
}
```

`ProcessedStripeEventRepository.java`:

```java
package com.restaurante.subscription.repository;

import com.restaurante.subscription.entity.ProcessedStripeEvent;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;

@Repository
public interface ProcessedStripeEventRepository extends JpaRepository<ProcessedStripeEvent, Long> {

    boolean existsByStripeEventId(String stripeEventId);
}
```

- [ ] **Step 5: Añadir la columna a Restaurant**

En `restaurant/entity/Restaurant.java`, justo después de
`defaultReservationDurationMinutes`:

```java
    /**
     * Si el local está operativo bajo el plan contratado. Un tenant que baja de
     * PRO a NORMAL con varios locales conserva TODOS sus datos: los sobrantes
     * pasan a solo lectura con este flag en false, y se reactivan solos al
     * volver a PRO. Nunca se borra ni se marca como eliminado un local por
     * motivos de plan.
     */
    @Column(name = "active_under_plan", nullable = false)
    private Boolean activeUnderPlan = true;
```

- [ ] **Step 6: Escribir la migración V9**

`src/main/resources/db/migration/V9__subscriptions.sql`:

```sql
-- ============================================================================
-- V9 — Suscripciones por tenant (planes NORMAL/PRO con Stripe Billing).
-- ============================================================================
-- 100 % aditiva: no borra ni modifica ningún dato existente.
--
-- Los tenants que ya existen reciben una concesión de cortesía PRO
-- (legacy_grant = 1, sin identificadores de Stripe) para que la implantación del
-- cobro no rompa ninguna cuenta el día del despliegue. La conversión a plan de
-- pago se hace después, tenant a tenant, poniendo legacy_grant = 0.

CREATE TABLE `subscriptions` (
  `deleted` bit(1) NOT NULL,
  `cancel_at_period_end` bit(1) NOT NULL,
  `legacy_grant` bit(1) NOT NULL,
  `created_at` datetime(6) NOT NULL,
  `updated_at` datetime(6) NOT NULL,
  `deleted_at` datetime(6) DEFAULT NULL,
  `current_period_start` datetime(6) DEFAULT NULL,
  `current_period_end` datetime(6) DEFAULT NULL,
  `trial_end` datetime(6) DEFAULT NULL,
  `last_stripe_event_at` datetime(6) DEFAULT NULL,
  `id` bigint NOT NULL AUTO_INCREMENT,
  `tenant_id` bigint NOT NULL,
  `plan_code` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `status` varchar(30) COLLATE utf8mb4_unicode_ci NOT NULL,
  `stripe_customer_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stripe_subscription_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  `stripe_price_id` varchar(255) COLLATE utf8mb4_unicode_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_subscriptions_tenant` (`tenant_id`),
  UNIQUE KEY `uk_subscriptions_stripe_subscription` (`stripe_subscription_id`),
  KEY `idx_subscriptions_stripe_customer` (`stripe_customer_id`),
  CONSTRAINT `fk_subscriptions_tenant` FOREIGN KEY (`tenant_id`) REFERENCES `tenants` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bitácora de idempotencia de webhooks. La UNIQUE de stripe_event_id es lo que
-- garantiza que un evento reentregado por Stripe no se procese dos veces.
CREATE TABLE `stripe_processed_events` (
  `id` bigint NOT NULL AUTO_INCREMENT,
  `stripe_event_id` varchar(255) COLLATE utf8mb4_unicode_ci NOT NULL,
  `type` varchar(100) COLLATE utf8mb4_unicode_ci NOT NULL,
  `processed_at` datetime(6) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_stripe_processed_events_event` (`stripe_event_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bloqueo suave del downgrade. Todos los locales existentes quedan activos.
ALTER TABLE `restaurants`
  ADD COLUMN `active_under_plan` bit(1) NOT NULL DEFAULT b'1';

-- Concesión de cortesía para los tenants que ya existían.
INSERT INTO `subscriptions`
  (`tenant_id`, `plan_code`, `status`, `legacy_grant`, `cancel_at_period_end`,
   `deleted`, `created_at`, `updated_at`)
SELECT t.`id`, 'PRO', 'ACTIVE', b'1', b'0', b'0', NOW(6), NOW(6)
FROM `tenants` t
WHERE t.`deleted` = b'0'
  AND NOT EXISTS (SELECT 1 FROM `subscriptions` s WHERE s.`tenant_id` = t.`id`);
```

- [ ] **Step 7: Ejecutar el test y verificar que pasa**

Run: `cd restaurante_manage && mvn test -Dtest=SubscriptionRepositoryTest`
Expected: PASS — 3 tests. (Esto valida el mapeo JPA contra H2, no la migración.)

- [ ] **Step 8: Verificar la migración contra el MySQL real — PASO CRÍTICO**

Con el contenedor `restaurant-mysql` levantado (puerto 3307), arrancar el backend **sin
perfil** para que Flyway aplique la V9 y Hibernate valide el esquema:

```bash
cd restaurante_manage && mvn spring-boot:run
```

Expected en el log:
- `Migrating schema ... to version "9 - subscriptions"`
- `Successfully applied 1 migration`
- Arranque completo sin `SchemaManagementException`. **Si Hibernate se queja de que falta o
  sobra una columna, la migración y la entidad no coinciden: arreglar antes de seguir.**

Comprobar el resultado (sólo lectura) y parar el backend:

```bash
docker exec restaurant-mysql mysql -uroot -proot restaurant_db -t -e \
 "SELECT s.id, s.tenant_id, t.name, s.plan_code, s.status, s.legacy_grant+0 AS cortesia
    FROM subscriptions s JOIN tenants t ON t.id = s.tenant_id;
  SELECT COUNT(*) AS locales_activos FROM restaurants WHERE active_under_plan = b'1';"
```

Expected: **2 filas** (`Demo Gourmet` y `Legacy/Test`), ambas `PRO / ACTIVE / cortesia=1`, y
`locales_activos = 7`.

- [ ] **Step 9: Sembrar las suscripciones de los datos de demostración**

El perfil `dev` no ejecuta Flyway, así que los dos tenants demo nacerían **sin suscripción**
y la aplicación se vería como si todo estuviera bloqueado. En
`demodata/DemoDataInitializer.java`, tras `createTenantIfNotExists(...)`, añadir:

```java
    /**
     * Los tenants demo reciben PRO activo. Sin esto, el perfil dev arrancaría con
     * todo bloqueado por plan y parecería que la aplicación está rota.
     */
    private void createSubscriptionIfNotExists(Tenant tenant, PlanCode plan) {
        if (subscriptionRepository.findByTenantIdAndDeletedFalse(tenant.getId()).isPresent()) {
            return;
        }
        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(plan);
        suscripcion.setStatus(SubscriptionStatus.ACTIVE);
        suscripcion.setLegacyGrant(true);
        subscriptionRepository.save(suscripcion);
        log.info("[DemoData] Suscripción {} creada para el tenant '{}'", plan, tenant.getName());
    }
```

Y llamarla para ambos tenants:

```java
        createSubscriptionIfNotExists(demoGourmet, PlanCode.PRO);
        // Legacy/Test se queda en NORMAL a propósito: así el perfil dev tiene un
        // inquilino con el que probar los límites y el diálogo de mejora de plan.
        createSubscriptionIfNotExists(legacyTest, PlanCode.NORMAL);
```

Verificar: `cd restaurante_manage && mvn spring-boot:run -Dspring-boot.run.profiles=dev` y
comprobar en el log las dos líneas `[DemoData] Suscripción ... creada`. Parar el proceso.

- [ ] **Step 10: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/subscription \
        restaurante_manage/src/main/java/com/restaurante/restaurant/entity/Restaurant.java \
        restaurante_manage/src/main/java/com/restaurante/demodata/DemoDataInitializer.java \
        restaurante_manage/src/main/resources/db/migration/V9__subscriptions.sql \
        restaurante_manage/src/test/java/com/restaurante/subscription
git commit -m "feat(billing): añadir las entidades de suscripción y la migración V9

La migración es 100 % aditiva y concede PRO de cortesía a los tenants que ya
existían, para que implantar el cobro no rompa ninguna cuenta. Restaurant gana
active_under_plan, el bloqueo suave que permite bajar de plan sin borrar datos.

Verificado contra el MySQL local: Flyway aplica la V9 y Hibernate valida el
esquema al arrancar."
```

---

## Task 3: EntitlementService y errores estructurados

La autoridad única de consulta del plan, más el 403 tipado que el frontend necesita para
distinguir "no tienes permiso" de "tu plan no lo incluye".

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/common/exception/PlanUpgradeRequiredException.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/common/exception/PlanLimitReachedException.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/service/EffectiveSubscription.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/service/EntitlementService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/common/dto/ApiResponse.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/common/exception/GlobalExceptionHandler.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/restaurant/repository/RestaurantRepository.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/user/repository/UserRepository.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/service/EntitlementServiceTest.java`

**Interfaces:**
- Consumes: `PlanCatalog`, `PlanCode`, `Feature`, `Resource`, `SubscriptionStatus` (Task 1);
  `SubscriptionRepository` (Task 2); `CurrentUserService`, `RestaurantRepository`,
  `UserRepository` (existentes).
- Produces:
  - `EffectiveSubscription(PlanCode plan, SubscriptionStatus status, boolean hasAccess, PlanLimits limits, boolean legacyGrant, LocalDateTime currentPeriodEnd, LocalDateTime trialEnd, boolean cancelAtPeriodEnd)`
    con `Set<Feature> features()` y `boolean has(Feature)`
  - `EntitlementService.resolve(Long tenantId): EffectiveSubscription`
  - `EntitlementService.resolveForCurrentUser(): EffectiveSubscription`
  - `EntitlementService.hasFeature(Long tenantId, Feature): boolean`
  - `EntitlementService.require(Feature): void` — lanza `PlanUpgradeRequiredException`
  - `EntitlementService.requireCapacity(Resource): void` — lanza `PlanLimitReachedException`
  - `EntitlementService.currentUsage(Long tenantId, Resource): long`
  - `PlanUpgradeRequiredException.getFeature(): Feature`, `.getRequiredPlan(): PlanCode`, constante `CODE`
  - `PlanLimitReachedException.getResource(): Resource`, `.getLimit(): int`, `.getCurrent(): long`, `.getRequiredPlan(): PlanCode`, constante `CODE`
  - `ApiResponse.error(String code, String message)` y `ApiResponse.error(String code, String message, T data)`
  - `RestaurantRepository.countByTenantIdAndDeletedFalse(Long): long`
  - `UserRepository.countByTenantIdAndDeletedFalse(Long): long`

- [ ] **Step 1: Escribir el test del servicio**

`EntitlementServiceTest.java`:

```java
package com.restaurante.subscription.service;

import com.restaurante.common.exception.PlanLimitReachedException;
import com.restaurante.common.exception.PlanUpgradeRequiredException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.Resource;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class EntitlementServiceTest {

    @Mock private SubscriptionRepository subscriptionRepository;
    @Mock private CurrentUserService currentUserService;
    @Mock private RestaurantRepository restaurantRepository;
    @Mock private UserRepository userRepository;

    @InjectMocks private EntitlementService entitlementService;

    private static final Long TENANT_ID = 7L;

    @BeforeEach
    void configurarUsuarioPorDefecto() {
        lenient().when(currentUserService.isSuperAdmin()).thenReturn(false);
        lenient().when(currentUserService.getCurrentTenantId()).thenReturn(TENANT_ID);
    }

    private void conSuscripcion(PlanCode plan, SubscriptionStatus estado) {
        Subscription suscripcion = new Subscription();
        suscripcion.setPlanCode(plan);
        suscripcion.setStatus(estado);
        when(subscriptionRepository.findByTenantIdAndDeletedFalse(TENANT_ID))
                .thenReturn(Optional.of(suscripcion));
    }

    @Test
    @DisplayName("PRO activo tiene las features del plan")
    void proTieneFeatures() {
        conSuscripcion(PlanCode.PRO, SubscriptionStatus.ACTIVE);
        assertTrue(entitlementService.hasFeature(TENANT_ID, Feature.EXPORT_DATA));
        assertDoesNotThrow(() -> entitlementService.require(Feature.EXPORT_DATA));
    }

    @Test
    @DisplayName("NORMAL no tiene features PRO y el error indica a qué plan subir")
    void normalNoTieneFeaturesPro() {
        conSuscripcion(PlanCode.NORMAL, SubscriptionStatus.ACTIVE);

        assertFalse(entitlementService.hasFeature(TENANT_ID, Feature.EXPORT_DATA));

        PlanUpgradeRequiredException error = assertThrows(PlanUpgradeRequiredException.class,
                () -> entitlementService.require(Feature.EXPORT_DATA));
        assertEquals(Feature.EXPORT_DATA, error.getFeature());
        assertEquals(PlanCode.PRO, error.getRequiredPlan());
    }

    @Test
    @DisplayName("Un estado sin acceso anula las features aunque el plan sea PRO")
    void canceladaNoConcedeNada() {
        conSuscripcion(PlanCode.PRO, SubscriptionStatus.CANCELED);
        assertFalse(entitlementService.hasFeature(TENANT_ID, Feature.EXPORT_DATA));
        assertThrows(PlanUpgradeRequiredException.class,
                () -> entitlementService.require(Feature.EXPORT_DATA));
    }

    @Test
    @DisplayName("PAST_DUE conserva el acceso mientras Stripe reintenta el cobro")
    void pagoFallidoConservaAcceso() {
        conSuscripcion(PlanCode.PRO, SubscriptionStatus.PAST_DUE);
        assertTrue(entitlementService.hasFeature(TENANT_ID, Feature.EXPORT_DATA));
    }

    @Test
    @DisplayName("Un tenant sin suscripción se trata como sin acceso, sin lanzar excepción")
    void tenantSinSuscripcion() {
        when(subscriptionRepository.findByTenantIdAndDeletedFalse(TENANT_ID))
                .thenReturn(Optional.empty());

        EffectiveSubscription efectiva = entitlementService.resolve(TENANT_ID);
        assertFalse(efectiva.hasAccess());
        assertTrue(efectiva.features().isEmpty());
        assertFalse(entitlementService.hasFeature(TENANT_ID, Feature.MULTI_RESTAURANT));
    }

    @Test
    @DisplayName("SUPER_ADMIN está exento de features y de límites")
    void superAdminExento() {
        when(currentUserService.isSuperAdmin()).thenReturn(true);
        when(currentUserService.getCurrentTenantId()).thenReturn(null);

        assertDoesNotThrow(() -> entitlementService.require(Feature.EXPORT_DATA));
        assertDoesNotThrow(() -> entitlementService.requireCapacity(Resource.RESTAURANT));
    }

    @Test
    @DisplayName("NORMAL con 1 local no puede crear otro y el error lleva el detalle")
    void limiteDeLocalesAlcanzado() {
        conSuscripcion(PlanCode.NORMAL, SubscriptionStatus.ACTIVE);
        when(restaurantRepository.countByTenantIdAndDeletedFalse(TENANT_ID)).thenReturn(1L);

        PlanLimitReachedException error = assertThrows(PlanLimitReachedException.class,
                () -> entitlementService.requireCapacity(Resource.RESTAURANT));
        assertEquals(Resource.RESTAURANT, error.getResource());
        assertEquals(1, error.getLimit());
        assertEquals(1L, error.getCurrent());
        assertEquals(PlanCode.PRO, error.getRequiredPlan());
    }

    @Test
    @DisplayName("NORMAL con 4 cuentas todavía puede crear una más")
    void limiteDeCuentasConMargen() {
        conSuscripcion(PlanCode.NORMAL, SubscriptionStatus.ACTIVE);
        when(userRepository.countByTenantIdAndDeletedFalse(TENANT_ID)).thenReturn(4L);
        assertDoesNotThrow(() -> entitlementService.requireCapacity(Resource.USER_ACCOUNT));
    }

    @Test
    @DisplayName("PRO no tiene límite de locales")
    void proSinLimiteDeLocales() {
        conSuscripcion(PlanCode.PRO, SubscriptionStatus.ACTIVE);
        when(restaurantRepository.countByTenantIdAndDeletedFalse(TENANT_ID)).thenReturn(42L);
        assertDoesNotThrow(() -> entitlementService.requireCapacity(Resource.RESTAURANT));
    }

    @Test
    @DisplayName("Un usuario sin tenant y sin ser SUPER_ADMIN no tiene ninguna feature")
    void usuarioSinTenant() {
        when(currentUserService.getCurrentTenantId()).thenReturn(null);
        assertThrows(PlanUpgradeRequiredException.class,
                () -> entitlementService.require(Feature.EXPORT_DATA));
    }
}
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=EntitlementServiceTest`
Expected: FAIL de compilación — no existen `EntitlementService` ni las excepciones.

- [ ] **Step 3: Escribir las excepciones**

`PlanUpgradeRequiredException.java`:

```java
package com.restaurante.common.exception;

import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import lombok.Getter;

/**
 * El tenant intenta usar una funcionalidad que su plan no incluye.
 *
 * Es distinto de AccessDeniedException a propósito: allí el problema es QUIÉN
 * eres (rol), aquí es QUÉ ha contratado tu empresa. El frontend necesita
 * distinguirlos para mostrar un diálogo de mejora de plan en vez de un error.
 */
@Getter
public class PlanUpgradeRequiredException extends RuntimeException {

    public static final String CODE = "PLAN_UPGRADE_REQUIRED";

    private final Feature feature;
    private final PlanCode requiredPlan;

    public PlanUpgradeRequiredException(Feature feature, PlanCode requiredPlan, String message) {
        super(message);
        this.feature = feature;
        this.requiredPlan = requiredPlan;
    }
}
```

`PlanLimitReachedException.java`:

```java
package com.restaurante.common.exception;

import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.Resource;
import lombok.Getter;

/**
 * El tenant ha alcanzado la cuota de su plan para un recurso (locales, cuentas).
 * Lleva el detalle numérico para que la interfaz pueda decir "1 de 1" en lugar
 * de un mensaje genérico.
 */
@Getter
public class PlanLimitReachedException extends RuntimeException {

    public static final String CODE = "PLAN_LIMIT_REACHED";

    private final Resource resource;
    private final int limit;
    private final long current;
    private final PlanCode requiredPlan;

    public PlanLimitReachedException(Resource resource, int limit, long current,
                                     PlanCode requiredPlan, String message) {
        super(message);
        this.resource = resource;
        this.limit = limit;
        this.current = current;
        this.requiredPlan = requiredPlan;
    }
}
```

- [ ] **Step 4: Escribir EffectiveSubscription y EntitlementService**

`EffectiveSubscription.java`:

```java
package com.restaurante.subscription.service;

import com.restaurante.subscription.catalog.PlanCatalog;
import com.restaurante.subscription.catalog.PlanLimits;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;

import java.time.LocalDateTime;
import java.util.Set;

/**
 * Vista resuelta de la suscripción de un tenant: el plan y el estado ya
 * combinados en la única pregunta que importa, hasAccess.
 */
public record EffectiveSubscription(
        PlanCode plan,
        SubscriptionStatus status,
        boolean hasAccess,
        PlanLimits limits,
        boolean legacyGrant,
        LocalDateTime currentPeriodEnd,
        LocalDateTime trialEnd,
        boolean cancelAtPeriodEnd
) {

    /** Tenant sin suscripción: sin plan, sin features y sin cuota. */
    public static EffectiveSubscription none() {
        return new EffectiveSubscription(
                null, null, false, new PlanLimits(0, 0), false, null, null, false);
    }

    public Set<Feature> features() {
        if (!hasAccess || plan == null) {
            return Set.of();
        }
        return PlanCatalog.get(plan).features();
    }

    public boolean has(Feature feature) {
        return features().contains(feature);
    }
}
```

`EntitlementService.java`:

```java
package com.restaurante.subscription.service;

import com.restaurante.common.exception.PlanLimitReachedException;
import com.restaurante.common.exception.PlanUpgradeRequiredException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.subscription.catalog.PlanCatalog;
import com.restaurante.subscription.catalog.PlanLimits;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.Resource;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.user.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Autoridad única sobre qué puede hacer un tenant según su plan.
 *
 * Es a los planes lo que CurrentUserService es al aislamiento multi-tenant: si
 * añades una funcionalidad de pago, la compruebas aquí y en ningún otro sitio.
 *
 * No se cachea a propósito: son consultas por clave indexada, despreciables
 * frente a las que ya hace la aplicación, y una caché introduciría una ventana
 * en la que un tenant que acaba de pagar sigue viendo su plan viejo.
 */
@Service
@RequiredArgsConstructor
public class EntitlementService {

    private final SubscriptionRepository subscriptionRepository;
    private final CurrentUserService currentUserService;
    private final RestaurantRepository restaurantRepository;
    private final UserRepository userRepository;

    @Transactional(readOnly = true)
    public EffectiveSubscription resolve(Long tenantId) {
        if (tenantId == null) {
            return EffectiveSubscription.none();
        }
        return subscriptionRepository.findByTenantIdAndDeletedFalse(tenantId)
                .map(this::toEffective)
                .orElseGet(EffectiveSubscription::none);
    }

    @Transactional(readOnly = true)
    public EffectiveSubscription resolveForCurrentUser() {
        return resolve(currentUserService.getCurrentTenantId());
    }

    private EffectiveSubscription toEffective(Subscription suscripcion) {
        boolean acceso = suscripcion.getStatus() != null && suscripcion.getStatus().grantsAccess();
        PlanLimits limites = acceso
                ? PlanCatalog.limits(suscripcion.getPlanCode())
                : new PlanLimits(0, 0);
        return new EffectiveSubscription(
                suscripcion.getPlanCode(),
                suscripcion.getStatus(),
                acceso,
                limites,
                suscripcion.isLegacyGrant(),
                suscripcion.getCurrentPeriodEnd(),
                suscripcion.getTrialEnd(),
                suscripcion.isCancelAtPeriodEnd()
        );
    }

    @Transactional(readOnly = true)
    public boolean hasFeature(Long tenantId, Feature feature) {
        return resolve(tenantId).has(feature);
    }

    /**
     * Exige que el tenant del usuario actual tenga la feature contratada.
     * El SUPER_ADMIN es el dueño del SaaS: nunca se le limita.
     */
    @Transactional(readOnly = true)
    public void require(Feature feature) {
        if (currentUserService.isSuperAdmin()) {
            return;
        }
        if (!resolveForCurrentUser().has(feature)) {
            PlanCode minimo = PlanCatalog.minimumPlanFor(feature);
            throw new PlanUpgradeRequiredException(feature, minimo,
                    "Esta función requiere el plan " + PlanCatalog.get(minimo).displayName());
        }
    }

    /**
     * Exige que quede cuota del recurso antes de crear uno nuevo.
     * Se llama ANTES de persistir, nunca después.
     */
    @Transactional(readOnly = true)
    public void requireCapacity(Resource resource) {
        if (currentUserService.isSuperAdmin()) {
            return;
        }
        Long tenantId = currentUserService.getCurrentTenantId();
        PlanLimits limites = resolve(tenantId).limits();

        if (limites.isUnlimited(resource)) {
            return;
        }

        int limite = limites.limitFor(resource);
        long usoActual = currentUsage(tenantId, resource);
        if (usoActual >= limite) {
            throw new PlanLimitReachedException(
                    resource, limite, usoActual, PlanCode.PRO, mensajeDeLimite(resource, limite));
        }
    }

    @Transactional(readOnly = true)
    public long currentUsage(Long tenantId, Resource resource) {
        if (tenantId == null) {
            return 0L;
        }
        return switch (resource) {
            case RESTAURANT -> restaurantRepository.countByTenantIdAndDeletedFalse(tenantId);
            case USER_ACCOUNT -> userRepository.countByTenantIdAndDeletedFalse(tenantId);
        };
    }

    private String mensajeDeLimite(Resource resource, int limite) {
        return switch (resource) {
            case RESTAURANT -> limite == 1
                    ? "Tu plan incluye 1 local"
                    : "Tu plan incluye " + limite + " locales";
            case USER_ACCOUNT -> "Tu plan incluye " + limite + " cuentas de usuario";
        };
    }
}
```

- [ ] **Step 5: Añadir los métodos de conteo a los repositorios existentes**

En `restaurant/repository/RestaurantRepository.java`:

```java
    long countByTenantIdAndDeletedFalse(Long tenantId);
```

En `user/repository/UserRepository.java`:

```java
    long countByTenantIdAndDeletedFalse(Long tenantId);
```

- [ ] **Step 6: Añadir el campo `code` a ApiResponse**

En `common/dto/ApiResponse.java`, añadir el campo justo tras `message`. La clase ya lleva
`@JsonInclude(NON_NULL)`, así que **ninguna respuesta existente cambia**:

```java
    /**
     * Código de error estable y legible por máquina (PLAN_UPGRADE_REQUIRED,
     * PLAN_LIMIT_REACHED...). Sólo se rellena en los errores que el cliente debe
     * distinguir por programa; el resto siguen llegando sin él.
     */
    private String code;
```

Y los dos constructores estáticos nuevos, junto al `error(String)` existente:

```java
    public static <T> ApiResponse<T> error(String code, String message) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(code)
                .message(message)
                .build();
    }

    public static <T> ApiResponse<T> error(String code, String message, T data) {
        return ApiResponse.<T>builder()
                .success(false)
                .code(code)
                .message(message)
                .data(data)
                .build();
    }
```

- [ ] **Step 7: Registrar los handlers en GlobalExceptionHandler**

En `common/exception/GlobalExceptionHandler.java`, junto a los demás handlers. `HashMap` y
`Map` ya están importados; las excepciones son del mismo paquete, así que no hacen falta
imports nuevos:

```java
    /**
     * El plan del tenant no incluye la función. Se devuelve 403 con código para
     * que el frontend abra el diálogo de mejora de plan en lugar de un error
     * genérico. El mensaje nunca revela datos de facturación.
     */
    @ExceptionHandler(PlanUpgradeRequiredException.class)
    public ResponseEntity<ApiResponse<Map<String, Object>>> handlePlanUpgradeRequired(
            PlanUpgradeRequiredException ex) {
        Map<String, Object> detalle = new HashMap<>();
        detalle.put("feature", ex.getFeature().name());
        detalle.put("requiredPlan", ex.getRequiredPlan().name());
        return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(
                        PlanUpgradeRequiredException.CODE, ex.getMessage(), detalle));
    }

    @ExceptionHandler(PlanLimitReachedException.class)
    public ResponseEntity<ApiResponse<Map<String, Object>>> handlePlanLimitReached(
            PlanLimitReachedException ex) {
        Map<String, Object> detalle = new HashMap<>();
        detalle.put("resource", ex.getResource().name());
        detalle.put("limit", ex.getLimit());
        detalle.put("current", ex.getCurrent());
        detalle.put("requiredPlan", ex.getRequiredPlan().name());
        return ResponseEntity
                .status(HttpStatus.FORBIDDEN)
                .body(ApiResponse.error(
                        PlanLimitReachedException.CODE, ex.getMessage(), detalle));
    }
```

- [ ] **Step 8: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante_manage && mvn test -Dtest='EntitlementServiceTest,GlobalExceptionHandlerTest'`
Expected: PASS. `GlobalExceptionHandlerTest` ya existía: **debe seguir en verde**, lo que
confirma que añadir `code` no ha roto el contrato de respuesta.

- [ ] **Step 9: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/common \
        restaurante_manage/src/main/java/com/restaurante/subscription \
        restaurante_manage/src/main/java/com/restaurante/restaurant/repository/RestaurantRepository.java \
        restaurante_manage/src/main/java/com/restaurante/user/repository/UserRepository.java \
        restaurante_manage/src/test/java/com/restaurante/subscription
git commit -m "feat(billing): anadir EntitlementService y errores de plan tipados"
```

---

## Task 4: Aplicar los límites de locales y cuentas

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/restaurant/service/RestaurantService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/user/service/UserService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/auth/service/AuthService.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/PlanLimitsEndpointIntegrationTest.java`

**Interfaces:**
- Consumes: `EntitlementService.requireCapacity(Resource)` (Task 3); `Subscription`,
  `SubscriptionRepository` (Task 2).
- Produces: sólo comportamiento; además, el andamiaje de siembra que reutilizan las Tasks 5,
  10 y 11 (`crearTenant`, `crearSuscripcion`, `crearRestaurante`, `crearAdmin`).

- [ ] **Step 1: Escribir el test de integración**

`PlanLimitsEndpointIntegrationTest.java`. Sigue el patrón de
`security/P0VulnerabilidadesEndpointIntegrationTest.java`: JWT firmado de verdad, H2, cadena
de seguridad real, sin mocks.

```java
package com.restaurante.subscription;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.role.entity.Role;
import com.restaurante.role.enums.RoleName;
import com.restaurante.role.repository.RoleRepository;
import com.restaurante.security.jwt.JwtTokenProvider;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.entity.User;
import com.restaurante.user.repository.UserRepository;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;

import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("dev")
class PlanLimitsEndpointIntegrationTest {

    @Autowired private MockMvc mockMvc;
    @Autowired private ObjectMapper objectMapper;
    @Autowired private JwtTokenProvider jwtTokenProvider;
    @Autowired private TenantRepository tenantRepository;
    @Autowired private RestaurantRepository restaurantRepository;
    @Autowired private UserRepository userRepository;
    @Autowired private RoleRepository roleRepository;
    @Autowired private SubscriptionRepository subscriptionRepository;

    private Tenant tenantNormal;
    private String tokenAdminNormal;
    private String tokenAdminPro;

    @BeforeEach
    void sembrarDatos() {
        tenantNormal = crearTenant("Plan Normal SA", "plan-normal-sa-" + System.nanoTime());
        Tenant tenantPro = crearTenant("Plan Pro SA", "plan-pro-sa-" + System.nanoTime());

        crearSuscripcion(tenantNormal, PlanCode.NORMAL, SubscriptionStatus.ACTIVE);
        crearSuscripcion(tenantPro, PlanCode.PRO, SubscriptionStatus.ACTIVE);

        // El tenant NORMAL arranca ya en su límite: 1 local.
        crearRestaurante("Local Unico", tenantNormal);
        crearRestaurante("Local Pro 1", tenantPro);
        crearRestaurante("Local Pro 2", tenantPro);

        tokenAdminNormal = jwtTokenProvider.generateToken(
                crearAdmin("admin.normal", "admin.normal@test.com", tenantNormal));
        tokenAdminPro = jwtTokenProvider.generateToken(
                crearAdmin("admin.pro", "admin.pro@test.com", tenantPro));
    }

    private Tenant crearTenant(String nombre, String slug) {
        Tenant tenant = new Tenant();
        tenant.setName(nombre);
        tenant.setSlug(slug);
        tenant.setActive(true);
        return tenantRepository.save(tenant);
    }

    private void crearSuscripcion(Tenant tenant, PlanCode plan, SubscriptionStatus estado) {
        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(plan);
        suscripcion.setStatus(estado);
        subscriptionRepository.save(suscripcion);
    }

    private Restaurant crearRestaurante(String nombre, Tenant tenant) {
        Restaurant restaurante = new Restaurant();
        restaurante.setName(nombre);
        restaurante.setTenant(tenant);
        restaurante.setActiveUnderPlan(true);
        return restaurantRepository.save(restaurante);
    }

    private User crearAdmin(String username, String email, Tenant tenant) {
        Role rolAdmin = roleRepository.findByName(RoleName.ROLE_ADMIN).orElseThrow();
        User usuario = new User();
        usuario.setUsername(username + "." + System.nanoTime());
        usuario.setEmail(System.nanoTime() + email);
        usuario.setPassword("irrelevante");
        usuario.setEnabled(true);
        usuario.setTenant(tenant);
        usuario.setRoles(new HashSet<>(Set.of(rolAdmin)));
        return userRepository.save(usuario);
    }

    private String cuerpoRestaurante(String nombre) throws Exception {
        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("name", nombre);
        cuerpo.put("address", "Calle Falsa 123");
        cuerpo.put("phone", "600000000");
        cuerpo.put("email", "nuevo@test.com");
        cuerpo.put("capacity", 50);
        return objectMapper.writeValueAsString(cuerpo);
    }

    @Test
    @DisplayName("NORMAL en su límite no puede crear un segundo local: 403 PLAN_LIMIT_REACHED")
    void normalNoPuedeCrearSegundoLocal() throws Exception {
        mockMvc.perform(post("/api/v1/restaurants")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoRestaurante("Local Prohibido")))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.success").value(false))
                .andExpect(jsonPath("$.code").value("PLAN_LIMIT_REACHED"))
                .andExpect(jsonPath("$.data.resource").value("RESTAURANT"))
                .andExpect(jsonPath("$.data.limit").value(1))
                .andExpect(jsonPath("$.data.requiredPlan").value("PRO"));
    }

    @Test
    @DisplayName("PRO puede crear locales sin límite")
    void proPuedeCrearMasLocales() throws Exception {
        mockMvc.perform(post("/api/v1/restaurants")
                        .header("Authorization", "Bearer " + tokenAdminPro)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpoRestaurante("Local Pro 3")))
                .andExpect(status().isCreated());
    }

    @Test
    @DisplayName("NORMAL no puede crear la sexta cuenta de usuario")
    void normalNoPuedeCrearSextaCuenta() throws Exception {
        // Ya existe admin.normal; se añaden 4 más hasta llegar al tope de 5.
        for (int i = 1; i <= 4; i++) {
            crearAdmin("relleno" + i, "relleno" + i + "@test.com", tenantNormal);
        }

        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("username", "sexto");
        cuerpo.put("email", "sexto@test.com");
        cuerpo.put("password", "Password123!");
        cuerpo.put("firstName", "Sexto");
        cuerpo.put("lastName", "Usuario");
        cuerpo.put("roles", Set.of("ROLE_EMPLOYEE"));

        mockMvc.perform(post("/api/v1/users")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(cuerpo)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLAN_LIMIT_REACHED"))
                .andExpect(jsonPath("$.data.resource").value("USER_ACCOUNT"))
                .andExpect(jsonPath("$.data.limit").value(5));
    }
}
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=PlanLimitsEndpointIntegrationTest`
Expected: FAIL — los dos casos de límite devuelven `201 Created` en vez de `403`, porque hoy
no existe ninguna cuota.

- [ ] **Step 3: Aplicar el límite en RestaurantService.create()**

En `restaurant/service/RestaurantService.java`, añadir al campo del constructor de Lombok:

```java
    private final EntitlementService entitlementService;
```

Imports nuevos: `com.restaurante.subscription.enums.Resource`,
`com.restaurante.subscription.service.EntitlementService`.

Y la comprobación como **primera línea** de `create(...)`:

```java
    @Transactional
    public RestaurantResponse create(RestaurantRequest request) {
        // La cuota se comprueba ANTES de construir nada: crear el local y luego
        // deshacerlo dejaría huecos en el autoincremento y ruido en los logs.
        entitlementService.requireCapacity(Resource.RESTAURANT);

        Restaurant restaurant = restaurantMapper.toEntity(request);
        // ... el resto del método queda igual
    }
```

- [ ] **Step 4: Aplicar el límite en UserService.create()**

En `user/service/UserService.java`, inyectar igualmente `EntitlementService` y añadir la
comprobación tras `validateUniqueFields(request)`, antes de construir el `User`:

```java
        // Cuota de cuentas del plan. Va después de las validaciones de unicidad
        // para que un email duplicado siga dando 409 y no un 403 confuso.
        entitlementService.requireCapacity(Resource.USER_ACCOUNT);
```

- [ ] **Step 5: Aplicar el límite en AuthService.register()**

En `auth/service/AuthService.java`, inyectar `EntitlementService` y añadir, dentro de
`register(...)`, justo después de resolver el tenant y antes de `User user = new User();`:

```java
        // Registrar por este endpoint también consume cuota: si no, sería la
        // puerta trasera para saltarse el límite de cuentas del plan.
        entitlementService.requireCapacity(Resource.USER_ACCOUNT);
```

- [ ] **Step 6: Ejecutar el test y verificar que pasa**

Run: `cd restaurante_manage && mvn test -Dtest=PlanLimitsEndpointIntegrationTest`
Expected: PASS — 3 tests.

- [ ] **Step 7: Ejecutar la batería completa para descartar regresiones**

Run: `cd restaurante_manage && mvn test`
Expected: BUILD SUCCESS.

Si algún test existente falla porque su tenant de prueba no tiene suscripción, **es un fallo
legítimo del test, no del código**: hay que sembrarle una suscripción PRO activa en su
`@BeforeEach`, igual que hace `PlanLimitsEndpointIntegrationTest.crearSuscripcion(...)`.
Anotar en el mensaje de commit qué tests se han tocado y por qué.

- [ ] **Step 8: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/restaurant/service/RestaurantService.java \
        restaurante_manage/src/main/java/com/restaurante/user/service/UserService.java \
        restaurante_manage/src/main/java/com/restaurante/auth/service/AuthService.java \
        restaurante_manage/src/test
git commit -m "feat(billing): imponer los limites de locales y cuentas del plan"
```

---

## Task 5: Bloqueo suave de locales y cierre del QR público

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/restaurant/service/RestaurantService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/publicapi/service/PublicReservationService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/InactiveRestaurantIntegrationTest.java`

**Interfaces:**
- Consumes: `EntitlementService.resolve(Long)` y `EffectiveSubscription.status()` (Task 3);
  `Restaurant.getActiveUnderPlan()` (Task 2); `SubscriptionStatus.allowsPublicBooking()` (Task 1).
- Produces:
  - `RestaurantService.assertRestaurantWritable(Long restaurantId): void` — lanza
    `PlanUpgradeRequiredException(Feature.MULTI_RESTAURANT, PlanCode.PRO, ...)` si el local
    está bloqueado por plan. La consumen `ReservationService` y la Task 10.

- [ ] **Step 1: Escribir el test de integración**

`InactiveRestaurantIntegrationTest.java`. Reutiliza el mismo andamiaje de siembra de la Task
4 (`crearTenant`, `crearSuscripcion`, `crearRestaurante`, `crearAdmin`, JWT real), con
`@Autowired SubscriptionRepository` para poder mutar el estado de la suscripción en cada
caso. En el `@BeforeEach` se crean: un tenant PRO con `Local Activo` y `Local Bloqueado`
(este último con `setActiveUnderPlan(false)`), y su ADMIN con token.

```java
    @Test
    @DisplayName("Un local bloqueado por plan sigue siendo legible")
    void localBloqueadoSeSigueLeyendo() throws Exception {
        mockMvc.perform(get("/api/v1/restaurants/" + idLocalBloqueado)
                        .header("Authorization", "Bearer " + tokenAdmin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.name").value("Local Bloqueado"));
    }

    @Test
    @DisplayName("Un local bloqueado por plan no admite escrituras")
    void localBloqueadoNoAdmiteEscrituras() throws Exception {
        Map<String, Object> cuerpo = new HashMap<>();
        cuerpo.put("name", "Nombre nuevo");
        cuerpo.put("address", "Calle Falsa 123");
        cuerpo.put("capacity", 60);

        mockMvc.perform(put("/api/v1/restaurants/" + idLocalBloqueado)
                        .header("Authorization", "Bearer " + tokenAdmin)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(cuerpo)))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLAN_UPGRADE_REQUIRED"))
                .andExpect(jsonPath("$.data.feature").value("MULTI_RESTAURANT"));
    }

    @Test
    @DisplayName("El QR público de un local bloqueado no acepta reservas")
    void qrDeLocalBloqueadoCerrado() throws Exception {
        mockMvc.perform(get("/api/v1/public/restaurants/" + idLocalBloqueado))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("El QR sigue abierto con la suscripción en PAST_DUE")
    void qrAbiertoConPagoFallido() throws Exception {
        ponerEstadoSuscripcion(SubscriptionStatus.PAST_DUE);
        mockMvc.perform(get("/api/v1/public/restaurants/" + idLocalActivo))
                .andExpect(status().isOk());
    }

    @Test
    @DisplayName("El QR se cierra con la suscripción CANCELED")
    void qrCerradoConSuscripcionCancelada() throws Exception {
        ponerEstadoSuscripcion(SubscriptionStatus.CANCELED);
        mockMvc.perform(get("/api/v1/public/restaurants/" + idLocalActivo))
                .andExpect(status().isBadRequest());
    }
```

Con este método auxiliar en la clase de test:

```java
    private void ponerEstadoSuscripcion(SubscriptionStatus estado) {
        Subscription suscripcion = subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenantPro.getId()).orElseThrow();
        suscripcion.setStatus(estado);
        subscriptionRepository.save(suscripcion);
    }
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=InactiveRestaurantIntegrationTest`
Expected: FAIL — hoy todo devuelve 200, porque `activeUnderPlan` no lo consulta nadie y el
QR sólo mira `publicBookingEnabled`.

- [ ] **Step 3: Añadir la guarda de escritura en RestaurantService**

```java
    /**
     * Un local desactivado por el plan (por ejemplo, tras bajar de PRO a NORMAL)
     * queda en SOLO LECTURA: se consulta y se exporta, pero no se modifica ni
     * genera reservas nuevas. Sus datos permanecen intactos y vuelve a estar
     * operativo en cuanto se recupera el plan.
     */
    public void assertRestaurantWritable(Long restaurantId) {
        Restaurant restaurante = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new ResourceNotFoundException("Restaurante", "id", restaurantId));
        if (Boolean.FALSE.equals(restaurante.getActiveUnderPlan())) {
            throw new PlanUpgradeRequiredException(
                    Feature.MULTI_RESTAURANT,
                    PlanCode.PRO,
                    "Este local está inactivo con tu plan actual. Sus datos se conservan;"
                            + " actualiza a Pro para volver a operarlo.");
        }
    }
```

Imports nuevos en `RestaurantService`:
`com.restaurante.common.exception.PlanUpgradeRequiredException`,
`com.restaurante.subscription.enums.Feature`, `com.restaurante.subscription.enums.PlanCode`.

Llamarla en `update(...)` y en `delete(...)` de `RestaurantService`, inmediatamente después
de `currentUserService.validateRestaurantAccess(id);`.

- [ ] **Step 4: Extender la guarda a las reservas**

En `reservation/service/ReservationService.java`, inyectar `RestaurantService` y llamar a
`restaurantService.assertRestaurantWritable(restaurantId)` en los métodos de creación y de
actualización de reserva, justo después de la validación de acceso al restaurante que ya
existe. Un local en solo lectura conserva su histórico de reservas, pero no admite ninguna
nueva.

- [ ] **Step 5: Cerrar el QR público**

En `publicapi/service/PublicReservationService.java`, inyectar `EntitlementService` y
sustituir las dos comprobaciones sueltas de `publicBookingEnabled` (líneas ~75 y ~99) por
llamadas a esta guarda única, aplicada también en el método que resuelve el restaurante en
la línea ~47:

```java
    /**
     * El acceso público depende de tres cosas: que el local acepte reservas, que
     * su tenant tenga la suscripción en un estado que lo permita, y que el local
     * no esté bloqueado por un cambio de plan.
     *
     * PAST_DUE sigue abierto a propósito: un pago fallido suele ser una tarjeta
     * caducada, y cortar el QR castigaría a los clientes finales del restaurante
     * mientras Stripe reintenta el cobro.
     */
    private void assertReservasPublicasPermitidas(Restaurant restaurant) {
        if (Boolean.FALSE.equals(restaurant.getPublicBookingEnabled())) {
            throw new BadRequestException(
                    "Este restaurante no acepta reservas públicas en este momento");
        }
        if (Boolean.FALSE.equals(restaurant.getActiveUnderPlan())) {
            throw new BadRequestException(
                    "Este restaurante no acepta reservas online en este momento");
        }
        Long tenantId = restaurant.getTenant() != null ? restaurant.getTenant().getId() : null;
        EffectiveSubscription suscripcion = entitlementService.resolve(tenantId);
        if (suscripcion.status() == null || !suscripcion.status().allowsPublicBooking()) {
            // Mensaje neutro a propósito: al cliente final del restaurante nunca
            // se le cuenta que hay un problema de pago de su restaurante.
            throw new BadRequestException(
                    "Este restaurante no acepta reservas online en este momento");
        }
    }
```

- [ ] **Step 6: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante_manage && mvn test -Dtest='InactiveRestaurantIntegrationTest,PublicReservationServiceTest'`
Expected: PASS. `PublicReservationServiceTest` ya existía: si falla porque su restaurante de
prueba no tiene tenant con suscripción, sembrarle una PRO activa.

- [ ] **Step 7: Ejecutar la batería completa**

Run: `cd restaurante_manage && mvn test`
Expected: BUILD SUCCESS.

- [ ] **Step 8: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/restaurant/service/RestaurantService.java \
        restaurante_manage/src/main/java/com/restaurante/publicapi/service/PublicReservationService.java \
        restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java \
        restaurante_manage/src/test
git commit -m "feat(billing): bloquear en solo lectura los locales fuera del plan"
```

**Fin de la Fase A.** El backend ya impone planes y límites, aunque todavía nadie pueda
pagar. Es un punto de parada verificable: `mvn test` en verde y arranque correcto contra el
MySQL local con la V9 aplicada.

---

# FASE B — Stripe

## Task 6: Dependencia, configuración y la puerta a Stripe

Toda la superficie de Stripe pasa por una interfaz. Los tests usan la implementación falsa:
**ningún test toca la red ni genera un cobro**.

**Files:**
- Modify: `restaurante_manage/pom.xml`
- Modify: `restaurante_manage/src/main/resources/application.yml`
- Modify: `restaurante_manage/.env.example`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/stripe/StripeProperties.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/stripe/StripeGateway.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/stripe/StripeGatewayImpl.java`
- Create: `restaurante_manage/src/test/java/com/restaurante/subscription/stripe/FakeStripeGateway.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/stripe/StripePropertiesTest.java`

**Interfaces:**
- Consumes: `PlanCode` (Task 1).
- Produces:
  - `StripeProperties.getSecretKey()`, `.getWebhookSecret()`, `.getTrialDays()`, `.isEnabled()`
  - `StripeProperties.priceIdFor(PlanCode): String` y `planForPrice(String priceId): Optional<PlanCode>`
  - `StripeGateway` con: `String createCustomer(Long tenantId, String tenantName, String email)`,
    `String createCheckoutSession(String customerId, Long tenantId, String priceId, Integer trialDays, String successUrl, String cancelUrl)`,
    `String createPortalSession(String customerId, String returnUrl)`,
    `StripeSubscriptionSnapshot updateSubscriptionPrice(String subscriptionId, String newPriceId)`,
    `StripeSubscriptionSnapshot cancelSubscription(String subscriptionId, boolean atPeriodEnd)`,
    `StripeSubscriptionSnapshot reactivateSubscription(String subscriptionId)`,
    `StripeSubscriptionSnapshot fetchSubscription(String subscriptionId)`
  - `StripeSubscriptionSnapshot(String subscriptionId, String customerId, String priceId, String status, Long currentPeriodStart, Long currentPeriodEnd, Long trialEnd, boolean cancelAtPeriodEnd)`
    — record en el mismo paquete; los tiempos son épocas en segundos, como los devuelve Stripe.
  - `FakeStripeGateway` con `setNextSnapshot(...)` y `getLastCheckoutRequest()` para los tests.

- [ ] **Step 1: Escribir el test de configuración**

`StripePropertiesTest.java`:

```java
package com.restaurante.subscription.stripe;

import com.restaurante.subscription.enums.PlanCode;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Optional;

import static org.junit.jupiter.api.Assertions.*;

class StripePropertiesTest {

    private StripeProperties conPrecios(String normal, String pro) {
        StripeProperties propiedades = new StripeProperties();
        propiedades.setPriceNormalMonthly(normal);
        propiedades.setPriceProMonthly(pro);
        return propiedades;
    }

    @Test
    @DisplayName("Resuelve el identificador de precio de cada plan")
    void resuelvePreciosPorPlan() {
        StripeProperties propiedades = conPrecios("price_normal", "price_pro");
        assertEquals("price_normal", propiedades.priceIdFor(PlanCode.NORMAL));
        assertEquals("price_pro", propiedades.priceIdFor(PlanCode.PRO));
    }

    @Test
    @DisplayName("Resuelve el plan a partir del precio: es así como se deduce el plan de Stripe")
    void resuelvePlanPorPrecio() {
        StripeProperties propiedades = conPrecios("price_normal", "price_pro");
        assertEquals(Optional.of(PlanCode.NORMAL), propiedades.planForPrice("price_normal"));
        assertEquals(Optional.of(PlanCode.PRO), propiedades.planForPrice("price_pro"));
        // Un precio desconocido NUNCA debe adivinar un plan: se ignora el evento.
        assertEquals(Optional.empty(), propiedades.planForPrice("price_desconocido"));
        assertEquals(Optional.empty(), propiedades.planForPrice(null));
    }

    @Test
    @DisplayName("Sin clave secreta o sin precios, el cobro queda deshabilitado en vez de roto")
    void deshabilitadoSinConfiguracion() {
        StripeProperties sinNada = new StripeProperties();
        assertFalse(sinNada.isEnabled());

        StripeProperties soloClave = conPrecios(null, null);
        soloClave.setSecretKey("sk_test_123");
        assertFalse(soloClave.isEnabled());

        StripeProperties completa = conPrecios("price_normal", "price_pro");
        completa.setSecretKey("sk_test_123");
        assertTrue(completa.isEnabled());
    }
}
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=StripePropertiesTest`
Expected: FAIL de compilación — no existe `StripeProperties`.

- [ ] **Step 3: Añadir la dependencia**

En `restaurante_manage/pom.xml`, dentro de `<dependencies>`, junto a `resend-java`:

```xml
        <!-- Cobros recurrentes. Librería fuertemente tipada: fija internamente la
             versión de la API de Stripe contra la que se compiló. -->
        <dependency>
            <groupId>com.stripe</groupId>
            <artifactId>stripe-java</artifactId>
            <version>${stripe.version}</version>
        </dependency>
```

Y en `<properties>`:

```xml
        <stripe.version>33.4.0</stripe.version>
```

**Antes de fijar la versión**, comprobar cuál es la última estable:
Run: `curl -s "https://search.maven.org/solrsearch/select?q=g:com.stripe+AND+a:stripe-java&core=gav&rows=5&wt=json"`
Usar la última versión **estable** (sin `-beta`). Si difiere de 33.4.0, ajustar la propiedad.

Run: `cd restaurante_manage && mvn dependency:resolve -q`
Expected: descarga sin errores.

- [ ] **Step 4: Configuración en application.yml**

Añadir bajo `app:` (nunca con valores por defecto para los secretos):

```yaml
  stripe:
    # Claves de Stripe. SIN valor por defecto a propósito: si no están definidas,
    # el cobro queda deshabilitado (no roto) y los endpoints de billing lo dicen.
    # Nunca escribir estos valores aquí: sólo por variable de entorno.
    secret-key: ${STRIPE_SECRET_KEY:}
    webhook-secret: ${STRIPE_WEBHOOK_SECRET:}
    price-normal-monthly: ${STRIPE_PRICE_NORMAL_MONTHLY:}
    price-pro-monthly: ${STRIPE_PRICE_PRO_MONTHLY:}
    # Días de prueba gratuita al contratar. 0 desactiva el periodo de prueba.
    trial-days: ${STRIPE_TRIAL_DAYS:14}
```

Y en `restaurante_manage/.env.example`, documentar las variables **sin valores reales**:

```
# Stripe (modo test en local). Obtener en https://dashboard.stripe.com/test/apikeys
STRIPE_SECRET_KEY=
# Lo imprime `stripe listen --forward-to localhost:8080/api/v1/webhooks/stripe`
STRIPE_WEBHOOK_SECRET=
# Identificadores de precio mensuales (price_...), no de producto (prod_...)
STRIPE_PRICE_NORMAL_MONTHLY=
STRIPE_PRICE_PRO_MONTHLY=
STRIPE_TRIAL_DAYS=14
```

- [ ] **Step 5: Escribir StripeProperties**

```java
package com.restaurante.subscription.stripe;

import com.restaurante.subscription.enums.PlanCode;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

import java.util.Optional;

/**
 * Configuración de Stripe. Ningún valor se escribe en el repositorio: todos
 * llegan por variable de entorno.
 *
 * Si falta la clave o los precios, isEnabled() devuelve false y los endpoints de
 * cobro responden que la facturación no está configurada, en lugar de estallar.
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "app.stripe")
public class StripeProperties {

    private String secretKey;
    private String webhookSecret;
    private String priceNormalMonthly;
    private String priceProMonthly;
    private int trialDays = 14;

    public boolean isEnabled() {
        return tieneValor(secretKey)
                && tieneValor(priceNormalMonthly)
                && tieneValor(priceProMonthly);
    }

    public String priceIdFor(PlanCode plan) {
        return switch (plan) {
            case NORMAL -> priceNormalMonthly;
            case PRO -> priceProMonthly;
        };
    }

    /**
     * Deduce el plan a partir del identificador de precio. Es el camino por el que
     * se decide el plan tras un webhook: nunca se confía en lo que pidió el
     * usuario, sólo en lo que Stripe dice que está cobrando.
     *
     * Un precio desconocido devuelve vacío: mejor ignorar el evento que adivinar.
     */
    public Optional<PlanCode> planForPrice(String priceId) {
        if (!tieneValor(priceId)) {
            return Optional.empty();
        }
        if (priceId.equals(priceNormalMonthly)) {
            return Optional.of(PlanCode.NORMAL);
        }
        if (priceId.equals(priceProMonthly)) {
            return Optional.of(PlanCode.PRO);
        }
        return Optional.empty();
    }

    private boolean tieneValor(String valor) {
        return valor != null && !valor.isBlank();
    }
}
```

- [ ] **Step 6: Escribir la interfaz y el record de instantánea**

`StripeGateway.java`:

```java
package com.restaurante.subscription.stripe;

/**
 * Única puerta de salida hacia Stripe. Todo lo demás del sistema habla con esta
 * interfaz, nunca con la librería directamente: así los tests usan la
 * implementación falsa y no se hace ni una llamada de red ni un cobro real.
 */
public interface StripeGateway {

    /** Crea el cliente en Stripe con el tenant en metadata. Devuelve su id. */
    String createCustomer(Long tenantId, String tenantName, String email);

    /** Crea la sesión de pago alojada. Devuelve la URL a la que redirigir. */
    String createCheckoutSession(String customerId, Long tenantId, String priceId,
                                 Integer trialDays, String successUrl, String cancelUrl);

    /** Crea la sesión del portal de cliente. Devuelve la URL. */
    String createPortalSession(String customerId, String returnUrl);

    /** Cambia el precio (el plan) de una suscripción viva, con prorrateo. */
    StripeSubscriptionSnapshot updateSubscriptionPrice(String subscriptionId, String newPriceId);

    /** Cancela: al final del periodo, o de inmediato si atPeriodEnd es false. */
    StripeSubscriptionSnapshot cancelSubscription(String subscriptionId, boolean atPeriodEnd);

    /** Deshace una cancelación programada. */
    StripeSubscriptionSnapshot reactivateSubscription(String subscriptionId);

    /** Relee la suscripción desde Stripe. Se usa para reconciliar. */
    StripeSubscriptionSnapshot fetchSubscription(String subscriptionId);
}
```

`StripeSubscriptionSnapshot.java`:

```java
package com.restaurante.subscription.stripe;

/**
 * Foto del estado de una suscripción en Stripe, sin tipos de la librería, para
 * que el resto del sistema no dependa de stripe-java.
 *
 * Las marcas de tiempo son épocas en SEGUNDOS, tal y como las devuelve Stripe.
 */
public record StripeSubscriptionSnapshot(
        String subscriptionId,
        String customerId,
        String priceId,
        String status,
        Long currentPeriodStart,
        Long currentPeriodEnd,
        Long trialEnd,
        boolean cancelAtPeriodEnd
) {}
```

- [ ] **Step 7: Escribir la implementación real**

`StripeGatewayImpl.java` — se activa sólo si hay clave configurada, para que la aplicación
arranque igual sin Stripe:

```java
package com.restaurante.subscription.stripe;

import com.stripe.StripeClient;
import com.stripe.model.Subscription;
import com.stripe.model.checkout.Session;
import com.stripe.param.*;
import com.stripe.param.checkout.SessionCreateParams;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * Implementación real contra la API de Stripe.
 *
 * El cliente se construye con la clave secreta de las propiedades; nunca se
 * registra ni se traza esa clave. Los datos de tarjeta jamás pasan por aquí: los
 * captura Stripe en su propia página alojada.
 */
@Slf4j
@Component
public class StripeGatewayImpl implements StripeGateway {

    private final StripeProperties properties;
    private final StripeClient client;

    public StripeGatewayImpl(StripeProperties properties) {
        this.properties = properties;
        this.client = properties.isEnabled()
                ? new StripeClient(properties.getSecretKey())
                : null;
    }

    private StripeClient client() {
        if (client == null) {
            throw new IllegalStateException(
                    "La facturación no está configurada: falta STRIPE_SECRET_KEY o los precios");
        }
        return client;
    }

    @Override
    public String createCustomer(Long tenantId, String tenantName, String email) {
        try {
            CustomerCreateParams params = CustomerCreateParams.builder()
                    .setName(tenantName)
                    .setEmail(email)
                    // El tenant viaja en metadata: es como se verifica, al recibir
                    // un webhook, que el cliente de Stripe es de quien creemos.
                    .putMetadata("tenantId", String.valueOf(tenantId))
                    .build();
            return client().customers().create(params).getId();
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo crear el cliente en Stripe", e);
        }
    }

    @Override
    public String createCheckoutSession(String customerId, Long tenantId, String priceId,
                                        Integer trialDays, String successUrl, String cancelUrl) {
        try {
            SessionCreateParams.SubscriptionData.Builder datosSuscripcion =
                    SessionCreateParams.SubscriptionData.builder()
                            .putMetadata("tenantId", String.valueOf(tenantId));
            if (trialDays != null && trialDays > 0) {
                datosSuscripcion.setTrialPeriodDays(trialDays.longValue());
            }

            SessionCreateParams params = SessionCreateParams.builder()
                    .setMode(SessionCreateParams.Mode.SUBSCRIPTION)
                    .setCustomer(customerId)
                    .setClientReferenceId(String.valueOf(tenantId))
                    .addLineItem(SessionCreateParams.LineItem.builder()
                            .setPrice(priceId)
                            .setQuantity(1L)
                            .build())
                    .setSubscriptionData(datosSuscripcion.build())
                    .setSuccessUrl(successUrl)
                    .setCancelUrl(cancelUrl)
                    .build();

            Session sesion = client().checkout().sessions().create(params);
            return sesion.getUrl();
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo crear la sesión de pago", e);
        }
    }

    @Override
    public String createPortalSession(String customerId, String returnUrl) {
        try {
            com.stripe.param.billingportal.SessionCreateParams params =
                    com.stripe.param.billingportal.SessionCreateParams.builder()
                            .setCustomer(customerId)
                            .setReturnUrl(returnUrl)
                            .build();
            return client().billingPortal().sessions().create(params).getUrl();
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo abrir el portal de cliente", e);
        }
    }

    @Override
    public StripeSubscriptionSnapshot updateSubscriptionPrice(String subscriptionId,
                                                              String newPriceId) {
        try {
            Subscription suscripcion = client().subscriptions().retrieve(subscriptionId);
            String itemId = suscripcion.getItems().getData().get(0).getId();

            SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
                    .addItem(SubscriptionUpdateParams.Item.builder()
                            .setId(itemId)
                            .setPrice(newPriceId)
                            .build())
                    // Con prorrateo: el cliente paga o recibe crédito por la parte
                    // proporcional del periodo ya consumido.
                    .setProrationBehavior(
                            SubscriptionUpdateParams.ProrationBehavior.CREATE_PRORATIONS)
                    .build();

            return toSnapshot(client().subscriptions().update(subscriptionId, params));
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo cambiar el plan en Stripe", e);
        }
    }

    @Override
    public StripeSubscriptionSnapshot cancelSubscription(String subscriptionId,
                                                         boolean atPeriodEnd) {
        try {
            if (atPeriodEnd) {
                SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
                        .setCancelAtPeriodEnd(true)
                        .build();
                return toSnapshot(client().subscriptions().update(subscriptionId, params));
            }
            return toSnapshot(client().subscriptions().cancel(subscriptionId));
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo cancelar la suscripción", e);
        }
    }

    @Override
    public StripeSubscriptionSnapshot reactivateSubscription(String subscriptionId) {
        try {
            SubscriptionUpdateParams params = SubscriptionUpdateParams.builder()
                    .setCancelAtPeriodEnd(false)
                    .build();
            return toSnapshot(client().subscriptions().update(subscriptionId, params));
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo reactivar la suscripción", e);
        }
    }

    @Override
    public StripeSubscriptionSnapshot fetchSubscription(String subscriptionId) {
        try {
            return toSnapshot(client().subscriptions().retrieve(subscriptionId));
        } catch (Exception e) {
            throw new StripeOperationException("No se pudo leer la suscripción", e);
        }
    }

    private StripeSubscriptionSnapshot toSnapshot(Subscription suscripcion) {
        var item = suscripcion.getItems().getData().get(0);
        return new StripeSubscriptionSnapshot(
                suscripcion.getId(),
                suscripcion.getCustomer(),
                item.getPrice() != null ? item.getPrice().getId() : null,
                suscripcion.getStatus(),
                item.getCurrentPeriodStart(),
                item.getCurrentPeriodEnd(),
                suscripcion.getTrialEnd(),
                Boolean.TRUE.equals(suscripcion.getCancelAtPeriodEnd())
        );
    }
}
```

> **Nota de versión:** en stripe-java 33.x, `current_period_start` y `current_period_end`
> viven en el **item** de la suscripción, no en la suscripción. Si la versión fijada en el
> Step 3 los expone en `Subscription`, ajustar `toSnapshot` y dejarlo comentado. Verificar
> con: `javap -classpath ~/.m2/repository/com/stripe/stripe-java/<version>/stripe-java-<version>.jar com.stripe.model.Subscription | grep -i period`

Y la excepción, en el mismo paquete:

```java
package com.restaurante.subscription.stripe;

/** Fallo al hablar con Stripe. Se traduce a 502 en el manejador global. */
public class StripeOperationException extends RuntimeException {
    public StripeOperationException(String message, Throwable cause) {
        super(message, cause);
    }
}
```

Registrar su handler en `GlobalExceptionHandler`, **sin filtrar el detalle interno**:

```java
    @ExceptionHandler(StripeOperationException.class)
    public ResponseEntity<ApiResponse<Void>> handleStripeOperation(StripeOperationException ex) {
        // El detalle va al log, no a la respuesta: puede contener identificadores
        // internos de Stripe que no deben salir al cliente.
        log.error("Error al operar con Stripe: {}", ex.getMessage(), ex);
        return ResponseEntity
                .status(HttpStatus.BAD_GATEWAY)
                .body(ApiResponse.error("BILLING_PROVIDER_ERROR",
                        "No se pudo completar la operación de pago. Inténtalo de nuevo."));
    }
```

- [ ] **Step 8: Escribir el doble de test**

`FakeStripeGateway.java` (en `src/test/java`, marcado `@Primary` para que gane sobre el real
en los tests de integración):

```java
package com.restaurante.subscription.stripe;

import org.springframework.context.annotation.Primary;
import org.springframework.stereotype.Component;

import java.util.ArrayList;
import java.util.List;

/**
 * Implementación falsa de Stripe para los tests. No hace red ni cobra nada:
 * registra lo que se le pide y devuelve lo que se le haya preparado.
 */
@Primary
@Component
public class FakeStripeGateway implements StripeGateway {

    public record CheckoutRequest(String customerId, Long tenantId, String priceId,
                                  Integer trialDays, String successUrl, String cancelUrl) {}

    private final List<CheckoutRequest> checkoutRequests = new ArrayList<>();
    private StripeSubscriptionSnapshot nextSnapshot;
    private String nextCustomerId = "cus_fake_1";

    public void setNextSnapshot(StripeSubscriptionSnapshot snapshot) {
        this.nextSnapshot = snapshot;
    }

    public void setNextCustomerId(String customerId) {
        this.nextCustomerId = customerId;
    }

    public CheckoutRequest getLastCheckoutRequest() {
        return checkoutRequests.isEmpty() ? null : checkoutRequests.get(checkoutRequests.size() - 1);
    }

    public void reset() {
        checkoutRequests.clear();
        nextSnapshot = null;
        nextCustomerId = "cus_fake_1";
    }

    @Override
    public String createCustomer(Long tenantId, String tenantName, String email) {
        return nextCustomerId;
    }

    @Override
    public String createCheckoutSession(String customerId, Long tenantId, String priceId,
                                        Integer trialDays, String successUrl, String cancelUrl) {
        checkoutRequests.add(new CheckoutRequest(
                customerId, tenantId, priceId, trialDays, successUrl, cancelUrl));
        return "https://checkout.stripe.test/sesion-falsa";
    }

    @Override
    public String createPortalSession(String customerId, String returnUrl) {
        return "https://billing.stripe.test/portal-falso";
    }

    @Override
    public StripeSubscriptionSnapshot updateSubscriptionPrice(String subscriptionId, String newPriceId) {
        return snapshotOSimulado(subscriptionId, newPriceId, "active", false);
    }

    @Override
    public StripeSubscriptionSnapshot cancelSubscription(String subscriptionId, boolean atPeriodEnd) {
        return snapshotOSimulado(subscriptionId, null,
                atPeriodEnd ? "active" : "canceled", atPeriodEnd);
    }

    @Override
    public StripeSubscriptionSnapshot reactivateSubscription(String subscriptionId) {
        return snapshotOSimulado(subscriptionId, null, "active", false);
    }

    @Override
    public StripeSubscriptionSnapshot fetchSubscription(String subscriptionId) {
        return snapshotOSimulado(subscriptionId, null, "active", false);
    }

    private StripeSubscriptionSnapshot snapshotOSimulado(String subscriptionId, String priceId,
                                                         String status, boolean cancelAtPeriodEnd) {
        if (nextSnapshot != null) {
            return nextSnapshot;
        }
        long ahora = System.currentTimeMillis() / 1000L;
        return new StripeSubscriptionSnapshot(
                subscriptionId, "cus_fake_1", priceId, status,
                ahora, ahora + 2_592_000L, null, cancelAtPeriodEnd);
    }
}
```

- [ ] **Step 9: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante_manage && mvn test -Dtest=StripePropertiesTest`
Expected: PASS — 3 tests.

Run: `cd restaurante_manage && mvn test`
Expected: BUILD SUCCESS — la aplicación arranca en los tests **sin** claves de Stripe.

- [ ] **Step 10: Commit**

```bash
git add restaurante_manage/pom.xml \
        restaurante_manage/.env.example \
        restaurante_manage/src/main/resources/application.yml \
        restaurante_manage/src/main/java/com/restaurante/subscription/stripe \
        restaurante_manage/src/main/java/com/restaurante/common/exception/GlobalExceptionHandler.java \
        restaurante_manage/src/test/java/com/restaurante/subscription/stripe
git commit -m "feat(billing): anadir la integracion con Stripe tras una interfaz propia"
```

---

## Task 7: Endpoints de consulta del plan

Los tres endpoints de lectura. Separar `/entitlements` de `/subscription` es deliberado: un
EMPLOYEE necesita saber si pintar un candado, pero no tiene por qué ver el estado de pago de
la empresa.

**Files:**
- Modify: `restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/dto/PlanResponse.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/dto/EntitlementsResponse.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/dto/SubscriptionResponse.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/dto/SubscriptionMapper.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/controller/BillingController.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/BillingReadEndpointIntegrationTest.java`

**Interfaces:**
- Consumes: `EntitlementService` (Task 3); `PlanCatalog` (Task 1); `StripeProperties` (Task 6).
- Produces:
  - `Constants.BILLING_PATH`, `Constants.BILLING_PLANS_SUBPATH`,
    `Constants.BILLING_ENTITLEMENTS_SUBPATH`, `Constants.BILLING_SUBSCRIPTION_SUBPATH`,
    `Constants.STRIPE_WEBHOOK_PATH`
  - `EntitlementsResponse(String plan, boolean hasAccess, String status, Set<String> features, Map<String,Object> limits, Map<String,Long> usage, boolean billingConfigured)`
  - `SubscriptionResponse(String plan, String planName, String status, LocalDateTime currentPeriodEnd, LocalDateTime trialEnd, boolean cancelAtPeriodEnd, boolean legacyGrant, boolean stripeLinked)`
  - `PlanResponse(String code, String name, Set<String> features, Integer maxRestaurants, Integer maxUserAccounts)`

- [ ] **Step 1: Escribir el test de integración**

`BillingReadEndpointIntegrationTest.java`, con el andamiaje de siembra de la Task 4:

```java
    @Test
    @DisplayName("GET /billing/plans devuelve el catálogo sin identificadores de precio")
    void catalogoDePlanes() throws Exception {
        mockMvc.perform(get("/api/v1/billing/plans")
                        .header("Authorization", "Bearer " + tokenEmpleado))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.length()").value(2))
                .andExpect(jsonPath("$.data[?(@.code=='NORMAL')].maxRestaurants").value(1))
                .andExpect(jsonPath("$.data[?(@.code=='PRO')].maxRestaurants").value((Object) null))
                // Los price_id nunca salen al cliente.
                .andExpect(content().string(org.hamcrest.Matchers.not(
                        org.hamcrest.Matchers.containsString("price_"))));
    }

    @Test
    @DisplayName("Un EMPLOYEE puede leer sus entitlements")
    void empleadoLeeEntitlements() throws Exception {
        mockMvc.perform(get("/api/v1/billing/entitlements")
                        .header("Authorization", "Bearer " + tokenEmpleado))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.plan").value("PRO"))
                .andExpect(jsonPath("$.data.hasAccess").value(true))
                .andExpect(jsonPath("$.data.features").isArray())
                .andExpect(jsonPath("$.data.usage.RESTAURANT").exists());
    }

    @Test
    @DisplayName("Un EMPLOYEE NO puede leer el estado de facturación de la empresa")
    void empleadoNoVeFacturacion() throws Exception {
        mockMvc.perform(get("/api/v1/billing/subscription")
                        .header("Authorization", "Bearer " + tokenEmpleado))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Un ADMIN sí ve el estado de facturación de su tenant")
    void adminVeFacturacion() throws Exception {
        mockMvc.perform(get("/api/v1/billing/subscription")
                        .header("Authorization", "Bearer " + tokenAdmin))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.plan").value("PRO"))
                .andExpect(jsonPath("$.data.status").value("ACTIVE"))
                .andExpect(jsonPath("$.data.stripeLinked").value(false));
    }

    @Test
    @DisplayName("Un tenant NORMAL ve sus límites y su uso reales")
    void tenantNormalVeSusLimites() throws Exception {
        mockMvc.perform(get("/api/v1/billing/entitlements")
                        .header("Authorization", "Bearer " + tokenAdminNormal))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.plan").value("NORMAL"))
                .andExpect(jsonPath("$.data.features.length()").value(0))
                .andExpect(jsonPath("$.data.limits.maxRestaurants").value(1))
                .andExpect(jsonPath("$.data.usage.RESTAURANT").value(1));
    }

    @Test
    @DisplayName("Sin autenticar no se puede leer nada de facturación")
    void sinTokenNoHayAcceso() throws Exception {
        mockMvc.perform(get("/api/v1/billing/entitlements"))
                .andExpect(status().isUnauthorized());
    }
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=BillingReadEndpointIntegrationTest`
Expected: FAIL — 404 en todas las rutas; el controlador aún no existe.

- [ ] **Step 3: Añadir las constantes de ruta**

En `common/util/Constants.java`, junto a las demás rutas:

```java
    // Facturación y suscripciones
    public static final String BILLING_PATH = API_BASE_PATH + "/billing";
    public static final String BILLING_PLANS_SUBPATH = "/plans";
    public static final String BILLING_ENTITLEMENTS_SUBPATH = "/entitlements";
    public static final String BILLING_SUBSCRIPTION_SUBPATH = "/subscription";
    public static final String BILLING_CHECKOUT_SUBPATH = "/checkout";
    public static final String BILLING_PORTAL_SUBPATH = "/portal";
    public static final String BILLING_CHANGE_PLAN_SUBPATH = "/change-plan";
    public static final String BILLING_CANCEL_SUBPATH = "/cancel";
    public static final String BILLING_REACTIVATE_SUBPATH = "/reactivate";
    public static final String BILLING_ACTIVE_RESTAURANT_SUBPATH = "/active-restaurant";

    /** Webhook de Stripe. Público y con verificación de firma obligatoria. */
    public static final String STRIPE_WEBHOOK_PATH = API_BASE_PATH + "/webhooks/stripe";
```

- [ ] **Step 4: Escribir los DTOs y el mapper**

```java
package com.restaurante.subscription.dto;

import java.util.Set;

/** Un plan del catálogo, tal y como se le muestra al usuario. Sin price_id. */
public record PlanResponse(
        String code,
        String name,
        Set<String> features,
        Integer maxRestaurants,
        Integer maxUserAccounts
) {}
```

```java
package com.restaurante.subscription.dto;

import java.util.Map;
import java.util.Set;

/**
 * Lo que puede hacer el tenant del usuario actual. Lo consume toda la interfaz y
 * lo puede leer cualquier rol: NO contiene ningún dato de facturación.
 */
public record EntitlementsResponse(
        String plan,
        boolean hasAccess,
        String status,
        Set<String> features,
        Map<String, Object> limits,
        Map<String, Long> usage,
        boolean billingConfigured
) {}
```

```java
package com.restaurante.subscription.dto;

import java.time.LocalDateTime;

/**
 * Estado de facturación del tenant. Sólo para ADMIN y SUPER_ADMIN.
 * No incluye identificadores de Stripe: al cliente le basta con saber si su
 * suscripción está enlazada, no con qué id.
 */
public record SubscriptionResponse(
        String plan,
        String planName,
        String status,
        LocalDateTime currentPeriodEnd,
        LocalDateTime trialEnd,
        boolean cancelAtPeriodEnd,
        boolean legacyGrant,
        boolean stripeLinked
) {}
```

`SubscriptionMapper.java` — clase estática, como el resto de mappers del proyecto:

```java
package com.restaurante.subscription.dto;

import com.restaurante.subscription.catalog.PlanCatalog;
import com.restaurante.subscription.catalog.PlanDefinition;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.service.EffectiveSubscription;

import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

public final class SubscriptionMapper {

    private SubscriptionMapper() {
        throw new UnsupportedOperationException("Clase de utilidad, no instanciable");
    }

    public static List<PlanResponse> toPlanList() {
        return PlanCatalog.all().values().stream()
                .map(SubscriptionMapper::toPlanResponse)
                .sorted((a, b) -> a.code().compareTo(b.code()))
                .toList();
    }

    private static PlanResponse toPlanResponse(PlanDefinition definicion) {
        return new PlanResponse(
                definicion.code().name(),
                definicion.displayName(),
                definicion.features().stream().map(Feature::name).collect(Collectors.toSet()),
                definicion.limits().maxRestaurants(),
                definicion.limits().maxUserAccounts()
        );
    }

    public static EntitlementsResponse toEntitlements(EffectiveSubscription efectiva,
                                                      Map<String, Long> uso,
                                                      boolean billingConfigured) {
        Map<String, Object> limites = new HashMap<>();
        limites.put("maxRestaurants", efectiva.limits().maxRestaurants());
        limites.put("maxUserAccounts", efectiva.limits().maxUserAccounts());

        return new EntitlementsResponse(
                efectiva.plan() != null ? efectiva.plan().name() : null,
                efectiva.hasAccess(),
                efectiva.status() != null ? efectiva.status().name() : null,
                efectiva.features().stream().map(Feature::name).collect(Collectors.toSet()),
                limites,
                uso,
                billingConfigured
        );
    }

    public static SubscriptionResponse toResponse(Subscription suscripcion) {
        PlanCode plan = suscripcion.getPlanCode();
        return new SubscriptionResponse(
                plan != null ? plan.name() : null,
                plan != null ? PlanCatalog.get(plan).displayName() : null,
                suscripcion.getStatus() != null ? suscripcion.getStatus().name() : null,
                suscripcion.getCurrentPeriodEnd(),
                suscripcion.getTrialEnd(),
                suscripcion.isCancelAtPeriodEnd(),
                suscripcion.isLegacyGrant(),
                suscripcion.getStripeSubscriptionId() != null
        );
    }

    /** Tenant sin suscripción: se responde con un estado vacío, no con un 404. */
    public static SubscriptionResponse empty() {
        return new SubscriptionResponse(null, null, null, null, null, false, false, false);
    }
}
```

- [ ] **Step 5: Escribir el controlador (sólo lectura por ahora)**

```java
package com.restaurante.subscription.controller;

import com.restaurante.common.dto.ApiResponse;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.common.util.Constants;
import com.restaurante.subscription.dto.*;
import com.restaurante.subscription.enums.Resource;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.subscription.service.EffectiveSubscription;
import com.restaurante.subscription.service.EntitlementService;
import com.restaurante.subscription.stripe.StripeProperties;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.prepost.PreAuthorize;
import org.springframework.web.bind.annotation.*;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Facturación y suscripción del tenant del usuario autenticado.
 *
 * El tenant NUNCA llega por parámetro ni por cuerpo: siempre sale del token, a
 * través de CurrentUserService. Aceptarlo del cliente sería permitir consultar y
 * modificar la suscripción de otra empresa.
 */
@RestController
@RequestMapping(Constants.BILLING_PATH)
@RequiredArgsConstructor
@Tag(name = "Facturación", description = "Planes, suscripción y pagos del inquilino")
public class BillingController {

    private final EntitlementService entitlementService;
    private final SubscriptionRepository subscriptionRepository;
    private final CurrentUserService currentUserService;
    private final StripeProperties stripeProperties;

    @GetMapping(Constants.BILLING_PLANS_SUBPATH)
    @Operation(summary = "Catálogo de planes disponibles")
    public ResponseEntity<ApiResponse<List<PlanResponse>>> plans() {
        return ResponseEntity.ok(ApiResponse.success(SubscriptionMapper.toPlanList()));
    }

    /**
     * Lo que el tenant tiene contratado. Accesible a cualquier rol autenticado:
     * la interfaz lo necesita para decidir qué pinta bloqueado. No expone ningún
     * dato de facturación.
     */
    @GetMapping(Constants.BILLING_ENTITLEMENTS_SUBPATH)
    @Operation(summary = "Funcionalidades y límites del inquilino actual")
    public ResponseEntity<ApiResponse<EntitlementsResponse>> entitlements() {
        Long tenantId = currentUserService.getCurrentTenantId();
        EffectiveSubscription efectiva = entitlementService.resolve(tenantId);

        Map<String, Long> uso = new HashMap<>();
        uso.put(Resource.RESTAURANT.name(),
                entitlementService.currentUsage(tenantId, Resource.RESTAURANT));
        uso.put(Resource.USER_ACCOUNT.name(),
                entitlementService.currentUsage(tenantId, Resource.USER_ACCOUNT));

        return ResponseEntity.ok(ApiResponse.success(
                SubscriptionMapper.toEntitlements(efectiva, uso, stripeProperties.isEnabled())));
    }

    /**
     * Estado de facturación. Restringido a ADMIN y SUPER_ADMIN: un empleado no
     * tiene por qué saber si su empresa tiene un pago pendiente.
     */
    @GetMapping(Constants.BILLING_SUBSCRIPTION_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Estado de la suscripción del inquilino")
    public ResponseEntity<ApiResponse<SubscriptionResponse>> subscription() {
        Long tenantId = currentUserService.getCurrentTenantId();
        return ResponseEntity.ok(ApiResponse.success(
                subscriptionRepository.findByTenantIdAndDeletedFalse(tenantId)
                        .map(SubscriptionMapper::toResponse)
                        .orElseGet(SubscriptionMapper::empty)));
    }
}
```

- [ ] **Step 6: Ejecutar el test y verificar que pasa**

Run: `cd restaurante_manage && mvn test -Dtest=BillingReadEndpointIntegrationTest`
Expected: PASS — 6 tests.

- [ ] **Step 7: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java \
        restaurante_manage/src/main/java/com/restaurante/subscription/dto \
        restaurante_manage/src/main/java/com/restaurante/subscription/controller \
        restaurante_manage/src/test/java/com/restaurante/subscription
git commit -m "feat(billing): exponer el catalogo de planes y el estado del inquilino"
```

---

## Task 8: Contratar, cambiar y cancelar

Los endpoints que mueven dinero. Ninguno acepta un `priceId` del cliente: se recibe un
`planCode` y el precio se resuelve en el servidor.

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/dto/CheckoutRequest.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/dto/CancelSubscriptionRequest.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/dto/BillingSessionResponse.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/service/SubscriptionService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/subscription/controller/BillingController.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/BillingCheckoutEndpointIntegrationTest.java`

**Interfaces:**
- Consumes: `StripeGateway`, `StripeProperties`, `StripeSubscriptionSnapshot` (Task 6);
  `SubscriptionRepository` (Task 2); `CurrentUserService` (existente).
- Produces:
  - `CheckoutRequest { @NotNull PlanCode planCode }`
  - `CancelSubscriptionRequest { boolean atPeriodEnd }` (por defecto `true`)
  - `BillingSessionResponse(String url)`
  - `SubscriptionService.createCheckoutSession(PlanCode): String`
  - `SubscriptionService.createPortalSession(): String`
  - `SubscriptionService.changePlan(PlanCode): SubscriptionResponse`
  - `SubscriptionService.cancel(boolean atPeriodEnd): SubscriptionResponse`
  - `SubscriptionService.reactivate(): SubscriptionResponse`
  - `SubscriptionService.applySnapshot(Subscription, StripeSubscriptionSnapshot, LocalDateTime eventoEn): void`
    — usada también por la Task 9.

- [ ] **Step 1: Escribir el test de integración**

`BillingCheckoutEndpointIntegrationTest.java`, con el andamiaje de siembra de la Task 4 más
`@Autowired FakeStripeGateway fakeStripeGateway` y `@BeforeEach fakeStripeGateway.reset()`.
Las propiedades de Stripe se inyectan con `@TestPropertySource`:

```java
@TestPropertySource(properties = {
        "app.stripe.secret-key=sk_test_falsa",
        "app.stripe.webhook-secret=whsec_test_falsa",
        "app.stripe.price-normal-monthly=price_normal_test",
        "app.stripe.price-pro-monthly=price_pro_test",
        "app.stripe.trial-days=14"
})
```

```java
    @Test
    @DisplayName("El checkout resuelve el precio en servidor y añade la prueba de 14 días")
    void checkoutResuelvePrecioEnServidor() throws Exception {
        mockMvc.perform(post("/api/v1/billing/checkout")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"PRO\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.url").value("https://checkout.stripe.test/sesion-falsa"));

        FakeStripeGateway.CheckoutRequest peticion = fakeStripeGateway.getLastCheckoutRequest();
        assertEquals("price_pro_test", peticion.priceId());
        assertEquals(14, peticion.trialDays());
        assertEquals(tenantNormal.getId(), peticion.tenantId());
    }

    @Test
    @DisplayName("El checkout IGNORA cualquier priceId que envíe el cliente")
    void checkoutIgnoraPrecioDelCliente() throws Exception {
        // Intento de pagar el plan barato y recibir el caro.
        mockMvc.perform(post("/api/v1/billing/checkout")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"NORMAL\",\"priceId\":\"price_pro_test\","
                                + "\"paid\":true,\"plan\":\"PRO\"}"))
                .andExpect(status().isOk());

        // Se cobra lo que dice el servidor para NORMAL, no lo que pidió el cliente.
        assertEquals("price_normal_test", fakeStripeGateway.getLastCheckoutRequest().priceId());
        // Y el plan guardado NO ha cambiado: sólo lo cambia un webhook de Stripe.
        assertEquals(PlanCode.NORMAL, subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenantNormal.getId()).orElseThrow().getPlanCode());
    }

    @Test
    @DisplayName("Un plan inexistente se rechaza con 400")
    void planInvalido() throws Exception {
        mockMvc.perform(post("/api/v1/billing/checkout")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"ENTERPRISE\"}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Un MANAGER no puede iniciar un pago")
    void managerNoPuedePagar() throws Exception {
        mockMvc.perform(post("/api/v1/billing/checkout")
                        .header("Authorization", "Bearer " + tokenManager)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"planCode\":\"PRO\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("El portal exige tener cliente en Stripe")
    void portalSinClienteStripe() throws Exception {
        mockMvc.perform(post("/api/v1/billing/portal")
                        .header("Authorization", "Bearer " + tokenAdminNormal))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("Cancelar al final del periodo marca la bandera sin quitar el acceso")
    void cancelarAlFinalDelPeriodo() throws Exception {
        enlazarConStripe(tenantNormal, "cus_x", "sub_x", "price_normal_test");
        fakeStripeGateway.setNextSnapshot(new StripeSubscriptionSnapshot(
                "sub_x", "cus_x", "price_normal_test", "active",
                null, null, null, true));

        mockMvc.perform(post("/api/v1/billing/cancel")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"atPeriodEnd\":true}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.cancelAtPeriodEnd").value(true))
                .andExpect(jsonPath("$.data.status").value("ACTIVE"));
    }

    @Test
    @DisplayName("Un tenant no puede tocar la suscripción de otro")
    void aislamientoEntreInquilinos() throws Exception {
        // El ADMIN del tenant NORMAL cancela; el tenant PRO no debe verse afectado.
        enlazarConStripe(tenantNormal, "cus_a", "sub_a", "price_normal_test");
        mockMvc.perform(post("/api/v1/billing/cancel")
                        .header("Authorization", "Bearer " + tokenAdminNormal)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"atPeriodEnd\":false}"))
                .andExpect(status().isOk());

        assertEquals(SubscriptionStatus.ACTIVE, subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenantPro.getId()).orElseThrow().getStatus());
    }
```

Con este auxiliar en la clase de test:

```java
    private void enlazarConStripe(Tenant tenant, String customerId,
                                  String subscriptionId, String priceId) {
        Subscription suscripcion = subscriptionRepository
                .findByTenantIdAndDeletedFalse(tenant.getId()).orElseThrow();
        suscripcion.setStripeCustomerId(customerId);
        suscripcion.setStripeSubscriptionId(subscriptionId);
        suscripcion.setStripePriceId(priceId);
        subscriptionRepository.save(suscripcion);
    }
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=BillingCheckoutEndpointIntegrationTest`
Expected: FAIL — 404: los endpoints de escritura no existen.

- [ ] **Step 3: Escribir los DTOs**

```java
package com.restaurante.subscription.dto;

import com.restaurante.subscription.enums.PlanCode;
import jakarta.validation.constraints.NotNull;
import lombok.Data;

/**
 * Petición de contratación. Sólo lleva el plan: el identificador de precio se
 * resuelve SIEMPRE en el servidor. Aceptar un priceId del cliente permitiría
 * pagar el plan barato y recibir el caro.
 */
@Data
public class CheckoutRequest {

    @NotNull(message = "El plan es obligatorio")
    private PlanCode planCode;
}
```

```java
package com.restaurante.subscription.dto;

import lombok.Data;

/** Cancelación. Por defecto, al final del periodo ya pagado. */
@Data
public class CancelSubscriptionRequest {
    private boolean atPeriodEnd = true;
}
```

```java
package com.restaurante.subscription.dto;

/** URL alojada por Stripe a la que redirigir al usuario. */
public record BillingSessionResponse(String url) {}
```

- [ ] **Step 4: Escribir SubscriptionService**

```java
package com.restaurante.subscription.service;

import com.restaurante.common.exception.BadRequestException;
import com.restaurante.common.security.CurrentUserService;
import com.restaurante.subscription.dto.SubscriptionMapper;
import com.restaurante.subscription.dto.SubscriptionResponse;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.enums.PlanCode;
import com.restaurante.subscription.enums.SubscriptionStatus;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.subscription.stripe.StripeGateway;
import com.restaurante.subscription.stripe.StripeProperties;
import com.restaurante.subscription.stripe.StripeSubscriptionSnapshot;
import com.restaurante.tenant.entity.Tenant;
import com.restaurante.tenant.repository.TenantRepository;
import com.restaurante.user.entity.User;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;

/**
 * Ciclo de vida de la suscripción de un tenant.
 *
 * Regla que gobierna toda la clase: el estado y el plan guardados sólo cambian a
 * partir de lo que dice Stripe (una instantánea devuelta por la API, o un
 * webhook firmado). Nunca a partir de lo que pide el cliente.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class SubscriptionService {

    private final SubscriptionRepository subscriptionRepository;
    private final TenantRepository tenantRepository;
    private final CurrentUserService currentUserService;
    private final StripeGateway stripeGateway;
    private final StripeProperties stripeProperties;

    @Value("${app.frontend.base-url}")
    private String frontendBaseUrl;

    /** Suscripción del tenant del usuario actual, creándola vacía si no existe. */
    @Transactional
    public Subscription currentSubscription() {
        Long tenantId = requireTenantId();
        return subscriptionRepository.findByTenantIdAndDeletedFalse(tenantId)
                .orElseGet(() -> crearSuscripcionInicial(tenantId));
    }

    private Long requireTenantId() {
        Long tenantId = currentUserService.getCurrentTenantId();
        if (tenantId == null) {
            // El SUPER_ADMIN es el dueño del SaaS: no tiene inquilino ni suscripción.
            throw new BadRequestException(currentUserService.isSuperAdmin()
                    ? "El superadministrador no tiene una suscripción propia"
                    : "Tu usuario no está asociado a ningún inquilino");
        }
        return tenantId;
    }

    private Subscription crearSuscripcionInicial(Long tenantId) {
        Tenant tenant = tenantRepository.findByIdAndDeletedFalse(tenantId)
                .orElseThrow(() -> new BadRequestException("El inquilino no existe"));
        Subscription suscripcion = new Subscription();
        suscripcion.setTenant(tenant);
        suscripcion.setPlanCode(PlanCode.NORMAL);
        // INCOMPLETE: sin acceso hasta que Stripe confirme un pago.
        suscripcion.setStatus(SubscriptionStatus.INCOMPLETE);
        return subscriptionRepository.save(suscripcion);
    }

    private void requireBillingConfigured() {
        if (!stripeProperties.isEnabled()) {
            throw new BadRequestException(
                    "La facturación no está configurada en este entorno");
        }
    }

    @Transactional
    public String createCheckoutSession(PlanCode planCode) {
        requireBillingConfigured();
        Subscription suscripcion = currentSubscription();

        if (suscripcion.getStripeCustomerId() == null) {
            User usuario = currentUserService.getCurrentUser();
            String customerId = stripeGateway.createCustomer(
                    suscripcion.getTenant().getId(),
                    suscripcion.getTenant().getName(),
                    usuario.getEmail());
            suscripcion.setStripeCustomerId(customerId);
            subscriptionRepository.save(suscripcion);
        }

        // El precio SIEMPRE se resuelve aquí, nunca llega del cliente.
        String priceId = stripeProperties.priceIdFor(planCode);
        int diasPrueba = suscripcion.getTrialEnd() == null ? stripeProperties.getTrialDays() : 0;

        return stripeGateway.createCheckoutSession(
                suscripcion.getStripeCustomerId(),
                suscripcion.getTenant().getId(),
                priceId,
                diasPrueba,
                frontendBaseUrl + "/settings/billing?checkout=success",
                frontendBaseUrl + "/settings/billing?checkout=cancel");
    }

    @Transactional(readOnly = true)
    public String createPortalSession() {
        requireBillingConfigured();
        Subscription suscripcion = subscriptionRepository
                .findByTenantIdAndDeletedFalse(requireTenantId())
                .orElseThrow(() -> new BadRequestException("Todavía no tienes una suscripción"));

        if (suscripcion.getStripeCustomerId() == null) {
            throw new BadRequestException(
                    "Todavía no tienes un método de pago registrado. Contrata un plan primero.");
        }
        return stripeGateway.createPortalSession(
                suscripcion.getStripeCustomerId(), frontendBaseUrl + "/settings/billing");
    }

    @Transactional
    public SubscriptionResponse changePlan(PlanCode nuevoPlan) {
        requireBillingConfigured();
        Subscription suscripcion = currentSubscription();

        if (suscripcion.getStripeSubscriptionId() == null) {
            throw new BadRequestException(
                    "No tienes una suscripción activa que cambiar. Contrata un plan primero.");
        }
        if (nuevoPlan == suscripcion.getPlanCode()) {
            throw new BadRequestException("Ya tienes contratado ese plan");
        }

        StripeSubscriptionSnapshot instantanea = stripeGateway.updateSubscriptionPrice(
                suscripcion.getStripeSubscriptionId(), stripeProperties.priceIdFor(nuevoPlan));
        applySnapshot(suscripcion, instantanea, LocalDateTime.now());
        return SubscriptionMapper.toResponse(subscriptionRepository.save(suscripcion));
    }

    @Transactional
    public SubscriptionResponse cancel(boolean atPeriodEnd) {
        requireBillingConfigured();
        Subscription suscripcion = currentSubscription();

        if (suscripcion.getStripeSubscriptionId() == null) {
            throw new BadRequestException("No tienes una suscripción activa que cancelar");
        }

        StripeSubscriptionSnapshot instantanea = stripeGateway.cancelSubscription(
                suscripcion.getStripeSubscriptionId(), atPeriodEnd);
        applySnapshot(suscripcion, instantanea, LocalDateTime.now());
        return SubscriptionMapper.toResponse(subscriptionRepository.save(suscripcion));
    }

    @Transactional
    public SubscriptionResponse reactivate() {
        requireBillingConfigured();
        Subscription suscripcion = currentSubscription();

        if (suscripcion.getStripeSubscriptionId() == null) {
            throw new BadRequestException("No tienes una suscripción que reactivar");
        }
        if (!suscripcion.isCancelAtPeriodEnd()) {
            throw new BadRequestException("Tu suscripción no está pendiente de cancelación");
        }

        StripeSubscriptionSnapshot instantanea =
                stripeGateway.reactivateSubscription(suscripcion.getStripeSubscriptionId());
        applySnapshot(suscripcion, instantanea, LocalDateTime.now());
        return SubscriptionMapper.toResponse(subscriptionRepository.save(suscripcion));
    }

    /**
     * Vuelca en la entidad lo que Stripe dice que es verdad.
     *
     * El plan se deduce del precio: si el precio no está en la configuración, el
     * plan NO se toca. Es preferible conservar el último plan conocido a adivinar
     * uno y conceder o quitar acceso por error.
     *
     * eventoEn permite descartar eventos fuera de orden (Stripe no garantiza el
     * orden de entrega). Los llamadores de la API pasan LocalDateTime.now().
     */
    public void applySnapshot(Subscription suscripcion,
                              StripeSubscriptionSnapshot instantanea,
                              LocalDateTime eventoEn) {
        if (instantanea == null) {
            return;
        }

        suscripcion.setStripeSubscriptionId(instantanea.subscriptionId());
        if (instantanea.customerId() != null) {
            suscripcion.setStripeCustomerId(instantanea.customerId());
        }
        if (instantanea.priceId() != null) {
            suscripcion.setStripePriceId(instantanea.priceId());
            stripeProperties.planForPrice(instantanea.priceId())
                    .ifPresentOrElse(
                            suscripcion::setPlanCode,
                            () -> log.warn("Precio desconocido {} en la suscripción {}:"
                                            + " se conserva el plan {}",
                                    instantanea.priceId(), instantanea.subscriptionId(),
                                    suscripcion.getPlanCode()));
        }
        suscripcion.setStatus(SubscriptionStatus.fromStripe(instantanea.status()));
        suscripcion.setCurrentPeriodStart(aFechaLocal(instantanea.currentPeriodStart()));
        suscripcion.setCurrentPeriodEnd(aFechaLocal(instantanea.currentPeriodEnd()));
        suscripcion.setTrialEnd(aFechaLocal(instantanea.trialEnd()));
        suscripcion.setCancelAtPeriodEnd(instantanea.cancelAtPeriodEnd());
        suscripcion.setLastStripeEventAt(eventoEn);
        // Al entrar en el circuito de cobro real, deja de ser una concesión.
        suscripcion.setLegacyGrant(false);
    }

    private LocalDateTime aFechaLocal(Long epocaEnSegundos) {
        if (epocaEnSegundos == null || epocaEnSegundos == 0L) {
            return null;
        }
        return LocalDateTime.ofInstant(
                Instant.ofEpochSecond(epocaEnSegundos), ZoneId.systemDefault());
    }
}
```

- [ ] **Step 5: Añadir los endpoints al controlador**

En `BillingController`, inyectar `SubscriptionService` y añadir:

```java
    @PostMapping(Constants.BILLING_CHECKOUT_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Iniciar la contratación de un plan")
    public ResponseEntity<ApiResponse<BillingSessionResponse>> checkout(
            @Valid @RequestBody CheckoutRequest request) {
        String url = subscriptionService.createCheckoutSession(request.getPlanCode());
        return ResponseEntity.ok(ApiResponse.success(new BillingSessionResponse(url)));
    }

    @PostMapping(Constants.BILLING_PORTAL_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Abrir el portal de cliente de Stripe")
    public ResponseEntity<ApiResponse<BillingSessionResponse>> portal() {
        return ResponseEntity.ok(ApiResponse.success(
                new BillingSessionResponse(subscriptionService.createPortalSession())));
    }

    @PostMapping(Constants.BILLING_CHANGE_PLAN_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Cambiar de plan")
    public ResponseEntity<ApiResponse<SubscriptionResponse>> changePlan(
            @Valid @RequestBody CheckoutRequest request) {
        return ResponseEntity.ok(ApiResponse.success(
                "Plan actualizado", subscriptionService.changePlan(request.getPlanCode())));
    }

    @PostMapping(Constants.BILLING_CANCEL_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Cancelar la suscripción")
    public ResponseEntity<ApiResponse<SubscriptionResponse>> cancel(
            @RequestBody(required = false) CancelSubscriptionRequest request) {
        boolean alFinalDelPeriodo = request == null || request.isAtPeriodEnd();
        return ResponseEntity.ok(ApiResponse.success(
                "Suscripción cancelada", subscriptionService.cancel(alFinalDelPeriodo)));
    }

    @PostMapping(Constants.BILLING_REACTIVATE_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Deshacer una cancelación programada")
    public ResponseEntity<ApiResponse<SubscriptionResponse>> reactivate() {
        return ResponseEntity.ok(ApiResponse.success(
                "Suscripción reactivada", subscriptionService.reactivate()));
    }
```

Imports nuevos: `jakarta.validation.Valid`, los DTOs y `SubscriptionService`.

- [ ] **Step 6: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante_manage && mvn test -Dtest=BillingCheckoutEndpointIntegrationTest`
Expected: PASS — 7 tests.

- [ ] **Step 7: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/subscription \
        restaurante_manage/src/test/java/com/restaurante/subscription
git commit -m "feat(billing): contratar, cambiar y cancelar la suscripcion

El precio siempre se resuelve en el servidor a partir del plan: aceptar un
priceId del cliente permitiria pagar el plan barato y recibir el caro. El plan
guardado nunca cambia por una peticion del frontend, solo con lo que Stripe
devuelve."
```

---

## Task 9: Webhook de Stripe

El punto más delicado del sistema. Tres reglas irrenunciables: firma verificada, cuerpo
crudo e idempotencia por restricción de base de datos.

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/service/StripeWebhookService.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/controller/StripeWebhookController.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/security/config/SecurityConfig.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/StripeWebhookEndpointIntegrationTest.java`

**Interfaces:**
- Consumes: `SubscriptionService.applySnapshot(...)` (Task 8); `SubscriptionRepository`,
  `ProcessedStripeEventRepository` (Task 2); `StripeProperties` (Task 6).
- Produces:
  - `StripeWebhookService.handle(String payload, String signatureHeader): void`
    — lanza `InvalidWebhookSignatureException` si la firma no valida.
  - `StripeWebhookService.SIGNATURE_HEADER = "Stripe-Signature"`

- [ ] **Step 1: Escribir el test de integración**

Los webhooks se firman **localmente** con HMAC-SHA256, exactamente como lo hace Stripe. No
hace falta red ni cuenta:

```java
package com.restaurante.subscription;

import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.nio.charset.StandardCharsets;

/**
 * Construye la cabecera Stripe-Signature igual que la genera Stripe:
 * HMAC-SHA256 de "<timestamp>.<payload>" con el secreto del endpoint.
 * Permite probar la verificación de firma sin tocar la red.
 */
final class StripeSignatureHelper {

    static String firmar(String payload, String secreto, long marcaTemporal) throws Exception {
        String contenido = marcaTemporal + "." + payload;
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secreto.getBytes(StandardCharsets.UTF_8), "HmacSHA256"));
        byte[] hash = mac.doFinal(contenido.getBytes(StandardCharsets.UTF_8));
        StringBuilder hex = new StringBuilder();
        for (byte b : hash) {
            hex.append(String.format("%02x", b));
        }
        return "t=" + marcaTemporal + ",v1=" + hex;
    }
}
```

Y los casos, con `@TestPropertySource` fijando `app.stripe.webhook-secret=whsec_test_falsa`:

```java
    private String cuerpoSuscripcion(String eventId, String subscriptionId, String priceId,
                                     String estado, long creadoEn) {
        return """
            {
              "id": "%s",
              "object": "event",
              "type": "customer.subscription.updated",
              "created": %d,
              "data": { "object": {
                "id": "%s",
                "object": "subscription",
                "customer": "cus_test_1",
                "status": "%s",
                "cancel_at_period_end": false,
                "items": { "object": "list", "data": [
                  { "id": "si_1", "object": "subscription_item",
                    "current_period_start": 1750000000,
                    "current_period_end": 1752592000,
                    "price": { "id": "%s", "object": "price" } }
                ]}
              }}
            }
            """.formatted(eventId, creadoEn, subscriptionId, estado, priceId);
    }

    @Test
    @DisplayName("Un webhook firmado correctamente actualiza el plan y el estado")
    void webhookValidoActualizaEstado() throws Exception {
        enlazarConStripe(tenantNormal, "cus_test_1", "sub_test_1", "price_normal_test");
        String cuerpo = cuerpoSuscripcion("evt_1", "sub_test_1", "price_pro_test",
                "active", Instant.now().getEpochSecond());

        mockMvc.perform(post("/api/v1/webhooks/stripe")
                        .header("Stripe-Signature", StripeSignatureHelper.firmar(
                                cuerpo, "whsec_test_falsa", Instant.now().getEpochSecond()))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isOk());

        Subscription actualizada = subscriptionRepository
                .findByStripeSubscriptionId("sub_test_1").orElseThrow();
        assertEquals(PlanCode.PRO, actualizada.getPlanCode());
        assertEquals(SubscriptionStatus.ACTIVE, actualizada.getStatus());
    }

    @Test
    @DisplayName("Una firma inválida devuelve 400 y NO cambia nada")
    void firmaInvalidaNoCambiaNada() throws Exception {
        enlazarConStripe(tenantNormal, "cus_test_1", "sub_test_2", "price_normal_test");
        String cuerpo = cuerpoSuscripcion("evt_2", "sub_test_2", "price_pro_test",
                "active", Instant.now().getEpochSecond());

        mockMvc.perform(post("/api/v1/webhooks/stripe")
                        .header("Stripe-Signature", "t=1,v1=firmafalsa")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(cuerpo))
                .andExpect(status().isBadRequest());

        // El plan sigue siendo el de antes: nadie sube de plan sin firma válida.
        assertEquals(PlanCode.NORMAL, subscriptionRepository
                .findByStripeSubscriptionId("sub_test_2").orElseThrow().getPlanCode());
    }

    @Test
    @DisplayName("Sin cabecera de firma se rechaza")
    void sinCabeceraDeFirma() throws Exception {
        mockMvc.perform(post("/api/v1/webhooks/stripe")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{}"))
                .andExpect(status().isBadRequest());
    }

    @Test
    @DisplayName("El mismo evento entregado dos veces se procesa una sola vez")
    void eventoDuplicado() throws Exception {
        enlazarConStripe(tenantNormal, "cus_test_1", "sub_test_3", "price_normal_test");
        String cuerpo = cuerpoSuscripcion("evt_dup", "sub_test_3", "price_pro_test",
                "active", Instant.now().getEpochSecond());
        String firma = StripeSignatureHelper.firmar(
                cuerpo, "whsec_test_falsa", Instant.now().getEpochSecond());

        for (int i = 0; i < 2; i++) {
            mockMvc.perform(post("/api/v1/webhooks/stripe")
                            .header("Stripe-Signature", firma)
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(cuerpo))
                    .andExpect(status().isOk());
        }

        assertEquals(1, processedStripeEventRepository.count());
    }

    @Test
    @DisplayName("Un evento más antiguo que el último aplicado se descarta")
    void eventoFueraDeOrden() throws Exception {
        enlazarConStripe(tenantNormal, "cus_test_1", "sub_test_4", "price_normal_test");
        long ahora = Instant.now().getEpochSecond();

        // Primero llega el nuevo: sube a PRO.
        enviarFirmado(cuerpoSuscripcion("evt_nuevo", "sub_test_4", "price_pro_test",
                "active", ahora));
        // Luego llega uno viejo que decía NORMAL: debe ignorarse.
        enviarFirmado(cuerpoSuscripcion("evt_viejo", "sub_test_4", "price_normal_test",
                "active", ahora - 600));

        assertEquals(PlanCode.PRO, subscriptionRepository
                .findByStripeSubscriptionId("sub_test_4").orElseThrow().getPlanCode());
    }

    @Test
    @DisplayName("Un tipo de evento que no nos interesa se acepta sin hacer nada")
    void eventoIrrelevante() throws Exception {
        String cuerpo = """
            {"id":"evt_otro","object":"event","type":"payment_intent.created",
             "created":%d,"data":{"object":{"id":"pi_1","object":"payment_intent"}}}
            """.formatted(Instant.now().getEpochSecond());
        enviarFirmado(cuerpo);
        // 200 para que Stripe no lo reintente eternamente.
    }
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=StripeWebhookEndpointIntegrationTest`
Expected: FAIL — 404 o 401: la ruta no existe ni es pública.

- [ ] **Step 3: Escribir el servicio de webhooks**

```java
package com.restaurante.subscription.service;

import com.restaurante.subscription.entity.ProcessedStripeEvent;
import com.restaurante.subscription.entity.Subscription;
import com.restaurante.subscription.repository.ProcessedStripeEventRepository;
import com.restaurante.subscription.repository.SubscriptionRepository;
import com.restaurante.subscription.stripe.StripeProperties;
import com.restaurante.subscription.stripe.StripeSubscriptionSnapshot;
import com.stripe.exception.SignatureVerificationException;
import com.stripe.model.Event;
import com.stripe.net.Webhook;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.util.Optional;

/**
 * Procesa los eventos de Stripe. Es la ÚNICA vía por la que el estado de pago de
 * un tenant puede cambiar de forma autoritativa.
 *
 * Tres garantías:
 *  - Firma verificada siempre. Sin secreto configurado, no se procesa nada.
 *  - Idempotencia por la UNIQUE de stripe_processed_events, no por una consulta
 *    previa (que tendría condición de carrera con dos entregas simultáneas).
 *  - Se descartan los eventos anteriores al último aplicado a esa suscripción:
 *    Stripe no garantiza el orden de entrega.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class StripeWebhookService {

    public static final String SIGNATURE_HEADER = "Stripe-Signature";

    private final StripeProperties stripeProperties;
    private final SubscriptionRepository subscriptionRepository;
    private final ProcessedStripeEventRepository processedEventRepository;
    private final SubscriptionService subscriptionService;

    @Transactional
    public void handle(String payload, String signatureHeader) {
        if (stripeProperties.getWebhookSecret() == null
                || stripeProperties.getWebhookSecret().isBlank()) {
            // Fail closed: sin secreto no se acepta NADA. Aceptar sin verificar
            // sería dejar que cualquiera regale planes con una petición HTTP.
            throw new IllegalStateException("STRIPE_WEBHOOK_SECRET no está configurado");
        }

        Event evento;
        try {
            evento = Webhook.constructEvent(
                    payload, signatureHeader, stripeProperties.getWebhookSecret());
        } catch (SignatureVerificationException e) {
            throw new InvalidWebhookSignatureException("Firma de webhook inválida", e);
        }

        // Idempotencia: si la inserción viola la UNIQUE, el evento ya se procesó.
        try {
            processedEventRepository.saveAndFlush(
                    new ProcessedStripeEvent(evento.getId(), evento.getType()));
        } catch (DataIntegrityViolationException e) {
            log.info("[Stripe] Evento {} ({}) ya procesado; se ignora",
                    evento.getId(), evento.getType());
            return;
        }

        log.info("[Stripe] Procesando evento {} de tipo {}", evento.getId(), evento.getType());

        LocalDateTime eventoEn = LocalDateTime.ofInstant(
                Instant.ofEpochSecond(evento.getCreated()), ZoneId.systemDefault());

        switch (evento.getType()) {
            case "checkout.session.completed",
                 "customer.subscription.created",
                 "customer.subscription.updated",
                 "customer.subscription.deleted",
                 "invoice.paid",
                 "invoice.payment_failed" -> aplicarDesdeEvento(evento, eventoEn);
            case "customer.subscription.trial_will_end" ->
                    log.info("[Stripe] La prueba del evento {} termina pronto", evento.getId());
            default -> log.debug("[Stripe] Evento {} sin manejador; se acepta y se ignora",
                    evento.getType());
        }
    }

    /**
     * Relee la suscripción desde Stripe en lugar de fiarse del cuerpo del evento.
     * Es una llamada más, pero elimina toda una clase de errores: el cuerpo puede
     * estar incompleto o desfasado, la API siempre dice la verdad actual.
     */
    private void aplicarDesdeEvento(Event evento, LocalDateTime eventoEn) {
        Optional<String> subscriptionId = extraerSubscriptionId(evento);
        if (subscriptionId.isEmpty()) {
            log.warn("[Stripe] Evento {} sin identificador de suscripción; se ignora",
                    evento.getId());
            return;
        }

        Optional<Subscription> suscripcion =
                subscriptionRepository.findByStripeSubscriptionId(subscriptionId.get());
        if (suscripcion.isEmpty()) {
            suscripcion = resolverPorTenantDeMetadata(evento, subscriptionId.get());
        }
        if (suscripcion.isEmpty()) {
            log.warn("[Stripe] No hay inquilino asociado a la suscripción {}; se ignora",
                    subscriptionId.get());
            return;
        }

        Subscription entidad = suscripcion.get();
        if (entidad.getLastStripeEventAt() != null
                && eventoEn.isBefore(entidad.getLastStripeEventAt())) {
            log.info("[Stripe] Evento {} anterior al último aplicado; se descarta",
                    evento.getId());
            return;
        }

        StripeSubscriptionSnapshot instantanea =
                stripeGatewayFetch(subscriptionId.get());
        subscriptionService.applySnapshot(entidad, instantanea, eventoEn);
        subscriptionRepository.save(entidad);
    }
}
```

> El agente que implemente esta tarea debe completar tres métodos auxiliares privados,
> siguiendo el estilo del resto de la clase:
> - `extraerSubscriptionId(Event)`: para `customer.subscription.*` es el `id` del objeto; para
>   `checkout.session.completed` es `session.getSubscription()`; para `invoice.*` es
>   `invoice.getSubscription()`. Devuelve `Optional.empty()` si no hay ninguno.
> - `resolverPorTenantDeMetadata(Event, String subscriptionId)`: lee `client_reference_id`
>   (checkout) o `metadata.tenantId` (suscripción), busca la suscripción de ese tenant y
>   **verifica que el `customer` del evento coincide** con el guardado si ya había uno.
>   Si no coincide, devuelve `Optional.empty()` y lo registra como incidencia de seguridad.
> - `stripeGatewayFetch(String subscriptionId)`: delega en `StripeGateway.fetchSubscription`,
>   inyectando el gateway en el constructor.
>
> Y la excepción `InvalidWebhookSignatureException extends RuntimeException` en el paquete
> `com.restaurante.common.exception`, con su handler devolviendo **400**:
>
> ```java
> @ExceptionHandler(InvalidWebhookSignatureException.class)
> public ResponseEntity<ApiResponse<Void>> handleInvalidWebhookSignature(
>         InvalidWebhookSignatureException ex) {
>     // 400 a propósito: Stripe NO reintenta los 4xx, y una firma inválida no
>     // mejora reintentándola. Se registra como incidencia de seguridad.
>     log.warn("[Seguridad] Webhook de Stripe con firma inválida rechazado");
>     return ResponseEntity.status(HttpStatus.BAD_REQUEST)
>             .body(ApiResponse.error("INVALID_SIGNATURE", "Firma inválida"));
> }
> ```

- [ ] **Step 4: Escribir el controlador con cuerpo crudo**

```java
package com.restaurante.subscription.controller;

import com.restaurante.common.util.Constants;
import com.restaurante.subscription.service.StripeWebhookService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

/**
 * Receptor de webhooks de Stripe.
 *
 * Devuelve texto plano y recibe el cuerpo como String SIN deserializar: la firma
 * de Stripe se calcula sobre los bytes exactos del payload, así que si Jackson lo
 * convierte a objeto y lo vuelve a serializar, la verificación falla SIEMPRE.
 *
 * Por el mismo motivo la respuesta no usa el envoltorio ApiResponse: a Stripe le
 * basta con el código de estado.
 */
@Slf4j
@RestController
@RequiredArgsConstructor
@Tag(name = "Webhooks", description = "Recepción de eventos de Stripe")
public class StripeWebhookController {

    private final StripeWebhookService stripeWebhookService;

    @PostMapping(Constants.STRIPE_WEBHOOK_PATH)
    @Operation(summary = "Recibir un evento de Stripe (firma obligatoria)")
    public ResponseEntity<String> receive(
            @RequestBody String payload,
            @RequestHeader(value = StripeWebhookService.SIGNATURE_HEADER, required = false)
            String signature) {

        if (signature == null || signature.isBlank()) {
            log.warn("[Seguridad] Webhook de Stripe sin cabecera de firma; rechazado");
            return ResponseEntity.badRequest().body("missing signature");
        }

        stripeWebhookService.handle(payload, signature);
        // 200 siempre que se haya procesado o ignorado a conciencia. Un fallo
        // transitorio propio se propaga como 500 para que Stripe reintente.
        return ResponseEntity.ok("ok");
    }
}
```

- [ ] **Step 5: Abrir la ruta en SecurityConfig**

En `security/config/SecurityConfig.java`, dentro de `authorizeHttpRequests`, junto a las
demás rutas públicas:

```java
                        // Webhook de Stripe: público por definición (lo llama Stripe, sin
                        // JWT). La autenticidad NO la da la sesión, sino la verificación de
                        // la firma HMAC dentro de StripeWebhookService.
                        .requestMatchers(HttpMethod.POST, Constants.STRIPE_WEBHOOK_PATH).permitAll()
```

CSRF ya está desactivado globalmente, así que no hay nada más que tocar.

- [ ] **Step 6: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante_manage && mvn test -Dtest=StripeWebhookEndpointIntegrationTest`
Expected: PASS — 6 tests.

- [ ] **Step 7: Ejecutar la batería completa**

Run: `cd restaurante_manage && mvn test`
Expected: BUILD SUCCESS.

- [ ] **Step 8: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/subscription \
        restaurante_manage/src/main/java/com/restaurante/common/exception \
        restaurante_manage/src/main/java/com/restaurante/security/config/SecurityConfig.java \
        restaurante_manage/src/test/java/com/restaurante/subscription
git commit -m "feat(billing): recibir los webhooks de Stripe con firma verificada

El cuerpo se recibe crudo porque la firma se calcula sobre los bytes exactos:
deserializar y volver a serializar la invalidaria siempre. La idempotencia la
da la UNIQUE de stripe_processed_events, no una consulta previa, que tendria
condicion de carrera con dos entregas simultaneas."
```

---

## Task 10: Reconciliación del downgrade

Qué pasa cuando un tenant con 3 locales baja a un plan de 1. La respuesta: **nada se borra**.

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/service/PlanReconciliationService.java`
- Create: `restaurante_manage/src/main/java/com/restaurante/subscription/dto/ActiveRestaurantRequest.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/subscription/service/SubscriptionService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/subscription/controller/BillingController.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/restaurant/repository/RestaurantRepository.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/PlanReconciliationServiceTest.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/DowngradeEndpointIntegrationTest.java`

**Interfaces:**
- Consumes: `PlanCatalog.limits(PlanCode)` (Task 1); `Restaurant.setActiveUnderPlan(...)` (Task 2);
  `EntitlementService` (Task 3); `SubscriptionService.applySnapshot(...)` (Task 8).
- Produces:
  - `PlanReconciliationService.reconcile(Long tenantId): void` — ajusta `activeUnderPlan`
    de todos los locales del tenant a su plan actual.
  - `PlanReconciliationService.chooseActiveRestaurant(Long tenantId, Long restaurantId): void`
  - `RestaurantRepository.findByTenantIdAndDeletedFalseOrderByIdAsc(Long): List<Restaurant>`
  - `ActiveRestaurantRequest { @NotNull Long restaurantId }`

- [ ] **Step 1: Escribir el test unitario de la reconciliación**

```java
    @Test
    @DisplayName("Al bajar a un plan de 1 local, queda activo el más antiguo y el resto se bloquea")
    void downgradeDejaActivoElMasAntiguo() {
        // tenant con locales de id 10, 11 y 12, todos activos, plan NORMAL
        planReconciliationService.reconcile(TENANT_ID);

        assertTrue(local10.getActiveUnderPlan());
        assertFalse(local11.getActiveUnderPlan());
        assertFalse(local12.getActiveUnderPlan());
    }

    @Test
    @DisplayName("La reconciliación NUNCA borra ni marca como eliminado un local")
    void reconciliacionNoBorraNada() {
        planReconciliationService.reconcile(TENANT_ID);

        for (Restaurant local : List.of(local10, local11, local12)) {
            assertFalse(local.getDeleted(), "La reconciliación no debe borrar locales");
            assertNull(local.getDeletedAt());
        }
        verify(restaurantRepository, never()).delete(any());
        verify(restaurantRepository, never()).deleteById(any());
    }

    @Test
    @DisplayName("Al volver a un plan ilimitado se reactivan todos los locales")
    void upgradeReactivaTodo() {
        local11.setActiveUnderPlan(false);
        local12.setActiveUnderPlan(false);
        conPlan(PlanCode.PRO);

        planReconciliationService.reconcile(TENANT_ID);

        assertTrue(local10.getActiveUnderPlan());
        assertTrue(local11.getActiveUnderPlan());
        assertTrue(local12.getActiveUnderPlan());
    }

    @Test
    @DisplayName("Si ya hay un local elegido dentro de la cuota, se respeta")
    void respetaLaEleccionPrevia() {
        local10.setActiveUnderPlan(false);
        local12.setActiveUnderPlan(true);   // el usuario eligió el 12
        local11.setActiveUnderPlan(false);
        conPlan(PlanCode.NORMAL);

        planReconciliationService.reconcile(TENANT_ID);

        assertFalse(local10.getActiveUnderPlan());
        assertTrue(local12.getActiveUnderPlan(), "No debe pisar la elección del usuario");
    }

    @Test
    @DisplayName("Un estado sin acceso bloquea todos los locales, sin borrar nada")
    void suscripcionMuertaBloqueaTodo() {
        conPlanYEstado(PlanCode.PRO, SubscriptionStatus.CANCELED);

        planReconciliationService.reconcile(TENANT_ID);

        assertFalse(local10.getActiveUnderPlan());
        assertFalse(local11.getActiveUnderPlan());
        assertFalse(local12.getActiveUnderPlan());
        assertFalse(local10.getDeleted());
    }

    @Test
    @DisplayName("No se puede elegir como activo un local de otro inquilino")
    void eleccionCrossTenantRechazada() {
        assertThrows(AccessDeniedException.class, () ->
                planReconciliationService.chooseActiveRestaurant(TENANT_ID, idLocalDeOtroTenant));
    }
```

- [ ] **Step 2: Escribir el test de integración del flujo completo**

`DowngradeEndpointIntegrationTest.java`, con el andamiaje de la Task 4 y un webhook firmado
como el de la Task 9:

```java
    @Test
    @DisplayName("Un webhook que baja a NORMAL bloquea los locales sobrantes sin borrarlos")
    void webhookDeDowngradeReconcilia() throws Exception {
        // tenant PRO con 3 locales, enlazado a sub_down
        enviarWebhookFirmado(cuerpoSuscripcion("evt_down", "sub_down",
                "price_normal_test", "active", Instant.now().getEpochSecond()));

        List<Restaurant> locales = restaurantRepository
                .findByTenantIdAndDeletedFalseOrderByIdAsc(tenantPro.getId());
        assertEquals(3, locales.size(), "No se debe perder ningún local");
        assertTrue(locales.get(0).getActiveUnderPlan());
        assertFalse(locales.get(1).getActiveUnderPlan());
        assertFalse(locales.get(2).getActiveUnderPlan());
    }

    @Test
    @DisplayName("El ADMIN puede elegir qué local queda activo")
    void adminEligeLocalActivo() throws Exception {
        // tras el downgrade anterior
        mockMvc.perform(post("/api/v1/billing/active-restaurant")
                        .header("Authorization", "Bearer " + tokenAdminPro)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"restaurantId\":" + idTercerLocal + "}"))
                .andExpect(status().isOk());

        assertTrue(restaurantRepository.findById(idTercerLocal).orElseThrow().getActiveUnderPlan());
        assertFalse(restaurantRepository.findById(idPrimerLocal).orElseThrow().getActiveUnderPlan());
    }

    @Test
    @DisplayName("No se puede elegir como activo un local de otro inquilino")
    void noSePuedeElegirLocalAjeno() throws Exception {
        mockMvc.perform(post("/api/v1/billing/active-restaurant")
                        .header("Authorization", "Bearer " + tokenAdminPro)
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"restaurantId\":" + idLocalDelOtroTenant + "}"))
                .andExpect(status().isForbidden());
    }

    @Test
    @DisplayName("Volver a PRO reactiva los tres locales con sus datos intactos")
    void upgradeDevuelveTodo() throws Exception {
        long reservasAntes = reservationRepository.count();

        enviarWebhookFirmado(cuerpoSuscripcion("evt_up", "sub_down",
                "price_pro_test", "active", Instant.now().getEpochSecond() + 60));

        restaurantRepository.findByTenantIdAndDeletedFalseOrderByIdAsc(tenantPro.getId())
                .forEach(local -> assertTrue(local.getActiveUnderPlan()));
        assertEquals(reservasAntes, reservationRepository.count(),
                "Bajar y subir de plan no debe perder ni una reserva");
    }
```

- [ ] **Step 3: Ejecutar los tests y verificar que fallan**

Run: `cd restaurante_manage && mvn test -Dtest='PlanReconciliationServiceTest,DowngradeEndpointIntegrationTest'`
Expected: FAIL — no existe `PlanReconciliationService` ni el endpoint.

- [ ] **Step 4: Escribir PlanReconciliationService**

```java
package com.restaurante.subscription.service;

import com.restaurante.common.exception.AccessDeniedException;
import com.restaurante.common.exception.BadRequestException;
import com.restaurante.restaurant.entity.Restaurant;
import com.restaurante.restaurant.repository.RestaurantRepository;
import com.restaurante.subscription.catalog.PlanLimits;
import com.restaurante.subscription.enums.Resource;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * Ajusta los locales de un tenant a los límites de su plan actual.
 *
 * PRINCIPIO INNEGOCIABLE: esta clase nunca borra, nunca marca como eliminado y
 * nunca desactiva cuentas de usuario. Lo único que toca es activeUnderPlan, que
 * es reversible: al recuperar el plan, todo vuelve exactamente como estaba.
 *
 * Criterio de desempate: se conservan activos los locales MÁS ANTIGUOS (menor
 * id). Es determinista y previsible, y el usuario puede cambiarlo después con
 * chooseActiveRestaurant.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PlanReconciliationService {

    private final RestaurantRepository restaurantRepository;
    private final EntitlementService entitlementService;

    @Transactional
    public void reconcile(Long tenantId) {
        if (tenantId == null) {
            return;
        }

        EffectiveSubscription efectiva = entitlementService.resolve(tenantId);
        List<Restaurant> locales =
                restaurantRepository.findByTenantIdAndDeletedFalseOrderByIdAsc(tenantId);

        // Sin acceso (cancelada, impagada): se bloquea todo, pero no se pierde nada.
        if (!efectiva.hasAccess()) {
            locales.forEach(local -> local.setActiveUnderPlan(false));
            restaurantRepository.saveAll(locales);
            log.info("[Plan] Inquilino {} sin suscripción activa: {} locales en solo lectura",
                    tenantId, locales.size());
            return;
        }

        PlanLimits limites = efectiva.limits();
        if (limites.isUnlimited(Resource.RESTAURANT)) {
            locales.forEach(local -> local.setActiveUnderPlan(true));
            restaurantRepository.saveAll(locales);
            log.info("[Plan] Inquilino {} con plan ilimitado: {} locales activos",
                    tenantId, locales.size());
            return;
        }

        int cupo = limites.limitFor(Resource.RESTAURANT);

        // Se respeta la elección previa del usuario si cabe en el cupo; el resto
        // del cupo se rellena con los locales más antiguos.
        List<Restaurant> yaElegidos = locales.stream()
                .filter(local -> Boolean.TRUE.equals(local.getActiveUnderPlan()))
                .limit(cupo)
                .toList();

        int huecosLibres = cupo - yaElegidos.size();
        List<Restaurant> relleno = locales.stream()
                .filter(local -> !yaElegidos.contains(local))
                .limit(huecosLibres)
                .toList();

        for (Restaurant local : locales) {
            boolean activo = yaElegidos.contains(local) || relleno.contains(local);
            local.setActiveUnderPlan(activo);
        }
        restaurantRepository.saveAll(locales);

        log.info("[Plan] Inquilino {} ajustado a un cupo de {}: {} de {} locales activos."
                        + " Ningún dato eliminado.",
                tenantId, cupo, yaElegidos.size() + relleno.size(), locales.size());
    }

    /**
     * El usuario elige qué local quiere mantener operativo. Sólo reordena dentro
     * del cupo; nunca permite superarlo.
     */
    @Transactional
    public void chooseActiveRestaurant(Long tenantId, Long restaurantId) {
        Restaurant elegido = restaurantRepository.findByIdAndDeletedFalse(restaurantId)
                .orElseThrow(() -> new BadRequestException("El local no existe"));

        Long tenantDelLocal = elegido.getTenant() != null ? elegido.getTenant().getId() : null;
        if (tenantId == null || !tenantId.equals(tenantDelLocal)) {
            // Aislamiento entre inquilinos: nunca se toca un local ajeno.
            throw new AccessDeniedException("No tiene permiso para acceder a este local");
        }

        EffectiveSubscription efectiva = entitlementService.resolve(tenantId);
        if (!efectiva.hasAccess()) {
            throw new BadRequestException(
                    "Tu suscripción no está activa; no se pueden activar locales");
        }
        PlanLimits limites = efectiva.limits();
        if (limites.isUnlimited(Resource.RESTAURANT)) {
            return; // con plan ilimitado no hay nada que elegir
        }

        List<Restaurant> locales =
                restaurantRepository.findByTenantIdAndDeletedFalseOrderByIdAsc(tenantId);
        int cupo = limites.limitFor(Resource.RESTAURANT);

        // El elegido primero; el resto del cupo, por antigüedad.
        locales.forEach(local -> local.setActiveUnderPlan(false));
        elegido.setActiveUnderPlan(true);
        locales.stream()
                .filter(local -> !local.getId().equals(restaurantId))
                .limit(Math.max(0, cupo - 1))
                .forEach(local -> local.setActiveUnderPlan(true));

        restaurantRepository.saveAll(locales);
        restaurantRepository.save(elegido);
    }
}
```

- [ ] **Step 5: Añadir el método al repositorio y enganchar la reconciliación**

En `restaurant/repository/RestaurantRepository.java`:

```java
    List<Restaurant> findByTenantIdAndDeletedFalseOrderByIdAsc(Long tenantId);
```

En `SubscriptionService`, inyectar `PlanReconciliationService` y llamarlo **después de
guardar** en `changePlan(...)`, `cancel(...)` y `reactivate(...)`. En
`StripeWebhookService.aplicarDesdeEvento(...)`, llamarlo tras `subscriptionRepository.save`:

```java
        // El plan acaba de cambiar: ajustar qué locales quedan operativos.
        // Nunca borra datos, sólo alterna activeUnderPlan.
        planReconciliationService.reconcile(entidad.getTenant().getId());
```

- [ ] **Step 6: Añadir el endpoint de elección**

```java
package com.restaurante.subscription.dto;

import jakarta.validation.constraints.NotNull;
import lombok.Data;

/** Local que el inquilino quiere mantener operativo tras bajar de plan. */
@Data
public class ActiveRestaurantRequest {

    @NotNull(message = "El identificador del local es obligatorio")
    private Long restaurantId;
}
```

En `BillingController`:

```java
    @PostMapping(Constants.BILLING_ACTIVE_RESTAURANT_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN')")
    @Operation(summary = "Elegir qué local queda operativo con el plan actual")
    public ResponseEntity<ApiResponse<Void>> activeRestaurant(
            @Valid @RequestBody ActiveRestaurantRequest request) {
        planReconciliationService.chooseActiveRestaurant(
                currentUserService.getCurrentTenantId(), request.getRestaurantId());
        return ResponseEntity.ok(ApiResponse.success("Local activo actualizado", null));
    }
```

- [ ] **Step 7: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante_manage && mvn test -Dtest='PlanReconciliationServiceTest,DowngradeEndpointIntegrationTest'`
Expected: PASS.

- [ ] **Step 8: Ejecutar la batería completa**

Run: `cd restaurante_manage && mvn test`
Expected: BUILD SUCCESS.

- [ ] **Step 9: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/subscription \
        restaurante_manage/src/main/java/com/restaurante/restaurant/repository/RestaurantRepository.java \
        restaurante_manage/src/test/java/com/restaurante/subscription
git commit -m "feat(billing): reconciliar los locales al cambiar de plan

Bajar de plan nunca borra: los locales sobrantes pasan a solo lectura por
antiguedad, el usuario puede elegir cual conserva, y al volver a Pro se
reactivan todos con sus datos intactos."
```

---

# FASE C — Funcionalidades del plan PRO

## Task 11: Exportación CSV y horizonte de estadísticas

Le da a PRO algo tangible desde el primer día, y estrena el uso de
`entitlementService.require(...)` en endpoints reales.

**Files:**
- Create: `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationExportService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/controller/ReservationController.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/reservation/service/ReservationService.java`
- Modify: `restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java`
- Test: `restaurante_manage/src/test/java/com/restaurante/subscription/ProFeaturesEndpointIntegrationTest.java`

**Interfaces:**
- Consumes: `EntitlementService.require(Feature)` (Task 3); `Feature.EXPORT_DATA`,
  `Feature.ADVANCED_ANALYTICS` (Task 1); `CurrentUserService.getVisibleRestaurantIds()`.
- Produces:
  - `Constants.RESERVATIONS_EXPORT_SUBPATH = "/export"`
  - `ReservationExportService.exportToCsv(LocalDate desde, LocalDate hasta): String`
  - Constante `ReservationService.HISTORICO_BASICO_DIAS = 7`

- [ ] **Step 1: Escribir el test de integración**

```java
    @Test
    @DisplayName("Un tenant NORMAL no puede exportar: 403 PLAN_UPGRADE_REQUIRED")
    void normalNoPuedeExportar() throws Exception {
        mockMvc.perform(get("/api/v1/reservations/export")
                        .header("Authorization", "Bearer " + tokenAdminNormal))
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("PLAN_UPGRADE_REQUIRED"))
                .andExpect(jsonPath("$.data.feature").value("EXPORT_DATA"))
                .andExpect(jsonPath("$.data.requiredPlan").value("PRO"));
    }

    @Test
    @DisplayName("Un tenant PRO exporta un CSV con cabecera y sus reservas")
    void proExportaCsv() throws Exception {
        mockMvc.perform(get("/api/v1/reservations/export")
                        .header("Authorization", "Bearer " + tokenAdminPro))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type",
                        org.hamcrest.Matchers.containsString("text/csv")))
                .andExpect(header().string("Content-Disposition",
                        org.hamcrest.Matchers.containsString("reservas")))
                .andExpect(content().string(org.hamcrest.Matchers.startsWith(
                        "id,fecha,hora,cliente,telefono,personas,mesa,estado,restaurante")));
    }

    @Test
    @DisplayName("La exportación de un PRO sólo incluye sus propias reservas")
    void exportacionAisladaPorInquilino() throws Exception {
        String csv = mockMvc.perform(get("/api/v1/reservations/export")
                        .header("Authorization", "Bearer " + tokenAdminPro))
                .andReturn().getResponse().getContentAsString();

        assertTrue(csv.contains("Cliente Del Pro"));
        assertFalse(csv.contains("Cliente Del Normal"),
                "Fuga de datos entre inquilinos en la exportación");
    }

    @Test
    @DisplayName("NORMAL sólo ve estadísticas de los últimos 7 días")
    void normalTieneHistoricoRecortado() throws Exception {
        mockMvc.perform(get("/api/v1/reservations/stats")
                        .param("from", LocalDate.now().minusMonths(6).toString())
                        .param("to", LocalDate.now().toString())
                        .header("Authorization", "Bearer " + tokenAdminNormal))
                .andExpect(status().isOk())
                // El rango se recorta en servidor: pedir 6 meses no los devuelve.
                .andExpect(jsonPath("$.data.rangeFrom")
                        .value(LocalDate.now().minusDays(7).toString()))
                .andExpect(jsonPath("$.data.historyTruncated").value(true));
    }

    @Test
    @DisplayName("PRO recibe el histórico completo que pide")
    void proTieneHistoricoCompleto() throws Exception {
        mockMvc.perform(get("/api/v1/reservations/stats")
                        .param("from", LocalDate.now().minusMonths(6).toString())
                        .param("to", LocalDate.now().toString())
                        .header("Authorization", "Bearer " + tokenAdminPro))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.rangeFrom")
                        .value(LocalDate.now().minusMonths(6).toString()))
                .andExpect(jsonPath("$.data.historyTruncated").value(false));
    }
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante_manage && mvn test -Dtest=ProFeaturesEndpointIntegrationTest`
Expected: FAIL — 404 en `/export`; las estadísticas no recortan nada.

- [ ] **Step 3: Escribir el servicio de exportación**

```java
package com.restaurante.reservation.service;

import com.restaurante.common.security.CurrentUserService;
import com.restaurante.reservation.entity.Reservation;
import com.restaurante.reservation.repository.ReservationRepository;
import com.restaurante.subscription.enums.Feature;
import com.restaurante.subscription.service.EntitlementService;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.util.List;

/**
 * Exportación de reservas a CSV. Es una funcionalidad del plan Pro.
 *
 * El filtrado por inquilino sigue siendo el de siempre
 * (CurrentUserService.getVisibleRestaurantIds): la comprobación de plan se suma a
 * la de aislamiento, no la sustituye.
 */
@Service
@RequiredArgsConstructor
public class ReservationExportService {

    private static final String CABECERA =
            "id,fecha,hora,cliente,telefono,personas,mesa,estado,restaurante";
    private static final DateTimeFormatter FECHA = DateTimeFormatter.ISO_LOCAL_DATE;
    private static final DateTimeFormatter HORA = DateTimeFormatter.ofPattern("HH:mm");

    private final ReservationRepository reservationRepository;
    private final CurrentUserService currentUserService;
    private final EntitlementService entitlementService;

    @Transactional(readOnly = true)
    public String exportToCsv(LocalDate desde, LocalDate hasta) {
        entitlementService.require(Feature.EXPORT_DATA);

        List<Long> restaurantesVisibles = currentUserService.getVisibleRestaurantIds();
        Long tenantId = currentUserService.getTenantIdForCurrentUser();

        List<Reservation> reservas = reservationRepository
                .findForExport(tenantId, restaurantesVisibles, desde, hasta);

        StringBuilder csv = new StringBuilder(CABECERA).append("\n");
        for (Reservation reserva : reservas) {
            csv.append(fila(reserva)).append("\n");
        }
        return csv.toString();
    }

    private String fila(Reservation reserva) {
        return String.join(",",
                String.valueOf(reserva.getId()),
                reserva.getReservationDate() != null
                        ? reserva.getReservationDate().format(FECHA) : "",
                reserva.getReservationTime() != null
                        ? reserva.getReservationTime().format(HORA) : "",
                escapar(reserva.getCustomer() != null
                        ? reserva.getCustomer().getFirstName() + " "
                          + reserva.getCustomer().getLastName() : ""),
                escapar(reserva.getCustomer() != null ? reserva.getCustomer().getPhone() : ""),
                String.valueOf(reserva.getNumberOfGuests()),
                escapar(reserva.getDiningTable() != null
                        ? reserva.getDiningTable().getTableNumber() : ""),
                reserva.getStatus() != null ? reserva.getStatus().name() : "",
                escapar(reserva.getRestaurant() != null ? reserva.getRestaurant().getName() : ""));
    }

    /**
     * Entrecomilla y neutraliza el valor. Además de las comas y comillas, se
     * antepone un apóstrofo a lo que empieza por =, +, - o @: sin eso, abrir el
     * CSV en Excel ejecutaría el contenido como fórmula (inyección CSV), y estos
     * campos los rellenan clientes finales desde la página pública.
     */
    private String escapar(String valor) {
        if (valor == null || valor.isBlank()) {
            return "";
        }
        String limpio = valor.replace("\"", "\"\"").replace("\n", " ").replace("\r", " ");
        if (limpio.startsWith("=") || limpio.startsWith("+")
                || limpio.startsWith("-") || limpio.startsWith("@")) {
            limpio = "'" + limpio;
        }
        return "\"" + limpio + "\"";
    }
}
```

El agente añadirá a `ReservationRepository` la consulta `findForExport(...)` siguiendo el
estilo de las consultas existentes: filtro por `deletedFalse`, por `tenantId` cuando no sea
nulo, por `restaurantId IN :visibles` cuando la lista no esté vacía, y por rango de fechas
cuando se indique. **Debe respetar el convenio de `getVisibleRestaurantIds()`**: lista vacía
significa "sin filtro de id", `[-1]` significa "nada".

- [ ] **Step 4: Añadir el endpoint**

En `Constants.java`:

```java
    /** Exportación CSV de reservas. Requiere el plan Pro. */
    public static final String RESERVATIONS_EXPORT_SUBPATH = "/export";
```

En `ReservationController`:

```java
    @GetMapping(Constants.RESERVATIONS_EXPORT_SUBPATH)
    @PreAuthorize("hasAnyRole('SUPER_ADMIN','ADMIN','MANAGER')")
    @Operation(summary = "Exportar reservas a CSV (requiere plan Pro)")
    public ResponseEntity<String> export(
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate from,
            @RequestParam(required = false)
            @DateTimeFormat(iso = DateTimeFormat.ISO.DATE) LocalDate to) {

        String csv = reservationExportService.exportToCsv(from, to);
        String nombre = "reservas-" + LocalDate.now() + ".csv";

        return ResponseEntity.ok()
                .header(HttpHeaders.CONTENT_TYPE, "text/csv; charset=UTF-8")
                .header(HttpHeaders.CONTENT_DISPOSITION, "attachment; filename=\"" + nombre + "\"")
                .body(csv);
    }
```

- [ ] **Step 5: Recortar el horizonte de las estadísticas**

En `ReservationService`, en el método que sirve `/reservations/stats`:

```java
    /** Días de histórico que incluye el plan básico. */
    public static final int HISTORICO_BASICO_DIAS = 7;
```

```java
        // Sin analítica avanzada, el histórico se recorta EN SERVIDOR: pedir seis
        // meses por parámetro no debe devolver seis meses. El recorte se anuncia
        // en la respuesta para que la interfaz pueda explicarlo en vez de mentir.
        boolean historicoCompleto = entitlementService.hasFeature(
                currentUserService.getCurrentTenantId(), Feature.ADVANCED_ANALYTICS);

        LocalDate minimoPermitido = LocalDate.now().minusDays(HISTORICO_BASICO_DIAS);
        boolean recortado = false;
        if (!historicoCompleto && (from == null || from.isBefore(minimoPermitido))) {
            from = minimoPermitido;
            recortado = true;
        }
```

Y añadir a `ReservationStats` los campos `rangeFrom`, `rangeTo` y `historyTruncated`.

- [ ] **Step 6: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante_manage && mvn test -Dtest=ProFeaturesEndpointIntegrationTest`
Expected: PASS — 5 tests.

- [ ] **Step 7: Ejecutar la batería completa**

Run: `cd restaurante_manage && mvn test`
Expected: BUILD SUCCESS.

- [ ] **Step 8: Commit**

```bash
git add restaurante_manage/src/main/java/com/restaurante/reservation \
        restaurante_manage/src/main/java/com/restaurante/common/util/Constants.java \
        restaurante_manage/src/test/java/com/restaurante/subscription
git commit -m "feat(billing): anadir exportacion CSV y recorte de historico por plan

La exportacion escapa las formulas de Excel: esos campos los rellenan clientes
finales desde la pagina publica, asi que un nombre que empiece por = no debe
ejecutarse al abrir el fichero."
```

**Fin del backend.** Punto de parada: `mvn test` en verde y el flujo completo probable con
la CLI de Stripe.

---

# FASE D — Frontend

## Task 12: Servicio y contexto de entitlements

La base de la que cuelga todo lo visual. **Nunca autoriza nada**: sólo decide qué se pinta.

**Files:**
- Create: `restaurante-frontend/src/services/billingService.js`
- Create: `restaurante-frontend/src/config/features.js`
- Create: `restaurante-frontend/src/context/EntitlementsContext.jsx`
- Modify: `restaurante-frontend/src/main.jsx`
- Modify: `restaurante-frontend/src/config/permissions.js`
- Test: `restaurante-frontend/src/context/EntitlementsContext.test.jsx`

**Interfaces:**
- Consumes: `GET /billing/entitlements`, `GET /billing/plans`, `GET /billing/subscription`,
  `POST /billing/{checkout,portal,change-plan,cancel,reactivate,active-restaurant}` (Tasks 7-10);
  `api` de `src/api/axios.js` y `useAuth` de `AuthContext` (existentes).
- Produces:
  - `billingService`: `getEntitlements()`, `getPlans()`, `getSubscription()`,
    `startCheckout(planCode)`, `openPortal()`, `changePlan(planCode)`,
    `cancelSubscription(atPeriodEnd)`, `reactivateSubscription()`, `setActiveRestaurant(id)`
  - `FEATURES` (objeto espejo del enum) y `FEATURE_LABELS` en `config/features.js`
  - `useEntitlements()` → `{ plan, status, features, limits, usage, loading, hasFeature(f), refresh(), isAtLimit(resource) }`
  - `PERMISSIONS.MANAGE_BILLING` en `permissions.js`, concedido sólo a ADMIN y SUPER_ADMIN

- [ ] **Step 1: Escribir el test del contexto**

```jsx
import { render, screen, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EntitlementsProvider, useEntitlements } from './EntitlementsContext';
import * as billingService from '../services/billingService';

vi.mock('../services/billingService');
vi.mock('./AuthContext', () => ({
  useAuth: () => ({ user: { id: 1, role: 'ADMIN' }, token: 'token-falso' }),
}));

const Sonda = () => {
  const { plan, loading, hasFeature, isAtLimit } = useEntitlements();
  if (loading) return <span>cargando</span>;
  return (
    <div>
      <span data-testid="plan">{plan}</span>
      <span data-testid="export">{String(hasFeature('EXPORT_DATA'))}</span>
      <span data-testid="tope-locales">{String(isAtLimit('RESTAURANT'))}</span>
    </div>
  );
};

describe('EntitlementsContext', () => {
  beforeEach(() => vi.clearAllMocks());

  it('expone las features del plan contratado', async () => {
    billingService.getEntitlements.mockResolvedValue({
      plan: 'PRO', hasAccess: true, status: 'ACTIVE',
      features: ['EXPORT_DATA', 'MULTI_RESTAURANT'],
      limits: { maxRestaurants: null, maxUserAccounts: null },
      usage: { RESTAURANT: 3, USER_ACCOUNT: 8 },
    });

    render(<EntitlementsProvider><Sonda /></EntitlementsProvider>);

    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('PRO'));
    expect(screen.getByTestId('export')).toHaveTextContent('true');
    expect(screen.getByTestId('tope-locales')).toHaveTextContent('false');
  });

  it('un plan NORMAL no tiene features y detecta el tope alcanzado', async () => {
    billingService.getEntitlements.mockResolvedValue({
      plan: 'NORMAL', hasAccess: true, status: 'ACTIVE', features: [],
      limits: { maxRestaurants: 1, maxUserAccounts: 5 },
      usage: { RESTAURANT: 1, USER_ACCOUNT: 3 },
    });

    render(<EntitlementsProvider><Sonda /></EntitlementsProvider>);

    await waitFor(() => expect(screen.getByTestId('plan')).toHaveTextContent('NORMAL'));
    expect(screen.getByTestId('export')).toHaveTextContent('false');
    expect(screen.getByTestId('tope-locales')).toHaveTextContent('true');
  });

  it('ante un fallo de red no concede ninguna feature', async () => {
    billingService.getEntitlements.mockRejectedValue(new Error('sin red'));

    render(<EntitlementsProvider><Sonda /></EntitlementsProvider>);

    // Cerrado por defecto: un error de red nunca debe regalar funciones de pago.
    await waitFor(() => expect(screen.getByTestId('export')).toHaveTextContent('false'));
  });
});
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante-frontend && pnpm test EntitlementsContext`
Expected: FAIL — no existe el módulo.

- [ ] **Step 3: Escribir el servicio**

```js
import api from '../api/axios';

/**
 * Cliente de la API de facturación.
 *
 * Ninguna función de aquí decide nada: el backend es el que autoriza. Lo que se
 * lee por aquí sólo sirve para pintar la interfaz.
 */

export const getEntitlements = async () => {
  const { data } = await api.get('/billing/entitlements');
  return data.data;
};

export const getPlans = async () => {
  const { data } = await api.get('/billing/plans');
  return data.data;
};

export const getSubscription = async () => {
  const { data } = await api.get('/billing/subscription');
  return data.data;
};

/** Devuelve la URL de Stripe Checkout a la que hay que redirigir. */
export const startCheckout = async (planCode) => {
  const { data } = await api.post('/billing/checkout', { planCode });
  return data.data.url;
};

export const openPortal = async () => {
  const { data } = await api.post('/billing/portal');
  return data.data.url;
};

export const changePlan = async (planCode) => {
  const { data } = await api.post('/billing/change-plan', { planCode });
  return data.data;
};

export const cancelSubscription = async (atPeriodEnd = true) => {
  const { data } = await api.post('/billing/cancel', { atPeriodEnd });
  return data.data;
};

export const reactivateSubscription = async () => {
  const { data } = await api.post('/billing/reactivate');
  return data.data;
};

export const setActiveRestaurant = async (restaurantId) => {
  const { data } = await api.post('/billing/active-restaurant', { restaurantId });
  return data.data;
};
```

- [ ] **Step 4: Escribir el catálogo de features del frontend**

```js
// ═══════════════════════════════════════════════════════════════════════════════
//  Funcionalidades por plan — espejo del enum Feature del backend.
//
//  IMPORTANTE: esto NO autoriza nada. Sirve para pintar candados y textos. Quien
//  decide es el backend: aunque alguien manipule este archivo en el navegador, la
//  API responde 403 igual.
// ═══════════════════════════════════════════════════════════════════════════════

export const FEATURES = {
  MULTI_RESTAURANT: 'MULTI_RESTAURANT',
  ADVANCED_ANALYTICS: 'ADVANCED_ANALYTICS',
  EXPORT_DATA: 'EXPORT_DATA',
  ADVANCED_PERMISSIONS: 'ADVANCED_PERMISSIONS',
  AUTOMATIONS: 'AUTOMATIONS',
  CUSTOMER_REMINDERS: 'CUSTOMER_REMINDERS',
};

/** Nombre y explicación breve de cada funcionalidad, para el diálogo de mejora. */
export const FEATURE_LABELS = {
  [FEATURES.MULTI_RESTAURANT]: {
    name: 'Varios locales',
    description: 'Gestiona todos tus restaurantes desde una sola cuenta, con sus '
      + 'reservas, mesas y personal separados.',
  },
  [FEATURES.ADVANCED_ANALYTICS]: {
    name: 'Analítica avanzada',
    description: 'Histórico completo, comparativas entre periodos y tendencias, '
      + 'más allá de los últimos 7 días.',
  },
  [FEATURES.EXPORT_DATA]: {
    name: 'Exportación de datos',
    description: 'Descarga tus reservas en CSV para abrirlas en Excel o llevarlas '
      + 'a tu contabilidad.',
  },
  [FEATURES.ADVANCED_PERMISSIONS]: {
    name: 'Permisos avanzados',
    description: 'Control fino de qué ve y qué hace cada persona de tu equipo.',
  },
  [FEATURES.AUTOMATIONS]: {
    name: 'Automatizaciones',
    description: 'Tareas que se ejecutan solas según lo que pase en tu servicio.',
  },
  [FEATURES.CUSTOMER_REMINDERS]: {
    name: 'Recordatorios a clientes',
    description: 'Avisos automáticos antes de la reserva para reducir las ausencias.',
  },
};

export const PLAN_LABELS = { NORMAL: 'Normal', PRO: 'Pro' };

/** Estados de suscripción en lenguaje humano. */
export const STATUS_LABELS = {
  TRIALING: { text: 'Periodo de prueba', tone: 'info' },
  ACTIVE: { text: 'Activo', tone: 'success' },
  PAST_DUE: { text: 'Pago pendiente', tone: 'warning' },
  CANCELED: { text: 'Cancelado', tone: 'danger' },
  UNPAID: { text: 'Impagado', tone: 'danger' },
  INCOMPLETE: { text: 'Sin completar', tone: 'warning' },
  INCOMPLETE_EXPIRED: { text: 'Caducado', tone: 'danger' },
};
```

- [ ] **Step 5: Escribir el contexto**

`EntitlementsContext.jsx` — con `hasFeature`, `isAtLimit`, `refresh` y, crítico, el
**reintento tras el checkout**, porque el webhook de Stripe puede tardar unos segundos:

```jsx
import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { getEntitlements } from '../services/billingService';
import { useAuth } from './AuthContext';

const EntitlementsContext = createContext(null);

// eslint-disable-next-line react-refresh/only-export-components
export const useEntitlements = () => {
  const context = useContext(EntitlementsContext);
  if (!context) {
    throw new Error('useEntitlements debe usarse dentro de un EntitlementsProvider');
  }
  return context;
};

/** Estado cerrado: sin features y sin cuota. Es el punto de partida y el de error. */
const ESTADO_VACIO = {
  plan: null, status: null, hasAccess: false,
  features: [], limits: {}, usage: {},
};

export const EntitlementsProvider = ({ children }) => {
  const { token } = useAuth();
  const [entitlements, setEntitlements] = useState(ESTADO_VACIO);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!token) {
      setEntitlements(ESTADO_VACIO);
      setLoading(false);
      return;
    }
    try {
      setEntitlements(await getEntitlements());
    } catch {
      // Cerrado por defecto: un fallo de red nunca debe regalar funciones de pago.
      // El backend seguiría negándolas, pero pintar candados es más honesto que
      // mostrar botones que van a fallar.
      setEntitlements(ESTADO_VACIO);
    } finally {
      setLoading(false);
    }
  }, [token]);

  useEffect(() => { refresh(); }, [refresh]);

  /**
   * Tras volver de Stripe, el webhook puede tardar unos segundos en llegar. Se
   * reconsulta con espera creciente en vez de mostrar el plan viejo y parecer
   * que el pago no ha servido de nada.
   */
  const refreshAfterCheckout = useCallback(async (intentos = 5) => {
    for (let i = 0; i < intentos; i += 1) {
      const datos = await getEntitlements().catch(() => null);
      if (datos?.hasAccess) {
        setEntitlements(datos);
        return datos;
      }
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
    return refresh();
  }, [refresh]);

  const hasFeature = useCallback(
    (feature) => Boolean(entitlements.features?.includes(feature)),
    [entitlements.features],
  );

  const isAtLimit = useCallback((resource) => {
    const limite = resource === 'RESTAURANT'
      ? entitlements.limits?.maxRestaurants
      : entitlements.limits?.maxUserAccounts;
    if (limite === null || limite === undefined) return false; // ilimitado
    return (entitlements.usage?.[resource] ?? 0) >= limite;
  }, [entitlements.limits, entitlements.usage]);

  return (
    <EntitlementsContext.Provider
      value={{ ...entitlements, loading, hasFeature, isAtLimit, refresh, refreshAfterCheckout }}
    >
      {children}
    </EntitlementsContext.Provider>
  );
};
```

- [ ] **Step 6: Montar el proveedor y añadir el permiso**

En `main.jsx`, envolver **dentro** de `AuthProvider` (depende del token):

```jsx
        <AuthProvider>
          <EntitlementsProvider>
            {/* ... el resto del árbol, sin cambios */}
          </EntitlementsProvider>
        </AuthProvider>
```

En `config/permissions.js`, añadir a `PERMISSIONS`:

```js
  // ── Facturación ──
  MANAGE_BILLING: 'MANAGE_BILLING',
```

`SUPER_ADMIN` y `ADMIN` ya lo tienen por el comodín `'*'`. **No** añadirlo a las listas de
`MANAGER` ni `EMPLOYEE`: el estado de pago de la empresa no es asunto suyo. Y en
`ROUTE_PERMISSIONS` y `SIDEBAR_PERMISSIONS`:

```js
  '/settings/billing': PERMISSIONS.MANAGE_BILLING,
```

Más su mensaje en `DENIED_MESSAGES`:

```js
  [PERMISSIONS.MANAGE_BILLING]: 'La facturación solo está disponible para administradores.',
```

- [ ] **Step 7: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante-frontend && pnpm test`
Expected: PASS, incluidos los tests existentes.

Run: `cd restaurante-frontend && pnpm lint`
Expected: sin errores.

- [ ] **Step 8: Commit**

```bash
git add restaurante-frontend/src/services/billingService.js \
        restaurante-frontend/src/config \
        restaurante-frontend/src/context \
        restaurante-frontend/src/main.jsx
git commit -m "feat(billing): anadir el contexto de funcionalidades contratadas

El contexto solo decide que se pinta, nunca autoriza: ante un fallo de red se
cierra por defecto en lugar de asumir que el plan incluye todo."
```

---

## Task 13: Página de facturación y comparativa de planes

**Files:**
- Create: `restaurante-frontend/src/components/PlanBadge.jsx`
- Create: `restaurante-frontend/src/components/PlanComparisonModal.jsx`
- Create: `restaurante-frontend/src/pages/Billing.jsx`
- Modify: `restaurante-frontend/src/App.jsx`
- Modify: `restaurante-frontend/src/components/Sidebar.jsx`
- Modify: `restaurante-frontend/src/index.css`
- Test: `restaurante-frontend/src/pages/Billing.test.jsx`

**Interfaces:**
- Consumes: `billingService`, `useEntitlements`, `FEATURE_LABELS`, `STATUS_LABELS`,
  `PLAN_LABELS` (Task 12).
- Produces:
  - `<PlanBadge plan status />` — distintivo compacto reutilizable
  - `<PlanComparisonModal show onClose currentPlan onChoosePlan />`

- [ ] **Step 1: Escribir el test de la página**

```jsx
  it('muestra el plan actual, su estado y la próxima renovación', async () => {
    billingService.getSubscription.mockResolvedValue({
      plan: 'PRO', planName: 'Pro', status: 'ACTIVE',
      currentPeriodEnd: '2026-10-01T00:00:00', trialEnd: null,
      cancelAtPeriodEnd: false, legacyGrant: false, stripeLinked: true,
    });

    render(<Billing />, { wrapper: Wrapper });

    expect(await screen.findByText('Pro')).toBeInTheDocument();
    expect(screen.getByText('Activo')).toBeInTheDocument();
    expect(screen.getByText(/1 de octubre/i)).toBeInTheDocument();
  });

  it('avisa de una cancelación programada sin alarmar', async () => {
    billingService.getSubscription.mockResolvedValue({
      plan: 'PRO', planName: 'Pro', status: 'ACTIVE',
      currentPeriodEnd: '2026-10-01T00:00:00',
      cancelAtPeriodEnd: true, stripeLinked: true,
    });

    render(<Billing />, { wrapper: Wrapper });

    expect(await screen.findByText(/se cancelará el/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reactivar/i })).toBeInTheDocument();
  });

  it('redirige a Stripe al contratar un plan', async () => {
    billingService.startCheckout.mockResolvedValue('https://checkout.stripe.test/x');
    const asignar = vi.fn();
    vi.stubGlobal('location', { assign: asignar, href: '', search: '' });

    render(<Billing />, { wrapper: Wrapper });
    await userEvent.click(await screen.findByRole('button', { name: /cambiar a pro/i }));

    await waitFor(() => expect(billingService.startCheckout).toHaveBeenCalledWith('PRO'));
  });

  it('avisa cuando hay locales bloqueados por el plan', async () => {
    // entitlements con usage.RESTAURANT = 3 y limits.maxRestaurants = 1
    render(<Billing />, { wrapper: Wrapper });
    expect(await screen.findByText(/elige cuál quieres mantener activo/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Ejecutar el test y verificar que falla**

Run: `cd restaurante-frontend && pnpm test Billing`
Expected: FAIL — no existe la página.

- [ ] **Step 3: Escribir PlanBadge**

Distintivo compacto, reutilizado en la página, el sidebar y la comparativa:

```jsx
import { PLAN_LABELS, STATUS_LABELS } from '../config/features';

/**
 * Distintivo del plan contratado. Discreto a propósito: informa, no vende.
 */
const PlanBadge = ({ plan, status, size = 'md' }) => {
  if (!plan) return null;
  const estado = STATUS_LABELS[status];
  return (
    <span className={`plan-badge plan-badge--${plan.toLowerCase()} plan-badge--${size}`}>
      {PLAN_LABELS[plan] ?? plan}
      {estado && estado.tone !== 'success' && (
        <span className={`plan-badge__state plan-badge__state--${estado.tone}`}>
          {estado.text}
        </span>
      )}
    </span>
  );
};

export default PlanBadge;
```

- [ ] **Step 4: Escribir PlanComparisonModal**

Modal con la tabla NORMAL vs PRO, alimentada por `getPlans()` y `FEATURE_LABELS`. Marca el
plan actual con "Tu plan" y **desactiva** su botón. Sin cuentas atrás, sin "¡oferta!", sin
lenguaje de urgencia: una tabla honesta con dos columnas. Usa `.modal` de Bootstrap como los
modales existentes (`RestaurantDetailModal`, `QRModal`).

- [ ] **Step 5: Escribir la página Billing**

Estructura en cuatro bloques, de arriba abajo:

1. **Plan actual** — `PlanBadge`, estado en lenguaje humano y fecha de renovación (o de fin
   de prueba, o de cancelación). Si `legacyGrant` es true, una nota discreta: *"Plan de
   cortesía activo"*.
2. **Uso frente a límites** — dos barras: locales y cuentas. Con límite `null` se muestra
   "Sin límite" en vez de una barra al 0 %.
3. **Aviso de reconciliación**, sólo si `usage.RESTAURANT > limits.maxRestaurants`: la lista
   de locales con un selector para elegir el activo → `setActiveRestaurant(id)`. Texto
   explícito de que **no se ha borrado nada**.
4. **Acciones** — Cambiar de plan (abre la comparativa), Gestionar suscripción (portal de
   Stripe), Cancelar / Reactivar. `Cancelar` pide confirmación y ofrece las dos variantes:
   al final del periodo (recomendada) o inmediata.

Al montar, si `location.search` contiene `checkout=success`, llamar a
`refreshAfterCheckout()` y mostrar *"Estamos confirmando tu pago…"* mientras tanto; con
`checkout=cancel`, no mostrar ningún error: el usuario simplemente cambió de idea.

- [ ] **Step 6: Enganchar ruta y sidebar**

En `App.jsx`, dentro del bloque de rutas protegidas:

```jsx
        <Route path="/settings/billing" element={
          <PermissionRoute permission={PERMISSIONS.MANAGE_BILLING}><Billing /></PermissionRoute>
        } />
```

En `Sidebar.jsx`, una entrada "Facturación" en la sección de administración, filtrada por
`SIDEBAR_PERMISSIONS` como el resto.

- [ ] **Step 7: Estilos**

En `index.css`, al final, un bloque nuevo con la cabecera de sección del archivo. Usar
**sólo tokens existentes** (`--bg-card`, `--border`, `--primary`, `--text-secondary`,
`--radius-lg`, `--space-*`, `--shadow-sm`). Verificar en claro y en oscuro: el tema oscuro
es azul noche, así que nada de colores fijos.

- [ ] **Step 8: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante-frontend && pnpm test`
Expected: PASS.
Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: sin errores.

- [ ] **Step 9: Commit**

```bash
git add restaurante-frontend/src
git commit -m "feat(billing): anadir la pagina de facturacion y la comparativa de planes"
```

---

## Task 14: Diálogo de mejora de plan y candados

Cerrar el círculo: cuando el backend responde `PLAN_UPGRADE_REQUIRED`, el usuario ve una
explicación, no un error.

**Files:**
- Create: `restaurante-frontend/src/components/UpgradeModal.jsx`
- Modify: `restaurante-frontend/src/api/axios.js`
- Modify: `restaurante-frontend/src/layouts/MainLayout.jsx`
- Modify: `restaurante-frontend/src/components/Sidebar.jsx`
- Test: `restaurante-frontend/src/components/UpgradeModal.test.jsx`
- Test: `restaurante-frontend/src/api/axios.test.js`

**Interfaces:**
- Consumes: `FEATURE_LABELS` (Task 12); `useEntitlements` (Task 12).
- Produces: evento `plan:upgrade-required` con
  `detail: { code, feature, requiredPlan, message, resource, limit, current }`.

- [ ] **Step 1: Escribir los tests**

```js
  it('emite plan:upgrade-required ante un 403 con ese código', async () => {
    const escucha = vi.fn();
    window.addEventListener('plan:upgrade-required', escucha);

    await simularRespuesta({
      status: 403,
      data: { success: false, code: 'PLAN_UPGRADE_REQUIRED',
              message: 'Esta función requiere el plan Pro',
              data: { feature: 'EXPORT_DATA', requiredPlan: 'PRO' } },
    });

    expect(escucha).toHaveBeenCalled();
    expect(escucha.mock.calls[0][0].detail.feature).toBe('EXPORT_DATA');
  });

  it('un 403 normal de permisos NO abre el diálogo de mejora', async () => {
    const escucha = vi.fn();
    window.addEventListener('plan:upgrade-required', escucha);

    await simularRespuesta({
      status: 403,
      data: { success: false, message: 'No tiene permisos para realizar esta operación.' },
    });

    // Sin código, es un problema de rol, no de plan: mezclarlos confundiría al
    // usuario ofreciéndole pagar por algo que su rol nunca le va a dejar hacer.
    expect(escucha).not.toHaveBeenCalled();
  });

  it('el diálogo explica la funcionalidad concreta y ofrece un solo CTA', async () => {
    render(<UpgradeModal />, { wrapper: Wrapper });
    window.dispatchEvent(new CustomEvent('plan:upgrade-required', {
      detail: { feature: 'EXPORT_DATA', requiredPlan: 'PRO' },
    }));

    expect(await screen.findByText('Exportación de datos')).toBeInTheDocument();
    expect(screen.getByText(/Descarga tus reservas en CSV/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /actualizar a pro/i })).toHaveLength(1);
  });

  it('un límite alcanzado muestra el detalle numérico', async () => {
    render(<UpgradeModal />, { wrapper: Wrapper });
    window.dispatchEvent(new CustomEvent('plan:upgrade-required', {
      detail: { code: 'PLAN_LIMIT_REACHED', resource: 'RESTAURANT',
                limit: 1, current: 1, requiredPlan: 'PRO' },
    }));

    expect(await screen.findByText(/1 de 1 locales/i)).toBeInTheDocument();
  });
```

- [ ] **Step 2: Ejecutar los tests y verificar que fallan**

Run: `cd restaurante-frontend && pnpm test UpgradeModal`
Expected: FAIL — no existe el componente.

- [ ] **Step 3: Emitir el evento desde el interceptor**

En `api/axios.js`, sustituir la rama del 403 (que hoy sólo hace `console.error`):

```js
      } else if (status === 403) {
        const { code, message, data } = error.response.data ?? {};
        if (code === 'PLAN_UPGRADE_REQUIRED' || code === 'PLAN_LIMIT_REACHED') {
          // Mismo patrón que auth:unauthorized: el interceptor no conoce la
          // interfaz, sólo avisa; quien decide qué mostrar es el componente.
          window.dispatchEvent(new CustomEvent('plan:upgrade-required', {
            detail: { code, message, ...(data ?? {}) },
          }));
        } else {
          // 403 por rol: no es un problema de plan y no debe ofrecer pagar.
          console.error('Acceso denegado: no tienes permisos para este recurso.');
        }
      }
```

- [ ] **Step 4: Escribir UpgradeModal**

Un único modal montado en `MainLayout`, que escucha el evento. Debe:

- Mostrar el **nombre y la descripción** de la feature desde `FEATURE_LABELS`, o el detalle
  numérico del límite (*"Estás usando 1 de 1 locales"*) si el código es `PLAN_LIMIT_REACHED`.
- Un solo CTA, "Actualizar a Pro", que lleva a `/settings/billing`.
- Un enlace secundario "Ver comparativa de planes".
- Cerrarse con Escape y con el botón de cierre, sin reaparecer solo.
- **No mostrarse dos veces seguidas por el mismo motivo**: si el usuario lo cierra, no
  reabrirlo hasta que cambie la feature o pasen 60 segundos. *No abusar de ventanas de
  venta* es un requisito explícito, no un detalle.

- [ ] **Step 5: Candados discretos**

En `Sidebar.jsx` y en los botones de funciones PRO, usar `hasFeature(...)` para añadir un
icono de candado y `title="Disponible en el plan Pro"`. **El elemento sigue siendo pulsable**
y abre el diálogo explicativo: esconderlo del todo deja al usuario sin saber que existe, y
deshabilitarlo sin explicación es peor.

Banner en `MainLayout` **sólo** cuando hay algo que resolver: `status === 'PAST_DUE'`,
`cancelAtPeriodEnd`, o locales bloqueados. Nunca un banner permanente de venta.

- [ ] **Step 6: Ejecutar los tests y verificar que pasan**

Run: `cd restaurante-frontend && pnpm test`
Expected: PASS.
Run: `cd restaurante-frontend && pnpm lint && pnpm build`
Expected: sin errores.

- [ ] **Step 7: Commit**

```bash
git add restaurante-frontend/src
git commit -m "feat(billing): anadir el dialogo de mejora de plan y los candados

El interceptor distingue el 403 por plan del 403 por rol: mezclarlos ofreceria
pagar por algo que el rol del usuario nunca le va a permitir hacer."
```

---

# FASE E — Prueba de extremo a extremo y cierre

## Task 15: Prueba real con Stripe y auditoría final

**Files:**
- Modify: `CLAUDE.md`
- Create: `docs/billing-stripe-setup.md`

- [ ] **Step 1: Preparar Stripe en modo test**

En el panel de Stripe, **en modo test**:

1. Crear dos productos: `Restaurant Manager Normal` y `Restaurant Manager Pro`.
2. A cada uno, un precio **recurrente mensual** en EUR. Anotar los `price_...` (no los
   `prod_...`).
3. Copiar la clave secreta de test (`sk_test_...`) desde Desarrolladores → Claves de API.
4. Activar el portal de cliente en Configuración → Facturación → Portal de cliente,
   permitiendo cancelar y cambiar de plan entre los dos precios creados.

Instalar la CLI y arrancar el reenvío de webhooks:

```bash
stripe login
stripe listen --forward-to localhost:8080/api/v1/webhooks/stripe
```

La CLI imprime un `whsec_...`: ese es `STRIPE_WEBHOOK_SECRET` **en local** (es distinto del
de producción).

Rellenar `restaurante_manage/.env` (ya ignorado por git) con las cinco variables.
**Verificar antes de continuar** que `.env` no aparece en `git status`.

- [ ] **Step 2: Probar el flujo completo**

Con MySQL arrancado, `mvn spring-boot:run` (sin perfil), `pnpm dev` y `stripe listen` en
marcha, recorrer y anotar el resultado de cada paso:

1. Entrar como ADMIN → `/settings/billing` → se ve el plan de cortesía.
2. "Cambiar a Pro" → Stripe Checkout → tarjeta `4242 4242 4242 4242`, fecha futura, CVC
   cualquiera → pagar.
3. Vuelta a `/settings/billing?checkout=success` → **el plan pasa a Pro en segundos**, sin
   recargar a mano. En `stripe listen` se ven los eventos entrando.
4. Comprobar en la base de datos que `legacy_grant` ha pasado a 0 y que hay
   `stripe_subscription_id`.
5. "Gestionar suscripción" → se abre el portal de Stripe y vuelve a la aplicación.
6. Bajar a Normal desde la aplicación con 3 locales → verificar que **los 3 siguen
   existiendo**, que sólo el más antiguo queda activo y que se puede elegir otro.
7. Volver a Pro → los 3 se reactivan y **no falta ninguna reserva**.
8. Simular un pago fallido:
   `stripe trigger invoice.payment_failed` → el estado pasa a `PAST_DUE`, aparece el banner
   y **el QR público sigue funcionando**.
9. Cancelar de inmediato → el QR público se cierra con mensaje neutro.
10. Como usuario NORMAL, llamar a mano al endpoint de exportación:
    `curl -i -H "Authorization: Bearer <token>" localhost:8080/api/v1/reservations/export`
    → **403 `PLAN_UPGRADE_REQUIRED`**. Es la prueba de que ocultar el botón no es la defensa.

- [ ] **Step 3: Auditoría de seguridad**

Recorrer y dejar constancia de cada punto:

```bash
# 1. Ningún secreto en el repositorio
git grep -nE "sk_(test|live)_|whsec_|price_1" -- ':!docs/' ':!*.example'
# Expected: sin resultados

# 2. El .env no está seguido por git
git check-ignore -v restaurante_manage/.env
# Expected: coincide con una regla de .gitignore

# 3. Ningún endpoint acepta el plan desde el cuerpo de la petición
git grep -n "setPlanCode" -- restaurante_manage/src/main
# Expected: sólo dentro de SubscriptionService.applySnapshot y la creación inicial

# 4. Ningún endpoint acepta tenantId del cliente en billing
git grep -n "tenantId" -- restaurante_manage/src/main/java/com/restaurante/subscription/controller
# Expected: sin resultados

# 5. La reconciliación no borra nada
git grep -nE "\.delete\(|setDeleted\(true\)" -- \
  restaurante_manage/src/main/java/com/restaurante/subscription
# Expected: sin resultados
```

Repasar además a mano:

- Aislamiento entre inquilinos en cada endpoint nuevo de billing (el tenant sale del token).
- IDOR en `active-restaurant` (cubierto por test, verificar que sigue).
- Que el webhook responde 400 sin firma y 400 con firma inválida.
- Que ningún log imprime el payload completo de Stripe ni claves.
- Que `SUPER_ADMIN` sin tenant no provoca ningún error 500 en `/billing/*`.
- Duplicación: que no hay dos sitios comprobando el mismo límite.
- Que no queda ningún valor fijo en el código que debiera ser configuración.

- [ ] **Step 4: Verificar contra el MySQL de producción — ANTES de desplegar**

Repetir en Railway la comprobación de sólo lectura hecha en local:

```sql
SELECT COUNT(*) FROM tenants WHERE deleted = b'0';
SELECT COUNT(*) FROM restaurants WHERE tenant_id IS NULL AND deleted = b'0';
SELECT t.id, t.name,
       (SELECT COUNT(*) FROM restaurants r WHERE r.tenant_id = t.id AND r.deleted = b'0') AS locales,
       (SELECT COUNT(*) FROM users u WHERE u.tenant_id = t.id AND u.deleted = b'0') AS cuentas
  FROM tenants t WHERE t.deleted = b'0';
SELECT version, success FROM flyway_schema_history ORDER BY installed_rank DESC LIMIT 1;
```

**Si aparece algún restaurante vivo con `tenant_id NULL`, PARAR y consultar al usuario**: ese
local no pertenecería a ninguna suscripción y quedaría fuera de todo límite y de todo
bloqueo. En local no había ninguno, pero producción es otra base.

- [ ] **Step 5: Documentar el despliegue**

Crear `docs/billing-stripe-setup.md` con: los pasos del panel de Stripe, la tabla de
variables de entorno por entorno (local / Railway / Vercel), cómo registrar el webhook de
producción apuntando a
`https://saas-restaurantes-production-ee67.up.railway.app/api/v1/webhooks/stripe`, y el aviso
de que el `whsec_` de producción es distinto del de la CLI.

Actualizar `CLAUDE.md`:

- Corregir los **tres puntos desactualizados** detectados en el análisis: `ddl-auto` es
  `validate`, el esquema lo gestiona **Flyway** (`V1`…`V9`), y **sí hay tests de frontend**
  (vitest, `pnpm test`).
- Añadir un apartado sobre planes y entitlements: `EntitlementService` es la autoridad única,
  el catálogo vive en `PlanCatalog`, y la comprobación de plan va en la capa de servicio
  junto a la de tenant.

- [ ] **Step 6: Ejecutar todo por última vez**

```bash
cd restaurante_manage && mvn test
cd ../restaurante-frontend && pnpm lint && pnpm test && pnpm build
```

Expected: todo en verde. **No declarar el trabajo terminado sin haber visto esta salida.**

- [ ] **Step 7: Commit final**

```bash
git add CLAUDE.md docs/billing-stripe-setup.md
git commit -m "docs(billing): documentar la configuracion de Stripe y actualizar CLAUDE.md"
```

- [ ] **Step 8: Entregar, sin desplegar**

Resumir al usuario: qué se ha construido, la salida real de los tests, los pasos manuales
que le tocan en el panel de Stripe y las variables que debe definir en Railway y Vercel.

**No hacer push, no abrir PR y no desplegar sin que lo pida.** La migración V9 se aplica sola
en el primer arranque tras el despliegue: conviene decírselo explícitamente antes de que
suba nada.

---

## Notas para quien ejecute el plan

- **Andamiaje de test compartido.** Las Tasks 5, 7, 8, 9, 10 y 11 reutilizan los métodos de
  siembra definidos íntegramente en el Step 1 de la **Task 4**
  (`crearTenant`, `crearSuscripcion`, `crearRestaurante`, `crearAdmin`, `cuerpoRestaurante`).
  Para entonces ya existen en
  `src/test/java/com/restaurante/subscription/PlanLimitsEndpointIntegrationTest.java`:
  cópialos de ahí. Si acabas repitiéndolos por cuarta vez, extráelos a una clase base
  `SubscriptionTestSupport` en ese mismo paquete y haz que los tests la hereden.
- **Dónde está la parte menos prescrita.** Dos puntos piden criterio propio y conviene
  revisarlos con calma: los tres métodos auxiliares de `StripeWebhookService` (Task 9,
  Step 3) y la maquetación de `Billing.jsx` (Task 13, Step 5). El comportamiento exigido está
  descrito por completo; lo que no está escrito línea a línea es la implementación.

- **Si un test existente se pone en rojo por falta de suscripción**, es un fallo legítimo del
  test: hay que sembrarle una suscripción PRO activa, no relajar la comprobación de plan.
- **Si Hibernate se queja al arrancar contra MySQL**, la entidad y la V9 no coinciden.
  Arreglar antes de seguir: en producción, ese error impide arrancar la aplicación.
- **Nunca arrancar con `-Dspring-boot.run.profiles=dev` para "comprobar algo"** contra lo que
  el usuario cree que son sus datos reales: ese perfil usa H2 y los borra en cada arranque.
- Ante cualquier decisión que afecte a datos de producción, **parar y preguntar**.
