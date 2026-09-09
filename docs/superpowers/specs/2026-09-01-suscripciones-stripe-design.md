# Suscripciones y planes (NORMAL / PRO) con Stripe Billing

**Fecha:** 2026-09-01
**Estado:** aprobado por el usuario, pendiente de plan de implementación

## Objetivo

Convertir la aplicación en un SaaS comercial con dos planes de suscripción por **tenant**
(NORMAL y PRO), cobrados con Stripe Billing, donde el backend es quien decide qué puede
hacer cada tenant y Stripe es la única fuente de verdad del estado de pago.

La arquitectura debe permitir añadir planes y funcionalidades nuevas sin sembrar el código
de `if (plan == PRO)`: un catálogo centralizado plan → features + límites, y una única
autoridad de consulta (`EntitlementService`), al mismo nivel conceptual que
`CurrentUserService` lo es para el aislamiento multi-tenant.

Fuera de alcance en esta especificación: registro público de cuentas (self-signup),
facturación anual, y la implementación funcional de automatizaciones y recordatorios a
clientes (sí se declaran como features del catálogo).

## Situación de partida

Verificada sobre el código y sobre la base de datos MySQL local el 2026-09-01.

### Esquema y migraciones

- `application.yml` fija `ddl-auto: validate`; **el esquema lo gestiona Flyway**
  (`V1__baseline_schema.sql` … `V8__add_service_periods.sql`, `baseline-on-migrate: true`).
  El siguiente número libre es **V9**.
- `application-dev.yml` (perfil `dev`) usa H2 con `create-drop`, **Flyway desactivado** y
  `data.sql`. Los tests de integración corren con ese perfil.
- Consecuencia: toda tabla nueva necesita **migración Flyway (MySQL/prod) + entidad JPA
  correcta** (H2/dev y tests). Un desajuste entidad↔migración **impide arrancar en
  producción**, porque `validate` falla al iniciar.
- `CLAUDE.md` está desactualizado en tres puntos: afirma `ddl-auto: update/create-drop`,
  "no hay scripts de migración" y "no hay tests de frontend". Los tres son falsos.

### Datos existentes (MySQL local, 2026-09-01)

| Dato | Valor |
|---|---|
| Tenants vivos | 2: `Demo Gourmet` (id 1) y `Legacy/Test` (id 2) |
| `Demo Gourmet` | 3 restaurantes vivos, 5 cuentas vivas |
| `Legacy/Test` | 2 restaurantes vivos, 0 cuentas con `tenant_id` |
| Restaurantes con `tenant_id NULL` | 2 (ids 3 y 4), **ambos ya con `deleted = 1`** |
| Restaurantes vivos sin tenant | **0** |
| Cuentas vivas con `tenant_id NULL` | 8: `super.admin` (correcto) + 7 residuos `@test.com` del 08/06 |
| Flyway | último aplicado V8, todos `success = 1` |

`Demo Gourmet` está fuera del plan NORMAL: **3 locales frente a 1**, y **5 cuentas justo en el
tope de 5** (no podría crear ni una más). Confirma que cualquier migración que no sea PRO
de cortesía rompería la cuenta el día del despliegue.

Los 7 residuos `@test.com` sin tenant (dos de ellos `ROLE_ADMIN`) son anteriores a la
multi-tenancy y **no se tocan** en este trabajo; obligan a que los endpoints de billing
traten explícitamente el caso *"usuario no SUPER_ADMIN sin tenant"*.

La base de datos de producción (Railway) es distinta y no se ha inspeccionado. La migración
se escribe como `INSERT ... SELECT` sobre los tenants existentes, por lo que es correcta en
ambas, pero **la comprobación se repetirá contra Railway antes de desplegar**.

### Autorización actual

- `CurrentUserService` es la autoridad única de scoping multi-tenant:
  `getVisibleRestaurantIds()` (lista vacía = "sin filtro", `[-1]` = "nada"),
  `canAccessRestaurant(id)`, `validateRestaurantAccess(id)`, con logging de auditoría.
- El rol se comprueba con `@PreAuthorize("hasAnyRole(...)")` en los controladores.
- El JWT (`JwtTokenProvider`) lleva `userId, email, roles, restaurantId, tenantId,
  assignedRestaurantIds`. **Expiración 24 h y no hay refresh token.**
- `SUPER_ADMIN` no tiene tenant (`tenantId` nulo).
- Superficie pública en `SecurityConfig`: `POST /auth/login`, forgot/reset password,
  `GET /restaurants`, `GET /restaurants/*`, `/api/v1/public/**`. CSRF desactivado
  globalmente; sesiones stateless.

### Otros hechos relevantes

- **No existe registro público.** `POST /auth/register` exige un ADMIN/SUPER_ADMIN
  autenticado y **nunca crea un Tenant**: lo hereda del creador o del restaurante.
- `ApiResponse {success, message, data, timestamp}` con `@JsonInclude(NON_NULL)`.
  **No tiene campo `code`**: hoy todo 403 es una cadena sin tipar.
- `GlobalExceptionHandler` mapea 7 excepciones propias a status + `ApiResponse.error(...)`.
- `Employee` (ficha de RRHH, con `hasSystemAccess` y `User` opcional enlazado) y `User`
  (cuenta de acceso) son entidades distintas.
- No existe paquete `dashboard` ni `analytics`; `/analytics` en el frontend redirige a
  `/inicio`. Sí existen `/reservations/stats`, `/customers/stats`, `/users/stats`,
  `/admin/restaurants/stats`.
- No hay exportación, automatizaciones ni recordatorios a clientes. Sólo emails de
  confirmación/cancelación de reserva vía Resend.
- **No hay ningún límite de cuota en el sistema**: `RestaurantService.create()` y la
  creación de usuarios no comprueban nada.
- Frontend: `permissions.js` (rol→permiso), `ProtectedRoute` + `PermissionRoute`, 11
  servicios API, contextos de auth/tema/notificaciones, **vitest con tests existentes**.
- `axios.js`: en 401 limpia sesión y emite `CustomEvent('auth:unauthorized')`; en 403 sólo
  hace `console.error`.
- Producción: Railway (backend, Docker, Root Directory `restaurante_manage`) + Vercel
  (frontend, Root Directory `restaurante-frontend`). Secretos por variables de entorno,
  `.env` local ignorado por git.

## Decisiones tomadas

| Decisión | Elegido | Motivo |
|---|---|---|
| Alcance del alta | Sólo billing; el alta de tenants sigue siendo manual | No tocar la superficie de auth, la más sensible. El self-signup es un proyecto propio posterior. |
| Qué limita "5 empleados" | **Cuentas de `User` activas** del tenant | Es el coste real del SaaS (modelo per-seat). Las fichas de `Employee` sin acceso son datos del restaurante, no asientos. |
| Downgrade con exceso de locales | Gracia + el usuario elige cuál queda activo | Nada se borra. Sin elección, queda activo el más antiguo (determinista). El resto pasa a solo lectura, reversible al volver a PRO. |
| Migración de tenants existentes | **PRO de cortesía** (`legacyGrant`), sin Stripe y sin caducidad automática | Cero regresiones el día del despliegue. `Demo Gourmet` excede NORMAL, cualquier otra opción lo rompe. |
| Periodo de prueba | **14 días**, vía `trial_period_days` en Checkout | Estándar del sector; margen para probar un servicio real completo. |
| Periodicidad | **Sólo mensual** en v1 | El catálogo se diseña con la periodicidad como dimensión: añadir anual = crear el precio en Stripe + una variable de entorno. |
| QR público al impagar | Sigue activo en `PAST_DUE`; se cierra en `CANCELED`/`UNPAID` | Un pago fallido suele ser una tarjeta caducada, no un abandono. No se castiga al cliente final del restaurante mientras Stripe reintenta. |
| Catálogo de planes | **Enum + catálogo inmutable en código**, no tablas | Con `ddl-auto: validate`, una tabla `plan_features` mal sembrada = todos los tenants sin features. El catálogo en código se testea; una fila no. La extensibilidad la da la centralización, no el estar en BD. |
| Dónde se comprueba la feature | **Capa de servicio**, llamada explícita | Es donde ya vive `validateRestaurantAccess()`. Autorizar en dos capas distintas es cómo se cuelan los agujeros. Evita además `spring-boot-starter-aop`. |
| Separación de endpoints | `/billing/entitlements` (cualquier rol) vs `/billing/subscription` (ADMIN+) | Un EMPLOYEE necesita saber si pintar un candado; no tiene por qué ver el estado de pago de la empresa. |
| Plan en el JWT | **Nunca** | El token dura 24 h sin refresh: un usuario que paga seguiría siendo NORMAL hasta 24 h. Se lee del servidor en cada petición. |
| Caché de entitlements | **Sin caché en v1** | Una consulta por PK indexada es despreciable frente a las que ya hace la app, y elimina una clase entera de bugs de estado obsoleto. Se añadirá cuando se mida. |

## Ajustes a la distribución de planes propuesta

1. **"Roles básicos vs avanzados" sale del argumentario.** Los 4 roles actuales son fijos y
   ya están construidos; degradar `MANAGER` a PRO rompería cuentas existentes. Los roles
   completos van en NORMAL. `ADVANCED_PERMISSIONS` se declara en el catálogo para el futuro
   editor de roles, pero **no se anuncia** hasta que exista.
2. **Dashboard vs analítica avanzada se corta por horizonte temporal**: NORMAL ve hoy y los
   últimos 7 días; PRO ve histórico completo. Es la única línea objetiva e implementable
   hoy, y se aplica dentro de los endpoints de stats.
3. **La exportación CSV se implementa de verdad** en esta fase. Es la feature PRO más barata
   y la más percibida; sin ella PRO se compra sólo por quitar un límite.
4. **"Soporte prioritario" no entra en el enum**: no hay nada que comprobar en código. Es
   una promesa comercial de la tabla comparativa.
5. **No se limita el número de mesas.** Castigaría al restaurante grande de un solo local,
   que es el mejor cliente NORMAL.

### Distribución final

| | NORMAL | PRO |
|---|---|---|
| Locales | 1 | ilimitados |
| Cuentas de usuario activas | 5 | ilimitadas |
| Reservas, clientes, mesas, plano de sala, agenda | sí | sí |
| QR / enlace público de reservas | sí | sí |
| Roles del sistema (4) | sí | sí |
| Estadísticas | hoy + 7 días | histórico completo |
| Exportación CSV | no | sí |
| Automatizaciones · recordatorios | no | declarado, sin implementar |
| Soporte prioritario | — | promesa comercial, fuera del código |

## Arquitectura

Tres capas de autorización independientes, ninguna sustituye a otra:

```
Petición
  → JwtAuthenticationFilter                              ¿quién eres?
  → @PreAuthorize hasAnyRole(...)                        capa 1: ROL      (ya existe)
  → Service:
      currentUserService.validateRestaurantAccess(id)    capa 2: TENANT   (ya existe)
      entitlements.require(Feature.EXPORT_DATA)          capa 3: PLAN     (nuevo)
```

`ROLE` responde *¿puede este usuario?*. `PLAN` responde *¿ha contratado su empresa esto?*.
Se mantienen deliberadamente separados: un `MANAGER` de un tenant PRO puede exportar; un
`ADMIN` de un tenant NORMAL, no.

Paquete nuevo `subscription/`, siguiendo el layout por feature del proyecto
(`controller/`, `service/`, `repository/`, `entity/`, `enums/`, `dto/`).

## Entidades

### Catálogo (código, sin tablas)

```java
enum PlanCode { NORMAL, PRO }

enum Feature {
    MULTI_RESTAURANT, ADVANCED_ANALYTICS, EXPORT_DATA,
    ADVANCED_PERMISSIONS, AUTOMATIONS, CUSTOMER_REMINDERS
}

enum SubscriptionStatus {
    TRIALING, ACTIVE, PAST_DUE, CANCELED, UNPAID, INCOMPLETE, INCOMPLETE_EXPIRED;
    // grantsAccess(): TRIALING, ACTIVE, PAST_DUE -> true; el resto -> false
    // allowsPublicBooking(): TRIALING, ACTIVE, PAST_DUE -> true
}

enum Resource { RESTAURANT, USER_ACCOUNT }   // ejes de cuota, para requireCapacity()

record PlanLimits(Integer maxRestaurants, Integer maxUserAccounts) // null = ilimitado

final class PlanCatalog  // PlanCode -> features + límites + nombre comercial
```

`INCOMPLETE_EXPIRED` se incluye aunque no estaba en la lista original: Stripe lo emite, y
sin él un webhook real no mapearía y rompería la idempotencia.

`PAST_DUE` concede acceso (`grantsAccess() == true`) por la decisión sobre el QR público.

### `Subscription` — tabla `subscriptions`, extiende `BaseEntity`

| Campo | Tipo | Notas |
|---|---|---|
| `id` | `Long` identity | |
| `tenant` | `@OneToOne`, `tenant_id` UNIQUE NOT NULL | una suscripción por tenant |
| `planCode` | enum `STRING` NOT NULL | |
| `status` | enum `STRING` NOT NULL | |
| `stripeCustomerId` | `String(255)` nullable, índice | nulo en cortesía |
| `stripeSubscriptionId` | `String(255)` nullable, UNIQUE | nulo en cortesía |
| `stripePriceId` | `String(255)` nullable | de aquí se deduce el plan |
| `currentPeriodStart` / `currentPeriodEnd` | `LocalDateTime` nullable | |
| `trialEnd` | `LocalDateTime` nullable | |
| `cancelAtPeriodEnd` | `boolean` NOT NULL default false | |
| `legacyGrant` | `boolean` NOT NULL default false | cortesía: plan válido sin Stripe |
| `lastStripeEventAt` | `LocalDateTime` nullable | descarta webhooks fuera de orden |
| `createdAt` / `updatedAt` / `deleted` / `deletedAt` | heredados de `BaseEntity` | |

### `ProcessedStripeEvent` — tabla `stripe_processed_events`

`id`, `stripe_event_id` (UNIQUE NOT NULL), `type`, `processed_at`. La idempotencia se
consigue por **restricción UNIQUE de base de datos**, no por comprobación previa: una
comprobación previa tiene condición de carrera, una UNIQUE no.

### Modificación en entidad existente (una sola columna)

`Restaurant.activeUnderPlan` → `active_under_plan BOOLEAN NOT NULL DEFAULT TRUE`.

Es el bloqueo suave del downgrade. **Nunca se borra ni se marca `deleted` ningún dato del
cliente por motivos de plan.**

## Comportamiento del downgrade

Tenant PRO con 3 locales que baja a NORMAL (límite 1):

1. Llega `customer.subscription.updated` con el precio NORMAL. Se actualiza el plan.
   **No se toca ningún restaurante en este paso.**
2. El tenant queda en estado *excedido*: locales activos (3) > límite (1).
3. Se marca `activeUnderPlan = true` **sólo en el más antiguo** (menor `id`) y `false` en el
   resto: un estado por defecto seguro y determinista, nunca un vacío.
4. El ADMIN ve un aviso: *"Tu plan incluye 1 local. Elige cuál quieres mantener activo."* →
   `POST /billing/active-restaurant {restaurantId}`, que sólo permite **reordenar** cuál es
   el activo, nunca superar el límite.
5. Un local con `activeUnderPlan = false` queda en **solo lectura**: se ve, se consulta su
   histórico y se exporta si el plan lo permite; **no** admite crear ni editar reservas,
   mesas ni empleados, y su **página pública / QR se cierra**.
6. Al volver a PRO se reactivan todos automáticamente. No hay nada que restaurar porque no
   se perdió nada.

Para el límite de **cuentas** el criterio es distinto y deliberado: al bajar a NORMAL con 8
usuarios **no se deshabilita a nadie**; simplemente no se pueden crear más hasta bajar de 5.
Desactivar cuentas de personas que trabajan al día siguiente es inaceptable.

## Endpoints

Todos bajo `Constants.BILLING_PATH = API_BASE_PATH + "/billing"`, salvo el webhook.

| Método | Ruta | Autorización | Descripción |
|---|---|---|---|
| `GET` | `/billing/plans` | autenticado | Catálogo: planes, features, límites, precio de display. **No expone price IDs.** |
| `GET` | `/billing/entitlements` | autenticado, cualquier rol | Features + límites + uso actual + estado resumido. Lo consume toda la UI. |
| `GET` | `/billing/subscription` | ADMIN, SUPER_ADMIN | Estado completo: fechas, cancelación programada, trial, plan. |
| `POST` | `/billing/checkout` | ADMIN | `{planCode}` → URL de Stripe Checkout. |
| `POST` | `/billing/portal` | ADMIN | → URL del Customer Portal de Stripe. |
| `POST` | `/billing/change-plan` | ADMIN | `{planCode}` → actualiza la suscripción existente en Stripe. |
| `POST` | `/billing/cancel` | ADMIN | `{atPeriodEnd: boolean}`: inmediata o al final del periodo. |
| `POST` | `/billing/reactivate` | ADMIN | Deshace una cancelación programada. |
| `POST` | `/billing/active-restaurant` | ADMIN | `{restaurantId}`: elegir el local activo tras un downgrade. |
| `POST` | `/api/v1/webhooks/stripe` | **público** | Firma obligatoria, cuerpo crudo. |

Reglas de seguridad de esta superficie:

- `POST /billing/checkout` **jamás acepta un `priceId`**: recibe `planCode` y resuelve el
  precio desde variable de entorno en servidor. Es la puerta de "pago 1 € y me llevo PRO".
- El `tenantId` sale **siempre** de `currentUserService.getCurrentTenantId()`, nunca del
  cuerpo de la petición ni de un parámetro.
- Un usuario no SUPER_ADMIN sin tenant recibe un 400 explicativo, no un NPE.
- `SUPER_ADMIN` no tiene tenant: los endpoints de billing le responden con un 400
  explicativo, y queda **exento de todo límite y toda feature** (es el dueño del SaaS).

## Estrategia Stripe

**Dependencia nueva:** `com.stripe:stripe-java` 33.x estable (33.4.0 en la fecha de esta
especificación; se fijará la última estable al implementar). Es la única dependencia nueva
del backend y es inevitable. Es una librería fuertemente tipada que fija internamente la
versión de la API de Stripe.

**Abstracción:** interfaz `StripeGateway` con implementación real (`StripeGatewayImpl`) y
un *fake* en tests. **Ningún test toca la red ni genera cobros.**

### Flujo de compra

1. `POST /billing/checkout`: si el tenant no tiene `stripeCustomerId`, se crea el Customer
   con `metadata.tenantId`. Se crea la Checkout Session en modo `subscription`, con
   `client_reference_id = tenantId`, `subscription_data.metadata.tenantId`,
   `subscription_data.trial_period_days = 14`, y `success_url`/`cancel_url` construidas
   desde `app.frontend.base-url` (ya existe en `application.yml`).
2. El usuario paga en Stripe. **El backend no ve ni almacena ningún dato de tarjeta.**
3. Stripe envía el webhook → se valida la firma → se actualiza `Subscription`.
4. El frontend vuelve a `/settings/billing?checkout=success` y **repregunta**
   `/billing/entitlements` con reintentos, porque el webhook puede tardar segundos. Nunca
   activa nada por su cuenta.

**Fuente de verdad:** el plan se deduce **siempre del `price_id` que devuelve Stripe**,
mapeado contra las variables de entorno. Nunca de lo que pidió el usuario, ni del frontend.

### Variables de entorno

Ninguna con valor por defecto en el YAML. Ausentes ⇒ billing deshabilitado, no roto.

```
STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET
STRIPE_PRICE_NORMAL_MONTHLY
STRIPE_PRICE_PRO_MONTHLY
STRIPE_TRIAL_DAYS=14
BILLING_ENABLED=true
FRONTEND_URL              (ya existe)
```

Local: `.env` de `restaurante_manage/` (ya ignorado por git) + `stripe listen` de la CLI de
Stripe para recibir webhooks. Producción: variables de Railway (backend) y de Vercel
(frontend, sólo `VITE_API_URL`). **Ningún secreto en el repositorio ni en el YAML.**

### Webhooks

| Evento | Efecto |
|---|---|
| `checkout.session.completed` | Enlaza customer + subscription al tenant. Verifica que `metadata.tenantId` coincide con el `client_reference_id`. |
| `customer.subscription.created` / `.updated` | **Evento maestro**: plan (por price), status, periodo, `cancelAtPeriodEnd`, `trialEnd`. Dispara la reconciliación de límites. |
| `customer.subscription.deleted` | → `CANCELED`. Bloqueo suave; ningún dato borrado. |
| `invoice.paid` | Confirma `ACTIVE`. |
| `invoice.payment_failed` | → `PAST_DUE`. |
| `customer.subscription.trial_will_end` | Aviso al ADMIN (3 días antes). |

Reglas obligatorias:

- **Firma:** `Webhook.constructEvent(rawBody, sigHeader, secret)`. Si
  `STRIPE_WEBHOOK_SECRET` no está configurado, el endpoint responde **503 y no procesa
  nada** (*fail closed*).
- **Cuerpo crudo:** controlador dedicado con `@RequestBody String`, fuera del envoltorio
  `ApiResponse`. Si Jackson deserializa y reserializa, la firma **falla siempre**.
- **Idempotencia:** `INSERT` en `stripe_processed_events`; si viola la UNIQUE, se responde
  `200 OK` sin reprocesar.
- **Orden:** los eventos con timestamp anterior a `lastStripeEventAt` se descartan. Stripe
  no garantiza el orden y un `updated` viejo puede llegar después de uno nuevo.
- **Códigos de respuesta:** `400` sólo si la firma es inválida (Stripe no reintenta, que es
  lo correcto). `200` para eventos desconocidos o ya procesados. `500` ante fallo
  transitorio propio, **para que Stripe reintente**.
- **Logging:** se registran `eventId` y `type`. **Nunca** el payload completo.
- El endpoint se añade a `permitAll` en `SecurityConfig`. CSRF ya está desactivado.

## Estrategia de features y errores

En la capa de servicio, junto a las validaciones de tenant que ya existen:

```java
entitlements.require(Feature.EXPORT_DATA);           // lanza PlanUpgradeRequiredException
entitlements.requireCapacity(Resource.RESTAURANT);   // lanza PlanLimitReachedException
```

API de `EntitlementService`:

```java
boolean hasFeature(Long tenantId, Feature feature);
void    require(Feature feature);                 // usa el tenant del usuario actual
PlanLimits limits(Long tenantId);
void    requireCapacity(Resource resource);
EffectiveSubscription resolve(Long tenantId);     // aplica legacyGrant y grantsAccess()
```

`ApiResponse` gana **un campo opcional `code`**. Con `@JsonInclude(NON_NULL)` no cambia ni
una sola respuesta existente.

```json
{
  "success": false,
  "code": "PLAN_UPGRADE_REQUIRED",
  "message": "Esta función requiere el plan Pro",
  "data": { "feature": "ADVANCED_ANALYTICS", "requiredPlan": "PRO" }
}
```

```json
{
  "success": false,
  "code": "PLAN_LIMIT_REACHED",
  "message": "Tu plan incluye 1 local",
  "data": { "resource": "RESTAURANT", "limit": 1, "current": 1, "requiredPlan": "PRO" }
}
```

Ambos responden **403**, vía dos excepciones nuevas registradas en
`GlobalExceptionHandler`, siguiendo el patrón de las siete que ya existen.

## Estrategia de migración

`V9__subscriptions.sql`, **100 % aditiva**. Sin `DROP`, sin `DELETE`, sin `UPDATE` sobre
columnas existentes:

1. `CREATE TABLE subscriptions`
2. `CREATE TABLE stripe_processed_events`
3. `ALTER TABLE restaurants ADD COLUMN active_under_plan BOOLEAN NOT NULL DEFAULT TRUE`
   → todos los locales existentes quedan activos.
4. `INSERT INTO subscriptions (...) SELECT ...` — una fila **PRO, `status = 'ACTIVE'`,
   `legacy_grant = 1`, sin IDs de Stripe** por cada tenant existente no borrado.

Resultado el día del despliegue: **cero cambios visibles para los usuarios**. Nadie pierde
un local, nadie pierde una cuenta, nadie encuentra un muro nuevo. La conversión a plan de
pago se decide después, tenant a tenant y avisando, poniendo `legacy_grant = 0`.

En `dev`/H2 lo equivalente vía `data.sql`; los tests siembran su propia suscripción.

**La migración no se ejecuta contra Railway hasta que se repita allí la comprobación de
sólo lectura hecha en local** (tenants, restaurantes huérfanos vivos, cuentas por tenant).

## Frontend

- `src/services/billingService.js` — módulo fino, como los 11 existentes.
- `src/context/EntitlementsContext.jsx` — carga `/billing/entitlements` al iniciar sesión;
  expone `hasFeature()`, `limits`, `usage`, `status`. Se refresca al volver del checkout con
  reintentos.
- `src/config/features.js` — espejo del enum del backend, **sólo para pintar**. No autoriza
  nada.
- **Página `/settings/billing`**: plan actual, estado en lenguaje humano (*Activo · Prueba
  hasta el 15 de sept. · Pago fallido · Se cancelará el 1 de oct.*), fecha de renovación,
  uso frente a límites y los botones (Cambiar a Pro / Volver a Normal / Gestionar
  suscripción / Cancelar / Reactivar). Ruta nueva con permiso `MANAGE_BILLING`, restringido
  a ADMIN y SUPER_ADMIN.
- **`PlanComparisonModal`** — tabla NORMAL vs PRO, reutilizada desde la página de billing y
  desde el modal de upgrade.
- **`UpgradeModal`** — el interceptor de `axios.js` detecta `code ===
  'PLAN_UPGRADE_REQUIRED'` y emite `CustomEvent('plan:upgrade-required')`, **el mismo patrón
  que el `auth:unauthorized` ya existente**. Un único modal en toda la app, con el nombre y
  una frase de la feature concreta, y un CTA.
- Candados discretos en sidebar y botones donde `hasFeature` es falso. **Sin popups
  automáticos ni banners de venta permanentes.** Banner sólo cuando hay algo que el usuario
  debe resolver: pago fallido, cancelación programada, o locales bloqueados por downgrade.
- Estética: tokens existentes (`--primary`, `--bg-card`, `--border`…), correcto en tema
  claro y en el azul noche.

## Testing

Ningún test realiza cobros reales ni llamadas de red: se usa el *fake* de `StripeGateway`,
y los webhooks se firman localmente con HMAC contra un secreto de test.

| Caso | Nivel |
|---|---|
| NORMAL puede usar funciones normales | integración |
| NORMAL **no** puede usar funciones PRO (403 `PLAN_UPGRADE_REQUIRED`) | integración |
| PRO puede usar funciones PRO | integración |
| NORMAL no puede crear un 2º restaurante (403 `PLAN_LIMIT_REACHED`) | integración |
| NORMAL no puede crear la 6ª cuenta | integración |
| Tenant A no accede a la suscripción de Tenant B | integración |
| Webhook con firma válida actualiza el estado | integración |
| Webhook con firma inválida → 400 y **ningún cambio de estado** | integración |
| Webhook duplicado (mismo `event_id`) → 200 y un solo efecto | integración |
| Webhook fuera de orden → se descarta el antiguo | unitario |
| Activación, cancelación inmediata, cancelación al final del periodo, reactivación | unitario + integración |
| Upgrade NORMAL→PRO y downgrade PRO→NORMAL (incluida la reconciliación de locales) | integración |
| Pago fallido → `PAST_DUE` con acceso conservado y QR público abierto | integración |
| `CANCELED`/`UNPAID` → QR público cerrado | integración |
| Tenant sin suscripción → tratado como sin acceso, sin excepción | unitario |
| Usuario sin tenant en endpoints de billing → 400, no NPE | integración |
| Matriz plan × feature del catálogo | unitario (fija el catálogo) |
| Frontend: `UpgradeModal` se abre ante `PLAN_UPGRADE_REQUIRED` | vitest |

## Archivos afectados

**Backend — nuevos (~22):** paquete `subscription/` completo (entidades, enums, catálogo,
repositorios, `EntitlementService`, `SubscriptionService`, `StripeGateway` + impl + fake,
`BillingController`, `StripeWebhookController`, DTOs), 2 excepciones nuevas,
`V9__subscriptions.sql`.

**Backend — modificados (9, con cirugía mínima):**

- `common/dto/ApiResponse.java` — un campo `code` opcional.
- `common/exception/GlobalExceptionHandler.java` — dos handlers nuevos.
- `common/util/Constants.java` — rutas de billing y webhook.
- `security/config/SecurityConfig.java` — webhook en `permitAll`.
- `restaurant/service/RestaurantService.java` — límite al crear + filtro `activeUnderPlan`.
- `user/service/UserService.java` y `auth/service/AuthService.java` — límite de cuentas.
- `publicapi/service/PublicReservationService.java` — cerrar el QR si el estado no permite
  reservas o el local está inactivo.
- `application.yml` — bloque `app.stripe`.
- `pom.xml` — `stripe-java`.

**Frontend — nuevos (7):** `billingService.js`, `EntitlementsContext.jsx`, `features.js`,
`pages/Billing.jsx`, `PlanComparisonModal.jsx`, `UpgradeModal.jsx`, `PlanBadge.jsx`.

**Frontend — modificados (6):** `App.jsx` (ruta), `api/axios.js` (evento de upgrade),
`config/permissions.js` (`MANAGE_BILLING`), `main.jsx` (provider),
`layouts/MainLayout.jsx` (banner), `components/Sidebar.jsx` (entrada + candados).

**Documentación:** actualizar `CLAUDE.md` en los tres puntos desactualizados detectados
(ddl-auto, migraciones Flyway, tests de frontend).

## Riesgos

| # | Riesgo | Mitigación |
|---|---|---|
| 1 | `ddl-auto: validate` + entidad que no cuadra con V9 → el backend no arranca en Railway | Migración y entidades escritas juntas; arranque verificado contra el MySQL local (3307) antes de subir nada. |
| 2 | Restaurantes huérfanos fuera de toda suscripción | **Cerrado**: los 2 huérfanos locales ya están `deleted`; 0 vivos. Se repetirá la comprobación contra Railway. |
| 3 | Webhook mal configurado en Railway → pagos que no activan nada | `BILLING_ENABLED`, `GET /billing/subscription` muestra el desfase, Stripe CLI en local, reintentos automáticos de Stripe. |
| 4 | Retraso del webhook → el usuario paga y ve "NORMAL" unos segundos | Reintentos en el frontend tras `?checkout=success` y estado "procesando pago"; nunca un error. |
| 5 | Los límites nuevos rompen cuentas existentes | PRO de cortesía: el día 1 nadie choca con nada. |
| 6 | El bloqueo suave se olvida en alguna consulta y un local bloqueado sigue operando | El filtro vive en `RestaurantService`/`CurrentUserService`, no repartido; tests de integración específicos. |
| 7 | Alguien añade `if (plan == PRO)` a mano en el futuro | El catálogo es la única fuente; un test fija la matriz plan × feature y rompe la build ante cambios accidentales. |
| 8 | Secretos filtrados al repositorio | Nada en YAML sin `${VAR}`; `.env` ya ignorado; revisión explícita en la auditoría final. |
| 9 | Alcance amplio (~40 archivos) | Ejecución por fases con checkpoints; backend y tests en verde antes de tocar el frontend. |
| 10 | Cuentas `ROLE_ADMIN` sin tenant (7 residuos) llegando a endpoints de billing | Tratamiento explícito con 400; no se modifican esos datos en este trabajo. |
